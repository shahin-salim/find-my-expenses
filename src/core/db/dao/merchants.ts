/**
 * Section 8.4. The merchants table is also where a user's category preference
 * is stored: "A saved category preference is a single write. Setting
 * `merchants.category_id` applies to every past and future transaction from
 * that merchant."
 */

import { normalizeMerchantName } from '../../sms/normalize';
import type { MerchantRow } from '../models';
import { markDataChanged } from '../changes';
import type { SqlDatabase } from '../types';

export interface MerchantIdentity {
  /** The name as the message wrote it, or null. */
  recipientName: string | null;
  upiId: string | null;
}

/**
 * Section 8.4: "`identity_key` prefers the UPI ID. A UPI ID identifies one
 * specific payee, whereas names repeat and are often missing or generic."
 */
export function identityKeyFor({ recipientName, upiId }: MerchantIdentity): string | null {
  if (upiId) {
    return `upi:${upiId.toLowerCase()}`;
  }
  if (recipientName) {
    const normalized = normalizeMerchantName(recipientName);
    return normalized ? `name:${normalized}` : null;
  }
  return null;
}

export function findMerchantByIdentity(
  db: SqlDatabase,
  identityKey: string,
): MerchantRow | null {
  const { rows } = db.execute<MerchantRow>(
    `SELECT * FROM merchants WHERE identity_key = ?`,
    [identityKey],
  );
  return rows[0] ?? null;
}

export function findMerchantById(db: SqlDatabase, id: number): MerchantRow | null {
  const { rows } = db.execute<MerchantRow>(`SELECT * FROM merchants WHERE id = ?`, [id]);
  return rows[0] ?? null;
}

export interface FindOrCreateResult {
  merchant: MerchantRow;
  created: boolean;
}

/**
 * Section 8.4: "Merchants are created during import. When a message is parsed,
 * the merchant is looked up by `identity_key` and created if it does not
 * exist."
 */
export function findOrCreateMerchant(
  db: SqlDatabase,
  identity: MerchantIdentity,
  seenAt: number,
  now: number = Date.now(),
): FindOrCreateResult | null {
  const identityKey = identityKeyFor(identity);
  if (!identityKey) {
    // "NULL when nothing identifiable could be parsed" — section 8.1.
    return null;
  }

  const existing = findMerchantByIdentity(db, identityKey);
  if (existing) {
    db.execute(
      `UPDATE merchants
          SET first_seen_at = MIN(first_seen_at, ?),
              last_seen_at  = MAX(last_seen_at, ?),
              -- A name can arrive later than the UPI ID that created the row.
              -- The test is against upi_id, not for an at-sign: shop names
              -- carry those too, and LIKE '%@%' let one mis-parsed name
              -- overwrite a good CAFE@MG ROAD for good. A row whose display
              -- name is literally its handle is the only one still waiting
              -- for a name.
              display_name  = CASE WHEN display_name = upi_id AND ? IS NOT NULL
                                   THEN ? ELSE display_name END,
              normalized_name = COALESCE(normalized_name, ?),
              updated_at = ?
        WHERE id = ?`,
      [
        seenAt,
        seenAt,
        identity.recipientName,
        identity.recipientName,
        identity.recipientName ? normalizeMerchantName(identity.recipientName) : null,
        now,
        existing.id,
      ],
    );
    return { merchant: findMerchantById(db, existing.id)!, created: false };
  }

  // The display name falls back to the UPI ID, which is what the transactions
  // screen shows for `paytmqr2810050501@paytm`.
  const displayName = identity.recipientName ?? identity.upiId!;
  const normalized = identity.recipientName
    ? normalizeMerchantName(identity.recipientName)
    : null;

  const result = db.execute(
    `INSERT INTO merchants
       (identity_key, display_name, normalized_name, upi_id, category_id,
        category_source, is_self, first_seen_at, last_seen_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, 'NONE', 0, ?, ?, ?, ?)`,
    [identityKey, displayName, normalized, identity.upiId, seenAt, seenAt, now, now],
  );
  return { merchant: findMerchantById(db, result.insertId)!, created: true };
}

/**
 * Section 5.3: "If the merchant already has a category, nothing is changed. A
 * category the user has chosen is never replaced by the rules."
 */
export function applyAutomaticCategory(
  db: SqlDatabase,
  merchantId: number,
  categoryId: number,
  now: number = Date.now(),
): void {
  db.execute(
    `UPDATE merchants SET category_id = ?, category_source = 'AUTO', updated_at = ?
      WHERE id = ? AND category_id IS NULL AND category_source = 'NONE'`,
    [categoryId, now, merchantId],
  );
}

/**
 * Section 2.3 of the product requirements: "Save the user's category choice
 * for a merchant or UPI ID", and apply it to existing and future transactions.
 * One write does both, because the category hangs off the merchant.
 */
/**
 * How many other payments a merchant-level category would reach.
 *
 * Section 10.3 resolves a transaction's category as its own when the user set
 * one and the merchant's otherwise, so setting it on the merchant reaches
 * every past payment to that payee that has no override of its own. That is
 * the point of offering it — and it is a large enough effect that the user
 * should be told the number before agreeing to it.
 */
export function paymentsFollowingMerchantCategory(
  db: SqlDatabase,
  merchantId: number,
  exceptTransactionId?: number,
): number {
  const { rows } = db.execute<{ total: number }>(
    `SELECT COUNT(*) AS total FROM transactions
      WHERE merchant_id = ? AND category_id IS NULL AND is_deleted = 0
        AND id IS NOT ?`,
    [merchantId, exceptTransactionId ?? null],
  );
  return rows[0]?.total ?? 0;
}

export function setUserCategory(
  db: SqlDatabase,
  merchantId: number,
  categoryId: number,
  now: number = Date.now(),
): void {
  db.execute(
    `UPDATE merchants SET category_id = ?, category_source = 'USER', updated_at = ?
      WHERE id = ?`,
    [categoryId, now, merchantId],
  );
  markDataChanged();
}

/**
 * Takes back a category the user set against a payee.
 *
 * `category_source` is left at `USER` rather than reset to `NONE`, which
 * looks wrong and is the whole point: `applyRulesToExistingMerchants` runs
 * on every launch and fills in any merchant that is `NONE` with no category.
 * Reset, a payee the user had just cleared would be re-categorised by a rule
 * the next time the app opened. `USER` with no category is the user saying
 * none, and the rules leave it alone.
 *
 * Payments that had their own category keep it. Only the ones that were
 * resolving through the payee come loose.
 */
export function clearUserCategory(
  db: SqlDatabase,
  merchantId: number,
  now: number = Date.now(),
): void {
  db.execute(
    `UPDATE merchants SET category_id = NULL, category_source = 'USER', updated_at = ?
      WHERE id = ?`,
    [now, merchantId],
  );
  markDataChanged();
}

export function markMerchantAsSelf(
  db: SqlDatabase,
  merchantId: number,
  now: number = Date.now(),
): void {
  db.execute(`UPDATE merchants SET is_self = 1, updated_at = ? WHERE id = ?`, [
    now,
    merchantId,
  ]);
}
