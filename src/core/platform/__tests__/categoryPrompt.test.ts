/**
 * The two ways a notification tap reaches the app, and the guards on both.
 *
 * Tapping the card opens the payment it was asking about. What matters here
 * is what happens when there is no payment to open: the navigator is handed
 * whatever these return, and `TransactionDetail` with an id of nothing is a
 * blank screen the user cannot get out of by any route but back.
 */

const mockTake = jest.fn();
const mockListeners = new Map<string, Set<(value: number) => void>>();

jest.mock('react-native', () => ({
  NativeModules: {
    CategoryPrompt: { takePendingTransaction: () => mockTake() },
  },
  DeviceEventEmitter: {
    addListener(name: string, listener: (value: number) => void) {
      const set = mockListeners.get(name) ?? new Set();
      set.add(listener);
      mockListeners.set(name, set);
      return { remove: () => set.delete(listener) };
    },
  },
}));

import { onPromptOpened, takePendingPrompt } from '../categoryPrompt';

/** Stands in for the native side emitting on the global channel. */
function emit(value: number) {
  for (const listener of [...(mockListeners.get('CategoryPrompt:open') ?? [])]) {
    listener(value);
  }
}

beforeEach(() => mockTake.mockReset());

describe('the payment a cold start was asked to open', () => {
  it('hands over the payment the tap named', async () => {
    mockTake.mockResolvedValue(1588);
    await expect(takePendingPrompt()).resolves.toBe(1588);
  });

  it('has nothing to open when the app was started some other way', async () => {
    mockTake.mockResolvedValue(null);
    await expect(takePendingPrompt()).resolves.toBeNull();
  });

  it('refuses an id no payment can have', async () => {
    // `getIntExtra` answers 0 for an extra that is not there, and 0 read as
    // a payment is a detail screen with nothing on it.
    mockTake.mockResolvedValue(0);
    await expect(takePendingPrompt()).resolves.toBeNull();

    mockTake.mockResolvedValue(-1);
    await expect(takePendingPrompt()).resolves.toBeNull();
  });

  it('stays quiet when the native side throws', async () => {
    // The activity can be gone by the time this is asked. Losing the deep
    // link costs a tap; letting it reject takes the navigator down with it.
    mockTake.mockRejectedValue(new Error('no activity'));
    await expect(takePendingPrompt()).resolves.toBeNull();
  });
});

describe('the payment a tap named while the app was already running', () => {
  it('passes it on, and stops listening when it is told to', () => {
    const seen: number[] = [];
    const stop = onPromptOpened((id) => seen.push(id));

    emit(1588);
    expect(seen).toEqual([1588]);

    // The navigator unsubscribes when it goes away; a listener left behind
    // would navigate a tree that is no longer mounted.
    stop();
    emit(1589);
    expect(seen).toEqual([1588]);
  });

  it('ignores an id no payment can have', () => {
    const seen: number[] = [];
    const stop = onPromptOpened((id) => seen.push(id));

    emit(0);
    emit(-3);
    expect(seen).toEqual([]);
    stop();
  });
});
