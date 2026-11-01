/**
 * The lock that keeps one catch-up scan running at a time, kept apart from
 * the scan so it can be tested without a phone.
 *
 * It used to be three lines — "if one is running, hand that one back" — and
 * those three lines had a hole in them that only opened when the app was
 * alive in the background.
 *
 * A scan reads the inbox from a watermark up to the moment it started. Hand
 * that scan to a caller who is asking about a message that arrived *after*
 * it started, and the answer is confidently wrong: the scan reports the
 * messages it did read, the caller reads `scanned > 0` as "the inbox has
 * been looked at", and the message that prompted the whole thing is never
 * fetched. The payment then waits until the app is next opened — which is
 * exactly what it looked like from outside, a service that started, showed
 * its notification, and stopped having done nothing.
 *
 * It could not happen with the app closed, because there was no scan in
 * flight to be handed back. That is why clearing the app made it work.
 *
 * So a caller now says which moment it needs covered, and a scan that began
 * before that moment is waited for rather than reused.
 */

export interface ScanGate<T> {
  /**
   * Runs `begin`, or joins a scan already in flight that is new enough.
   *
   * `mustCover` is the moment the caller needs included — for a message
   * that just arrived, when the broadcast landed. Zero means any scan will
   * do, which is what a screen opening wants.
   */
  (mustCover: number, begin: (at: number) => Promise<T>): Promise<T>;
}

export function createScanGate<T>(now: () => number = Date.now): ScanGate<T> {
  let running: Promise<T> | null = null;
  /** When the in-flight scan started reading. */
  let startedAt = 0;

  const run: ScanGate<T> = (mustCover, begin) => {
    if (running) {
      if (startedAt >= mustCover) {
        return running;
      }
      // Began too early to have seen what this caller is asking about.
      // Queue behind it rather than starting a second reader of the same
      // inbox: two scans racing would do the same work twice and race each
      // other to move the watermark.
      return running.catch(() => undefined).then(() => run(mustCover, begin));
    }

    const at = now();
    const work = begin(at).finally(() => {
      // Guarded, so a scan that finishes after a newer one has started
      // cannot release the newer one's lock.
      if (running === work) {
        running = null;
      }
    });
    running = work;
    startedAt = at;
    return work;
  };

  return run;
}
