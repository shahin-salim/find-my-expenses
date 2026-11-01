/**
 * Section 10, the spending definition every figure on Home is built from.
 *
 * "A transaction counts as spending when it is a debit, has not been deleted,
 * has not been excluded by the user, has not been refunded, and is not a
 * transfer to the user's own accounts."
 *
 * "All figures are calculated from the transactions table when the page is
 * opened. There are no stored totals or precalculated tables."
 */

import { RESOLVED_CATEGORY } from '../db/resolvedCategory';
import { IS_SPENDING } from '../db/spendingClause';
import type { SqlDatabase, SqlValue } from '../db/types';
import {
  addLocalDays,
  addLocalMonths,
  startOfLocalDay,
  startOfLocalMonth,
  startOfLocalWeek,
  toLocalDateString,
} from '../time/dates';

/* What counts as spending now lives in `db/spendingClause.ts`, because the
 * Categories screen needs the same answer and had been giving another one.
 * The reasoning that used to sit here is there. */


/**
 * How much of the money leaving the account the page is looking at.
 *
 *   EVERYDAY    what the user actually chooses to spend, day to day
 *   EVERYTHING  that, plus the commitments and the money that only moved
 *
 * The two are nested: the second is the first with every filter lifted, so a
 * figure can never grow by moving down the list.
 *
 * There was a third view between them, `ALL`, which showed everyday spending
 * plus the rent and bills. It is gone because a fixed cost now leaves the
 * spending figures outright rather than only the everyday ones, which left
 * `ALL` and `EVERYDAY` returning the same number under different names.
 */
export type SpendingView = 'EVERYDAY' | 'EVERYTHING';

/** The three periods the Home page can be looking at. */
export type PeriodKind = 'DAY' | 'WEEK' | 'MONTH';

/**
 * The Home filter sheet's two options. "Everyday spending" leaves out rent,
 * SIPs and regular bills, which are marked on the category.
 */
const CATEGORY_FLAG = (column: string) => `
  AND COALESCE(
    (SELECT c.${column} FROM categories c
      WHERE c.id = ${RESOLVED_CATEGORY}),
    0
  ) = 0
`;

function viewClause(view: SpendingView): string {
  // Section 8.2's "Leave out of spending totals": money that moved but was
  // not spent, such as an investment or a loan to a friend. It is not
  // spending under any view that claims to be about spending, which is why
  // only `EVERYTHING` sees it — and `EVERYTHING` does not claim to be.
  //
  // A fixed cost is now treated the same way. Section 8.2 says rent, bills
  // and SIPs "recur at a size that drowns out everyday spending", and that
  // is as true of a monthly total as of a daily one: a figure that rent is
  // inside says more about the lease than about the month. Both flags are
  // the user's own statement that a category is not what they are trying to
  // watch, so both are honoured wherever spending is counted.
  if (view === 'EVERYTHING') {
    return '';
  }
  return CATEGORY_FLAG('excluded_from_totals') + CATEGORY_FLAG('is_fixed_cost');
}

/**
 * Periods are matched on the stored local date, never on the instant.
 *
 * Section 10: "A transaction's date is fixed when the transaction is recorded
 * and is never recalculated afterwards, so a payment made while travelling
 * keeps the date it had in the place it was made." Comparing `occurred_at`
 * against a local midnight would undo that, and would also let the calendar
 * grid and the week total disagree about which day a late-night payment
 * belongs to — which section 10 requires never to happen.
 *
 * The upper bound is the start of the next period, so it is exclusive on both
 * the millisecond and the date-string form.
 */
const IN_PERIOD = `t.occurred_on >= ? AND t.occurred_on < ?`;

const FROM_WITH_CATEGORY = `
  FROM transactions t
  LEFT JOIN merchants m ON m.id = t.merchant_id
`;

export interface Period {
  /** Inclusive, epoch millis. */
  from: number;
  /** Exclusive, epoch millis. */
  to: number;
}

export function today(now: number): Period {
  const from = startOfLocalDay(now);
  return { from, to: addLocalDays(from, 1) };
}

export function thisWeek(now: number): Period {
  const from = startOfLocalWeek(now);
  return { from, to: addLocalDays(from, 7) };
}

export function thisMonth(now: number): Period {
  const from = startOfLocalMonth(now);
  return { from, to: addLocalMonths(from, 1) };
}

/** The start of the period of `kind` that `at` falls in. */
export function startOfPeriod(kind: PeriodKind, at: number): number {
  switch (kind) {
    case 'DAY':
      return startOfLocalDay(at);
    case 'WEEK':
      return startOfLocalWeek(at);
    case 'MONTH':
      return startOfLocalMonth(at);
  }
}

