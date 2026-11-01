/**
 * Section 12: reading lends out of the transactions table.
 *
 * There is no lends table. "A lend is an ordinary debit that happens to sit in
 * a category that tracks repayment, and a repayment is an ordinary credit that
 * happens to point at one." Everything here is a view over rows the rest of
 * the app already writes, so a lend cannot fall out of step with the payment
 * it is — they are the same row.
 */

import { RESOLVED_CATEGORY } from '../db/resolvedCategory';
import type { SqlDatabase } from '../db/types';

/**
 * Section 12.1's rule, written once for the same reason `IS_SPENDING` is.
 *
 * The category test goes through `RESOLVED_CATEGORY`, which is what makes
 * categorising a *payee* as Lend turn every payment to them into a lend: the
 * payment borrows the payee's category, and this reads whatever it resolves
 * to. `tracks_repayment` rather than the Lend row itself, because section 8.2
 * lets that category be renamed and lets the user make their own.
 *
 * `currency = 'INR'` for the reason the spending clause gives: a card used
 * abroad reports no rupee figure, and a foreign amount added into "left to get
 * back" would be wrong by whatever the exchange rate happens to be.
 *
 * Requires `transactions` aliased `t` and `merchants` aliased `m`.
 */
export const IS_LEND = `
  t.transaction_type = 'DEBIT'
  AND t.currency     = 'INR'
  AND t.is_deleted   = 0
  AND t.is_excluded  = 0
  AND t.is_transfer  = 0
  AND (
    EXISTS (SELECT 1 FROM categories lc
             WHERE lc.id = ${RESOLVED_CATEGORY}
               AND lc.tracks_repayment = 1)
    -- Section 12.7: recategorising a lend away from a repayment-tracking
    -- category stops it being a lend, unless the user has already acted on
    -- it. The payment screen keeps its "did this money come back?" switch
    -- on a payment marked as repaid for the same reason: a flag the user can
    -- no longer see is a flag they can no longer undo, and a repayment filed
    -- under a lend that has vanished belongs to nothing.
    OR t.repaid_at IS NOT NULL
    OR EXISTS (SELECT 1 FROM transactions r
                WHERE r.repays_transaction_id = t.id
                  AND r.is_deleted = 0)
  )
`;

/**
 * What has come back against a lend: the sum of the credits pointing at it.
 *
 * Section 12.2: "Nothing stores 'amount repaid' — it is that sum, every time
 * it is needed. A stored running total would be a copy of the credits and
 * would drift the first time one was deleted."
 */
export const REPAID_SUM = `
  COALESCE((SELECT SUM(r.amount) FROM transactions r
             WHERE r.repays_transaction_id = t.id
               AND r.is_deleted = 0), 0)
`;

export interface LendRow {
  id: number;
  /** Paise lent. */
  amount: number;
  /** Paise that have come back, which may exceed `amount` — see `surplus`. */
  repaid: number;
  /** Paise still to come back. Always zero once the lend is closed. */
  left: number;
  /** Paise received beyond what was lent, floored at zero. */
  surplus: number;
  /** How many credits are attached. */
  repayment_count: number;
  occurred_at: number;
  occurred_on: string;
  /** When it closed, or null while it is still open. */
  repaid_at: number | null;
  closed: boolean;
  merchant_id: number | null;
  /** Who it was lent to, as the app knows them. */
  person: string;
  /** What it was for. */
  note: string | null;
  source: 'SMS' | 'MANUAL';
  account_type: string | null;
  merchant_upi_id: string | null;
}

/**
 * The columns every lend view needs, derived in one place so the list and the
 * detail cannot disagree about what is left.
 */
const LEND_COLUMNS = `
  t.id, t.amount, t.occurred_at, t.occurred_on, t.repaid_at,
  t.merchant_id, t.note, t.source,
  COALESCE(m.display_name, t.recipient_name, 'Someone') AS person,
  m.upi_id AS merchant_upi_id,
  a.account_type,
  ${REPAID_SUM} AS repaid,
  (SELECT COUNT(*) FROM transactions r
    WHERE r.repays_transaction_id = t.id AND r.is_deleted = 0) AS repayment_count
`;

