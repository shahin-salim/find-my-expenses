/**
 * Keeps the app's figures level with the phone's inbox while it is open.
 *
 * Section 1.2 wants a new message recorded as it arrives, and names what
 * stops that being as simple as listening for one: "Android does not promise
 * that every new message reaches the app." So there are two triggers for one
 * scan.
 *
 *   - A message arrives while the app is running: the broadcast says look.
 *   - The app comes to the foreground: look anyway, because whatever arrived
 *     while it was closed was never announced to anyone.
 *
 * Both run the same scan, which reads forward from the watermark and is
 * harmless to run when there is nothing new.
 */

import { useEffect } from 'react';
import { AppState } from 'react-native';
import type { SqlDatabase } from '../../core/db/types';
import { onSmsReceived } from '../../core/platform/smsReader';
import { describeScan, runCatchUpScan } from './scan';

/**
 * The SMS provider is written by whichever app owns that job, and the
 * broadcast reaches us at the same moment rather than after. Reading
 * immediately can therefore miss the very message that prompted the read, so
 * the scan is given a moment. Missing it anyway costs nothing — the next scan
 * starts from the same watermark.
 */
const PROVIDER_SETTLE_MS = 1500;

export function useLiveSms(db: SqlDatabase | null): void {
  useEffect(() => {
    if (!db) {
      return;
    }

    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    // One scan at a time, and the same lock the headless task takes: with
    // the app alive in the background both of them run here.
    const scan = async () => {
      if (cancelled) {
        return;
      }
      try {
        const summary = describeScan(await runCatchUpScan(db));
        if (summary) {
          // eslint-disable-next-line no-console
          console.log(`[sms] ${summary}`);
        }
      } catch (error) {
        // A scan that fails changes nothing: the watermark only advances over
        // messages actually read, so the next one covers the same ground. It
        // is still said out loud, because a scan that never runs and a scan
        // that finds nothing look identical from the outside.
        // eslint-disable-next-line no-console
        console.warn('[sms] catch-up scan failed', error);
      }
    };

    const scanSoon = () => {
      timers.push(setTimeout(scan, PROVIDER_SETTLE_MS));
    };

    const unsubscribe = onSmsReceived(scanSoon);
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        void scan();
      }
    });

    // And once now, for whatever arrived before this screen existed.
    void scan();

    return () => {
      cancelled = true;
      unsubscribe();
      appState.remove();
      timers.forEach(clearTimeout);
    };
  }, [db]);
}
