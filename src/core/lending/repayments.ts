/**
 * Section 12.2 and 12.3: attaching money to the lend it pays back, and
 * deciding when a lend is closed.
 *
 * Every write to `repays_transaction_id` and every write to a lend's
 * `repaid_at` goes through this file. Section 12.3 accepts that `repaid_at` is
 * a stored copy of something derivable — `IS_SPENDING` tests it in fourteen
 * queries and a correlated sum in all fourteen is too high a price — and the
 * price of accepting it is that one module owns both sides of the invariant.
 */

import { markDataChanged } from '../db/changes';
import { getCashAccount } from '../db/dao/accounts';
import { findCategoryBySystemKey } from '../db/dao/categories';
import { findOrCreateMerchant } from '../db/dao/merchants';
import { findTransactionById, insertTransactionIfNew } from '../db/dao/transactions';
import type { TransactionRow } from '../db/models';
import type { SqlDatabase } from '../db/types';
import { dedupKeyForManualEntry } from '../sms/dedup';
import { toLocalDateString } from '../time/dates';
import { findLend } from './lends';
// `match` imports `attachRepayment` back from here. The two modules reference
// each other only from inside function bodies, never while either is being
// evaluated, which is the shape of cycle a module graph resolves without
// complaint. Section 12.4 is policy over these primitives and a new lend has
// to go through it like every other write does.
import { matchLendToCredits } from './match';

