/**
 * Sections 10.3 to 10.5: where the selected period's money went, the calendar
 * grid, and the biggest single payments.
 *
 * "This section breaks down the spending of the selected period only. It never
 * includes earlier periods."
 */

import { RESOLVED_CATEGORY } from '../db/resolvedCategory';
import { IS_SPENDING } from '../db/spendingClause';
import { toLocalDateString } from '../time/dates';
import type { SqlDatabase } from '../db/types';
import { COLOR_CHOICES } from '../categorization/defaultCategories';
import { NO_PAYEE } from '../transactions/query';
import { median } from './chart';
import {
  earliestSpendingDay,
  spendingByDay,
  spendingTotal,
  type Period,
  type SpendingView,
} from './spending';

/* -------------------------------------------------------------------------- */
/* Shared SQL                                                                  */
/* -------------------------------------------------------------------------- */



const IN_PERIOD = `t.occurred_on >= ? AND t.occurred_on < ?`;

/** Kept in step with `viewClause` in the analytics module, by hand. */
function fixedCostClause(view: SpendingView): string {
  const flag = (column: string) => `AND COALESCE(
    (SELECT c2.${column} FROM categories c2
      WHERE c2.id = ${RESOLVED_CATEGORY}),
    0
  ) = 0`;

  if (view === 'EVERYTHING') {
    return '';
  }
  return flag('excluded_from_totals') + '\n' + flag('is_fixed_cost');
}

const bounds = (period: Period) => [
  toLocalDateString(period.from),
  toLocalDateString(period.to),
];

export interface Slice {
  key: string;
  /**
   * The slices this one stands for, when it is the gathered tail of a list
   * rather than one of its own. Set by the caller that gathers them.
   */
  members?: Slice[];
  label: string;
  /** A palette token, resolved against the theme by the caller. */
  color: string;
  icon: string | null;
  total: number;
  /** Of the period's spending, 0 to 1. */
  share: number;
}

function withShares(rows: Array<Omit<Slice, 'share'>>): Slice[] {
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  return rows.map((row) => ({
    ...row,
    share: total === 0 ? 0 : row.total / total,
  }));
}

/* -------------------------------------------------------------------------- */
/* 10.3 Where your money went                                                  */
/* -------------------------------------------------------------------------- */

/**
 * "By category shows the total spent in each category, largest first. A
 * transaction uses its own category when the user has changed it, and the
 * merchant's category otherwise."
 *
 * Spending with no category at all is reported under one `Uncategorised`
 * slice rather than being dropped, so the shares always add up to the period
 * total the card has just printed above them.
 */
export function byCategory(
  db: SqlDatabase,
  period: Period,
  view: SpendingView = 'EVERYDAY',
): Slice[] {
  const { rows } = db.execute<{
    id: number | null;
    name: string | null;
    color: string | null;
    icon: string | null;
    total: number;
  }>(
    `SELECT c.id, c.name, c.color, c.icon, SUM(t.amount) AS total
       FROM transactions t
       LEFT JOIN merchants  m ON m.id = t.merchant_id
       LEFT JOIN categories c ON c.id = ${RESOLVED_CATEGORY}
      WHERE ${IS_SPENDING} AND ${IN_PERIOD} ${fixedCostClause(view)}
      GROUP BY c.id
      ORDER BY total DESC`,
    bounds(period),
  );

  return withShares(
    rows.map((row) => ({
      key: row.id === null ? 'none' : String(row.id),
      label: row.name ?? 'Uncategorised',
      color: row.color ?? 'grey',
      icon: row.icon,
      total: row.total,
    })),
  );
}

/**
 * "By UPI ID shows the same spending grouped by who was paid, so the user sees
 * names such as Swiggy or Zepto rather than categories."
 *
 * The merchant's own UPI ID is preferred as the label, because that is what
 * the section is called and it is what distinguishes two payees the bank
 * wrote the same display name for. Where the message carried no UPI ID the
 * name is all there is, and that is shown instead.
 */
/**
 * The palette a payee can be given, which is every category colour except
 * the neutral one. `grey` is kept back for the slices that stand for an
 * absence — the gathered `N more`, and the payments that named nobody.
 */
const PAYEE_COLORS = COLOR_CHOICES.filter((token) => token !== 'grey');

/**
 * A colour for each payee, in the order they are returned.
 *
 * Payees used to borrow the colour of whatever category they were in, and
 * fall back to `grey` when they had none. Both halves of that were wrong on
 * screen. Most payees are uncategorised — nothing in a bank message says
 * what a person is — so the view opened as a cluster of identical greys;
 * and the ones that were categorised came out identical to each other,
 * because three of the top six payees being places to eat is the normal
 * case, not an unlucky one.
 *
 * Either way the picture could not say which bubble was which, which is the
 * only thing its colours are for. So in this view a colour identifies a
 * payee and nothing else: taken in order, so the slices on screen always
 * differ, and never reused until the palette runs out. `grey` is left out
 * of the palette and kept for the gathered `N more`, which is the one slice
 * here that stands for no payee at all.
 *
 * What it gives up is the link between the two tabs — Food & Dining is
 * green under `By category`, and its payees are no longer green here. That
 * link was never readable anyway: a bubble in this view carries a payee's
 * name, not a category's, so there was nothing on screen to connect the
 * colour back to.
 *
 * The cost is that a payee's colour follows its position rather than its
 * name and can change between one month and the next. The chips underneath
 * name every slice in its own colour, so nothing rests on remembering it.
 */
