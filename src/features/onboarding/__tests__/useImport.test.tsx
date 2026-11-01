/**
 * Section 9.4, the half of it that was missing: the import screen coming back
 * to life after the app has been away.
 *
 * The import stops when the app leaves the screen, which is deliberate — a
 * half-written page is worse than a paused one. Nothing started it again when
 * the app returned, though, so a glance at another app left the progress bar
 * frozen at wherever it had got to, with no error and no way forward short of
 * force stopping the app. This drives that round trip.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { AppStateStatus } from 'react-native';
import { getProfile } from '../../../core/db/dao/profile';
import { countTransactions } from '../../../core/db/dao/transactions';
import { initializeDatabase } from '../../../core/db/database';
import { openNodeDatabase } from '../../../core/db/nodeSqlite';
import type { SqlDatabase } from '../../../core/db/types';
import {
  fakeInbox,
  type InboxMessage,
} from '../../../core/import/__tests__/fakeInbox';
import type { SmsSource } from '../../../core/platform/smsReader';
import {
  MINIMUM_STAGE_MILLIS,
  useImport,
  type AppStateLike,
  type UseImportResult,
} from '../useImport';

let mockDb: SqlDatabase;
/**
 * Stable across renders, as `AppProvider` makes it. A fresh function here
 * would change the effect's dependencies on every render and restart the
 * import each time, which is a property of the mock and not of the hook.
 */
const mockReloadProfile = () => undefined;

jest.mock('../../../state/AppProvider', () => ({
  useApp: () => ({ db: mockDb, reloadProfile: mockReloadProfile }),
}));

jest.mock('../../../core/platform/permissions', () => ({
  hasSmsPermission: async () => true,
}));

(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

/** Lets everything already queued settle. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/** `AppState`, driven by hand. */
function fakeAppState() {
  const listeners = new Set<(status: AppStateStatus) => void>();
  let current: AppStateStatus = 'active';
  return {
    get currentState(): AppStateStatus {
      return current;
    },
    addEventListener(
      _type: 'change',
      listener: (status: AppStateStatus) => void,
    ) {
      listeners.add(listener);
      return {
        remove() {
          listeners.delete(listener);
        },
      };
    },
    go(status: AppStateStatus) {
      current = status;
      for (const listener of [...listeners]) {
        listener(status);
      }
    },
  };
}

/**
 * An inbox that hands over a page only when the test says so, which is what
 * makes it possible to be in the middle of a read when the app goes away.
 */
function gatedInbox(messages: InboxMessage[]) {
  const inner = fakeInbox(messages);
  const waiting: Array<() => void> = [];
  const source: SmsSource = {
    count: (minDate, maxDate) => inner.count(minDate, maxDate),
    async page(request) {
      await new Promise<void>((resolve) => {
        waiting.push(resolve);
      });
      return inner.page(request);
    },
  };
  return {
    source,
    pending: () => waiting.length,
    /** Lets every read currently waiting through. */
    release() {
      while (waiting.length > 0) {
        waiting.shift()!();
      }
    },
  };
}

function Probe({
  source,
  appState,
  onRender,
}: {
  source: SmsSource;
  appState: AppStateLike;
  onRender: (result: UseImportResult) => void;
}) {
  onRender(useImport(source, appState));
  return null;
}

const NOW = Date.now();

const MESSAGES: InboxMessage[] = [
  {
    sender: 'AD-ICICIT-S',
    body:
      'ICICI Bank Acct XX903 debited for Rs 10.00 on 25-Oct-26; TEA STALL ' +
      'credited. UPI:912345678901',
    at: NOW - 60_000,
  },
];

describe('the import when the app leaves the screen', () => {
  beforeEach(() => {
    mockDb = initializeDatabase(openNodeDatabase(':memory:'));
  });

  it('carries on when the app comes back, rather than sitting frozen', async () => {
    const gate = gatedInbox(MESSAGES);
    const appState = fakeAppState();
    const result: { current: UseImportResult | null } = { current: null };
    let tree: ReactTestRenderer | null = null;

    await act(async () => {
      tree = create(
        <Probe
          source={gate.source}
          appState={appState}
          onRender={(value) => {
            result.current = value;
          }}
        />,
      );
      await flush();
    });

    // Mid-read: the import is waiting on a page of the inbox.
    expect(result.current!.state).toBe('RUNNING');
    expect(gate.pending()).toBe(1);

    // The user glances at another app. The read that was in flight finishes,
    // and the import stops at the next page boundary rather than part way
    // through one.
    await act(async () => {
      appState.go('background');
      gate.release();
      await flush();
    });

    expect(result.current!.state).toBe('RUNNING');
    expect(getProfile(mockDb).import_status).toBe('IN_PROGRESS');

    // And now they come back. This is the part that was missing: the import
    // has already returned, so nothing but this starts it again.
    await act(async () => {
      appState.go('active');
      await flush();
    });

    expect(gate.pending()).toBe(1);

    await act(async () => {
      gate.release();
      await new Promise((resolve) =>
        setTimeout(resolve, MINIMUM_STAGE_MILLIS + 50),
      );
    });

    expect(result.current!.state).toBe('COMPLETED');
    expect(getProfile(mockDb).import_status).toBe('COMPLETED');
    expect(countTransactions(mockDb)).toBe(1);

    await act(async () => {
      tree!.unmount();
    });
  });

  it('resumes straight away when the app is already back', async () => {
    const gate = gatedInbox(MESSAGES);
    const appState = fakeAppState();
    const result: { current: UseImportResult | null } = { current: null };
    let tree: ReactTestRenderer | null = null;

    await act(async () => {
      tree = create(
        <Probe
          source={gate.source}
          appState={appState}
          onRender={(value) => {
            result.current = value;
          }}
        />,
      );
      await flush();
    });

    // Away and back again while the read is still in flight, so the run is
    // told to stop but the app is on screen by the time it actually does.
    // Waiting for a return that has already happened would hang here.
    await act(async () => {
      appState.go('background');
      appState.go('active');
      gate.release();
      await flush();
    });

    expect(gate.pending()).toBe(1);

    await act(async () => {
      gate.release();
      await new Promise((resolve) =>
        setTimeout(resolve, MINIMUM_STAGE_MILLIS + 50),
      );
    });

    expect(result.current!.state).toBe('COMPLETED');
    expect(countTransactions(mockDb)).toBe(1);

    await act(async () => {
      tree!.unmount();
    });
  });
});
