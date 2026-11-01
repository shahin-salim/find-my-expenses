/**
 * The lock around the catch-up scan, and the hole that used to be in it.
 */

import { createScanGate } from '../scanGate';

/** A promise with its settle handles, so a test can hold a scan open. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A clock the test moves by hand. */
function clock(start = 1_000) {
  let at = start;
  return { now: () => at, set: (value: number) => { at = value; } };
}

describe('one scan at a time', () => {
  it('hands a second caller the scan already running', async () => {
    const time = clock();
    const gate = createScanGate<string>(time.now);
    const first = deferred<string>();
    const begin = jest.fn(() => first.promise);

    const a = gate(0, begin);
    const b = gate(0, begin);

    expect(begin).toHaveBeenCalledTimes(1);
    first.resolve('one');
    await expect(a).resolves.toBe('one');
    await expect(b).resolves.toBe('one');
  });

  it('starts a new one once the last has finished', async () => {
    const time = clock();
    const gate = createScanGate<string>(time.now);

    await gate(0, () => Promise.resolve('one'));
    const begin = jest.fn(() => Promise.resolve('two'));
    await expect(gate(0, begin)).resolves.toBe('two');
    expect(begin).toHaveBeenCalledTimes(1);
  });

  it('releases the lock even when a scan fails', async () => {
    const time = clock();
    const gate = createScanGate<string>(time.now);

    await expect(gate(0, () => Promise.reject(new Error('inbox')))).rejects.toThrow(
      'inbox',
    );

    await expect(gate(0, () => Promise.resolve('after'))).resolves.toBe('after');
  });
});

describe('a caller that needs a particular moment covered', () => {
  it('will not take a scan that began before it', async () => {
    const time = clock(1_000);
    const gate = createScanGate<string>(time.now);

    // A scan is already running — the screen started one when it opened.
    const open = deferred<string>();
    const first = gate(0, () => open.promise);

    // Now a message arrives. Its scan has to cover this moment, and the one
    // in flight started a second earlier, so it cannot have read it.
    time.set(2_000);
    const second = jest.fn(() => Promise.resolve('fresh'));
    const forMessage = gate(2_000, second);

    expect(second).not.toHaveBeenCalled();

    open.resolve('stale');
    await expect(first).resolves.toBe('stale');
    // Only once the first is out of the way does the fresh one run.
    await expect(forMessage).resolves.toBe('fresh');
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('takes a scan that began after it, rather than starting another', async () => {
    const time = clock(1_000);
    const gate = createScanGate<string>(time.now);

    time.set(3_000);
    const open = deferred<string>();
    const first = gate(0, () => open.promise);

    // The message landed before this scan started, so this scan has read it.
    const second = jest.fn(() => Promise.resolve('another'));
    const forMessage = gate(2_000, second);

    expect(second).not.toHaveBeenCalled();
    open.resolve('covers it');
    await expect(first).resolves.toBe('covers it');
    await expect(forMessage).resolves.toBe('covers it');
  });

  it('still gets its scan when the one it waited for failed', async () => {
    const time = clock(1_000);
    const gate = createScanGate<string>(time.now);

    const open = deferred<string>();
    const first = gate(0, () => open.promise);

    time.set(2_000);
    const forMessage = gate(2_000, () => Promise.resolve('fresh'));

    open.reject(new Error('inbox'));
    await expect(first).rejects.toThrow('inbox');
    // The failure belongs to the caller that asked for it, not to this one.
    await expect(forMessage).resolves.toBe('fresh');
  });

  it('runs one fresh scan however many callers are waiting on it', async () => {
    const time = clock(1_000);
    const gate = createScanGate<string>(time.now);

    const open = deferred<string>();
    const first = gate(0, () => open.promise);

    time.set(2_000);
    const second = jest.fn(() => Promise.resolve('fresh'));
    const waiting = [gate(2_000, second), gate(2_000, second), gate(2_000, second)];

    open.resolve('stale');
    await first;
    await expect(Promise.all(waiting)).resolves.toEqual(['fresh', 'fresh', 'fresh']);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