interface RawLend extends Omit<LendRow, 'left' | 'surplus' | 'closed'> {}

function shape(row: RawLend): LendRow {
  const closed = row.repaid_at !== null;
  return {
    ...row,
    // Nothing is left on a closed lend, however it was closed. A lend the
    // user closed by hand with the payment screen's switch has no repayments
    // recorded against it, so the subtraction alone left the full amount
    // standing under the words "fully paid back" — section 12.3 allows that
    // way of closing one, so the figure has to allow for it too.
    left: closed ? 0 : Math.max(0, row.amount - row.repaid),
    surplus: Math.max(0, row.repaid - row.amount),
    closed,
  };
}

/**
 * Every lend, open ones first and most recently lent first within each group.
 *
 * Section 12.6: "a lend that is settled is a record rather than something to
 * act on", so the closed ones sort below whatever is still outstanding.
 */
export function listLends(db: SqlDatabase): { open: LendRow[]; closed: LendRow[] } {
  const { rows } = db.execute<RawLend>(
    `SELECT ${LEND_COLUMNS}
       FROM transactions t
       LEFT JOIN merchants m ON m.id = t.merchant_id
       LEFT JOIN accounts  a ON a.id = t.account_id
      WHERE ${IS_LEND}
      ORDER BY t.occurred_at DESC, t.id DESC`,
  );
  const all = rows.map(shape);
  return {
    open: all.filter((lend) => !lend.closed),
    closed: all.filter((lend) => lend.closed),
  };
}

export function findLend(db: SqlDatabase, id: number): LendRow | null {
  const { rows } = db.execute<RawLend>(
    `SELECT ${LEND_COLUMNS}
       FROM transactions t
       LEFT JOIN merchants m ON m.id = t.merchant_id
       LEFT JOIN accounts  a ON a.id = t.account_id
      WHERE t.id = ? AND ${IS_LEND}`,
    [id],
  );
  return rows[0] ? shape(rows[0]) : null;
}

export interface RepaymentRow {
  id: number;
  amount: number;
  occurred_at: number;
  occurred_on: string;
  source: 'SMS' | 'MANUAL';
  person: string;
  merchant_upi_id: string | null;
  account_type: string | null;
}

/** The credits attached to a lend, oldest first — the order they arrived. */
export function listRepayments(db: SqlDatabase, lendId: number): RepaymentRow[] {
  return db.execute<RepaymentRow>(
    `SELECT t.id, t.amount, t.occurred_at, t.occurred_on, t.source,
            COALESCE(m.display_name, t.recipient_name, 'Someone') AS person,
            m.upi_id AS merchant_upi_id,
            a.account_type
       FROM transactions t
       LEFT JOIN merchants m ON m.id = t.merchant_id
       LEFT JOIN accounts  a ON a.id = t.account_id
      WHERE t.repays_transaction_id = ? AND t.is_deleted = 0
      ORDER BY t.occurred_at ASC, t.id ASC`,
    [lendId],
  ).rows;
}

export interface LendingTotals {
  /** Paise still to come back across every open lend. */
  left: number;
  openLends: number;
  /** How many different people are holding it. */
  people: number;
}

/**
 * Section 12.6's header figure.
 *
 * Deliberately not reachable from anywhere that adds up spending: lent money
 * is not spending, and money coming back is not income.
 */
export function lendingTotals(db: SqlDatabase): LendingTotals {
  const { open } = listLends(db);
  const people = new Set(
    open.map((lend) =>
      lend.merchant_id === null ? `name:${lend.person.toLowerCase()}` : `id:${lend.merchant_id}`,
    ),
  );
  return {
    left: open.reduce((sum, lend) => sum + lend.left, 0),
    openLends: open.length,
    people: people.size,
  };
}
