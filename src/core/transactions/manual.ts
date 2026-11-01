/**
 * Adding and editing a payment by hand.
 *
 * Section 5.3: "Categorization runs whenever a transaction is created,
 * whether it came from an imported message, a newly received message, or
 * manual entry." The merchant is resolved the same way too, so a payment
 * typed in by hand joins the same merchant row as the bank messages for that
 * payee and inherits whatever category the user has given it.
 */

import { categoryKeyForMerchantName } from '../categorization/categorize';
import { matchLending } from '../lending/match';
import { markDataChanged } from '../db/changes';
import { findCategoryBySystemKey } from '../db/dao/categories';
import { applyAutomaticCategory, findOrCreateMerchant } from '../db/dao/merchants';
import { findTransactionById, insertTransactionIfNew } from '../db/dao/transactions';
import type { TransactionRow } from '../db/models';
import type { SqlDatabase } from '../db/types';
import { dedupKeyForManualEntry } from '../sms/dedup';
import type { TransactionType } from '../sms/types';
import { toLocalDateString } from '../time/dates';
import { RESOLVED_CATEGORY } from '../db/resolvedCategory';

export interface ManualEntry {
  /** Paise, positive. The direction is carried by `transactionType`. */
  amount: number;
  transactionType: TransactionType;
  /** Who was paid, or who paid. */
  recipientName: string;
  upiId: string | null;
  /** The user's choice, which overrides whatever the merchant carries. */
  categoryId: number | null;
  accountId: number | null;
  occurredAt: number;
  note: string | null;
}

export interface ValidationResult {
  /** Field name to message. Empty when the entry can be saved. */
  errors: Partial<Record<'amount' | 'recipientName' | 'occurredAt', string>>;
}

/**
 * What the form will not let through.
 *
 * The amount check is the schema's own: section 8.1 stores a positive integer
 * and takes the sign from the type, so a zero or negative figure has no way
 * to be recorded and is refused here rather than at the insert.
 */
export function validate(entry: ManualEntry, now: number): ValidationResult {
  const errors: ValidationResult['errors'] = {};

  if (!Number.isFinite(entry.amount) || entry.amount <= 0) {
    errors.amount = 'Enter an amount greater than zero';
  }
  if (entry.recipientName.trim().length === 0) {
    errors.recipientName =
      entry.transactionType === 'DEBIT' ? 'Enter who you paid' : 'Enter who paid you';
  }
  // A payment cannot have happened later than now. Allowing it would put a
  // row in a period the Home page has already called complete.
  if (entry.occurredAt > now) {
    errors.occurredAt = 'This is in the future';
  }

  return { errors };
}

export function canSave(result: ValidationResult): boolean {
  return Object.keys(result.errors).length === 0;
}

/**
 * Writes the entry and everything that hangs off it.
 *
 * The dedup key is a fresh random one every time — section 3.2: "Manual
 * entries can never collide with each other or with a parsed message." Two
 * identical payments typed in a minute apart are two payments, and the app
 * has no way to know better than the person who typed them.
 */
export function createManualTransaction(
  db: SqlDatabase,
  entry: ManualEntry,
  now: number = Date.now(),
): TransactionRow {
  return db.transaction(() => {
    const name = entry.recipientName.trim();
    const merchantResult = findOrCreateMerchant(
      db,
      { recipientName: name, upiId: entry.upiId },
      entry.occurredAt,
      now,
    );
    const merchant = merchantResult?.merchant ?? null;

    // Section 5.2's rules run against the name only, never the UPI ID.
    if (merchant && merchant.category_id === null) {
      const systemKey = categoryKeyForMerchantName(name);
      if (systemKey) {
        const category = findCategoryBySystemKey(db, systemKey);
        if (category) {
          applyAutomaticCategory(db, merchant.id, category.id, now);
        }
      }
    }

    const inserted = insertTransactionIfNew(
      db,
      {
        amount: entry.amount,
        transactionType: entry.transactionType,
        occurredAt: entry.occurredAt,
        occurredOn: toLocalDateString(entry.occurredAt),
        merchantId: merchant?.id ?? null,
        recipientName: name,
        accountId: entry.accountId,
        categoryId: entry.categoryId,
        source: 'MANUAL',
        sourceSmsId: null,
        bankSenderId: null,
        rrn: null,
        parserId: null,
        dedupKey: dedupKeyForManualEntry(),
        note: entry.note,
        // Section 8.4: a payee already known to be one of the user's own
        // accounts makes this a transfer without needing a matching pair.
        isTransfer: merchant?.is_self === 1,
      },
      now,
    );
    // Section 12.4 runs on manual entries for the reason section 5.3 gives
    // for categorisation: a payment typed in by hand is a payment. Cash
    // handed back to settle a lend is recorded here and nowhere else.
    matchLending(db, inserted.row, now);
    markDataChanged();
    return findTransactionById(db, inserted.row.id) ?? inserted.row;
  });
}

