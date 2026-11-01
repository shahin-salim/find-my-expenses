/**
 * Section 10.2 to 10.5, against the real schema.
 */

import { initializeDatabase } from '../../db/database';
import { openNodeDatabase } from '../../db/nodeSqlite';
import { findCategoryBySystemKey } from '../../db/dao/categories';
import type { SqlDatabase } from '../../db/types';
import { byCategory, byPayee, calendarMonth, daySummary, topTransactions } from '../breakdown';
import { CHART_POINTS, chartMarks, chartSeries, median } from '../chart';
import { chartSummary, dayConcentration, topSliceNote } from '../insights';
import { periodOf, thisMonth, thisWeek } from '../spending';

// A Saturday, so the current week runs Mon 19 Oct to Sun 25 Oct 2026.
const NOW = new Date(2026, 9, 24, 14, 30, 0).getTime();
const DAY = 86_400_000;

let keyCounter = 0;

function spend(
  db: SqlDatabase,
  amount: number,
  at: number,
  extra: { categoryId?: number | null; name?: string } = {},
) {
  const d = new Date(at);
  const on = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
  db.execute(
    `INSERT INTO transactions
       (amount, transaction_type, occurred_at, occurred_on, category_id,
        recipient_name, source, dedup_key, created_at, updated_at)
     VALUES (?, 'DEBIT', ?, ?, ?, ?, 'MANUAL', ?, ?, ?)`,
    [amount, at, on, extra.categoryId ?? null, extra.name ?? null,
     `t:${keyCounter++}`, NOW, NOW],
  );
}

