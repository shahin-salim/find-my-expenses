/**
 * The Transactions screen's reads: the list, its filters, and its search.
 *
 * The screen is not specified in the technical document — the design is the
 * specification — so the rules it leans on are borrowed from the sections
 * that do exist. Spending is section 10's definition, a transaction's
 * category is section 10.3's COALESCE, fixed costs are section 8.2's flag,
 * and deleted rows stay hidden everywhere because section 8.1 keeps them as
 * tombstones rather than removing them.
 */

import {
  addLocalDays,
  addLocalMonths,
  startOfLocalDay,
  startOfLocalMonth,
  startOfLocalWeek,
  toLocalDateString,
} from '../time/dates';
import type { SqlDatabase, SqlValue } from '../db/types';
import { IS_REVERSAL_CREDIT } from '../db/reversalClause';
import { RESOLVED_CATEGORY } from '../db/resolvedCategory';

export type DatePreset = 'TODAY' | 'WEEK' | 'MONTH' | 'CUSTOM' | 'ALL';
export type TypeFilter = 'DEBIT' | 'CREDIT' | 'BOTH';

/** A category chip. `'NONE'` is the `Uncategorized` chip in the design. */
export type CategorySelection = number | 'NONE';

/** The payee of a payment that named nobody. See `payeeKeys`. */
export const NO_PAYEE = '\u0000none';

export interface TransactionFilter {
  datePreset: DatePreset;
  /** Only read when `datePreset` is `CUSTOM`. Epoch millis. */
  customFrom: number | null;
  customTo: number | null;
  type: TypeFilter;
  categories: CategorySelection[];
  accountIds: number[];
  /** Paise. Null means no bound on that end. */
  minAmount: number | null;
  maxAmount: number | null;
  onlyUncategorized: boolean;
  hideSelfTransfers: boolean;
  hideFixedCosts: boolean;
  /** Leaves out investments and lending — money moved, not spent. */
  hideMovedMoney: boolean;
  /**
   * Section 10's spending definition, exactly as the Home figures use it.
   *
   * Set when the list is opened from a figure on Home, so what is listed is
   * what was counted. Without it the list would show refunded, excluded and
   * foreign-currency rows that the total on the card had left out, and the
   * rows on screen would not add up to the number the user tapped.
   */
  spendingOnly: boolean;
  /**
   * Payees, by the identity section 8.4 gives them. Empty means all.
   *
   * `NO_PAYEE` stands for the payments that have none: a message that named
   * nobody has a NULL identity, and a NULL cannot be passed as a value to
   * match. Without a name for it, the bubble those payments are gathered
   * into could be tapped and would find nothing.
   */
  payeeKeys: string[];
  search: string;
}

export const DEFAULT_FILTER: TransactionFilter = {
  datePreset: 'MONTH',
  customFrom: null,
  customTo: null,
  type: 'BOTH',
  categories: [],
  accountIds: [],
  minAmount: null,
  maxAmount: null,
  onlyUncategorized: false,
  hideSelfTransfers: false,
  hideFixedCosts: false,
  hideMovedMoney: false,
  spendingOnly: false,
  payeeKeys: [],
  search: '',
};

/**
 * The filter left behind when the user names a direction.
 *
 * `spendingOnly` arrives from Home carrying section 10's definition of
 * spending, and that definition is DEBIT-only. It is not a chip and has no
 * control of its own, so once it is set the direction chips cannot speak:
 * `Money in` asks for CREDIT beside the DEBIT this adds and matches nothing
 * at all, and `Both` goes on hiding every credit while claiming not to.
 *
 * Naming a direction is the user stepping away from the figure they tapped,
 * so the definition that came with it is dropped here rather than left to
 * contradict them.
 */
export function withType(
  filter: TransactionFilter,
  type: TypeFilter,
): TransactionFilter {
  return { ...filter, type, spendingOnly: false };
}

