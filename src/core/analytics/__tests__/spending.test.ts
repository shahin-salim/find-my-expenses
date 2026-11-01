import { findCategoryBySystemKey } from '../../db/dao/categories';
import { initializeDatabase } from '../../db/database';
import { openNodeDatabase } from '../../db/nodeSqlite';
import type { SqlDatabase } from '../../db/types';
import {
  fixedCostTotal,
  formatCompactRupees,
  formatRupees,
  movedMoneyTotal,
  spendingTotal,
  summarise,
  thisMonth,
  today,
} from '../spending';

const NOW = new Date(2026, 9, 24, 14, 30, 0).getTime();
const DAY = 86_400_000;

let keyCounter = 0;

function addTransaction(
  db: SqlDatabase,
  values: {
    amount: number;
    at: number;
    type?: 'DEBIT' | 'CREDIT';
    categoryId?: number | null;
    isTransfer?: boolean;
    isExcluded?: boolean;
    isRefunded?: boolean;
    isDeleted?: boolean;
  },
) {
  const at = values.at;
  const d = new Date(at);
  const on = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;

  db.execute(
    `INSERT INTO transactions
       (amount, transaction_type, occurred_at, occurred_on, category_id, source,
        dedup_key, is_transfer, is_excluded, is_refunded, is_deleted,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'MANUAL', ?, ?, ?, ?, ?, ?, ?)`,
    [
      values.amount,
      values.type ?? 'DEBIT',
      at,
      on,
      values.categoryId ?? null,
      `test:${keyCounter++}`,
      values.isTransfer ? 1 : 0,
      values.isExcluded ? 1 : 0,
      values.isRefunded ? 1 : 0,
      values.isDeleted ? 1 : 0,
      NOW,
      NOW,
    ],
  );
}

function freshDb(): SqlDatabase {
  return initializeDatabase(openNodeDatabase(':memory:'), NOW);
}

describe('the spending definition in section 10', () => {
  test('counts a plain debit and nothing else', () => {
    const db = freshDb();
    addTransaction(db, { amount: 100_000, at: NOW - 3600_000 });
    addTransaction(db, { amount: 500_000, at: NOW - 3600_000, type: 'CREDIT' });
    addTransaction(db, { amount: 100_000, at: NOW - 3600_000, isTransfer: true });
    addTransaction(db, { amount: 100_000, at: NOW - 3600_000, isExcluded: true });
    addTransaction(db, { amount: 100_000, at: NOW - 3600_000, isRefunded: true });
    addTransaction(db, { amount: 100_000, at: NOW - 3600_000, isDeleted: true });

    expect(spendingTotal(db, today(NOW))).toBe(100_000);
  });

  test('a day runs from local midnight to local midnight', () => {
    const db = freshDb();
    // 23:59 yesterday and 00:01 today are different days.
    addTransaction(db, { amount: 50_000, at: new Date(2026, 9, 23, 23, 59).getTime() });
    addTransaction(db, { amount: 70_000, at: new Date(2026, 9, 24, 0, 1).getTime() });

    expect(spendingTotal(db, today(NOW))).toBe(70_000);
  });

  test('a period is compared against the whole of the one before it', () => {
    const db = freshDb();
    addTransaction(db, { amount: 120_000, at: NOW - 3600_000 });
    addTransaction(db, { amount: 100_000, at: NOW - DAY });

    const day = summarise(db, 'DAY', NOW);
    expect(day.total).toBe(120_000);
    expect(day.previousTotal).toBe(100_000);
    expect(day.changePercent).toBeCloseTo(20);
  });

  test('a previous period with no spending gives no percentage', () => {
    const db = freshDb();
    addTransaction(db, { amount: 120_000, at: NOW - 3600_000 });
    expect(summarise(db, 'DAY', NOW).changePercent).toBeNull();
  });

  test('everyday spending leaves out rent, bills and SIPs', () => {
    const db = freshDb();
    const rent = findCategoryBySystemKey(db, 'rent')!;
    const food = findCategoryBySystemKey(db, 'food')!;

    addTransaction(db, { amount: 1_836_800, at: NOW - 3 * DAY, categoryId: rent.id });
    addTransaction(db, { amount: 38_600, at: NOW - 3600_000, categoryId: food.id });

    const month = thisMonth(NOW);
    expect(spendingTotal(db, month, 'EVERYDAY')).toBe(38_600);
    // A fixed cost leaves the spending figures outright. It used to come
    // back under a third view, `ALL`, which is gone: rent drowns out a
    // month as thoroughly as it drowns out a day.
    expect(spendingTotal(db, month, 'EVERYTHING')).toBe(1_875_400);
    // What the filter sheet reports as hidden.
    expect(fixedCostTotal(db, month)).toBe(1_836_800);
  });
});

describe('formatting', () => {
  test('writes amounts the way the screens do', () => {
    expect(formatRupees(124_000)).toBe('₹1,240');
    expect(formatRupees(3_842_000)).toBe('₹38,420');
    expect(formatRupees(38_600)).toBe('₹386');
    expect(formatRupees(117_206, { showPaise: true })).toBe('₹1,172.06');
  });

  it('shortens a figure that has to fit inside the chart', () => {
    expect(formatCompactRupees(94_000)).toBe('₹940');
    expect(formatCompactRupees(992_000)).toBe('₹9.9k');
    expect(formatCompactRupees(510_000)).toBe('₹5.1k');
    // No decimal once it would be false precision on a glanced label.
    expect(formatCompactRupees(6_240_000)).toBe('₹62k');
    expect(formatCompactRupees(100_000_00)).toBe('₹1L');
    expect(formatCompactRupees(345_000_00)).toBe('₹3.5L');
    expect(formatCompactRupees(0)).toBe('₹0');
  });
});

describe('a category left out of spending totals, section 8.2', () => {
  it('keeps an investment out of the figures', () => {
    const db = freshDb();
    const investment = findCategoryBySystemKey(db, 'investment')!;
    const food = findCategoryBySystemKey(db, 'food')!;

    addTransaction(db, { amount: 500_000, at: NOW, categoryId: investment.id });
    addTransaction(db, { amount: 30_000, at: NOW, categoryId: food.id });

    // Money put into an investment has moved, not been spent.
    expect(spendingTotal(db, today(NOW))).toBe(30_000);
  });

  it('is reported apart from a fixed cost', () => {
    const db = freshDb();
    const investment = findCategoryBySystemKey(db, 'investment')!;
    const rent = findCategoryBySystemKey(db, 'rent')!;
    addTransaction(db, { amount: 500_000, at: NOW, categoryId: investment.id });
    addTransaction(db, { amount: 300_000, at: NOW, categoryId: rent.id });

    // Both flags now keep a payment out of spending, so the figures agree.
    expect(spendingTotal(db, today(NOW), 'EVERYDAY')).toBe(0);
    expect(spendingTotal(db, today(NOW), 'EVERYTHING')).toBe(800_000);

    // What they are not is interchangeable: the filter sheet names them
    // separately, and neither total may swallow the other's payment.
    expect(fixedCostTotal(db, today(NOW))).toBe(300_000);
    expect(movedMoneyTotal(db, today(NOW))).toBe(500_000);
  });
});