function payTo(
  db: SqlDatabase,
  identity: string,
  name: string,
  amount: number,
  at: number,
) {
  const existing = db.execute<{ id: number }>(
    'SELECT id FROM merchants WHERE identity_key = ?',
    [identity],
  ).rows[0];
  if (!existing) {
    db.execute(
      `INSERT INTO merchants
         (identity_key, display_name, upi_id, first_seen_at, last_seen_at,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [identity, name, identity, at, at, at, at],
    );
  }
  const id = db.execute<{ id: number }>(
    'SELECT id FROM merchants WHERE identity_key = ?',
    [identity],
  ).rows[0]!.id;
  const d = new Date(at);
  const on = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
  db.execute(
    `INSERT INTO transactions
       (amount, transaction_type, occurred_at, occurred_on, merchant_id,
        recipient_name, source, dedup_key, created_at, updated_at)
     VALUES (?, 'DEBIT', ?, ?, ?, ?, 'MANUAL', ?, ?, ?)`,
    [amount, at, on, id, name, `t:${keyCounter++}`, NOW, NOW],
  );
}

function freshDb(): SqlDatabase {
  return initializeDatabase(openNodeDatabase(':memory:'));
}

describe('the median line, section 10.2', () => {
  it('takes the middle value, not the average, so one big payment cannot move it', () => {
    // An average of these is 2,400; the median is 100.
    expect(median([100, 100, 100, 100, 11_600])).toBe(100);
  });

  it('averages the two middles when the count is even', () => {
    expect(median([100, 300])).toBe(200);
  });

  it('is null until there is enough history', () => {
    const db = freshDb();
    // Six complete weeks are required; five are given.
    for (let week = 1; week <= 5; week += 1) {
      spend(db, 1_000_00, NOW - week * 7 * DAY);
    }
    expect(chartSeries(db, 'WEEK', NOW).median).toBeNull();
  });

  it('appears once the history is there', () => {
    const db = freshDb();
    for (let week = 1; week <= 8; week += 1) {
      spend(db, 1_000_00, NOW - week * 7 * DAY);
    }
    expect(chartSeries(db, 'WEEK', NOW).median).toBe(1_000_00);
  });

  it('never includes the period it is measured against', () => {
    const db = freshDb();
    for (let week = 1; week <= 8; week += 1) {
      spend(db, 1_000_00, NOW - week * 7 * DAY);
    }
    // A huge payment today must not raise the line today is judged against.
    spend(db, 500_000_00, NOW);
    expect(chartSeries(db, 'WEEK', NOW).median).toBe(1_000_00);
  });

  it('counts a day with no spending as zero rather than skipping it', () => {
    const db = freshDb();
    // Twenty days of history, but only five of them had any spending. The
    // median of the dense run is zero; of the sparse one it would be 1,000.
    for (let day = 1; day <= 20; day += 1) {
      if (day % 4 === 0) {
        spend(db, 1_000_00, NOW - day * DAY);
      }
    }
    expect(chartSeries(db, 'DAY', NOW).median).toBe(0);
  });
});

describe('the chart series, section 10.2', () => {
  it('draws six finished periods and the one running', () => {
    const db = freshDb();
    const series = chartSeries(db, 'WEEK', NOW);

    expect(series.points).toHaveLength(CHART_POINTS);
    expect(series.points.filter((point) => point.isCurrent)).toHaveLength(1);
    expect(series.points[CHART_POINTS - 1]!.isCurrent).toBe(true);
    expect(series.points[CHART_POINTS - 1]!.from).toBe(thisWeek(NOW).from);
  });

  it('puts each payment in the week it was made', () => {
    const db = freshDb();
    spend(db, 500_00, NOW);                 // this week
    spend(db, 300_00, NOW - 7 * DAY);       // last week
    const series = chartSeries(db, 'WEEK', NOW);

    expect(series.points[6]!.total).toBe(500_00);
    expect(series.points[5]!.total).toBe(300_00);
  });

  it('projects the current period from how much of it has gone', () => {
    const db = freshDb();
    // Saturday is day 6 of 7, so 6/7 of the week has elapsed.
    spend(db, 600_00, NOW);
    const series = chartSeries(db, 'WEEK', NOW);
    expect(series.onPaceFor).toBe(70_000);
  });
});

describe('where the money went, section 10.3', () => {
  it('groups by category, largest first, with shares that add up', () => {
    const db = freshDb();
    const food = findCategoryBySystemKey(db, 'food')!;
    const shopping = findCategoryBySystemKey(db, 'shopping')!;

    spend(db, 300_00, NOW, { categoryId: food.id });
    spend(db, 100_00, NOW, { categoryId: food.id });
    spend(db, 100_00, NOW, { categoryId: shopping.id });

    const slices = byCategory(db, thisWeek(NOW));
    expect(slices.map((slice) => slice.label)).toEqual(['Food & Dining', 'Shopping']);
    expect(slices[0]!.total).toBe(400_00);
    expect(slices[0]!.share).toBeCloseTo(0.8);
    expect(slices.reduce((sum, slice) => sum + slice.share, 0)).toBeCloseTo(1);
  });

  it('reports spending with no category rather than dropping it', () => {
    const db = freshDb();
    spend(db, 100_00, NOW);
    const slices = byCategory(db, thisWeek(NOW));
    expect(slices).toHaveLength(1);
    expect(slices[0]!.label).toBe('Uncategorised');
  });

  it('never reaches into an earlier period', () => {
    const db = freshDb();
    const food = findCategoryBySystemKey(db, 'food')!;
    spend(db, 900_00, NOW - 14 * DAY, { categoryId: food.id });
    expect(byCategory(db, thisWeek(NOW))).toHaveLength(0);
  });
});

describe('the colours in the UPI view', () => {
  it('gives every payee one, rather than a cluster of identical greys', () => {
    const db = freshDb();
    // None of these has a category, which is the ordinary case: nothing in
    // a bank message says what a person is.
    for (const [name, amount] of [
      ['Anil', 900_00], ['Beena', 800_00], ['Chandra', 700_00],
      ['Deepa', 600_00], ['Esha', 500_00], ['Faisal', 400_00],
    ] as const) {
      spend(db, amount, NOW, { name });
    }

    const colors = byPayee(db, thisWeek(NOW)).map((slice) => slice.color);
    expect(colors).not.toContain('grey');
    // Distinct is the whole requirement: two circles of one colour beside
    // each other is exactly what this is for.
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('tells two payees in one category apart', () => {
    const db = freshDb();
    const food = findCategoryBySystemKey(db, 'food')!;
    // Three of the top payees being places to eat is the normal case. When
    // a payee wore its category's colour they came out identical, and no
    // bubble could be matched to its chip.
    spend(db, 900_00, NOW, { name: 'Chai Point', categoryId: food.id });
    spend(db, 800_00, NOW, { name: 'KFC', categoryId: food.id });
    spend(db, 700_00, NOW, { name: 'Starbucks', categoryId: food.id });

    const colors = byPayee(db, thisWeek(NOW)).map((slice) => slice.color);
    expect(new Set(colors).size).toBe(3);
  });

  it('gives the payments that named nobody a colour of their own', () => {
    const db = freshDb();
    spend(db, 900_00, NOW, { name: 'Anil' });
    spend(db, 100_00, NOW);

    const nameless = byPayee(db, thisWeek(NOW)).find(
      (slice) => slice.label === 'Unknown payee',
    )!;
    // It is a slice like any other — it has a figure and the payments
    // behind it open. Grey is kept for the gathered `N more`, which the
    // card adds itself, and these two were coming out identical and
    // adjacent as the biggest circles on screen.
    expect(nameless.color).not.toBe('grey');
  });

  it('is the same arrangement of colours every time it is read', () => {
    const db = freshDb();
    spend(db, 900_00, NOW, { name: 'Anil' });
    spend(db, 100_00, NOW, { name: 'Beena' });

    expect(byPayee(db, thisWeek(NOW)).map((slice) => slice.color)).toEqual(
      byPayee(db, thisWeek(NOW)).map((slice) => slice.color),
    );
  });
});

describe('the calendar, section 10.4', () => {
  it('covers the month and leaves empty days empty', () => {
    const db = freshDb();
    spend(db, 100_00, NOW);
    const days = calendarMonth(db, thisMonth(NOW), NOW);

    expect(days).toHaveLength(31);           // October
    expect(days[23]!.dayOfMonth).toBe(24);
    expect(days[23]!.total).toBe(100_00);
    expect(days[23]!.isToday).toBe(true);
    expect(days[0]!.total).toBe(0);
    expect(days[0]!.intensity).toBe(0);
    expect(days[30]!.isFuture).toBe(true);
  });

  it('shades by rank, so one huge day does not flatten the rest', () => {
    const db = freshDb();
    spend(db, 100_00, NOW - 3 * DAY);
    spend(db, 200_00, NOW - 2 * DAY);
    spend(db, 300_00, NOW - 1 * DAY);
    spend(db, 900_000_00, NOW);

    const days = calendarMonth(db, thisMonth(NOW), NOW).filter((day) => day.total > 0);
    expect(days.map((day) => day.intensity)).toEqual([1, 2, 3, 4]);
  });
});

describe('top transactions, section 10.5', () => {
  it('ranks by size and reports each share of the period', () => {
    const db = freshDb();
    spend(db, 600_00, NOW, { name: 'Myntra' });
    spend(db, 300_00, NOW, { name: 'Swiggy' });
    spend(db, 100_00, NOW, { name: 'Uber' });

    const top = topTransactions(db, thisWeek(NOW));
    expect(top.map((row) => row.label)).toEqual(['Myntra', 'Swiggy', 'Uber']);
    expect(top[0]!.share).toBeCloseTo(0.6);
  });
});

describe('the day panel', () => {
  it('adds a payee up instead of writing the name again', () => {
    const db = freshDb();
    for (const amount of [400_00, 300_00, 200_00, 50_00, 30_00]) {
      spend(db, amount, NOW, { name: 'Shop' });
    }
    const summary = daySummary(db, periodOf('DAY', NOW), thisMonth(NOW), NOW);

    expect(summary.total).toBe(980_00);
    expect(summary.payments).toEqual([
      expect.objectContaining({ label: 'Shop', amount: 980_00, count: 5 }),
    ]);
    // One line covered all five, so there is no remainder to fold.
    expect(summary.moreCount).toBe(0);
    expect(summary.moreTotal).toBe(0);
  });

  it('lists the biggest payees and folds the rest into one line', () => {
    const db = freshDb();
    spend(db, 400_00, NOW, { name: 'A' });
    spend(db, 300_00, NOW, { name: 'B' });
    spend(db, 200_00, NOW, { name: 'C' });
    spend(db, 50_00, NOW, { name: 'D' });
    spend(db, 30_00, NOW, { name: 'E' });

    const summary = daySummary(db, periodOf('DAY', NOW), thisMonth(NOW), NOW);
    expect(summary.payments.map((p) => p.label)).toEqual(['A', 'B', 'C']);
    expect(summary.moreCount).toBe(2);
    expect(summary.moreTotal).toBe(80_00);
  });

  it('counts what it folded in payments, not in payees', () => {
    const db = freshDb();
    spend(db, 400_00, NOW, { name: 'A' });
    spend(db, 300_00, NOW, { name: 'B' });
    spend(db, 200_00, NOW, { name: 'C' });
    // One payee past the three listed, but three payments to it.
    for (const amount of [20_00, 20_00, 20_00]) {
      spend(db, amount, NOW, { name: 'D' });
    }

    const summary = daySummary(db, periodOf('DAY', NOW), thisMonth(NOW), NOW);
    expect(summary.moreCount).toBe(3);
    expect(summary.moreTotal).toBe(60_00);
  });

  it('keeps two payees apart when they share a name', () => {
    const db = freshDb();
    // The reason the grouping is by identity and not by what is on screen:
    // adding these two together because of the name would invent a payee.
    payTo(db, 'upi:imran@okaxis', 'Imran Qureshi', 58_00, NOW);
    payTo(db, 'upi:imran.q@oksbi', 'Imran Qureshi', 48_00, NOW);

    const summary = daySummary(db, periodOf('DAY', NOW), thisMonth(NOW), NOW);
    expect(summary.payments.map((p) => p.amount)).toEqual([58_00, 48_00]);
    expect(summary.payments.every((p) => p.count === 1)).toBe(true);
  });

  it('adds up the same payee paid twice', () => {
    const db = freshDb();
    payTo(db, 'upi:imran@okaxis', 'Imran Qureshi', 58_00, NOW);
    payTo(db, 'upi:imran@okaxis', 'Imran Qureshi', 48_00, NOW);

    const summary = daySummary(db, periodOf('DAY', NOW), thisMonth(NOW), NOW);
    expect(summary.payments).toEqual([
      expect.objectContaining({ label: 'Imran Qureshi', amount: 106_00, count: 2 }),
    ]);
  });

  it('counts a quiet day as a quiet day, not as no day at all', () => {
    const db = freshDb();
    // Two spending days out of the twenty-four that have happened this
    // month. `spendingByDay` returns only the days that had something, so
    // this was being read as a two-day month and its typical day came out at
    // ₹900 — the median of the days the user spent on, not of the days.
    spend(db, 900_00, new Date(2026, 9, 1, 12, 0, 0).getTime());
    spend(db, 100_00, NOW);

    const summary = daySummary(db, periodOf('DAY', NOW), thisMonth(NOW), NOW);

    expect(summary.total).toBe(100_00);
    // The typical day this month really is zero, so there is nothing to
    // compare against and the panel says nothing rather than "-89%".
    expect(summary.versusTypicalPercent).toBeNull();
  });

  it('answers the typical day the same way the chart line does', () => {
    const db = freshDb();
    // Four days, every one of them spent on, so the zero filling above is not
    // what is being measured here — only how an even count is read. Taking
    // the upper middle gives ₹400 and averaging the two middles gives ₹300,
    // and the two figures sit one above the other on Home.
    const fourth = new Date(2026, 9, 4, 12, 0, 0).getTime();
    const amounts = [100_00, 200_00, 400_00, 800_00];
    amounts.forEach((amount, index) => {
      spend(db, amount, new Date(2026, 9, 1 + index, 12, 0, 0).getTime());
    });

    const summary = daySummary(db, periodOf('DAY', fourth), thisMonth(NOW), fourth);

    expect(summary.total).toBe(800_00);
    const typical = median(amounts)!;
    expect(typical).toBe(300_00);
    expect(summary.versusTypicalPercent).toBeCloseTo(
      ((800_00 - typical) / typical) * 100,
    );
  });

  it('leaves payments with no payee as separate lines', () => {
    const db = freshDb();
    // All three would share a NULL identity. Collapsing them into one
    // `Payment` row would hide two payments behind a third one's name.
    spend(db, 10_00, NOW);
    spend(db, 20_00, NOW);
    spend(db, 30_00, NOW);

    const summary = daySummary(db, periodOf('DAY', NOW), thisMonth(NOW), NOW);
    expect(summary.payments.map((p) => p.amount)).toEqual([30_00, 20_00, 10_00]);
  });
});

describe('the sentences', () => {
  it('says nothing when there is no previous period and no median', () => {
    const db = freshDb();
    spend(db, 100_00, NOW);
    expect(chartSummary(chartSeries(db, 'WEEK', NOW), 0, 'EVERYDAY')).toBeNull();
  });

  it('names the days carrying the week', () => {
    // Mon 19 Oct to Sat 24 Oct: Wednesday and Friday are 60% of it.
    const days = [
      { date: '2026-10-19', total: 100_00 },  // Monday
      { date: '2026-10-20', total: 100_00 },
      { date: '2026-10-21', total: 300_00 },  // Wednesday
      { date: '2026-10-22', total: 100_00 },
      { date: '2026-10-23', total: 300_00 },  // Friday
      { date: '2026-10-24', total: 100_00 },
    ];
    expect(dayConcentration(days, 'WEEK')?.text).toBe(
      'Wednesday and Friday alone were 60% of this week’s spending.'
        .replace('’', "'"),
    );
  });

  it('dates the days in a month instead of naming weekdays', () => {
    // A month holds four Saturdays, so "Saturday" would not say which.
    const days = [
      { date: '2026-10-03', total: 100_00 },
      { date: '2026-10-10', total: 100_00 },
      { date: '2026-10-11', total: 900_00 },
      { date: '2026-10-17', total: 100_00 },
      { date: '2026-10-24', total: 100_00 },
    ];
    expect(dayConcentration(days, 'MONTH')?.text).toBe(
      '11 Oct alone was 69% of this month\'s spending.',
    );
  });

  it('stays silent when spending is spread evenly', () => {
    const days = Array.from({ length: 6 }, (_, index) => ({
      date: `2026-10-${19 + index}`,
      total: 100_00,
    }));
    expect(dayConcentration(days, 'WEEK')).toBeNull();
  });

  it('does not call one slice the highest of one', () => {
    expect(topSliceNote([{ key: 'a', label: 'Food', color: 'green', icon: null, total: 1, share: 1 }]))
      .toBeNull();
  });
});

/**
 * The breakdown runs its own copy of the spending clause, because its
 * queries need the joins under their own names for grouping. That copy has
 * to say the same thing as the one in `spending.ts`, and nothing but a test
 * makes it: the figure on the card and the slices under it are read by
 * different SQL, and a flag missing from one of them shows up as a card
 * whose parts do not add up to its own total.
 */
describe('the breakdown agrees with the total above it', () => {
  it('leaves a fixed cost out of where the money went', () => {
    const db = freshDb();
    const rent = findCategoryBySystemKey(db, 'rent')!;
    const food = findCategoryBySystemKey(db, 'food')!;
    spend(db, 1_836_800, NOW, { categoryId: rent.id });
    spend(db, 38_600, NOW, { categoryId: food.id });

    const everyday = byCategory(db, thisMonth(NOW), 'EVERYDAY');
    expect(everyday.map((slice) => slice.label)).toEqual(['Food & Dining']);
    expect(everyday[0]!.total).toBe(38_600);

    // And brings it back where the total does.
    const everything = byCategory(db, thisMonth(NOW), 'EVERYTHING');
    expect(everything.reduce((sum, slice) => sum + slice.total, 0)).toBe(1_875_400);
  });

  it('leaves a repaid loan out of where the money went', () => {
    const db = freshDb();
    const food = findCategoryBySystemKey(db, 'food')!;
    spend(db, 38_600, NOW, { categoryId: food.id });
    spend(db, 500_000, NOW, { categoryId: food.id, name: 'A friend' });
    db.execute(`UPDATE transactions SET repaid_at = ? WHERE amount = 500000`, [NOW]);

    // Money lent and paid back never left. The Home figure has always known
    // that; this query used to disagree with it.
    const slices = byCategory(db, thisMonth(NOW), 'EVERYDAY');
    expect(slices.reduce((sum, slice) => sum + slice.total, 0)).toBe(38_600);
    expect(byCategory(db, thisMonth(NOW), 'EVERYTHING')
      .reduce((sum, slice) => sum + slice.total, 0)).toBe(38_600);
  });
});

describe('the columns that carry their own figure', () => {
  const column = (total: number, isCurrent = false) => ({
    from: 0, to: 0, total, isCurrent,
  });

  it('names the highest and the lowest', () => {
    const marks = chartMarks([
      column(300), column(900), column(100), column(500),
    ]);
    expect(marks.high).toEqual({ index: 1, total: 900 });
    expect(marks.low).toEqual({ index: 2, total: 100 });
  });

  it('never calls the running period the lowest', () => {
    // Two days into the week it is the smallest column on the chart, and
    // saying so would report the calendar rather than the spending.
    const marks = chartMarks([
      column(800), column(600), column(700), column(50, true),
    ]);
    expect(marks.low).toEqual({ index: 1, total: 600 });
  });

  it('still lets it be the highest, which it earned', () => {
    const marks = chartMarks([
      column(300), column(400), column(900, true),
    ]);
    expect(marks.high).toEqual({ index: 2, total: 900 });
  });

  it('says nothing when every column is the same', () => {
    expect(chartMarks([column(500), column(500), column(500)])).toEqual({
      high: null, low: null,
    });
  });

  it('says nothing about a chart with no spending on it at all', () => {
    expect(chartMarks([column(0), column(0), column(0, true)])).toEqual({
      high: null, low: null,
    });
  });

  it('says nothing about a single column', () => {
    expect(chartMarks([column(400)])).toEqual({ high: null, low: null });
  });
});
