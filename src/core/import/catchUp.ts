/**
 * Section 1.2, new messages.
 *
 * "Whenever the user receives a new SMS, the app should detect the message,
 * extract the transaction details, and save the information in transaction
 * table."
 *
 * This reads forward from the watermark rather than reacting to one message.
 * Section 1.2 names the reason: "Android does not promise that every new
 * message reaches the app. A force stop, battery optimisation, or a reboot
 * before the app is next opened can all mean the message is never delivered
 * to it." A scan that starts from `last_sms_scanned_at` picks up whatever was
 * missed as well as whatever just arrived, so a dropped broadcast costs a
 * delay rather than a payment.
 *
 * It is also the only ingestion path for a new message. The broadcast in
 * `SmsReceiver` does not carry the message here, it only says to look —
 * because a second path would be a second set of rules for the gates, the
 * dedup and the categorisation to drift apart in.
 */

import { attachLocation } from '../db/dao/transactions';
import { getProfile, updateProfile } from '../db/dao/profile';
import type { SqlDatabase } from '../db/types';
import type { SmsSource } from '../platform/smsReader';
import { ingestMessage, type LocationFix } from '../transactions/ingest';
import { oneYearBefore } from '../time/dates';

/** How many messages are read at a time. */
const PAGE = 100;

/**
 * A ceiling on one run, so a phone that has been off for a week cannot sit
 * churning on the first screen the user opens. Whatever is left is picked up
 * by the next run, because the window is read from its oldest end and the
 * watermark only advances over the contiguous block the run got through.
 *
 * It counts messages read, not payments found. The sender gate runs inside
 * `ingestMessage`, after the read, so a window full of delivery alerts and
 * one-time passwords reaches this ceiling exactly as fast as one full of bank
 * messages — which is why a run hitting it is not the rare case it looks.
 */
const MAX_PER_RUN = 400;

/**
 * How recently a message must have arrived for the current location to be
 * the right answer for it — section 6.
 *
 * A scan reads forward from a watermark, so one run can take in a message
 * that arrived ten seconds ago and one that arrived three days ago while the
 * phone was off. Stamping both with where the phone is standing now would be
 * right about the first and a fabrication about the second, and nothing on
 * the payment afterwards would say which it was. So only the messages that
 * have just arrived are given one, and the rest keep the empty location
 * every historical import has.
 *
 * Direction narrows it again at the call site: only a debit is given a fix.
 */
const LOCATION_WINDOW_MS = 10 * 60 * 1000;

export interface CatchUpOptions {
  /**
   * Section 6. Called at most once per scan, and only once a payment has
   * actually been created from a message that has just arrived — a fix is
   * worth a radio for a payment, and not for the one-time passwords and
   * delivery alerts that make up most of an inbox.
   */
  locate?: () => Promise<LocationFix | null>;
  /**
   * The payments a scan has just written, handed over the moment they are
   * written rather than when the scan finishes.
   *
   * What happens next is section 6's fix, and that can take twelve seconds
   * of radio. The question "what was this for" does not depend on where the
   * user was, so making it wait behind a GPS timeout only made it late —
   * and late enough that a service killed in the meantime never asked at
   * all.
   */
  onRecorded?: (transactionIds: number[]) => void;
}

export interface CatchUpOutcome {
  /** Messages read from the inbox. */
  scanned: number;
  /** Transactions created from them. */
  created: number;
  /**
   * The rows those creations made, newest last — the order the window is
   * read in, oldest message first.
   *
   * Carried out rather than counted because the caller has to look at them
   * again — section 5.3 cannot categorise every payment, and the ones it
   * could not are what the "what was this for" notification asks about.
   * Finding them afterwards by timestamp would catch rows this run did not
   * create.
   */
  createdIds: number[];
  /** Messages that passed the gates but could not be read — section 11.1. */
  unreadable: number;
  /** Of those created, how many were given a location — section 6. */
  located: number;
}

