/**
 * Section 8.6. "One row for every bank message the app has read. It records
 * what has already been processed, so the same message is never read twice."
 *
 * The message text is not stored. Only the provider id is kept, which is
 * enough to read the message back from the inbox for the unreadable messages
 * screen in section 11.1.
 */

import type { SmsMessageRow } from '../models';
import type { SqlDatabase } from '../types';

export type ParseStatus = 'PARSED' | 'NO_MATCH' | 'IGNORED';

/** Section 3.1, the message-level check. Runs before a message is parsed. */
export function hasProcessedMessage(db: SqlDatabase, providerId: number): boolean {
  const { rows } = db.execute<{ one: number }>(
    `SELECT 1 AS one FROM sms_messages WHERE provider_id = ? LIMIT 1`,
    [providerId],
  );
  return rows.length > 0;
}

export function processedProviderIds(db: SqlDatabase): Set<number> {
  const { rows } = db.execute<{ provider_id: number }>(
    `SELECT provider_id FROM sms_messages`,
  );
  return new Set(rows.map((row) => row.provider_id));
}

export interface RecordMessageInput {
  providerId: number;
  senderId: string;
  receivedAt: number;
  parseStatus: ParseStatus;
  parserId?: string | null;
  detail?: string | null;
}

/** Returns the row id, or the id of the row that was already there. */
export function recordMessage(
  db: SqlDatabase,
  input: RecordMessageInput,
  now: number = Date.now(),
): number {
  const result = db.execute(
    `INSERT OR IGNORE INTO sms_messages
       (provider_id, sender_id, received_at, parse_status, parser_id, detail, scanned_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.providerId,
      input.senderId,
      input.receivedAt,
      input.parseStatus,
      input.parserId ?? null,
      input.detail ?? null,
      now,
    ],
  );
  // `rowsAffected`, not `insertId`. SQLite does not reset last_insert_rowid
  // when an INSERT OR IGNORE inserts nothing, so for a message already on
  // record this answered with whatever row the connection inserted last — a
  // real id belonging to a different message — and the lookup below, which is
  // the whole point of the function's promise to return "the id of the row
  // that was already there", never ran.
  if (result.rowsAffected > 0 && result.insertId) {
    return result.insertId;
  }
  const { rows } = db.execute<{ id: number }>(
    `SELECT id FROM sms_messages WHERE provider_id = ?`,
    [input.providerId],
  );
  return rows[0]!.id;
}

/**
 * Section 11.1: the unreadable messages screen. "Messages are grouped by bank,
 * the largest group first." Only `NO_MATCH` appears, never `IGNORED`:
 * "Messages that were deliberately skipped, such as one-time passwords and
 * balance alerts, are not failures and are not listed."
 */
export interface UnreadableGroup {
  sender_id: string;
  message_count: number;
  oldest_at: number;
  newest_at: number;
}

export function unreadableGroups(db: SqlDatabase): UnreadableGroup[] {
  return db.execute<UnreadableGroup>(
    `SELECT sender_id,
            COUNT(*)        AS message_count,
            MIN(received_at) AS oldest_at,
            MAX(received_at) AS newest_at
       FROM sms_messages
      WHERE parse_status = 'NO_MATCH'
      GROUP BY sender_id
      ORDER BY message_count DESC`,
  ).rows;
}

export function unreadableCount(db: SqlDatabase): number {
  const { rows } = db.execute<{ total: number }>(
    `SELECT COUNT(*) AS total FROM sms_messages WHERE parse_status = 'NO_MATCH'`,
  );
  return rows[0]?.total ?? 0;
}

export function listUnreadableInGroup(
  db: SqlDatabase,
  senderId: string,
): SmsMessageRow[] {
  return db.execute<SmsMessageRow>(
    `SELECT * FROM sms_messages
      WHERE parse_status = 'NO_MATCH' AND sender_id = ?
      ORDER BY received_at DESC`,
    [senderId],
  ).rows;
}

/**
 * Every unreadable message, newest first. The screen in 11.1 groups by bank
 * rather than by sender ID, because one bank sends from several headers
 * (section 2.4), and only the registry knows which headers belong together.
 */
export function listUnreadable(db: SqlDatabase): SmsMessageRow[] {
  return db.execute<SmsMessageRow>(
    `SELECT * FROM sms_messages
      WHERE parse_status = 'NO_MATCH'
      ORDER BY received_at DESC`,
  ).rows;
}