/** True when anything would be left out, which is what the badge counts. */
export function activeFilterCount(filter: TransactionFilter): number {
  let count = 0;
  if (filter.datePreset !== 'MONTH') { count += 1; }
  if (filter.type !== 'BOTH') { count += 1; }
  if (filter.categories.length > 0) { count += 1; }
  if (filter.accountIds.length > 0) { count += 1; }
  if (filter.minAmount !== null || filter.maxAmount !== null) { count += 1; }
  if (filter.onlyUncategorized) { count += 1; }
  if (filter.hideSelfTransfers) { count += 1; }
  if (filter.hideFixedCosts) { count += 1; }
  if (filter.hideMovedMoney) { count += 1; }
  if (filter.spendingOnly) { count += 1; }
  if (filter.payeeKeys.length > 0) { count += 1; }
  return count;
}

/** The window a preset covers, or null for everything on record. */
export function filterWindow(
  filter: TransactionFilter,
  now: number,
): { from: number; to: number } | null {
  switch (filter.datePreset) {
    case 'TODAY': {
      const from = startOfLocalDay(now);
      return { from, to: addLocalDays(from, 1) };
    }
    case 'WEEK': {
      const from = startOfLocalWeek(now);
      return { from, to: addLocalDays(from, 7) };
    }
    case 'MONTH': {
      const from = startOfLocalMonth(now);
      return { from, to: addLocalMonths(from, 1) };
    }
    case 'CUSTOM':
      return filter.customFrom === null || filter.customTo === null
        ? null
        : { from: filter.customFrom, to: filter.customTo };
    case 'ALL':
      return null;
  }
}

const PRESET_LABEL: Record<Exclude<DatePreset, 'CUSTOM'>, string> = {
  TODAY: 'Today',
  WEEK: 'This week',
  MONTH: 'This month',
  ALL: 'All time',
};

function dayLabel(at: number, withYear: boolean): string {
  return new Date(at).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
  });
}

/**
 * What the date chip says, and the heading above the list with it.
 *
 * A custom range names its dates rather than calling itself `Custom range`,
 * which is the one thing the user already knows. The year is left off unless
 * the range leaves the current one, because `26 Oct 2026` on every chip in
 * October 2026 is three characters that never vary.
 *
 * `customTo` is exclusive — it is what the SQL compares `<` against — so the
 * day named at the end is the one before it. A range covering the 26th alone
 * is stored as the 26th to the 27th and has to read `26 Oct`, not `26–27`.
 */
export function dateFilterLabel(filter: TransactionFilter, now: number): string {
  if (filter.datePreset !== 'CUSTOM') {
    return PRESET_LABEL[filter.datePreset];
  }
  const window = filterWindow(filter, now);
  if (window === null) {
    return 'Custom range';
  }

  const lastDay = addLocalDays(window.to, -1);
  const start = new Date(window.from);
  const end = new Date(lastDay);
  const thisYear = new Date(now).getFullYear();
  const withYear =
    start.getFullYear() !== thisYear || end.getFullYear() !== thisYear;

  if (toLocalDateString(window.from) === toLocalDateString(lastDay)) {
    return dayLabel(window.from, withYear);
  }
  if (
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth()
  ) {
    // `1\u201315 Oct` rather than `1 Oct \u2013 15 Oct`: the month is said once
    // because it is the same month, and the chip has room for little else.
    return `${start.getDate()}\u2013${dayLabel(lastDay, withYear)}`;
  }
  return `${dayLabel(window.from, withYear)} \u2013 ${dayLabel(lastDay, withYear)}`;
}

/**
 * Builds the WHERE clause once, so the list, the totals and the count in the
 * filter sheet's button can never disagree about what is being shown.
 */
