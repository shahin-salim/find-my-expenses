/**
 * Section 8.6: "One row for every bank message the app has read."
 */

import { initializeDatabase } from '../../database';
import { openNodeDatabase } from '../../nodeSqlite';
import type { SqlDatabase } from '../../types';
import { hasProcessedMessage, recordMessage } from '../smsMessages';

const NOW = new Date(2026, 9, 25, 12, 0, 0).getTime();

const freshDb = (): SqlDatabase =>
  initializeDatabase(openNodeDatabase(':memory:'), NOW);

const message = (providerId: number) => ({
  providerId,
  senderId: 'AD-ICICIT-S',
  receivedAt: NOW,
  parseStatus: 'PARSED' as const,
});

describe('recording a message that is already recorded', () => {
  it('answers with that message row, not with the last row written', () => {
    const db = freshDb();
    const first = recordMessage(db, message(101), NOW);
    const second = recordMessage(db, message(102), NOW);
    expect(second).not.toBe(first);

    const again = recordMessage(db, message(101), NOW);

    // SQLite leaves last_insert_rowid alone when an INSERT OR IGNORE inserts
    // nothing, so reading it back answered with 102's row — a real id
    // belonging to a different message, which is the worst shape a wrong
    // answer can take because nothing downstream can tell it is wrong.
    expect(again).toBe(first);
    expect(again).not.toBe(second);
  });

  it('writes no second row', () => {
    const db = freshDb();
    recordMessage(db, message(101), NOW);
    recordMessage(db, message(101), NOW);

    const { rows } = db.execute<{ total: number }>(
      'SELECT COUNT(*) AS total FROM sms_messages',
    );
    expect(rows[0]!.total).toBe(1);
    expect(hasProcessedMessage(db, 101)).toBe(true);
    expect(hasProcessedMessage(db, 999)).toBe(false);
  });
});
