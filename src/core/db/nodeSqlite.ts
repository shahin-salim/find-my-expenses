/**
 * The test-time adapter, backed by node:sqlite. Never imported by app code.
 */

import { DatabaseSync } from 'node:sqlite';
import type { QueryResult, SqlDatabase, SqlValue } from './types';
import { nestableTransaction } from './nesting';

const WRITE = /^\s*(insert|update|delete|create|drop|alter|pragma|begin|commit|rollback)/i;

/**
 * `PRAGMA table_info(x)` is a question, not a statement.
 *
 * It was matching WRITE along with every other pragma and going down the
 * `.run()` path, which answers with no rows. The one caller that reads a
 * pragma is the migration in `database.ts`, and it treats an empty answer as
 * "there is no such table" and skips the column — so on this adapter every
 * entry in `ADDED_COLUMNS` was quietly doing nothing, and no test could see
 * a migration fail. A pragma that assigns has an `=` in it; one that asks
 * does not.
 */
const READ_PRAGMA = /^\s*pragma\b[^=]*$/i;

export function openNodeDatabase(path = ':memory:'): SqlDatabase {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');

  return {
    execute<Row>(sql: string, params: SqlValue[] = []): QueryResult<Row> {
      if (WRITE.test(sql) && !READ_PRAGMA.test(sql)) {
        const result = db.prepare(sql).run(...(params as never[]));
        return {
          rows: [],
          insertId: Number(result.lastInsertRowid ?? 0),
          rowsAffected: Number(result.changes ?? 0),
        };
      }
      const rows = db.prepare(sql).all(...(params as never[])) as Row[];
      // node:sqlite returns null-prototype objects; normalize them so test
      // matchers and object spreads behave the way they do on device.
      return {
        rows: rows.map((row) => ({ ...row })),
        insertId: 0,
        rowsAffected: 0,
      };
    },
    transaction: nestableTransaction((sql) => db.exec(sql)),
    close() {
      db.close();
    },
  };
}