function buildWhere(
  filter: TransactionFilter,
  now: number,
): { sql: string; params: SqlValue[] } {
  const clauses: string[] = ['t.is_deleted = 0'];
  const params: SqlValue[] = [];

  const window = filterWindow(filter, now);
  if (window) {
    // Section 10's rule, for the same reason: the stored local date is what
    // the day headings in the list group by.
    clauses.push('t.occurred_on >= ? AND t.occurred_on < ?');
    params.push(toLocalDateString(window.from), toLocalDateString(window.to));
  }

  if (filter.type !== 'BOTH') {
    clauses.push('t.transaction_type = ?');
    params.push(filter.type);
  }

  if (filter.categories.length > 0) {
    const ids = filter.categories.filter((value): value is number => value !== 'NONE');
    const wantsNone = filter.categories.includes('NONE');
    const parts: string[] = [];
    if (ids.length > 0) {
      parts.push(`${RESOLVED_CATEGORY} IN (${ids.map(() => '?').join(', ')})`);
      params.push(...ids);
    }
    if (wantsNone) {
      parts.push(`${RESOLVED_CATEGORY} IS NULL`);
    }
    clauses.push(`(${parts.join(' OR ')})`);
  }

  if (filter.accountIds.length > 0) {
    clauses.push(`t.account_id IN (${filter.accountIds.map(() => '?').join(', ')})`);
    params.push(...filter.accountIds);
  }

  if (filter.minAmount !== null) {
    clauses.push('t.amount >= ?');
    params.push(filter.minAmount);
  }
  if (filter.maxAmount !== null) {
    clauses.push('t.amount <= ?');
    params.push(filter.maxAmount);
  }

  if (filter.onlyUncategorized) {
    clauses.push(`${RESOLVED_CATEGORY} IS NULL`);
  }
  if (filter.hideSelfTransfers) {
    clauses.push('t.is_transfer = 0');
  }
  // Section 8.2's other category flag. Kept separate from `spendingOnly` so
  // a list opened from Home can match whichever of the three views it came
  // from, rather than always one of them.
  if (filter.hideMovedMoney) {
    clauses.push(`COALESCE(
      (SELECT c4.excluded_from_totals FROM categories c4
        WHERE c4.id = ${RESOLVED_CATEGORY}), 0
    ) = 0`);
  }
  if (filter.hideFixedCosts) {
    clauses.push(`COALESCE(
      (SELECT c2.is_fixed_cost FROM categories c2
        WHERE c2.id = ${RESOLVED_CATEGORY}), 0
    ) = 0`);
  }

  if (filter.spendingOnly) {
    // The same conditions as `IS_SPENDING` in the analytics module.
    // `is_transfer` is in here too, so `hideSelfTransfers` is redundant
    // alongside it rather than contradictory.
    clauses.push(`t.transaction_type = 'DEBIT'`);
    clauses.push(`t.currency = 'INR'`);
    clauses.push('t.is_excluded = 0');
    clauses.push('t.is_refunded = 0');
    clauses.push('t.is_transfer = 0');
    clauses.push('t.repaid_at IS NULL');
    // The category-level flag is deliberately not here: it belongs to
    // `hideMovedMoney` above, so a list opened under "Everything" can show
    // the investments and loans that view is there to show.
  }

  if (filter.payeeKeys.length > 0) {
    const named = filter.payeeKeys.filter((key) => key !== NO_PAYEE);
    const wantsNone = filter.payeeKeys.includes(NO_PAYEE);
    const parts: string[] = [];
    if (named.length > 0) {
      parts.push(
        `COALESCE(m.identity_key, t.recipient_name) IN (${named
          .map(() => '?')
          .join(', ')})`,
      );
      params.push(...named);
    }
    if (wantsNone) {
      parts.push('COALESCE(m.identity_key, t.recipient_name) IS NULL');
    }
    clauses.push(`(${parts.join(' OR ')})`);
  }

  const search = filter.search.trim();
  if (search.length > 0) {
    // "Search merchant, UPI ID or amount". A number typed without a decimal
    // point means rupees, so `386` has to find `₹386.00` as well as `₹3.86`
    // would never be meant. The rupee form is matched by prefix on the paise
    // value, which an index cannot help with but 1,500 rows do not need.
    //
    // What the user typed is text, not a pattern. `%` and `_` mean something
    // to LIKE, so searching `100%` matched every payee, note and UPI ID on
    // record and `a_b` matched `axb` — wrong answers with nothing on screen
    // to explain them. The digit clause needs no escaping: it is built from
    // `[\d.]` only, and a full stop is not a wildcard.
    const like = `%${escapeLike(search.toLowerCase())}%`;
    const digits = search.replace(/[^\d.]/g, '');
    const parts = [
      `LOWER(COALESCE(m.display_name, t.recipient_name, '')) LIKE ? ESCAPE '\\'`,
      `LOWER(COALESCE(m.upi_id, '')) LIKE ? ESCAPE '\\'`,
      `LOWER(COALESCE(t.note, '')) LIKE ? ESCAPE '\\'`,
    ];
    params.push(like, like, like);
    if (digits.length > 0) {
      parts.push('CAST(t.amount / 100 AS TEXT) LIKE ?');
      params.push(`${digits.replace(/\..*$/, '')}%`);
    }
    clauses.push(`(${parts.join(' OR ')})`);
  }

  return { sql: clauses.join('\n  AND '), params };
}

