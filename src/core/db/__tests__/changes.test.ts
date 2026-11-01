/**
 * The counter screens watch, and when they are allowed to hear about it.
 *
 * Writes happen inside a transaction. Telling the subscribers from in there
 * means every open screen re-queries the same connection with the transaction
 * still open — reading rows that are not committed, and on a rollback showing
 * figures that never existed.
 */

import { dataVersion, markDataChanged, subscribeToData } from '../changes';
import { initializeDatabase } from '../database';
import { openNodeDatabase } from '../nodeSqlite';
import type { SqlDatabase } from '../types';

const NOW = new Date(2026, 9, 24, 14, 30, 0).getTime();

function freshDb(): SqlDatabase {
  return initializeDatabase(openNodeDatabase(':memory:'), NOW);
}

/** Lets anything already queued run. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function rowCount(db: SqlDatabase): number {
  return db.execute<{ n: number }>(`SELECT COUNT(*) AS n FROM transactions`).rows[0]!.n;
}

function insert(db: SqlDatabase, key: string) {
  db.execute(
    `INSERT INTO transactions
       (amount, transaction_type, occurred_at, occurred_on, source, dedup_key,
        created_at, updated_at)
     VALUES (1000, 'DEBIT', ?, '2026-10-24', 'MANUAL', ?, ?, ?)`,
    [NOW, key, NOW, NOW],
  );
}

describe('telling the screens', () => {
  let stop: (() => void) | null = null;

  beforeEach(async () => {
    // Anything the database setup queued belongs to the previous test.
    await settle();
  });

  afterEach(() => {
    stop?.();
    stop = null;
  });

  it('says nothing while the transaction is still open', async () => {
    const db = freshDb();
    const seen: number[] = [];
    stop = subscribeToData(() => seen.push(rowCount(db)));

    db.transaction(() => {
      insert(db, 'changes:open');
      markDataChanged();
      // The write has happened and is not committed. A screen told now would
      // read it, and a rollback would leave it having shown a payment that
      // does not exist.
      expect(seen).toHaveLength(0);
    });

    await settle();
    expect(seen).toEqual([1]);
  });

  it('never shows a screen a write that was rolled back', async () => {
    const db = freshDb();
    const seen: number[] = [];
    stop = subscribeToData(() => seen.push(rowCount(db)));

    expect(() =>
      db.transaction(() => {
        insert(db, 'changes:doomed');
        markDataChanged();
        throw new Error('something went wrong after the write');
      }),
    ).toThrow();

    await settle();
    // Told, and reading nothing — which is the truth. The row is gone.
    expect(seen.every((count) => count === 0)).toBe(true);
    expect(rowCount(db)).toBe(0);
  });

  it('collapses a page of writes into one notification', async () => {
    const db = freshDb();
    let calls = 0;
    stop = subscribeToData(() => {
      calls += 1;
    });
    const before = dataVersion();

    // What the historical import does: one transaction across a page of
    // messages, marking on every one of them. That was a full re-read of
    // Home per message, inside the transaction.
    db.transaction(() => {
      for (let i = 0; i < 200; i += 1) {
        insert(db, `changes:page:${i}`);
        markDataChanged();
      }
    });

    await settle();
    expect(calls).toBe(1);
    expect(dataVersion()).toBe(before + 1);
    expect(rowCount(db)).toBe(200);
  });
});
