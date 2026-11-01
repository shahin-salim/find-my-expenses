/**
 * The on-device adapter. Section 8: "Transaction data is stored on the device
 * in SQLite (via Room). Nothing is sent to a server." Room is Android-native;
 * the React Native equivalent used here is op-sqlite, which is the same
 * SQLite underneath.
 */

import { open } from '@op-engineering/op-sqlite';
import type { QueryResult, SqlDatabase, SqlValue } from './types';
import { nestableTransaction } from './nesting';

export const DATABASE_NAME = 'find-my-expense.sqlite';

export function openDeviceDatabase(): SqlDatabase {
  const db = open({ name: DATABASE_NAME });
  db.executeSync('PRAGMA foreign_keys = ON');
  db.executeSync('PRAGMA journal_mode = WAL');

  return {
    execute<Row>(sql: string, params: SqlValue[] = []): QueryResult<Row> {
      const result = db.executeSync(sql, params);
      return {
        rows: (result.rows ?? []) as Row[],
        insertId: Number(result.insertId ?? 0),
        rowsAffected: Number(result.rowsAffected ?? 0),
      };
    },
    transaction: nestableTransaction((sql) => {
      db.executeSync(sql);
    }),
    close() {
      db.close();
    },
  };
}
