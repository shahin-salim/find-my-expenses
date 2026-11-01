/**
 * Section 8.1. Holds every transaction, whether parsed from an SMS or added
 * manually by the user.
 */

import { markDataChanged } from '../changes';
import type { TransactionType } from '../../sms/types';
import type { TransactionRow } from '../models';
import type { SqlDatabase } from '../types';

export interface NewTransaction {
  /** Minor units of `currency`, always positive. */
  amount: number;
  /** Defaults to `INR`; only a card used abroad sets anything else. */
  currency?: string;
  transactionType: TransactionType;
  occurredAt: number;
  occurredOn: string;
  merchantId: number | null;
  recipientName: string | null;
  accountId: number | null;
  /** Only set when the user overrides this one transaction. */
  categoryId: number | null;
  source: 'SMS' | 'MANUAL';
  sourceSmsId: number | null;
  bankSenderId: string | null;
  rrn: string | null;
  parserId: string | null;
  dedupKey: string;
  note?: string | null;
  isTransfer?: boolean;
  latitude?: number | null;
  longitude?: number | null;
  locationLabel?: string | null;
  locationCapturedAt?: number | null;
}

export interface InsertResult {
  row: TransactionRow;
  /** False when the dedup key was already taken and nothing was written. */
  created: boolean;
}

export function findTransactionById(db: SqlDatabase, id: number): TransactionRow | null {
  const { rows } = db.execute<TransactionRow>(
    `SELECT * FROM transactions WHERE id = ?`,
    [id],
  );
  return rows[0] ?? null;
}

export function findByDedupKey(db: SqlDatabase, dedupKey: string): TransactionRow | null {
  const { rows } = db.execute<TransactionRow>(
    `SELECT * FROM transactions WHERE dedup_key = ?`,
    [dedupKey],
  );
  return rows[0] ?? null;
}

/**
 * Section 3.2: "If a new transaction produces a key that already exists, the
 * transaction is not stored."
 */
