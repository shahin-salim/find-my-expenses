/**
 * Section 10.2, the spending chart and the line across it.
 *
 * "The chart follows the selected period. Today: one point per day, for the
 * last 7 days. This week: one point per week, for the last 7 weeks. This
 * month: one point per month, for the last 7 months."
 */

import { toLocalDateString } from '../time/dates';
import type { SqlDatabase } from '../db/types';
import {
  addPeriods,
  earliestSpendingDay,
  periodOf,
  spendingByDay,
  startOfPeriod,
  type Period,
  type PeriodKind,
  type SpendingView,
} from './spending';

/**
 * Section 10.2: "the chart shows six finished periods followed by the one that
 * is running."
 *
 * The Home mockup draws eight columns and titles itself `Last 8 weeks`. The
 * written rule is the one implemented, because it is the one that says why —
 * the count is a question of how much a person can read at a glance. Changing
 * this constant changes the heading with it; nothing else depends on seven.
 */
export const CHART_POINTS = 7;

/**
 * How far back the median looks, which is deliberately not the chart window.
 *
 * "The chart window is a question of how much a person can read at a glance.
 * The line is a question of how many periods are needed before a usual level
 * means anything, and daily spending in particular is far too uneven to take a
 * usual level from six days."
 */
const MEDIAN_HISTORY: Record<PeriodKind, number> = { DAY: 30, WEEK: 12, MONTH: 6 };

/**
 * "There must be enough history before the line is shown: 14 days, 6 weeks, or
 * 3 complete months. Below that the line and the comparison are hidden,
 * because a usual level cannot be established yet."
 */
const MEDIAN_MINIMUM: Record<PeriodKind, number> = { DAY: 14, WEEK: 6, MONTH: 3 };

export interface ChartPoint {
  /** Start of the period this column covers. */
  from: number;
  /** Exclusive end. */
  to: number;
  total: number;
  /** The period still running. Drawn as incomplete rather than finished. */
  isCurrent: boolean;
}

export interface ChartSeries {
  kind: PeriodKind;
  points: ChartPoint[];
  /**
   * The dashed line: the median of the complete periods behind it, or null
   * when there is not enough history for a usual level to mean anything.
   */
  median: number | null;
  /** What the current period reaches at its present rate, or null. */
  onPaceFor: number | null;
  /** How much of the current period has elapsed, 0 to 1. */
  elapsed: number;
}

/**
 * Sums the days in `days` that fall inside each bucket.
 *
 * Buckets are built from the calendar rather than from a fixed number of
 * milliseconds, so a month of 28 days and a week containing a daylight-saving
 * change both land where the calendar puts them.
 */
function bucketTotals(
  days: Map<string, number>,
  buckets: Array<{ from: number; to: number }>,
): number[] {
  return buckets.map(({ from, to }) => {
    const start = toLocalDateString(from);
    const end = toLocalDateString(to);
    let total = 0;
    for (const [day, amount] of days) {
      if (day >= start && day < end) {
        total += amount;
      }
    }
    return total;
  });
}

/** The middle value, averaging the two middles when the count is even. */
export function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

/**
 * How far through the current period we are, by whole days for a week or a
 * month and by elapsed time within the day itself.
 *
 * Section 10 keeps the comparisons off the clock, and they stay off it: this
 * is used only for the dotted projection, which is about the period in
 * progress and has no meaning without knowing how much of it has gone.
 */
function elapsedFraction(kind: PeriodKind, period: Period, now: number): number {
  if (kind === 'DAY') {
    return Math.min(1, Math.max(0, (now - period.from) / (period.to - period.from)));
  }
  const totalDays = Math.round((period.to - period.from) / 86_400_000);
  const dayOfPeriod = Math.floor((now - period.from) / 86_400_000);
  // The day in progress counts as a whole one. Treating Monday morning as
  // nothing elapsed would make a week's projection unbounded.
  return Math.min(1, (dayOfPeriod + 1) / totalDays);
}

/**
 * Everything the chart card needs, from one read of the database.
 *
 * The window read is the longer of the chart window and the median history,
 * so the median can reach further back than the chart draws — section 10.2:
 * "part of what shapes the line sits off the left edge of the screen."
 */