function payeeColors(rows: Array<{ key: string | null }>): string[] {
  // The nameless slice gets a colour like any other, rather than the
  // neutral it was first given. It is a payee slice in every way that
  // matters — it has a figure, it can be tapped, and the payments behind it
  // come up like anyone else's. Only the gathered `N more` is a true
  // absence, and it was coming out the same grey and sitting right beside
  // it, as the two biggest circles on the card.
  return rows.map((_, index) => PAYEE_COLORS[index % PAYEE_COLORS.length]!);
}

export function byPayee(
  db: SqlDatabase,
  period: Period,
  view: SpendingView = 'EVERYDAY',
): Slice[] {
  const { rows } = db.execute<{
    key: string | null;
    label: string | null;
    upi_id: string | null;
    icon: string | null;
    total: number;
  }>(
    `SELECT COALESCE(m.identity_key, t.recipient_name) AS key,
            COALESCE(m.display_name, t.recipient_name) AS label,
            m.upi_id,
            c.icon,
            SUM(t.amount) AS total
       FROM transactions t
       LEFT JOIN merchants  m ON m.id = t.merchant_id
       LEFT JOIN categories c ON c.id = ${RESOLVED_CATEGORY}
      WHERE ${IS_SPENDING} AND ${IN_PERIOD} ${fixedCostClause(view)}
      GROUP BY key
      ORDER BY total DESC`,
    bounds(period),
  );

  const colors = payeeColors(rows);

  return withShares(
    rows.map((row, index) => ({
      // A message that named nobody has no identity to group by, so the
      // payments share one slice under a key that says so — and one the
      // filter can turn back into `IS NULL`.
      key: row.key ?? NO_PAYEE,
      label: row.upi_id ?? row.label ?? 'Unknown payee',
      color: colors[index]!,
      icon: row.icon,
      total: row.total,
    })),
  );
}

/* -------------------------------------------------------------------------- */
/* 10.4 Calendar                                                               */
/* -------------------------------------------------------------------------- */

export interface CalendarDay {
  /** `YYYY-MM-DD`. */
  date: string;
  dayOfMonth: number;
  total: number;
  /** 0 for an empty day, then 1 to 4 by quartile of the month's spending. */
  intensity: 0 | 1 | 2 | 3 | 4;
  isToday: boolean;
  isFuture: boolean;
}

/**
 * "The month shown as a day grid, with the total spent on each day. Days with
 * no spending are left empty."
 *
 * Shading is by rank within the month rather than against the largest day.
 * One outsized payment — rent, a flight — would otherwise flatten every other
 * day to the palest step and the grid would say nothing at all.
 */
