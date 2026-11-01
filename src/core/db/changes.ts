/**
 * A counter that moves whenever something is written, and a way to watch it.
 *
 * Every screen recomputes its figures when it is opened — section 10: "All
 * figures are calculated from the transactions table when the page is
 * opened." Two things sit either side of that.
 *
 * Coming back from a screen that changed nothing is still an opening, and
 * Home rebuilding its chart, bubbles, calendar and lists to arrive at the
 * numbers it already had is work the user sees as a stutter.
 *
 * A message arriving while Home is open is the opposite case: nothing is
 * opened, so nothing would recompute, and a payment made a moment ago would
 * not appear until the user navigated away and back. Section 1.2 wants it
 * recorded as it arrives, and a figure that is right in the database and
 * stale on screen is not recorded as far as the user is concerned.
 *
 * So writes mark themselves here, and screens subscribe. They recompute when
 * the counter moves and at no other time.
 */

import { useSyncExternalStore } from 'react';

type Listener = () => void;

let version = 0;
let scheduled = false;
const listeners = new Set<Listener>();

export function dataVersion(): number {
  return version;
}

/**
 * Runs the subscribers, one tick after the write that asked for it.
 *
 * `queueMicrotask` where there is one, which is every environment this runs
 * in; the promise is for anything that disagrees.
 */
const defer: (task: () => void) => void =
  typeof queueMicrotask === 'function'
    ? (task) => queueMicrotask(task)
    : (task) => {
        void Promise.resolve().then(task);
      };

function flush(): void {
  scheduled = false;
  version += 1;
  // Copied before iterating: a listener may unsubscribe while being told,
  // and a set mutated under its own iteration drops the listener after it.
  for (const listener of [...listeners]) {
    listener();
  }
}

/**
 * Says that something was written. Deferred, deliberately, for two reasons.
 *
 * Writes happen inside a transaction. Telling the subscribers from in there
 * re-renders every open screen on the same connection with the transaction
 * still open: the screen reads rows that are not committed, and if the
 * transaction then rolls back, the user has already been shown figures that
 * never existed. One tick is all it takes to be sure the write landed —
 * `db.transaction` is synchronous end to end, so the commit has run by the
 * time a microtask gets its turn.
 *
 * It also collapses a run of writes into one notification. The historical
 * import holds a transaction across a page of two hundred messages and marks
 * on each one; that was two hundred full re-reads of Home, each of about
 * fifteen queries, inside the transaction. Now it is one, after it.
 */
export function markDataChanged(): void {
  if (scheduled) {
    return;
  }
  scheduled = true;
  defer(flush);
}

export function subscribeToData(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Re-renders the calling screen whenever anything is written, and never
 * otherwise. Used as a dependency of the screen's read.
 */
export function useDataVersion(): number {
  return useSyncExternalStore(subscribeToData, dataVersion, dataVersion);
}
