/**
 * The sentences on the Home cards.
 *
 * The Home mockup carries three pieces of written copy — the paragraph under
 * the chart heading, the line in the tinted box below it, and the note above
 * the bubbles. Section 10 defines the figures but not the wording, so the
 * rules for what is said, and for when nothing is worth saying, are here.
 *
 * Every one of these returns null rather than reaching for a weaker claim.
 * A sentence that appears whatever the data says is one the user learns to
 * skip, and the figures it sits beside are already on the screen.
 */

import { formatRupees, type PeriodKind, type SpendingView } from './spending';
import type { Slice } from './breakdown';
import type { ChartSeries } from './chart';

const PERIOD_NOUN: Record<PeriodKind, string> = {
  DAY: 'day',
  WEEK: 'week',
  MONTH: 'month',
};

const THIS_PERIOD: Record<PeriodKind, string> = {
  DAY: "today's",
  WEEK: "this week's",
  MONTH: "this month's",
};

const LAST_PERIOD: Record<PeriodKind, string> = {
  DAY: 'yesterday',
  WEEK: 'last week',
  MONTH: 'last month',
};

/** How this period compares with the last one, in words. */
function comparisonPhrase(total: number, previous: number): string | null {
  if (previous === 0) {
    return null;
  }
  const ratio = total / previous;
  if (ratio >= 2.4) { return 'well over double'; }
  if (ratio >= 1.8) { return 'nearly double'; }
  if (ratio >= 1.25) { return 'well above'; }
  if (ratio >= 1.05) { return 'above'; }
  if (ratio >= 0.95) { return 'about level with'; }
  if (ratio >= 0.75) { return 'below'; }
  return 'well below';
}

/** How this period compares with the usual level. */
function usualPhrase(total: number, usual: number): string {
  const ratio = total / usual;
  if (ratio >= 1.25) { return 'well above'; }
  if (ratio >= 1.05) { return 'above'; }
  if (ratio >= 0.95) { return 'about'; }
  if (ratio >= 0.75) { return 'below'; }
  return 'well below';
}

/**
 * The paragraph under the chart heading.
 *
 * `₹9,860 so far, nearly double last week (₹5,060) and well above your usual
 * ₹6,194 a week, rent aside.`
 *
 * The clauses drop out independently: a user with no previous period loses
 * the middle one, and one without enough history for a median loses the last.
 * With neither there is nothing to say that the total above does not already
 * say, so the whole paragraph goes.
 */
export function chartSummary(
  series: ChartSeries,
  previousTotal: number,
  view: SpendingView,
): string | null {
  const total = series.points[series.points.length - 1]?.total ?? 0;
  const noun = PERIOD_NOUN[series.kind];

  const comparison = comparisonPhrase(total, previousTotal);
  const against = comparison
    ? `${comparison} ${LAST_PERIOD[series.kind]} (${formatRupees(previousTotal)})`
    : null;

  const usual =
    series.median === null
      ? null
      : `${usualPhrase(total, series.median)} your usual ${formatRupees(
          series.median,
        )} a ${noun}`;

  if (!against && !usual) {
    return null;
  }

  // "rent aside" earns its place only when something was actually left out,
  // and the caller knows that from the filter, not from the figures here.
  const aside = view === 'EVERYDAY' ? ', rent aside' : '';
  const clauses = [against, usual].filter(Boolean).join(' and ');
  return `${formatRupees(total)} so far, ${clauses}${aside}.`;
}

export interface Concentration {
  text: string;
  share: number;
}

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * The line in the tinted box: `Wednesday and Friday alone were 58% of this
 * week's spending.`
 *
 * It is only worth saying when the spending really is concentrated — a few
 * days carrying half of it while several others also had payments. Spread
 * evenly across the week, or landing on a single day because the week has
 * only just begun, there is nothing here the chart does not show.
 */
export function dayConcentration(
  days: Array<{ date: string; total: number }>,
  kind: PeriodKind,
): Concentration | null {
  if (kind === 'DAY') {
    return null;
  }

  const spent = days.filter((day) => day.total > 0).sort((a, b) => b.total - a.total);
  const total = spent.reduce((sum, day) => sum + day.total, 0);
  if (total === 0 || spent.length < 4) {
    return null;
  }

  // At most two named days for a week, three for a month: past that the
  // sentence is a list rather than a point.
  const limit = kind === 'WEEK' ? 2 : 3;
  let running = 0;
  const picked: typeof spent = [];
  for (const day of spent) {
    if (running / total >= 0.5 || picked.length === limit) {
      break;
    }
    picked.push(day);
    running += day.total;
  }

  const share = running / total;
  // Half the spending on a third of the days that had any is the threshold.
  // Below it the days named are not carrying the period, they are simply the
  // largest of many.
  if (share < 0.5 || picked.length / spent.length > 0.34) {
    return null;
  }

  // A weekday names a day unambiguously inside one week, and not inside a
  // month, which holds four or five of each. `Saturday alone was 72% of this
  // month's spending` reads as a habit when it was one afternoon.
  const inOrder = [...picked].sort((a, b) => a.date.localeCompare(b.date));
  const names = inOrder.map((day) => {
    const [year, month, date] = day.date.split('-').map(Number);
    const when = new Date(year!, month! - 1, date!);
    return kind === 'WEEK'
      ? WEEKDAY[when.getDay()]!
      : when.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  });

  const list =
    names.length === 1
      ? names[0]!
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

  return {
    text: `${list} alone ${names.length === 1 ? 'was' : 'were'} ${Math.round(
      share * 100,
    )}% of ${THIS_PERIOD[kind]} spending.`,
    share,
  };
}

/**
 * The note above the bubbles: `Food & Dining is your highest spend at 35%.
 * Shopping and Transport follow.`
 *
 * Silent when one slice is everything there is, because naming it the highest
 * of one is not an observation.
 */
export function topSliceNote(slices: Slice[]): string | null {
  if (slices.length < 2) {
    return null;
  }
  const [first, ...rest] = slices;
  const followers = rest.slice(0, 2).map((slice) => slice.label);

  const follows =
    followers.length === 0
      ? ''
      : ` ${
          followers.length === 1
            ? followers[0]
            : `${followers[0]} and ${followers[1]}`
        } follow${followers.length === 1 ? 's' : ''}.`;

  const headline =
    `${first!.label} is your highest spend at ${Math.round(first!.share * 100)}%.`;
  return headline + follows;
}
