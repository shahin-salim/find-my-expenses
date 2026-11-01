/**
 * Re-reading the messages that could not be read.
 *
 * Section 11.1: "When a later release adds the bank, those messages are read
 * again on their own and the payments appear in the user's history."
 *
 * Section 3.1 is what makes that need saying. A message already in
 * `sms_messages` is skipped before it is parsed, so a parser fix never reaches
 * the messages it was written for — they stay unreadable for as long as the
 * install lasts. This drops the rows that recorded the failure and puts the
 * messages back through the full pipeline, which is the only thing standing
 * between a fixed format and the user's history.
 *
 * Only `NO_MATCH` rows are retried. A message skipped as an OTP or an offer
 * was not a failure, and re-reading it would only find the same thing again.
 */

import { listUnreadable } from '../db/dao/smsMessages';
import { getProfile, updateProfile } from '../db/dao/profile';
import type { SqlDatabase } from '../db/types';
import type { RawSms } from '../sms/types';
import { ingestMessage } from '../transactions/ingest';

/** Reads one message back out of the inbox, or null if it is gone. */
export type ReadMessage = (providerId: number) => Promise<RawSms | null>;

export interface RetryOutcome {
  /** How many were tried. */
  checked: number;
  /** How many became transactions this time. */
  recovered: number;
  /** How many are still unreadable, so still listed. */
  stillUnreadable: number;
  /** How many the user has since deleted from the inbox. */
  missing: number;
  /**
   * Read this time and settled without becoming a new payment: a message the
   * gates now skip as a one-time password or an offer, or one whose payment
   * is already in the history under another message.
   *
   * Counted because the row recording the failure is dropped either way. Left
   * uncounted, a message that moved into this state simply vanished from the
   * unreadable list, the four numbers stopped adding up to `checked`, and the
   * count on the settings screen fell with nothing to account for it.
   */
  settled: number;
  /**
   * How many could not be read back out of the inbox at all, because SMS
   * access has been revoked or the provider refused.
   *
   * Not the same thing as `missing`, which the screen reports as the user
   * having deleted the message. These rows are untouched and will be tried
   * again next time.
   */
  unavailable: number;
}

export async function retryUnreadable(
  db: SqlDatabase,
  readMessage: ReadMessage,
  now: () => number = Date.now,
): Promise<RetryOutcome> {
  const rows = listUnreadable(db);
  const outcome: RetryOutcome = {
    checked: rows.length,
    recovered: 0,
    stillUnreadable: 0,
    missing: 0,
    settled: 0,
    unavailable: 0,
  };

  for (const row of rows) {
    let sms: RawSms | null = null;
    let refused = false;
    try {
      sms = await readMessage(row.provider_id);
    } catch {
      // No SMS access, or the inbox refused. The row stays as it was, and
      // this is not the user having deleted the message.
      refused = true;
    }

    if (refused) {
      outcome.unavailable += 1;
      continue;
    }
    if (!sms) {
      outcome.missing += 1;
      continue;
    }

    const message = sms;
    db.transaction(() => {
      // Section 3.1 would skip the message while this row exists, so the
      // record of the failure has to go before the message is read again.
      db.execute(`DELETE FROM sms_messages WHERE provider_id = ?`, [
        row.provider_id,
      ]);
      const result = ingestMessage(db, message, { now: now() });
      if (result.kind === 'CREATED') {
        outcome.recovered += 1;
      } else if (result.kind === 'UNREADABLE') {
        outcome.stillUnreadable += 1;
      } else {
        // Skipped by the gates this time, or already in the history under
        // another message. Not a failure, and no longer listed.
        outcome.settled += 1;
      }
    });
  }

  if (outcome.recovered > 0) {
    // The Home card and the import summary both read these off the profile.
    const profile = getProfile(db);
    updateProfile(
      db,
      { transactions_found: profile.transactions_found + outcome.recovered },
      now(),
    );
  }

  return outcome;
}