export async function catchUpOnNewMessages(
  db: SqlDatabase,
  source: SmsSource,
  now: number = Date.now(),
  options: CatchUpOptions = {},
): Promise<CatchUpOutcome> {
  const outcome: CatchUpOutcome = {
    scanned: 0, created: 0, createdIds: [], unreadable: 0, located: 0,
  };
  const profile = getProfile(db);

  // Nothing to catch up on until the historical import has established where
  // "already seen" ends.
  if (profile.import_status !== 'COMPLETED') {
    return outcome;
  }

  // The watermark is the newest message the import or a previous run read.
  // A message arriving in the same millisecond is still read again, and the
  // message check in section 3.1 then drops it.
  const from = profile.last_sms_scanned_at ?? oneYearBefore(now);

  /**
   * The newest message this run has read, which becomes the new watermark.
   *
   * Sound only because the window is read from its oldest end: everything
   * between the old watermark and this moment has now been seen, with no
   * unread messages left behind it. Read the other way round and a run that
   * stopped at `MAX_PER_RUN` would set this to the newest message in the
   * inbox and bury every older one it never reached.
   */
  let newest = profile.last_sms_scanned_at ?? 0;
  let offset = 0;
  /** Payments from messages new enough for section 6's fix to describe. */
  const justArrived: number[] = [];

  while (outcome.scanned < MAX_PER_RUN) {
    const page = await source.page({
      minDate: from,
      maxDate: now,
      offset,
      limit: PAGE,
      order: 'OLDEST_FIRST',
    });
    if (page.length === 0) {
      break;
    }

    for (const sms of page) {
      outcome.scanned += 1;
      newest = Math.max(newest, sms.receivedAt);

      // One write per message, so a failure part way through leaves the
      // watermark behind the rest rather than skipping them.
      const result = db.transaction(() => ingestMessage(db, sms, { now }));
      if (result.kind === 'CREATED') {
        outcome.created += 1;
        outcome.createdIds.push(result.transaction.id);
        // Money going out is the only kind a place says anything about:
        // `where did I spend this` is a question, and `where was I standing
        // when somebody paid me` is not. A credit arrives wherever the payer
        // happened to send it from, so a fix taken here would describe the
        // receiver's evening rather than the payment, and buying it costs a
        // radio wake-up that answers nothing.
        if (
          result.transaction.transaction_type === 'DEBIT' &&
          now - sms.receivedAt <= LOCATION_WINDOW_MS
        ) {
          justArrived.push(result.transaction.id);
        }
      } else if (result.kind === 'UNREADABLE') {
        outcome.unreadable += 1;
      }
    }

    if (page.length < PAGE) {
      break;
    }
    offset += page.length;
  }

  if (options.onRecorded && outcome.createdIds.length > 0) {
    // Deliberately not awaited: nothing below depends on it, and a slow or
    // broken notifier must not hold up the fix or the watermark.
    options.onRecorded([...outcome.createdIds]);
  }

  // Section 6, after the writing rather than during it. One fix answers for
  // the whole run: the messages it covers all arrived within minutes of each
  // other, and asking the hardware once per payment would be the same answer
  // bought several times over.
  //
  // `location_enabled` is the user's own preference from section 8.5, and is
  // checked here rather than in the native module, so that turning it off
  // means no fix is asked for at all.
  if (options.locate && justArrived.length > 0 && profile.location_enabled === 1) {
    try {
      const fix = await options.locate();
      if (fix) {
        outcome.located = attachLocation(db, justArrived, fix, now);
      }
    } catch {
      // A payment without a location is the ordinary case, and losing the
      // payment because the location failed would not be.
    }
  }

  if (outcome.scanned > 0) {
    const current = getProfile(db);
    updateProfile(
      db,
      {
        last_sms_scanned_at: newest,
        transactions_found: current.transactions_found + outcome.created,
      },
      now,
    );
  }

  return outcome;
}