export function calendarMonth(
  db: SqlDatabase,
  month: Period,
  now: number,
  view: SpendingView = 'EVERYDAY',
): CalendarDay[] {
  const totals = new Map<string, number>();
  for (const row of spendingByDay(db, month, view)) {
    totals.set(row.occurred_on, row.total);
  }

  const spent = [...totals.values()].sort((a, b) => a - b);
  const quartile = (amount: number): 1 | 2 | 3 | 4 => {
    const rank = spent.filter((value) => value < amount).length / spent.length;
    if (rank < 0.25) { return 1; }
    if (rank < 0.5) { return 2; }
    if (rank < 0.75) { return 3; }
    return 4;
  };

  const todayKey = toLocalDateString(now);
  const days: CalendarDay[] = [];
  const cursor = new Date(month.from);

  while (cursor.getTime() < month.to) {
    const date = toLocalDateString(cursor.getTime());
    const total = totals.get(date) ?? 0;
    days.push({
      date,
      dayOfMonth: cursor.getDate(),
      total,
      intensity: total === 0 ? 0 : quartile(total),
      isToday: date === todayKey,
      isFuture: date > todayKey,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

/* -------------------------------------------------------------------------- */
/* 10.5 Top transactions                                                       */
/* -------------------------------------------------------------------------- */

export interface TopTransaction {
  id: number;
  amount: number;
  occurred_at: number;
  occurred_on: string;
  label: string;
  category_name: string | null;
  category_color: string | null;
  /** Of the period's total spending, 0 to 1. */
  share: number;
}

/**
 * "The biggest single payments in the selected period, highest first, each
 * showing what share of the period's total spending it accounts for."
 *
 * The share is against the period total under the same view, so the
 * percentages on a filtered Home still add up to that Home's figures.
 */
export function topTransactions(
  db: SqlDatabase,
  period: Period,
  view: SpendingView = 'EVERYDAY',
  limit = 5,
): TopTransaction[] {
  const total = spendingTotal(db, period, view);

  const { rows } = db.execute<Omit<TopTransaction, 'share'>>(
    `SELECT t.id, t.amount, t.occurred_at, t.occurred_on,
            COALESCE(m.display_name, t.recipient_name, 'Payment') AS label,
            c.name  AS category_name,
            c.color AS category_color
       FROM transactions t
       LEFT JOIN merchants  m ON m.id = t.merchant_id
       LEFT JOIN categories c ON c.id = ${RESOLVED_CATEGORY}
      WHERE ${IS_SPENDING} AND ${IN_PERIOD} ${fixedCostClause(view)}
      ORDER BY t.amount DESC, t.occurred_at DESC
      LIMIT ?`,
    [...bounds(period), limit],
  );

  return rows.map((row) => ({
    ...row,
    share: total === 0 ? 0 : row.amount / total,
  }));
}

/* -------------------------------------------------------------------------- */
/* The day panel under the calendar                                            */
/* -------------------------------------------------------------------------- */

export interface DayPayment {
  /** The payee's identity from section 8.4, which is what groups the row. */
  key: string;
  label: string;
  /** Everything paid to this payee on the day, together. */
  amount: number;
  /** How many payments that was. One, unless the panel is adding up. */
  count: number;
}

export interface DaySummary {
  date: string;
  total: number;
  payments: DayPayment[];
  /**
   * Payments beyond the few listed, and what they come to together.
   *
   * Counted as payments rather than as payees, because that is the word the
   * panel uses and the figure beside it is their total.
   */
  moreCount: number;
  moreTotal: number;
  /** Against the median day of the month the day sits in, or null. */
  versusTypicalPercent: number | null;
}

/**
 * What the panel under the calendar shows for the day the user tapped.
 *
 * The comparison is against the median day of that month, for the reason
 * section 10.2 gives for the chart line: one large payment would otherwise
 * move the level that every other day is being judged against.
 */
export function daySummary(
  db: SqlDatabase,
  day: Period,
  month: Period,
  now: number,
  view: SpendingView = 'EVERYDAY',
  listLimit = 3,
): DaySummary {
  const date = toLocalDateString(day.from);

  // Grouped by the payee's identity rather than listed one payment at a
  // time. Three taps to the same shop in a morning is one line of the
  // panel saying what the shop cost, not the same name written three times
  // with a third of the figure against each.
  //
  // By identity and not by the name on screen: two different people can
  // share a display name, and adding their payments together because of
  // that would be inventing a payee. A payment with no payee at all falls
  // back to its own id, so a day of unnamed payments stays a list rather
  // than collapsing into a single `Payment` row.
  //
  // `label` is not aggregated because it cannot vary inside a group: every
  // branch of the key determines it.
  const { rows } = db.execute<DayPayment>(
    `SELECT COALESCE(m.identity_key, t.recipient_name, 'id:' || t.id) AS key,
            COALESCE(m.display_name, t.recipient_name, 'Payment') AS label,
            SUM(t.amount) AS amount,
            COUNT(*) AS count
       FROM transactions t
       LEFT JOIN merchants m ON m.id = t.merchant_id
      WHERE ${IS_SPENDING} AND ${IN_PERIOD} ${fixedCostClause(view)}
      GROUP BY key
      ORDER BY amount DESC`,
    bounds(day),
  );

  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const payments = rows.slice(0, listLimit);
  const rest = rows.slice(listLimit);

  // The same days the chart's median line is built from, and by the same
  // rules, because the two figures sit one above the other on Home and were
  // answering one question with two different numbers.
  //
  // `spendingByDay` returns only the days that had spending — it says so —
  // so a month with ten spending days out of thirty was being read as a
  // ten-day month, and its typical day came out at the median of the days
  // the user actually spent on rather than of the days. Section 10.2 is
  // explicit for the chart: "A day with no spending counts as zero."
  const totals = new Map(
    spendingByDay(db, month, view).map((row) => [row.occurred_on, row.total]),
  );
  // Days that have not happened yet are not quiet days, and neither are the
  // days before the user's first payment — the same reasoning `chartSeries`
  // gives for trimming its history to `earliestSpendingDay`. Counting either
  // as zero drags the typical day down to nothing.
  const today = toLocalDateString(now);
  const firstDay = earliestSpendingDay(db, view);
  const monthDays: number[] = [];
  const cursor = new Date(month.from);
  while (cursor.getTime() < month.to) {
    const key = toLocalDateString(cursor.getTime());
    if (key > today) {
      break;
    }
    if (firstDay !== null && key >= firstDay) {
      monthDays.push(totals.get(key) ?? 0);
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  // `median` from the chart module, so an even number of days is averaged
  // across the two middles in both places instead of taking the upper one
  // here and the average there.
  const typical = median(monthDays) ?? 0;

  return {
    date,
    total,
    payments,
    moreCount: rest.reduce((sum, row) => sum + row.count, 0),
    moreTotal: rest.reduce((sum, row) => sum + row.amount, 0),
    versusTypicalPercent:
      typical === 0 || total === 0 ? null : ((total - typical) / typical) * 100,
  };
}