/**
 * `resolved_category` is section 10.3's rule — the transaction's own category
 * when the user set one, the merchant's otherwise — named once so every
 * clause above can use it instead of repeating the COALESCE.
 */
const FROM = `
  FROM transactions t
  LEFT JOIN merchants  m ON m.id = t.merchant_id
  LEFT JOIN categories c ON c.id = ${RESOLVED_CATEGORY}
  LEFT JOIN accounts   a ON a.id = t.account_id
`;

const SELECT_COLUMNS = `
  t.id, t.amount, t.currency, t.transaction_type, t.occurred_at, t.occurred_on,
  t.source, t.note, t.is_transfer, t.is_excluded, t.is_refunded, t.repaid_at,
  COALESCE(m.display_name, t.recipient_name) AS display_name,
  m.upi_id,
  c.id AS category_id, c.name AS category_name, c.color AS category_color,
  a.bank_name, a.last_four, a.account_type,
  ${RESOLVED_CATEGORY} AS resolved_category
`;

export interface TransactionListRow {
  id: number;
  amount: number;
  currency: string;
  transaction_type: 'DEBIT' | 'CREDIT';
  occurred_at: number;
  occurred_on: string;
  source: 'SMS' | 'MANUAL';
  note: string | null;
  is_transfer: 0 | 1;
  is_excluded: 0 | 1;
  is_refunded: 0 | 1;
  repaid_at: number | null;
  display_name: string | null;
  upi_id: string | null;
  category_id: number | null;
  category_name: string | null;
  category_color: string | null;
  bank_name: string | null;
  last_four: string | null;
  account_type: string | null;
}

/**
 * One page of the list, newest first.
 *
 * It is paged rather than read whole because a year of messages is already
 * over 1,500 payments and `All time` is one tap away. A flat limit would end
 * the list early with nothing on screen to say that it had.
 *
 * `id` breaks ties in the sort for the same reason: without it two payments
 * sharing a timestamp have no defined order, and a row could appear on two
 * pages or on neither.
 */