/** Steps whole periods forwards, or backwards when `count` is negative. */
export function addPeriods(kind: PeriodKind, at: number, count: number): number {
  switch (kind) {
    case 'DAY':
      return addLocalDays(at, count);
    case 'WEEK':
      return addLocalDays(at, count * 7);
    case 'MONTH':
      return addLocalMonths(at, count);
  }
}

/** The whole period of `kind` that `at` falls in. */
export function periodOf(kind: PeriodKind, at: number): Period {
  const from = startOfPeriod(kind, at);
  return { from, to: addPeriods(kind, from, 1) };
}

/** The period before `period`, always taken in full — section 10. */
export function previousPeriod(period: Period, kind: 'DAY' | 'WEEK' | 'MONTH'): Period {
  switch (kind) {
    case 'DAY':
      return { from: addLocalDays(period.from, -1), to: period.from };
    case 'WEEK':
      return { from: addLocalDays(period.from, -7), to: period.from };
    case 'MONTH':
      return { from: addLocalMonths(period.from, -1), to: period.from };
  }
}

/** Total spent in a period, in paise. */
export function spendingTotal(
  db: SqlDatabase,
  period: Period,
  view: SpendingView = 'EVERYDAY',
): number {
  const params: SqlValue[] = [
    toLocalDateString(period.from),
    toLocalDateString(period.to),
  ];
  const { rows } = db.execute<{ total: number | null }>(
    `SELECT COALESCE(SUM(t.amount), 0) AS total
     ${FROM_WITH_CATEGORY}
      WHERE ${IS_SPENDING}
        AND ${IN_PERIOD}
        ${viewClause(view)}`,
    params,
  );
  return rows[0]?.total ?? 0;
}

export interface DayTotal {
  /** `YYYY-MM-DD`. */
  occurred_on: string;
  total: number;
}

/**
 * Every day in the period that had spending, with its total. Days with none
 * are absent rather than zero; section 10.4 leaves those cells empty, and the
 * chart and the median fill them in themselves where a zero is wanted.
 *
 * This is the one read behind the chart, the median line and the calendar.
 * Each of those wants the same days bucketed differently, and bucketing once
 * in the caller beats running a query per bucket — a daily median over thirty
 * days would otherwise be thirty round trips every time Home opens.
 */
export function spendingByDay(
  db: SqlDatabase,
  period: Period,
  view: SpendingView = 'EVERYDAY',
): DayTotal[] {
  return db.execute<DayTotal>(
    `SELECT t.occurred_on, SUM(t.amount) AS total
     ${FROM_WITH_CATEGORY}
      WHERE ${IS_SPENDING}
        AND ${IN_PERIOD}
        ${viewClause(view)}
      GROUP BY t.occurred_on
      ORDER BY t.occurred_on`,
    [toLocalDateString(period.from), toLocalDateString(period.to)],
  ).rows;
}

/**
 * The local date of the oldest spending on record, or null when there is
 * none.
 *
 * Section 10.2 hides the median until there is enough history behind it, and
 * "enough" means periods the user was actually using the app for. Counting
 * buckets instead would always reach the required number, because a bucket
 * with no spending still counts as zero.
 */
export function earliestSpendingDay(
  db: SqlDatabase,
  view: SpendingView = 'EVERYDAY',
): string | null {
  const { rows } = db.execute<{ day: string | null }>(
    `SELECT MIN(t.occurred_on) AS day
     ${FROM_WITH_CATEGORY}
      WHERE ${IS_SPENDING} ${viewClause(view)}`,
  );
  return rows[0]?.day ?? null;
}

export interface PeriodSummary {
  total: number;
  previousTotal: number;
  /** Percent change against the whole of the previous period, or null. */
  changePercent: number | null;
}

export function summarise(
  db: SqlDatabase,
  kind: 'DAY' | 'WEEK' | 'MONTH',
  now: number,
  view: SpendingView = 'EVERYDAY',
): PeriodSummary {
  const period =
    kind === 'DAY' ? today(now) : kind === 'WEEK' ? thisWeek(now) : thisMonth(now);
  const total = spendingTotal(db, period, view);
  const previousTotal = spendingTotal(db, previousPeriod(period, kind), view);

  return {
    total,
    previousTotal,
    // A previous period with no spending gives no meaningful percentage.
    changePercent:
      previousTotal === 0 ? null : ((total - previousTotal) / previousTotal) * 100,
  };
}

/**
 * What a category flag is keeping out of the spending figures, in paise.
 *
 * Both of these used to be the difference between two views, which was
 * readable while there were three of them. There are two now, so each asks
 * its own question instead: a subtraction that crossed the one remaining
 * boundary would report the other flag's total as well.
 */
