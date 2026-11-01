/**
 * Transactions opened inside one another.
 *
 * Section 12.4 made this real: `createManualTransaction` opens a transaction
 * and the lend match inside it attaches a repayment, which opens its own.
 * Before savepoints that threw "cannot start a transaction within a
 * transaction" and lost the whole write.
 */

import { initializeDatabase } from '../database';
import { openNodeDatabase } from '../nodeSqlite';
import type { SqlDatabase } from '../types';

const NOW = new Date(2026, 9, 24).getTime();

function freshDb(): SqlDatabase {
  const db = initializeDatabase(openNodeDatabase(':memory:'), NOW);
  db.execute(`CREATE TABLE kept (value TEXT NOT NULL)`);
  return db;
}

function values(db: SqlDatabase): string[] {
  return db.execute<{ value: string }>(`SELECT value FROM kept ORDER BY rowid`).rows.map(
    (row) => row.value,
  );
}

describe('nested transactions', () => {
  it('commits an inner transaction with its outer one', () => {
    const db = freshDb();

    db.transaction(() => {
      db.execute(`INSERT INTO kept (value) VALUES ('outer')`);
      db.transaction(() => {
        db.execute(`INSERT INTO kept (value) VALUES ('inner')`);
      });
    });

    expect(values(db)).toEqual(['outer', 'inner']);
  });

  it('rolls the whole thing back when the outer one throws', () => {
    const db = freshDb();

    expect(() =>
      db.transaction(() => {
        db.transaction(() => {
          db.execute(`INSERT INTO kept (value) VALUES ('inner')`);
        });
        throw new Error('no');
      }),
    ).toThrow('no');

    expect(values(db)).toEqual([]);
  });

  it('undoes only the inner work when the caller catches the failure', () => {
    const db = freshDb();

    db.transaction(() => {
      db.execute(`INSERT INTO kept (value) VALUES ('outer')`);
      try {
        db.transaction(() => {
          db.execute(`INSERT INTO kept (value) VALUES ('inner')`);
          throw new Error('inner failed');
        });
      } catch {
        // The outer transaction carries on, which is the whole point of a
        // savepoint rather than a depth counter.
      }
      db.execute(`INSERT INTO kept (value) VALUES ('after')`);
    });

    expect(values(db)).toEqual(['outer', 'after']);
  });

  it('survives a failure deep in the stack and keeps working afterwards', () => {
    const db = freshDb();

    for (let round = 0; round < 3; round += 1) {
      db.transaction(() => {
        try {
          db.transaction(() => {
            db.transaction(() => {
              throw new Error('deep');
            });
          });
        } catch {
          // Each failure has to leave the savepoint stack as it found it, or
          // the next round begins one level deeper than it should.
        }
        db.execute(`INSERT INTO kept (value) VALUES ('round')`);
      });
    }

    expect(values(db)).toEqual(['round', 'round', 'round']);
  });

  it('still rolls back a plain unnested transaction', () => {
    const db = freshDb();

    expect(() =>
      db.transaction(() => {
        db.execute(`INSERT INTO kept (value) VALUES ('gone')`);
        throw new Error('no');
      }),
    ).toThrow('no');

    expect(values(db)).toEqual([]);
  });
});