export function listTransactions(
  db: SqlDatabase,
  filter: TransactionFilter,
  now: number,
  limit = 120,
  offset = 0,
): TransactionListRow[] {
  const { sql, params } = buildWhere(filter, now);
  return db.execute<TransactionListRow>(
    `SELECT ${SELECT_COLUMNS}
     ${FROM}
      WHERE ${sql}
      ORDER BY t.occurred_at DESC, t.id DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  ).rows;
}

export interface FilterTotals {
  count: number;
  /** Debits, in paise. The design calls it `Out`. */
  out: number;
  /** Credits, in paise. */
  in: number;
}

/**
 * Makes a search term literal to LIKE.
 *
 * The backslash is escaped first, or escaping the wildcards would then be
 * undone by a backslash the user typed themselves.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** What the list header shows, and what the filter sheet's button counts. */
export function filterTotals(
  db: SqlDatabase,
  filter: TransactionFilter,
  now: number,
): FilterTotals {
  const { sql, params } = buildWhere(filter, now);
  // A reversal is both rows of the list and neither figure of the header.
  //
  // Section 4 takes the debit out of spending the moment it is matched, so
  // `is_refunded` answers for `Out`. The credit carries no flag by design, so
  // `In` asks `IS_REVERSAL_CREDIT` whether this is the money coming straight
  // back from a payment that failed. Without it the header reported ₹500
  // received against a payment that never left, next to the ₹500 it was
  // already not counting as spent.
  //
  // Both rows are still counted, and still shown: the count is how many
  // transactions the filter matched, which is a different question.
  const { rows } = db.execute<{ count: number; out: number | null; in: number | null }>(
    `SELECT COUNT(*) AS count,
            SUM(CASE WHEN t.transaction_type = 'DEBIT' AND t.is_refunded = 0
                     THEN t.amount ELSE 0 END) AS out,
            SUM(CASE WHEN t.transaction_type = 'CREDIT' AND NOT (${IS_REVERSAL_CREDIT})
                     THEN t.amount ELSE 0 END) AS "in"
     ${FROM}
      WHERE ${sql}`,
    params,
  );
  const row = rows[0];
  return { count: row?.count ?? 0, out: row?.out ?? 0, in: row?.in ?? 0 };
}

export interface DayGroup {
  date: string;
  rows: TransactionListRow[];
  spent: number;
  received: number;
}

/**
 * The list is drawn in day blocks with a total on each heading, which is why
 * the grouping happens here rather than in SQL: the rows and the heading
 * figures have to come from exactly the same set.
 */
export function groupByDay(rows: TransactionListRow[]): DayGroup[] {
  const groups = new Map<string, DayGroup>();
  for (const row of rows) {
    const group = groups.get(row.occurred_on) ?? {
      date: row.occurred_on,
      rows: [],
      spent: 0,
      received: 0,
    };
    group.rows.push(row);
    if (row.transaction_type === 'DEBIT') {
      group.spent += row.amount;
    } else {
      group.received += row.amount;
    }
    groups.set(row.occurred_on, group);
  }
  return [...groups.values()];
}

/**
 * What the date window becomes when a search starts or stops.
 *
 * Searching looks at everything: a payee paid twenty-five times over a year
 * has one payment in the current month, and answering `1` for that reads as a
 * fact about the payee rather than about the window being looked through.
 * The window the user had is remembered and restored when they clear the box,
 * so widening it costs them nothing.
 */
export function presetForSearch(
  previousSearch: string,
  nextSearch: string,
  current: DatePreset,
  saved: DatePreset | null,
): { preset: DatePreset; saved: DatePreset | null } {
  const had = previousSearch.trim().length > 0;
  const has = nextSearch.trim().length > 0;

  if (!had && has) {
    return current === 'ALL'
      ? { preset: 'ALL', saved }
      : { preset: 'ALL', saved: current };
  }
  if (had && !has && saved !== null) {
    return { preset: saved, saved: null };
  }
  return { preset: current, saved };
}

/** The smallest and largest payment on record, for the amount slider. */
export function amountBounds(db: SqlDatabase): { min: number; max: number } {
  const { rows } = db.execute<{ min: number | null; max: number | null }>(
    `SELECT MIN(amount) AS min, MAX(amount) AS max
       FROM transactions WHERE is_deleted = 0`,
  );
  return { min: rows[0]?.min ?? 0, max: rows[0]?.max ?? 0 };
}

/**
 * The first and last day anything was recorded on.
 *
 * The range picker steps back a month at a time, and without a floor it
 * steps for ever through months that cannot contain a payment because the
 * user had not installed the app yet.
 */
export function transactionDateBounds(
  db: SqlDatabase,
): { first: string; last: string } | null {
  const { rows } = db.execute<{ first: string | null; last: string | null }>(
    `SELECT MIN(occurred_on) AS first, MAX(occurred_on) AS last
       FROM transactions WHERE is_deleted = 0`,
  );
  const row = rows[0];
  return row?.first && row.last ? { first: row.first, last: row.last } : null;
}

/**
 * The days inside a window that the rest of the filter would find something
 * on, which is what the dots under the calendar mean.
 *
 * Everything the user has already chosen is honoured except the dates
 * themselves: a dot has to promise that picking that day shows something, and
 * a day that only qualifies because the category and amount filters were
 * ignored would break that promise the moment it was tapped. Dropping the
 * date part is what stops the question being circular.
 */
export function daysWithActivity(
  db: SqlDatabase,
  filter: TransactionFilter,
  window: { from: number; to: number },
  now: number,
): Set<string> {
  const { sql, params } = buildWhere({ ...filter, datePreset: 'ALL' }, now);
  const { rows } = db.execute<{ occurred_on: string }>(
    `SELECT DISTINCT t.occurred_on
     ${FROM}
      WHERE ${sql}
        AND t.occurred_on >= ? AND t.occurred_on < ?`,
    [...params, toLocalDateString(window.from), toLocalDateString(window.to)],
  );
  return new Set(rows.map((row) => row.occurred_on));
}
