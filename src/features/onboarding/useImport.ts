/**
 * Drives the two-stage import for the progress screen.
 *
 * Section 9.4: "If the user leaves while it is still running, the next launch
 * returns to this screen and the import continues from the stage and the
 * position it stopped at, instead of starting again." `runImport` already
 * resumes from the profile row, so this hook only has to start it again.
 *
 * "The next launch" turned out to be too narrow a reading. The import also
 * stops when the app merely goes to the background for a moment, and nothing
 * was starting it again when the app came back — the screen sat on a frozen
 * bar, neither finished nor failed, until the app was force stopped. Coming
 * back to the screen is the same event as launching into it, and is handled
 * the same way here.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { getProfile } from '../../core/db/dao/profile';
import { runImport, type ImportSnapshot } from '../../core/import/importer';
import { hasSmsPermission } from '../../core/platform/permissions';
import { deviceSmsSource, type SmsSource } from '../../core/platform/smsReader';
import { useApp } from '../../state/AppProvider';

export type ImportState = 'RUNNING' | 'COMPLETED' | 'FAILED' | 'NO_PERMISSION';

export interface UseImportResult {
  snapshot: ImportSnapshot;
  state: ImportState;
  error: Error | null;
  retry: () => void;
}

/**
 * The part of `AppState` this hook uses, so the pause and resume can be
 * driven from a test the way `SmsSource` lets the import be.
 */
export interface AppStateLike {
  readonly currentState: string | null | undefined;
  addEventListener(
    type: 'change',
    listener: (status: AppStateStatus) => void,
  ): { remove(): void };
}

/**
 * How long a stage stays on screen at minimum. Not a delay added to the
 * import: if a stage genuinely takes longer than this, nothing is waited for.
 * It only stops a stage flashing past unread, which is what happens on an
 * inbox of a few hundred messages.
 */
export const MINIMUM_STAGE_MILLIS = 1400;

const EMPTY: ImportSnapshot = {
  stage: 'ACCOUNTS',
  messagesTotal: 0,
  messagesScanned: 0,
  accountsFound: 0,
  transactionsFound: 0,
  accounts: [],
};

export function useImport(
  source: SmsSource = deviceSmsSource,
  appState: AppStateLike = AppState,
): UseImportResult {
  const { db, reloadProfile } = useApp();
  const [snapshot, setSnapshot] = useState<ImportSnapshot>(EMPTY);
  const [state, setState] = useState<ImportState>('RUNNING');
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);

  /**
   * Set when a run has stopped because the app went away and the app has not
   * come back yet. It lives outside the effect because by the time it is read
   * the run that set it is already over.
   */
  const pausedInBackground = useRef(false);
  const stageStartedAt = useRef(Date.now());

  const retry = useCallback(() => {
    setError(null);
    setState('RUNNING');
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    stageStartedAt.current = Date.now();
    let cancelled = false;

    // One flag per run rather than one per hook. Resuming starts a second run
    // while the first may still be between pages, and a flag shared by both
    // would be cleared by the new run and then read by the old one — leaving
    // two imports walking the same inbox and writing the same counters.
    const stop = { current: false };

    // Android can stop a background app mid-import; pausing cleanly means the
    // next launch resumes from the cursor instead of from a half-written page.
    const subscription = appState.addEventListener('change', (status) => {
      if (status !== 'active') {
        stop.current = true;
        return;
      }
      // Back on screen. Only a run that has already stopped is started again
      // here. One still in flight is left alone, which is what keeps the two
      // from ever overlapping.
      if (pausedInBackground.current) {
        pausedInBackground.current = false;
        setAttempt((value) => value + 1);
      }
    });

    (async () => {
      try {
        // Section 8.5: permission state is read from the system every time it
        // is needed, because the user can revoke it from Settings at any point
        // — including while this screen was last open.
        if (!(await hasSmsPermission())) {
          if (!cancelled) {
            setState('NO_PERMISSION');
          }
          return;
        }

        const outcome = await runImport(db, {
          source,
          onProgress: (next) => {
            if (!cancelled) {
              setSnapshot(next);
            }
          },
          shouldStop: () => stop.current,
          onStageFinished: async () => {
            const remaining =
              MINIMUM_STAGE_MILLIS - (Date.now() - stageStartedAt.current);
            if (remaining > 0 && !stop.current) {
              await new Promise((resolve) => setTimeout(resolve, remaining));
            }
            stageStartedAt.current = Date.now();
          },
        });
        if (cancelled) {
          return;
        }
        reloadProfile();
        if (outcome === 'COMPLETED') {
          setSnapshot((previous) => ({
            ...previous,
            messagesScanned: getProfile(db).messages_scanned,
          }));
          setState('COMPLETED');
          return;
        }
        if (outcome === 'STOPPED') {
          // Paused because the app left the screen, and nothing else would
          // start it again: `runImport` has returned, so the progress bar is
          // not waiting on anything. Either the app is already back, in which
          // case carry straight on, or this is remembered until it is.
          if (appState.currentState === 'active') {
            setAttempt((value) => value + 1);
          } else {
            pausedInBackground.current = true;
          }
        }
      } catch (importError) {
        if (!cancelled) {
          setError(importError as Error);
          setState('FAILED');
        }
      }
    })();

    return () => {
      cancelled = true;
      stop.current = true;
      subscription.remove();
    };
  }, [db, source, appState, reloadProfile, attempt]);

  return { snapshot, state, error, retry };
}
