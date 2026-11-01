/**
 * A tiny SQL surface, so the same data layer runs against op-sqlite on the
 * device and against node:sqlite in tests. Nothing above this file knows which
 * one it is talking to.
 */

export type SqlValue = string | number | null;

export interface QueryResult<Row = Record<string, SqlValue>> {
  rows: Row[];
  insertId: number;
  rowsAffected: number;
}

export interface SqlDatabase {
  execute<Row = Record<string, SqlValue>>(
    sql: string,
    params?: SqlValue[],
  ): QueryResult<Row>;
  /** Runs `fn` inside a transaction, rolling back if it throws. */
  transaction<T>(fn: () => T): T;
  close(): void;
}