export function chartSeries(
  db: SqlDatabase,
  kind: PeriodKind,
  now: number,
  view: SpendingView = 'EVERYDAY',
): ChartSeries {
  const currentStart = startOfPeriod(kind, now);
  const history = MEDIAN_HISTORY[kind];
  const reach = Math.max(CHART_POINTS - 1, history);

  const windowStart = addPeriods(kind, currentStart, -reach);
  const windowEnd = addPeriods(kind, currentStart, 1);

  const days = new Map<string, number>();
  for (const row of spendingByDay(db, { from: windowStart, to: windowEnd }, view)) {
    days.set(row.occurred_on, row.total);
  }

  const buckets = (count: number, lastOffset: number) =>
    Array.from({ length: count }, (_, index) => {
      const from = addPeriods(kind, currentStart, lastOffset - (count - 1 - index));
      return { from, to: addPeriods(kind, from, 1) };
    });

  // The seven drawn columns, ending with the period in progress.
  const chartBuckets = buckets(CHART_POINTS, 0);
  const chartTotals = bucketTotals(days, chartBuckets);
  const points: ChartPoint[] = chartBuckets.map((bucket, index) => ({
    ...bucket,
    total: chartTotals[index]!,
    isCurrent: index === chartBuckets.length - 1,
  }));

  // The line. "The current period is never included in its own line" and
  // "Only complete periods count", so the window stops one period short.
  //
  // It also starts no earlier than the user's first spending. Periods from
  // before they had any are not quiet weeks, they are weeks that are not
  // theirs, and a run of leading zeros would drag the median to nothing.
  const firstDay = earliestSpendingDay(db, view);
  const historyBuckets = buckets(history, -1).filter(
    (bucket) => firstDay !== null && toLocalDateString(bucket.to) > firstDay,
  );
  const historyTotals = bucketTotals(days, historyBuckets);

  // "A day with no spending counts as zero in the daily line rather than being
  // skipped" — bucketTotals returns zero for an empty bucket, so the run of
  // periods inside the history is dense and nothing is filtered out of it.
  const enoughHistory = historyBuckets.length >= MEDIAN_MINIMUM[kind];

  const current = periodOf(kind, now);
  const elapsed = elapsedFraction(kind, current, now);
  const currentTotal = points[points.length - 1]!.total;

  return {
    kind,
    points,
    median: enoughHistory ? median(historyTotals) : null,
    onPaceFor: elapsed > 0 && elapsed < 1 ? Math.round(currentTotal / elapsed) : null,
    elapsed,
  };
}

/** A column singled out on the chart because it carries its own figure. */
export interface ChartMark {
  index: number;
  total: number;
}

/**
 * The highest and lowest columns, which are what the chart says instead of
 * having a scale.
 *
 * The axis carried no numbers even before this, so the only honest thing to
 * take from the line was its shape. Naming the two ends gives every other
 * column something to be read against, and costs no chrome.
 *
 * The period still running can be the high but never the low. It is a part
 * period: a week two days old is almost always the smallest column on the
 * chart, and saying so would be reporting the calendar rather than the
 * spending. Already having outspent every finished period, on the other
 * hand, is worth pointing at however early it is.
 *
 * Nothing is marked when there is only one column, or when every column
 * holds the same figure — a high and a low that are the same number is two
 * labels saying one thing.
 */
export function chartMarks(points: ChartPoint[]): {
  high: ChartMark | null;
  low: ChartMark | null;
} {
  const nothing = { high: null, low: null };
  if (points.length < 2) {
    return nothing;
  }

  let high: ChartMark | null = null;
  let low: ChartMark | null = null;
  points.forEach((point, index) => {
    if (high === null || point.total > high.total) {
      high = { index, total: point.total };
    }
    if (!point.isCurrent && (low === null || point.total < low.total)) {
      low = { index, total: point.total };
    }
  });

  if (high === null || low === null) {
    return nothing;
  }
  const top: ChartMark = high;
  const bottom: ChartMark = low;
  return top.index === bottom.index || top.total === bottom.total
    ? nothing
    : { high: top, low: bottom };
}
