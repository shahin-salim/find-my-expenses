/**
 * The one catch-up scan, and the lock that keeps it one.
 *
 * Three things ask for a scan now: a screen coming to the foreground, the
 * broadcast that says a message arrived, and the headless task in section 6.1
 * that runs when there is no screen at all. When the app is alive in the
 * background all three are the same JavaScript context, so two of them can
 * easily be in flight at once — and two scans reading the same window would
 * do the same work twice and race each other to move the watermark.
 *
 * Correctness does not depend on this: section 3.1 drops a message already
 * recorded, and the watermark only advances over messages actually read. What
 * it buys is one fix instead of several, and one set of rows instead of two
 * attempts at the same ones.
 */

import { catchUpOnNewMessages, type CatchUpOutcome } from '../../core/import/catchUp';
import type { SqlDatabase } from '../../core/db/types';
import { deviceCategoryNotifier } from '../../core/platform/categoryPrompt';
import { deviceLocation } from '../../core/platform/location';
import { deviceSmsSource } from '../../core/platform/smsReader';
import { askAboutPayments } from '../notifications/needsCategory';
import { createScanGate } from './scanGate';

const gate = createScanGate<CatchUpOutcome>();

/**
 * Reads whatever has arrived since the last scan.
 *
 * `mustCover` is the moment the caller needs looked at — for a message that
 * has just arrived, when its broadcast landed. A scan already in flight is
 * reused only if it started after that; one that began earlier is waited
 * for and then followed by a fresh one, because it cannot have read a
 * message that had not been written when it started. A screen opening has
 * no such moment and passes nothing.
 */
export function runCatchUpScan(
  db: SqlDatabase,
  mustCover = 0,
): Promise<CatchUpOutcome> {
  return gate(mustCover, (at) =>
    catchUpOnNewMessages(db, deviceSmsSource, at, {
      locate: () => deviceLocation.find(),
      // Asked here rather than inside `catchUpOnNewMessages` so the rule
      // stays testable without a notification manager, and so both callers
      // — the screen and the headless service — get it rather than one of
      // them being forgotten.
      onRecorded: (ids) => {
        askAboutPayments(db, ids, deviceCategoryNotifier).catch(() => {
          // A question that could not be asked is not a reason to fail a
          // scan that has already recorded the payments.
        });
      },
    }),
  );
}

/** What a finished scan did, for the log. Empty when it did nothing. */
export function describeScan(outcome: CatchUpOutcome): string | null {
  if (outcome.scanned === 0) {
    return null;
  }
  return (
    `scanned ${outcome.scanned}, created ${outcome.created}, ` +
    `unreadable ${outcome.unreadable}, located ${outcome.located}`
  );
}
