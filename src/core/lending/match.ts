/**
 * Section 12.4: attaching money that comes back to the lend it pays back,
 * without being asked.
 *
 * The match is on the payee, not on the UPI ID. The obvious design — "the
 * same UPI ID the money went to" — was measured against real imported
 * messages before it was written down, and bank credit messages name the
 * sender far more often than they give a handle; a rule keyed on the handle
 * would almost never fire. Section 8.4's `identity_key` already prefers the
 * UPI ID and falls back to the normalised name, so matching on `merchant_id`
 * uses the handle whenever the bank gives one and the name when it does not,
 * and introduces no second notion of who someone is.
 */

import { findTransactionById } from '../db/dao/transactions';
import type { TransactionRow } from '../db/models';
import type { SqlDatabase } from '../db/types';
import { IS_LEND, REPAID_SUM, findLend, type LendRow } from './lends';
import { attachRepayment } from './repayments';

export interface LendMatch {
  creditId: number;
  lendId: number;
  closed: boolean;
}

interface OpenLend {
  id: number;
  amount: number;
  repaid: number;
  occurred_at: number;
}

/**
 * Whether this credit is the kind of money that can pay back a lend.
 *
 * The reversal test is the one worth explaining. Section 4.1 matches a failed
 * payment to the credit that returns it by their shared reference number, and
 * marks the debit refunded rather than flagging the credit — so a reversal
 * credit carries nothing on itself to recognise it by. Its reference is the
 * tell, and checking it here means the guard holds on the backfill path as
 * well as on the live one, where `ingestMessage` already knows the answer.
 */
function canRepay(db: SqlDatabase, credit: TransactionRow): boolean {
  if (credit.transaction_type !== 'CREDIT') return false;
  if (credit.is_deleted === 1 || credit.is_transfer === 1) return false;
  if (credit.currency !== 'INR') return false;
  if (credit.repays_transaction_id !== null) return false;
  if (credit.merchant_id === null) return false;

  const { rows } = db.execute<{ one: number }>(
    `SELECT 1 AS one FROM merchants WHERE id = ? AND is_self = 1`,
    [credit.merchant_id],
  );
  if (rows.length > 0) return false;

  if (credit.rrn) {
    const reversal = db.execute<{ one: number }>(
      `SELECT 1 AS one FROM transactions
        WHERE rrn = ? AND transaction_type = 'DEBIT' AND is_deleted = 0 LIMIT 1`,
      [credit.rrn],
    );
    if (reversal.rows.length > 0) return false;
  }
  return true;
}

/** Open lends to this payee that were made before the credit arrived. */
function openLendsFor(
  db: SqlDatabase,
  merchantId: number,
  before: number,
): OpenLend[] {
  const { rows } = db.execute<OpenLend>(
    `SELECT t.id, t.amount, t.occurred_at, ${REPAID_SUM} AS repaid
       FROM transactions t
       LEFT JOIN merchants m ON m.id = t.merchant_id
      WHERE ${IS_LEND}
        AND t.merchant_id = ?
        AND t.repaid_at IS NULL
        AND t.occurred_at <= ?
      ORDER BY t.occurred_at ASC, t.id ASC`,
    [merchantId, before],
  );
  return rows.filter((lend) => lend.amount - lend.repaid > 0);
}

/**
 * Section 12.4's choice, when a person has more than one lend open.
 *
 * An exact remainder first, because paying back a round figure is how a
 * repayment usually arrives and an exact match is the strongest signal
 * available; the oldest otherwise, because that is what a person means when
 * they pay back a debt. The credit attaches to one lend and only one — a
 * surplus is reported on that lend rather than spread into the next, since
 * `repays_transaction_id` holds a single id and section 12.2 chose that over
 * a table of part-allocations deliberately.
 */
function pickLend(lends: OpenLend[], amount: number): OpenLend | null {
  const exact = lends.find((lend) => lend.amount - lend.repaid === amount);
  return exact ?? lends[0] ?? null;
}

/** A credit has arrived: look back for a lend it might be paying off. */
export function matchCreditToLend(
  db: SqlDatabase,
  credit: TransactionRow,
  now: number = Date.now(),
): LendMatch | null {
  if (!canRepay(db, credit) || credit.merchant_id === null) {
    return null;
  }
  const lend = pickLend(openLendsFor(db, credit.merchant_id, credit.occurred_at), credit.amount);
  if (!lend) {
    return null;
  }
  const attached = attachRepayment(db, credit.id, lend.id, now);
  return attached.ok
    ? { creditId: credit.id, lendId: lend.id, closed: attached.closed }
    : null;
}

/**
 * A lend has appeared: look forward for money already back.
 *
 * Section 12.4: "The historical import reads messages newest first, so during
 * an import the repayment is seen before the lend it repays." The same thing
 * happens outside an import whenever a payment *becomes* a lend by being
 * categorised, months after the friend paid it back.
 *
 * Credits are taken oldest first and only while something is still owed, so a
 * lend absorbs exactly as much as it needs and leaves the rest alone.
 */
export function matchLendToCredits(
  db: SqlDatabase,
  lendId: number,
  now: number = Date.now(),
): LendMatch[] {
  const lend = findLend(db, lendId);
  if (!lend || lend.closed || lend.merchant_id === null) {
    return [];
  }

  const { rows } = db.execute<{ id: number }>(
    `SELECT id FROM transactions
      WHERE merchant_id = ?
        AND transaction_type = 'CREDIT'
        AND repays_transaction_id IS NULL
        AND is_deleted = 0
        AND occurred_at >= ?
      ORDER BY occurred_at ASC, id ASC`,
    [lend.merchant_id, lend.occurred_at],
  );

  const matches: LendMatch[] = [];
  let left = lend.left;
  for (const { id } of rows) {
    if (left <= 0) break;
    const credit = findTransactionById(db, id);
    if (!credit || !canRepay(db, credit)) continue;
    const attached = attachRepayment(db, credit.id, lendId, now);
    if (attached.ok) {
      matches.push({ creditId: credit.id, lendId, closed: attached.closed });
      left -= credit.amount;
    }
  }
  return matches;
}

/**
 * The one entry point the ingestion paths call, for any transaction they have
 * just written. Runs in whichever direction the new row allows.
 */
export function matchLending(
  db: SqlDatabase,
  transaction: TransactionRow,
  now: number = Date.now(),
): LendMatch[] {
  if (transaction.transaction_type === 'CREDIT') {
    const match = matchCreditToLend(db, transaction, now);
    return match ? [match] : [];
  }
  return matchLendToCredits(db, transaction.id, now);
}

/**
 * Every open lend to one payee looks again for money already back.
 *
 * Section 12.1: categorising a *payee* as Lend turns every payment to them
 * into a lend at once, so one category write can create a dozen lends that
 * have never been offered a repayment. This is what the category screens call
 * afterwards.
 */
export function matchLendingForMerchant(
  db: SqlDatabase,
  merchantId: number,
  now: number = Date.now(),
): LendMatch[] {
  const { rows } = db.execute<{ id: number }>(
    `SELECT t.id
       FROM transactions t
       LEFT JOIN merchants m ON m.id = t.merchant_id
      WHERE ${IS_LEND}
        AND t.merchant_id = ?
        AND t.repaid_at IS NULL
      ORDER BY t.occurred_at ASC, t.id ASC`,
    [merchantId],
  );
  return rows.flatMap(({ id }) => matchLendToCredits(db, id, now));
}

export type { LendRow };