export function insertTransactionIfNew(
  db: SqlDatabase,
  tx: NewTransaction,
  now: number = Date.now(),
): InsertResult {
  const existing = findByDedupKey(db, tx.dedupKey);
  if (existing) {
    return { row: existing, created: false };
  }

  const result = db.execute(
    `INSERT INTO transactions
       (amount, currency, transaction_type, occurred_at, occurred_on, merchant_id,
        recipient_name, account_id, category_id, source, source_sms_id,
        bank_sender_id, rrn, parser_id, dedup_key, latitude, longitude,
        location_label, location_captured_at, note, is_transfer,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tx.amount,
      tx.currency ?? 'INR',
      tx.transactionType,
      tx.occurredAt,
      tx.occurredOn,
      tx.merchantId,
      tx.recipientName,
      tx.accountId,
      tx.categoryId,
      tx.source,
      tx.sourceSmsId,
      tx.bankSenderId,
      tx.rrn,
      tx.parserId,
      tx.dedupKey,
      tx.latitude ?? null,
      tx.longitude ?? null,
      tx.locationLabel ?? null,
      tx.locationCapturedAt ?? null,
      tx.note ?? null,
      tx.isTransfer ? 1 : 0,
      now,
      now,
    ],
  );
  return { row: findTransactionById(db, result.insertId)!, created: true };
}

/**
 * Section 4: "The original transaction is marked as refunded and stops
 * counting as spending."
 */
export function markRefunded(db: SqlDatabase, id: number, now = Date.now()): void {
  db.execute(`UPDATE transactions SET is_refunded = 1, updated_at = ? WHERE id = ?`, [
    now,
    id,
  ]);
}

/**
 * The user saying money they lent has come back.
 *
 * `repaid_at` rather than a flag, because when it came back is worth more
 * than that it did: a loan outstanding for a week and one outstanding for a
 * year read very differently, and the date costs the same column.
 *
 * Not `is_refunded`, which section 4 sets on its own when the bank reverses
 * a payment. Keeping them apart is what stops the reconciler writing over
 * something only the user could have known.
 */
export function setRepaid(
  db: SqlDatabase,
  id: number,
  repaid: boolean,
  now = Date.now(),
): void {
  db.execute(`UPDATE transactions SET repaid_at = ?, updated_at = ? WHERE id = ?`, [
    repaid ? now : null,
    now,
    id,
  ]);
  markDataChanged();
}

/**
 * Section 6: the fix taken when the message arrived.
 *
 * Written after the row rather than with it, because a location is worth
 * asking the hardware for only once a message has turned out to be a payment.
 * Taking a fix for every arriving message would spend the battery on every
 * one-time password the phone receives.
 *
 * Takes several ids: one scan reads whatever arrived since the last one, and
 * a single fix is the honest answer for all of them. Rows that already carry
 * a location are left alone, so a re-run cannot move a payment to wherever
 * the phone happens to be now.
 */
export function attachLocation(
  db: SqlDatabase,
  ids: number[],
  fix: { latitude: number; longitude: number; label?: string | null; capturedAt: number },
  now = Date.now(),
): number {
  if (ids.length === 0) {
    return 0;
  }
  const placeholders = ids.map(() => '?').join(', ');
  const result = db.execute(
    `UPDATE transactions
        SET latitude = ?, longitude = ?, location_label = ?,
            location_captured_at = ?, updated_at = ?
      WHERE id IN (${placeholders}) AND latitude IS NULL`,
    [fix.latitude, fix.longitude, fix.label ?? null, fix.capturedAt, now, ...ids],
  );
  return result.rowsAffected;
}

/** Section 8.1: "`is_transfer` is set on both halves of a transfer." */
export function markTransfer(db: SqlDatabase, id: number, now = Date.now()): void {
  db.execute(`UPDATE transactions SET is_transfer = 1, updated_at = ? WHERE id = ?`, [
    now,
    id,
  ]);
}

/**
 * Section 8.4: "Marking the merchant is what makes one match worth having."
 *
 * The import reads messages newest first, so payments to a payee are usually
 * already written by the time a matched pair proves that payee is one of the
 * user's own accounts. The flag only earns its keep if it reaches those rows
 * too, not just the ones that come after.
 */
export function markMerchantTransactionsAsTransfers(
  db: SqlDatabase,
  merchantId: number,
  now = Date.now(),
): number {
  const result = db.execute(
    `UPDATE transactions SET is_transfer = 1, updated_at = ?
      WHERE merchant_id = ? AND is_transfer = 0 AND is_deleted = 0`,
    [now, merchantId],
  );
  return result.rowsAffected;
}

/** The user deciding a payment should not count. */
export function setExcluded(
  db: SqlDatabase,
  id: number,
  excluded: boolean,
  now = Date.now(),
): void {
  db.execute(`UPDATE transactions SET is_excluded = ?, updated_at = ? WHERE id = ?`, [
    excluded ? 1 : 0,
    now,
    id,
  ]);
  markDataChanged();
}

/**
 * Section 8.1: "Deletes are soft. If a transaction parsed from SMS were hard
 * deleted, a later re-import would find no matching `dedup_key` and recreate
 * it. The tombstone is what stops that."
 */
export function softDelete(db: SqlDatabase, id: number, now = Date.now()): void {
  db.execute(`UPDATE transactions SET is_deleted = 1, updated_at = ? WHERE id = ?`, [
    now,
    id,
  ]);
  markDataChanged();
}

/**
 * Sets a payment's own category, or clears it back to its payee's.
 *
 * `null` means "take the payee's", which is what NULL in the column has
 * always meant. It is not the same as having none — see
 * `clearTransactionCategory`.
 */
export function setTransactionCategory(
  db: SqlDatabase,
  id: number,
  categoryId: number | null,
  now = Date.now(),
): void {
  db.execute(
    `UPDATE transactions
        SET category_id = ?, category_cleared = 0, updated_at = ?
      WHERE id = ?`,
    [categoryId, now, id],
  );
  markDataChanged();
}

/**
 * Leaves a payment with no category at all, whatever its payee carries.
 *
 * The third state section 10.3 had no room for. Clearing `category_id` only
 * says "ask the payee", so a payment to a payee that has a category could
 * never be left blank — the answer always came back through the merchant.
 */
export function clearTransactionCategory(
  db: SqlDatabase,
  id: number,
  now = Date.now(),
): void {
  db.execute(
    `UPDATE transactions
        SET category_id = NULL, category_cleared = 1, updated_at = ?
      WHERE id = ?`,
    [now, id],
  );
  markDataChanged();
}

export function setNote(
  db: SqlDatabase,
  id: number,
  note: string | null,
  now = Date.now(),
): void {
  db.execute(`UPDATE transactions SET note = ?, updated_at = ? WHERE id = ?`, [
    note,
    now,
    id,
  ]);
  markDataChanged();
}

export function countTransactions(db: SqlDatabase): number {
  const { rows } = db.execute<{ total: number }>(
    `SELECT COUNT(*) AS total FROM transactions WHERE is_deleted = 0`,
  );
  return rows[0]?.total ?? 0;
}