function hiddenByFlag(db: SqlDatabase, period: Period, column: string): number {
  const { rows } = db.execute<{ total: number | null }>(
    `SELECT COALESCE(SUM(t.amount), 0) AS total
     ${FROM_WITH_CATEGORY}
      WHERE ${IS_SPENDING}
        AND ${IN_PERIOD}
        AND COALESCE(
          (SELECT c.${column} FROM categories c
            WHERE c.id = ${RESOLVED_CATEGORY}),
          0
        ) = 1`,
    [toLocalDateString(period.from), toLocalDateString(period.to)],
  );
  return rows[0]?.total ?? 0;
}

/**
 * What the "fixed costs hidden" line reports: the rent, bills and premiums
 * the spending figures are leaving out.
 *
 * A category carrying both flags is counted as moved money rather than as a
 * fixed cost, so the two figures never report the same payment twice.
 */
export function fixedCostTotal(db: SqlDatabase, period: Period): number {
  return (
    hiddenByFlag(db, period, 'is_fixed_cost') -
    hiddenByFlag(db, period, 'is_fixed_cost AND c.excluded_from_totals')
  );
}

/**
 * What "Everything that left" would add back: the investments and loans that
 * no spending view counts.
 */
export function movedMoneyTotal(db: SqlDatabase, period: Period): number {
  return hiddenByFlag(db, period, 'excluded_from_totals');
}

export interface RecentTransaction {
  id: number;
  amount: number;
  transaction_type: 'DEBIT' | 'CREDIT';
  occurred_at: number;
  occurred_on: string;
  display_name: string | null;
  category_name: string | null;
  category_color: string | null;
  bank_name: string | null;
  last_four: string | null;
  is_transfer: 0 | 1;
  is_refunded: 0 | 1;
  source: 'SMS' | 'MANUAL';
  currency: string;
}

/**
 * Section 10.3: "A transaction uses its own category when the user has changed
 * it, and the merchant's category otherwise." One COALESCE, everywhere.
 */
export function recentTransactions(
  db: SqlDatabase,
  limit = 20,
): RecentTransaction[] {
  return db.execute<RecentTransaction>(
    `SELECT t.id, t.amount, t.currency, t.transaction_type, t.occurred_at, t.occurred_on,
            COALESCE(m.display_name, t.recipient_name) AS display_name,
            c.name  AS category_name,
            c.color AS category_color,
            a.bank_name, a.last_four,
            t.is_transfer, t.is_refunded, t.source
       FROM transactions t
       LEFT JOIN merchants  m ON m.id = t.merchant_id
       LEFT JOIN categories c ON c.id = ${RESOLVED_CATEGORY}
       LEFT JOIN accounts   a ON a.id = t.account_id
      WHERE t.is_deleted = 0
      ORDER BY t.occurred_at DESC, t.id DESC
      LIMIT ?`,
    [limit],
  ).rows;
}

/** Paise to the `₹1,240` form every screen uses. */
export function formatRupees(paise: number, options: { showPaise?: boolean } = {}): string {
  const rupees = paise / 100;
  const text = rupees.toLocaleString('en-IN', {
    minimumFractionDigits: options.showPaise ? 2 : 0,
    maximumFractionDigits: options.showPaise ? 2 : 0,
  });
  return `₹${text}`;
}

/**
 * The short form for a label drawn inside the chart — `₹9.9k`.
 *
 * Only ever for an annotation with no room for `₹9,920`. Every figure a
 * person might act on is still written out in full somewhere; this one exists
 * so the line can carry a sense of scale now that it has no axis to borrow
 * one from.
 *
 * `k` up to a lakh and `L` above it, which is how the amounts are said here.
 */
export function formatCompactRupees(paise: number): string {
  const rupees = Math.round(paise / 100);
  const sign = rupees < 0 ? '-' : '';
  const value = Math.abs(rupees);
  // One decimal below ten, none above: `₹9.9k` is worth the character,
  // `₹62.4k` is false precision on a label read at a glance.
  const scale = (by: number) => {
    const n = value / by;
    return n >= 10 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
  };
  if (value < 1_000) {
    return `${sign}₹${value}`;
  }
  if (value < 100_000) {
    return `${sign}₹${scale(1_000)}k`;
  }
  if (value < 10_000_000) {
    return `${sign}₹${scale(100_000)}L`;
  }
  return `${sign}₹${scale(10_000_000)}Cr`;
}

/**
 * The same figure for a row that may not be in rupees. A foreign amount keeps
 * its minor units and always shows them, because `SGD 1.38` rounded to `SGD 1`
 * reads like a different purchase.
 */
export function formatMoney(
  amount: number,
  currency: string,
  options: { showPaise?: boolean } = {},
): string {
  if (currency === 'INR') {
    return formatRupees(amount, options);
  }
  const major = (amount / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency} ${major}`;
}
