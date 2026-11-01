/**
 * Section 6.1, the app reading a message with nothing on screen.
 *
 * Registered in `index.js` and started by `SmsIngestService`, which is in
 * turn started by the SMS broadcast when the app is not in the foreground.
 * Everything it does is the same scan a screen would have run — the point is
 * only that it runs now, while the phone is still where the payment was
 * made, rather than whenever the app is next opened.
 */

import { appDatabase } from '../../core/db/instance';
import { describeScan, runCatchUpScan } from './scan';

/**
 * How long to let the SMS provider catch up before the first read.
 *
 * The broadcast does not mean the message has been written. It is delivered
 * to every app at once, and the one that owns the inbox writes the row at
 * the same moment rather than before — so a scan that starts immediately
 * reads a provider that does not have the message yet.
 */
const FIRST_LOOK_MS = 2_000;

/** How long to leave between looks after that. */
const LOOK_AGAIN_EVERY_MS = 2_500;

/**
 * How long to keep looking before giving up.
 *
 * This used to be two attempts five seconds apart, inside a service with
 * forty-five seconds of budget — so a provider that took six seconds to
 * write the row was given up on with forty seconds to spare, and the
 * payment waited until the app was next opened. Looking until the message
 * turns up costs nothing when it turns up on the first look, which is the
 * ordinary case.
 *
 * Short of the service's own timeout, because the fix in section 6 still
 * has to happen after this and the task is killed at forty-five.
 */
const GIVE_UP_AFTER_MS = 20_000;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function smsIngestTask(): Promise<void> {
  try {
    const db = appDatabase();

    // The moment the broadcast landed, which is what the scan has to cover.
    // A scan already in flight that began before this cannot have read the
    // message that woke us, and taking its answer was how a payment came to
    // be silently skipped whenever the app was alive in the background.
    const announcedAt = Date.now();
    const deadline = announcedAt + GIVE_UP_AFTER_MS;

    await wait(FIRST_LOOK_MS);
    let outcome = await runCatchUpScan(db, announcedAt);

    // Reading nothing at all is the shape a provider that is still writing
    // makes. Keep looking until it has written, or until the budget is out.
    while (outcome.scanned === 0 && Date.now() < deadline) {
      await wait(LOOK_AGAIN_EVERY_MS);
      outcome = await runCatchUpScan(db, announcedAt);
    }

    const summary = describeScan(outcome);
    // eslint-disable-next-line no-console
    console.log(`[sms] background ${summary ?? 'found nothing new'}`);
  } catch (error) {
    // Throwing here would be an unhandled rejection inside a service with a
    // wake lock held. The watermark has not moved over anything this run
    // failed to read, so the next scan covers the same ground.
    // eslint-disable-next-line no-console
    console.warn('[sms] background scan failed', error);
  }
}