/** What the credits attached to a lend currently come to. */
function repaidOn(db: SqlDatabase, lendId: number): { total: number; count: number } {
  const { rows } = db.execute<{ total: number; count: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
       FROM transactions
      WHERE repays_transaction_id = ? AND is_deleted = 0`,
    [lendId],
  );
  return rows[0] ?? { total: 0, count: 0 };
}

/**
 * Brings a lend's `repaid_at` into line with the credits attached to it.
 *
 * A lend with no attached credits is left alone, and that is the one case
 * worth explaining. `repaid_at` is also what the payment screen's "Did this
 * money come back?" switch writes, which is the right answer for cash handed
 * back in person and for every lend marked that way before section 12 existed.
 * Recomputing from zero repayments would silently undo it. Callers that have
 * just removed the last repayment know better and say so with `allowReopen`.
 */
export function refreshLendClosure(
  db: SqlDatabase,
  lendId: number,
  now: number = Date.now(),
  allowReopen = false,
): void {
  const lend = findTransactionById(db, lendId);
  if (!lend) {
    return;
  }

  const { total, count } = repaidOn(db, lendId);
  if (count === 0 && !allowReopen) {
    return;
  }

  const covered = total >= lend.amount;
  if (covered && lend.repaid_at === null) {
    db.execute(`UPDATE transactions SET repaid_at = ?, updated_at = ? WHERE id = ?`, [
      now,
      now,
      lendId,
    ]);
    markDataChanged();
    return;
  }
  if (!covered && lend.repaid_at !== null) {
    db.execute(`UPDATE transactions SET repaid_at = NULL, updated_at = ? WHERE id = ?`, [
      now,
      lendId,
    ]);
    markDataChanged();
  }
}

export type AttachRefusal =
  | 'NOT_A_CREDIT'
  | 'ALREADY_ATTACHED'
  | 'NOT_A_LEND'
  | 'BEFORE_THE_LEND'
  | 'GONE';

export type AttachResult =
  | { ok: true; lendId: number; creditId: number; closed: boolean }
  | { ok: false; reason: AttachRefusal };

/**
 * Points a credit at the lend it pays back.
 *
 * The checks are the ones section 12.4 makes of an automatic match, applied
 * here as well because this is also the path the user takes by hand and a
 * credit that arrived before the money went out cannot be paying it back
 * whichever way it got here.
 */
export function attachRepayment(
  db: SqlDatabase,
  creditId: number,
  lendId: number,
  now: number = Date.now(),
): AttachResult {
  return db.transaction(() => {
    const credit = findTransactionById(db, creditId);
    const lend = findLend(db, lendId);
    if (!credit || !lend) {
      return { ok: false, reason: 'GONE' } as AttachResult;
    }
    if (credit.transaction_type !== 'CREDIT' || credit.is_deleted === 1) {
      return { ok: false, reason: 'NOT_A_CREDIT' } as AttachResult;
    }
    if (credit.repays_transaction_id !== null && credit.repays_transaction_id !== lendId) {
      return { ok: false, reason: 'ALREADY_ATTACHED' } as AttachResult;
    }
    if (credit.id === lendId) {
      return { ok: false, reason: 'NOT_A_LEND' } as AttachResult;
    }
    if (credit.occurred_at < lend.occurred_at) {
      return { ok: false, reason: 'BEFORE_THE_LEND' } as AttachResult;
    }

    db.execute(
      `UPDATE transactions SET repays_transaction_id = ?, updated_at = ? WHERE id = ?`,
      [lendId, now, creditId],
    );
    refreshLendClosure(db, lendId, now, true);
    markDataChanged();

    const after = findLend(db, lendId);
    return {
      ok: true,
      lendId,
      creditId,
      closed: after?.closed ?? false,
    } as AttachResult;
  });
}

/**
 * Takes a credit back off a lend — section 12.4's "nothing is final".
 *
 * The credit becomes an ordinary credit again and the lend reopens if this
 * was what closed it. `allowReopen` is passed because removing the last
 * repayment is exactly the case `refreshLendClosure` otherwise declines to
 * act on, and here the caller does know the lend is no longer paid.
 */
export function detachRepayment(
  db: SqlDatabase,
  creditId: number,
  now: number = Date.now(),
): number | null {
  return db.transaction(() => {
    const credit = findTransactionById(db, creditId);
    const lendId = credit?.repays_transaction_id ?? null;
    if (lendId === null) {
      return null;
    }
    db.execute(
      `UPDATE transactions SET repays_transaction_id = NULL, updated_at = ? WHERE id = ?`,
      [now, creditId],
    );
    refreshLendClosure(db, lendId, now, true);
    markDataChanged();
    return lendId;
  });
}

export interface CashRepayment {
  lendId: number;
  /** Paise, positive. */
  amount: number;
  occurredAt: number;
}

/**
 * Section 12.5's "Record repayment": the money arrived in cash, so it is
 * written as a cash credit and then attached like any other.
 *
 * The amount is clamped to what is left rather than refused, because the
 * screen already prevents more being entered and a clamp is a kinder failure
 * than a lost tap if one ever gets through.
 */
export function recordCashRepayment(
  db: SqlDatabase,
  entry: CashRepayment,
  now: number = Date.now(),
): TransactionRow | null {
  return db.transaction(() => {
    const lend = findLend(db, entry.lendId);
    // A closed lend has nothing left to take, and `left` is zero on one, so
    // without this the clamp below would quietly record a single paisa.
    if (!lend || lend.closed || entry.amount <= 0) {
      return null;
    }
    const amount = Math.min(entry.amount, Math.max(1, lend.left));

    // The same payee row the lend is against, so the person's name on the
    // repayment is the person's name on the lend and a later UPI credit from
    // them lands on the same merchant.
    const merchant =
      lend.merchant_id !== null
        ? { id: lend.merchant_id }
        : (findOrCreateMerchant(db, { recipientName: lend.person, upiId: null }, entry.occurredAt, now)
            ?.merchant ?? null);

    const inserted = insertTransactionIfNew(
      db,
      {
        amount,
        transactionType: 'CREDIT',
        occurredAt: entry.occurredAt,
        occurredOn: toLocalDateString(entry.occurredAt),
        merchantId: merchant?.id ?? null,
        recipientName: lend.person,
        accountId: getCashAccount(db)?.id ?? null,
        // A credit is never spending, so it needs no category — and section
        // 12.2 is explicit that there is no Repayment category to give it.
        // The pill the screens show comes from the link, not from a category.
        categoryId: null,
        source: 'MANUAL',
        sourceSmsId: null,
        bankSenderId: null,
        rrn: null,
        parserId: null,
        dedupKey: dedupKeyForManualEntry(),
        note: null,
      },
      now,
    );

    attachRepayment(db, inserted.row.id, entry.lendId, now);
    markDataChanged();
    return findTransactionById(db, inserted.row.id);
  });
}

export interface CashLend {
  /** Who it was lent to. */
  person: string;
  /** Paise, positive. */
  amount: number;
  occurredAt: number;
  /** What it was for. */
  note: string | null;
}

export type CashLendErrors = Partial<Record<'person' | 'amount' | 'occurredAt', string>>;

/**
 * Section 12.5's "New lend · cash".
 *
 * Cash only, and the screen says so. A UPI lend already exists in the app as
 * a payment; typing it in again would make a second row that section 3's
 * deduplication cannot catch, because a manual entry is given a fresh key
 * every time precisely so that two identical payments stay two payments.
 */
export function validateCashLend(entry: CashLend, now: number): CashLendErrors {
  const errors: CashLendErrors = {};
  if (entry.person.trim().length === 0) {
    errors.person = 'Enter who you lent it to';
  }
  if (!Number.isFinite(entry.amount) || entry.amount <= 0) {
    errors.amount = 'Enter an amount greater than zero';
  }
  if (entry.occurredAt > now) {
    errors.occurredAt = 'This is in the future';
  }
  return errors;
}

export function createCashLend(
  db: SqlDatabase,
  entry: CashLend,
  now: number = Date.now(),
): TransactionRow | null {
  const lendCategory = findCategoryBySystemKey(db, 'lend');
  if (!lendCategory) {
    return null;
  }

  return db.transaction(() => {
    const person = entry.person.trim();
    const merchant =
      findOrCreateMerchant(db, { recipientName: person, upiId: null }, entry.occurredAt, now)
        ?.merchant ?? null;

    const inserted = insertTransactionIfNew(
      db,
      {
        amount: entry.amount,
        transactionType: 'DEBIT',
        occurredAt: entry.occurredAt,
        occurredOn: toLocalDateString(entry.occurredAt),
        merchantId: merchant?.id ?? null,
        recipientName: person,
        accountId: getCashAccount(db)?.id ?? null,
        // Set on the transaction, not on the payee. Lending a friend cash
        // once must not turn every payment to them into a lend; section
        // 12.1's payee-level behaviour is something the user asks for
        // deliberately from the payment screen.
        categoryId: lendCategory.id,
        source: 'MANUAL',
        sourceSmsId: null,
        bankSenderId: null,
        rrn: null,
        parserId: null,
        dedupKey: dedupKeyForManualEntry(),
        note: entry.note,
      },
      now,
    );
    // Section 12.4 in the forward direction, and inside this transaction
    // rather than after it. Cash lent to someone who has already sent money
    // back by UPI since finds that credit immediately — and every caller
    // gets that, not just the screen that used to do it by hand on the way
    // out. Doing it afterwards also meant a failure there left a lend
    // written and committed with its repayments unattached.
    matchLendToCredits(db, inserted.row.id, now);
    markDataChanged();
    return findTransactionById(db, inserted.row.id) ?? inserted.row;
  });
}

export interface LendEdit {
  /** Only applied to a lend the user typed in — see below. */
  person: string;
  /** Paise, positive. */
  amount: number;
  occurredAt: number;
  note: string | null;
}

/**
 * Section 12.7: editing the lend edits the transaction, because they are the
 * same row.
 *
 * The payee is rewritten only on a lend added by hand. On one that came from
 * a bank message the name is parse evidence — section 8.1 keeps it "exactly
 * as the message wrote it" — and letting this screen overwrite it would move
 * the payment onto a different payee, taking its category, its history and
 * any other lends to that person with it.
 *
 * Changing the amount changes what is left, so the closure is recomputed.
 * Repayments already received are not touched: an amount edited below what
 * has come back closes the lend and shows nothing left rather than a negative
 * figure, which is what `LendRow` floors at zero.
 */
export function updateLend(
  db: SqlDatabase,
  id: number,
  edit: LendEdit,
  now: number = Date.now(),
): TransactionRow | null {
  return db.transaction(() => {
    const existing = findTransactionById(db, id);
    if (!existing || edit.amount <= 0) {
      return null;
    }

    const typedIn = existing.source === 'MANUAL';
    const person = edit.person.trim();
    const merchantId =
      typedIn && person.length > 0
        ? findOrCreateMerchant(db, { recipientName: person, upiId: null }, edit.occurredAt, now)
            ?.merchant?.id ?? existing.merchant_id
        : existing.merchant_id;

    db.execute(
      `UPDATE transactions
          SET amount = ?, occurred_at = ?, occurred_on = ?, note = ?,
              merchant_id = ?,
              recipient_name = CASE WHEN ? = 1 THEN ? ELSE recipient_name END,
              updated_at = ?
        WHERE id = ?`,
      [
        edit.amount,
        edit.occurredAt,
        toLocalDateString(edit.occurredAt),
        edit.note,
        merchantId,
        typedIn ? 1 : 0,
        person,
        now,
        id,
      ],
    );

    refreshLendClosure(db, id, now);
    markDataChanged();
    return findTransactionById(db, id);
  });
}