/**
 * Editing a payment the user typed in.
 *
 * Everything is rewritten, including the merchant, because changing who was
 * paid has to move the transaction onto that payee's row rather than leaving
 * it filed under the old one. The dedup key is left alone: it is this row's
 * identity and nothing about an edit makes it a different payment.
 *
 * Picking a category here also lifts a clearing, the way picking one from the
 * payment itself does. Section 10.3 lets a payment be marked as deliberately
 * having no category, and that mark outranks the category column — so an edit
 * that wrote the category and left the mark alone was writing an answer
 * nothing would ever read, and the payment stayed uncategorised in front of a
 * user who had just categorised it. Leaving the field empty is not an answer,
 * so the mark stays as it was.
 */
export function updateManualTransaction(
  db: SqlDatabase,
  id: number,
  entry: ManualEntry,
  now: number = Date.now(),
): TransactionRow {
  return db.transaction(() => {
    const name = entry.recipientName.trim();
    const merchantResult = findOrCreateMerchant(
      db,
      { recipientName: name, upiId: entry.upiId },
      entry.occurredAt,
      now,
    );
    const merchant = merchantResult?.merchant ?? null;

    db.execute(
      `UPDATE transactions
          SET amount = ?, transaction_type = ?, occurred_at = ?, occurred_on = ?,
              merchant_id = ?, recipient_name = ?, account_id = ?, category_id = ?,
              category_cleared = CASE WHEN ? IS NULL THEN category_cleared ELSE 0 END,
              is_transfer = ?,
              note = ?, updated_at = ?
        WHERE id = ?`,
      [
        entry.amount,
        entry.transactionType,
        entry.occurredAt,
        toLocalDateString(entry.occurredAt),
        merchant?.id ?? null,
        name,
        entry.accountId,
        entry.categoryId,
        entry.categoryId,
        // Section 8.4, as the insert does it: changing the payee to one of
        // the user's own accounts makes this a transfer, and changing it away
        // from one makes it an ordinary payment again.
        merchant?.is_self === 1 ? 1 : 0,
        entry.note,
        now,
        id,
      ],
    );
    // Editing can make a payment a lend — by giving it the category — or
    // stop it being one. Either way the money that came back has to be
    // looked at again.
    matchLending(db, findTransactionById(db, id)!, now);
    markDataChanged();
    return findTransactionById(db, id)!;
  });
}

export interface TransactionDetail extends TransactionRow {
  merchant_name: string | null;
  merchant_upi_id: string | null;
  category_name: string | null;
  category_color: string | null;
  /** The category actually in force, whether the user's or the merchant's. */
  resolved_category_id: number | null;
  /**
   * What the payee carries, which is a different question.
   *
   * The screen has to tell "this payment has no category" from "this payment
   * is borrowing one", because clearing the first touches one row and
   * clearing the second touches every payment to that payee.
   */
  merchant_category_id: number | null;
  merchant_category_name: string | null;
  /** Whether that category asks the user if the money came back. */
  category_tracks_repayment: 0 | 1 | null;
  bank_name: string | null;
  last_four: string | null;
  account_type: string | null;
}

export function getTransactionDetail(
  db: SqlDatabase,
  id: number,
): TransactionDetail | null {
  const { rows } = db.execute<TransactionDetail>(
    `SELECT t.*,
            m.display_name AS merchant_name,
            m.upi_id       AS merchant_upi_id,
            c.name         AS category_name,
            c.color        AS category_color,
            c.tracks_repayment AS category_tracks_repayment,
            ${RESOLVED_CATEGORY} AS resolved_category_id,
            m.category_id  AS merchant_category_id,
            mc.name        AS merchant_category_name,
            a.bank_name, a.last_four, a.account_type
       FROM transactions t
       LEFT JOIN merchants  m ON m.id = t.merchant_id
       LEFT JOIN categories c  ON c.id = ${RESOLVED_CATEGORY}
       LEFT JOIN categories mc ON mc.id = m.category_id
       LEFT JOIN accounts   a ON a.id = t.account_id
      WHERE t.id = ?`,
    [id],
  );
  return rows[0] ?? null;
}
