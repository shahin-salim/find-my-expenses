/**
 * Manual entry, editing, deleting, and the Transactions list's filters.
 */

import { findCategoryBySystemKey, listCategories } from '../../db/dao/categories';
import { getCashAccount } from '../../db/dao/accounts';
import {
  findMerchantById,
  paymentsFollowingMerchantCategory,
  setUserCategory,
} from '../../db/dao/merchants';
import {
  findTransactionById,
  setExcluded,
  setNote,
  setTransactionCategory,
  softDelete,
} from '../../db/dao/transactions';
import { initializeDatabase } from '../../db/database';
import { openNodeDatabase } from '../../db/nodeSqlite';
import type { SqlDatabase } from '../../db/types';
import {
  canSave,
  createManualTransaction,
  getTransactionDetail,
  updateManualTransaction,
  validate,
  type ManualEntry,
} from '../manual';
import { byCategory, byPayee } from '../../analytics/breakdown';
import { thisWeek } from '../../analytics/spending';
import {
  DEFAULT_FILTER,
  NO_PAYEE,
  dateFilterLabel,
  daysWithActivity,
  filterTotals,
  groupByDay,
  listTransactions,
  presetForSearch,
  withType,
  transactionDateBounds,
  type TransactionFilter,
} from '../query';

const NOW = new Date(2026, 9, 24, 14, 30, 0).getTime();
const DAY = 86_400_000;

function freshDb(): SqlDatabase {
  return initializeDatabase(openNodeDatabase(':memory:'));
}

function entry(overrides: Partial<ManualEntry> = {}): ManualEntry {
  return {
    amount: 14_900,
    transactionType: 'DEBIT',
    recipientName: 'Ratnadeep',
    upiId: null,
    categoryId: null,
    accountId: null,
    occurredAt: NOW,
    note: null,
    ...overrides,
  };
}

function filter(overrides: Partial<TransactionFilter> = {}): TransactionFilter {
  return { ...DEFAULT_FILTER, ...overrides };
}

describe('creating a payment by hand', () => {
  it('stores it as a manual transaction on the chosen account', () => {
    const db = freshDb();
    const cash = getCashAccount(db)!;
    const groceries = findCategoryBySystemKey(db, 'groceries')!;

    const row = createManualTransaction(
      db,
      entry({ accountId: cash.id, categoryId: groceries.id, note: 'Vegetables and milk' }),
      NOW,
    );

    expect(row.source).toBe('MANUAL');
    expect(row.amount).toBe(14_900);
    expect(row.transaction_type).toBe('DEBIT');
    expect(row.occurred_on).toBe('2026-10-24');
    expect(row.account_id).toBe(cash.id);
    expect(row.category_id).toBe(groceries.id);
    expect(row.note).toBe('Vegetables and milk');
    expect(row.rrn).toBeNull();
  });

  it('never collides with another entry for the same payee and amount', () => {
    const db = freshDb();
    // Two metro journeys of the same fare are two payments, not one.
    const first = createManualTransaction(db, entry({ amount: 4_500 }), NOW);
    const second = createManualTransaction(db, entry({ amount: 4_500 }), NOW);

    expect(second.id).not.toBe(first.id);
    expect(second.dedup_key).not.toBe(first.dedup_key);
  });

  it('joins the merchant row the bank messages use', () => {
    const db = freshDb();
    const first = createManualTransaction(db, entry({ recipientName: 'Swiggy' }), NOW);
    const second = createManualTransaction(db, entry({ recipientName: 'swiggy' }), NOW);

    expect(second.merchant_id).toBe(first.merchant_id);
  });

  it('categorises the merchant automatically, section 5.3', () => {
    const db = freshDb();
    const row = createManualTransaction(db, entry({ recipientName: 'Swiggy' }), NOW);
    const merchant = findMerchantById(db, row.merchant_id!)!;
    const food = findCategoryBySystemKey(db, 'food')!;

    expect(merchant.category_id).toBe(food.id);
    expect(merchant.category_source).toBe('AUTO');
  });
});

describe('what the form refuses', () => {
  it('will not take a zero or negative amount', () => {
    expect(validate(entry({ amount: 0 }), NOW).errors.amount).toBeTruthy();
    expect(validate(entry({ amount: -500 }), NOW).errors.amount).toBeTruthy();
  });

  it('will not take an empty payee', () => {
    expect(validate(entry({ recipientName: '   ' }), NOW).errors.recipientName).toBeTruthy();
  });

  it('will not take a payment dated in the future', () => {
    expect(validate(entry({ occurredAt: NOW + DAY }), NOW).errors.occurredAt).toBeTruthy();
  });

  it('accepts an ordinary entry', () => {
    expect(canSave(validate(entry(), NOW))).toBe(true);
  });
});

describe('editing', () => {
  it('rewrites the fields and moves the payee', () => {
    const db = freshDb();
    const row = createManualTransaction(db, entry({ recipientName: 'Ratnadeep' }), NOW);

    const updated = updateManualTransaction(
      db,
      row.id,
      entry({ recipientName: 'Zepto', amount: 32_000, occurredAt: NOW - DAY }),
      NOW,
    );

    expect(updated.amount).toBe(32_000);
    expect(updated.recipient_name).toBe('Zepto');
    expect(updated.occurred_on).toBe('2026-10-23');
    expect(updated.merchant_id).not.toBe(row.merchant_id);
  });

  it('keeps the dedup key, because an edit is the same payment', () => {
    const db = freshDb();
    const row = createManualTransaction(db, entry(), NOW);
    const updated = updateManualTransaction(db, row.id, entry({ amount: 1 }), NOW);
    expect(updated.dedup_key).toBe(row.dedup_key);
  });

  it('overrides the category for this payment only', () => {
    const db = freshDb();
    const row = createManualTransaction(db, entry({ recipientName: 'Swiggy' }), NOW);
    const transport = findCategoryBySystemKey(db, 'transport')!;

    setTransactionCategory(db, row.id, transport.id, NOW);
    const detail = getTransactionDetail(db, row.id)!;

    expect(detail.category_name).toBe('Transport');
    // The merchant keeps the category it was given; only this row moved.
    expect(findMerchantById(db, row.merchant_id!)!.category_id).not.toBe(transport.id);
  });
});

describe('deleting', () => {
  it('is soft, so a re-import cannot bring it back', () => {
    const db = freshDb();
    const row = createManualTransaction(db, entry(), NOW);

    softDelete(db, row.id, NOW);

    const still = findTransactionById(db, row.id)!;
    expect(still.is_deleted).toBe(1);
    expect(still.dedup_key).toBe(row.dedup_key);
    expect(listTransactions(db, filter(), NOW)).toHaveLength(0);
  });

  it('takes the payment out of the totals', () => {
    const db = freshDb();
    const row = createManualTransaction(db, entry({ amount: 50_000 }), NOW);
    expect(filterTotals(db, filter(), NOW).out).toBe(50_000);

    softDelete(db, row.id, NOW);
    expect(filterTotals(db, filter(), NOW).out).toBe(0);
  });
});

describe('the list filters', () => {
  function seed(db: SqlDatabase) {
    const cash = getCashAccount(db)!;
    const food = findCategoryBySystemKey(db, 'food')!;
    const rent = findCategoryBySystemKey(db, 'rent')!;

    createManualTransaction(db, entry({
      recipientName: 'Swiggy', amount: 38_600, categoryId: food.id, accountId: cash.id,
    }), NOW);
    createManualTransaction(db, entry({
      recipientName: 'Landlord', amount: 2_500_000, categoryId: rent.id,
    }), NOW);
    createManualTransaction(db, entry({
      recipientName: 'Mum', amount: 100_000, transactionType: 'CREDIT',
    }), NOW);
    createManualTransaction(db, entry({
      recipientName: 'Unknown shop', amount: 20_000, occurredAt: NOW - 40 * DAY,
    }), NOW);
    return { cash, food, rent };
  }

  it('counts money out and money in separately', () => {
    const db = freshDb();
    seed(db);
    const totals = filterTotals(db, filter(), NOW);

    expect(totals.count).toBe(3);               // the 40-day-old one is last month
    expect(totals.out).toBe(38_600 + 2_500_000);
    expect(totals.in).toBe(100_000);
  });

  it('filters by direction', () => {
    const db = freshDb();
    seed(db);
    const rows = listTransactions(db, filter({ type: 'CREDIT' }), NOW);
    expect(rows.map((row) => row.display_name)).toEqual(['Mum']);
  });

  it('filters by category, and by having none', () => {
    const db = freshDb();
    const { food } = seed(db);

    expect(listTransactions(db, filter({ categories: [food.id] }), NOW))
      .toHaveLength(1);
    // 'Mum' and 'Landlord' — Landlord carries rent, Mum carries nothing.
    expect(listTransactions(db, filter({ categories: ['NONE'] }), NOW)
      .map((row) => row.display_name)).toEqual(['Mum']);
  });

  it('hides fixed costs when asked, section 8.2', () => {
    const db = freshDb();
    seed(db);
    const rows = listTransactions(db, filter({ hideFixedCosts: true }), NOW);
    expect(rows.map((row) => row.display_name)).not.toContain('Landlord');
  });

  it('filters by amount', () => {
    const db = freshDb();
    seed(db);
    const rows = listTransactions(db, filter({ minAmount: 50_000, maxAmount: 200_000 }), NOW);
    expect(rows.map((row) => row.display_name)).toEqual(['Mum']);
  });

  it('searches by payee and by rupee amount', () => {
    const db = freshDb();
    seed(db);
    expect(listTransactions(db, filter({ search: 'swig' }), NOW)).toHaveLength(1);
    // 38,600 paise is ₹386, and that is what a person would type.
    expect(listTransactions(db, filter({ search: '386' }), NOW)).toHaveLength(1);
  });

  it('reaches older payments only when the window allows', () => {
    const db = freshDb();
    seed(db);
    expect(listTransactions(db, filter({ datePreset: 'MONTH' }), NOW)).toHaveLength(3);
    expect(listTransactions(db, filter({ datePreset: 'ALL' }), NOW)).toHaveLength(4);
    expect(listTransactions(db, filter({ datePreset: 'TODAY' }), NOW)).toHaveLength(3);
  });

  it('groups into days with their own totals', () => {
    const db = freshDb();
    seed(db);
    const groups = groupByDay(listTransactions(db, filter({ datePreset: 'ALL' }), NOW));

    expect(groups).toHaveLength(2);
    expect(groups[0]!.date).toBe('2026-10-24');
    expect(groups[0]!.spent).toBe(38_600 + 2_500_000);
    expect(groups[0]!.received).toBe(100_000);
  });
});

describe('excluding a payment', () => {
  it('keeps it in the list but out of spending', () => {
    const db = freshDb();
    const row = createManualTransaction(db, entry({ amount: 50_000 }), NOW);

    setExcluded(db, row.id, true, NOW);

    expect(listTransactions(db, filter(), NOW)).toHaveLength(1);
    expect(getTransactionDetail(db, row.id)!.is_excluded).toBe(1);
  });
});

describe('the detail read', () => {
  it('carries the merchant, category and account together', () => {
    const db = freshDb();
    const cash = getCashAccount(db)!;
    const row = createManualTransaction(
      db,
      entry({ recipientName: 'Swiggy', upiId: 'swiggy.stores@axb', accountId: cash.id }),
      NOW,
    );
    const detail = getTransactionDetail(db, row.id)!;

    expect(detail.merchant_name).toBe('Swiggy');
    expect(detail.merchant_upi_id).toBe('swiggy.stores@axb');
    expect(detail.category_name).toBe('Food & Dining');
    expect(detail.bank_name).toBe(cash.bank_name);
    expect(listCategories(db).length).toBeGreaterThan(0);
  });
});

describe('opening the list from a figure on Home', () => {
  /**
   * The promise the drill-down makes: what is listed is what was counted.
   * Section 10 leaves out refunds, exclusions, transfers, credits and foreign
   * amounts, so a list that merely shared the period would show rows the
   * figure never included and would not add up to it.
   */
  function seedWithExclusions(db: SqlDatabase) {
    const food = findCategoryBySystemKey(db, 'food')!;

    const counted = [
      createManualTransaction(db, entry({ recipientName: 'Swiggy', amount: 38_600, categoryId: food.id }), NOW),
      createManualTransaction(db, entry({ recipientName: 'Swiggy', amount: 64_000, categoryId: food.id }), NOW),
    ];

    // Each of these falls in the same week and the same category, and each is
    // left out of spending for a different reason.
    const refunded = createManualTransaction(db, entry({ recipientName: 'Swiggy', amount: 99_900, categoryId: food.id }), NOW);
    db.execute(`UPDATE transactions SET is_refunded = 1 WHERE id = ?`, [refunded.id]);

    const excluded = createManualTransaction(db, entry({ recipientName: 'Swiggy', amount: 88_800, categoryId: food.id }), NOW);
    setExcluded(db, excluded.id, true, NOW);

    const transfer = createManualTransaction(db, entry({ recipientName: 'Swiggy', amount: 77_700, categoryId: food.id }), NOW);
    db.execute(`UPDATE transactions SET is_transfer = 1 WHERE id = ?`, [transfer.id]);

    const credit = createManualTransaction(db, entry({
      recipientName: 'Swiggy', amount: 66_600, categoryId: food.id, transactionType: 'CREDIT',
    }), NOW);

    const foreign = createManualTransaction(db, entry({ recipientName: 'Swiggy', amount: 55_500, categoryId: food.id }), NOW);
    db.execute(`UPDATE transactions SET currency = 'SGD' WHERE id = ?`, [foreign.id]);

    return { food, counted, left_out: [refunded, excluded, transfer, credit, foreign] };
  }

  it('lists exactly the rows the category figure added up', () => {
    const db = freshDb();
    const { food, counted } = seedWithExclusions(db);

    const slice = byCategory(db, thisWeek(NOW)).find(
      (entry_) => entry_.key === String(food.id),
    )!;

    const drilled = filter({
      datePreset: 'WEEK',
      spendingOnly: true,
      categories: [food.id],
    });
    const rows = listTransactions(db, drilled, NOW, 500);

    expect(rows).toHaveLength(counted.length);
    expect(rows.map((row) => row.id).sort()).toEqual(counted.map((row) => row.id).sort());
    // The figure on the card and the rows behind it are the same money.
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(slice.total);
    expect(filterTotals(db, drilled, NOW).out).toBe(slice.total);
  });

  it('leaves out every row section 10 leaves out', () => {
    const db = freshDb();
    const { food, left_out } = seedWithExclusions(db);

    const rows = listTransactions(
      db,
      filter({ datePreset: 'WEEK', spendingOnly: true, categories: [food.id] }),
      NOW,
      500,
    );
    const listed = new Set(rows.map((row) => row.id));
    for (const row of left_out) {
      expect(listed.has(row.id)).toBe(false);
    }
  });

  it('narrows to one payee when a UPI slice is tapped', () => {
    const db = freshDb();
    createManualTransaction(db, entry({ recipientName: 'Swiggy', amount: 10_000 }), NOW);
    createManualTransaction(db, entry({ recipientName: 'Swiggy', amount: 20_000 }), NOW);
    createManualTransaction(db, entry({ recipientName: 'Zepto', amount: 30_000 }), NOW);

    const slice = byPayee(db, thisWeek(NOW)).find((entry_) =>
      entry_.label.toLowerCase().includes('swiggy'),
    )!;

    const rows = listTransactions(
      db,
      filter({ datePreset: 'WEEK', spendingOnly: true, payeeKeys: [slice.key] }),
      NOW,
      500,
    );

    expect(rows).toHaveLength(2);
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(slice.total);
  });
});

describe('searching across periods', () => {
  it('widens the window to everything, and puts it back afterwards', () => {
    // Typing into an empty box: the month is remembered and dropped.
    const opened = presetForSearch('', 'divya', 'MONTH', null);
    expect(opened).toEqual({ preset: 'ALL', saved: 'MONTH' });

    // Still typing: nothing moves, and the saved window is not overwritten.
    const typing = presetForSearch('divya', 'divya r', opened.preset, opened.saved);
    expect(typing).toEqual({ preset: 'ALL', saved: 'MONTH' });

    // Cleared: the month comes back.
    expect(presetForSearch('divya r', '', typing.preset, typing.saved))
      .toEqual({ preset: 'MONTH', saved: null });
  });

  it('leaves an all-time list alone', () => {
    expect(presetForSearch('', 'swiggy', 'ALL', null))
      .toEqual({ preset: 'ALL', saved: null });
  });

  it('finds payments outside the current month', () => {
    const db = freshDb();
    createManualTransaction(db, entry({ recipientName: 'Divya Rao', amount: 10_000 }), NOW);
    createManualTransaction(db, entry({
      recipientName: 'Divya Rao', amount: 20_000, occurredAt: NOW - 200 * DAY,
    }), NOW);

    // Scoped to this month, one of the two is invisible — which is what made
    // the search read as an answer about the payee.
    expect(listTransactions(db, filter({ search: 'divya' }), NOW)).toHaveLength(1);
    expect(
      listTransactions(db, filter({ search: 'divya', datePreset: 'ALL' }), NOW),
    ).toHaveLength(2);
  });
});

describe('notes', () => {
  it('saves, changes and clears', () => {
    const db = freshDb();
    const row = createManualTransaction(db, entry(), NOW);

    setNote(db, row.id, 'Vegetables and milk', NOW);
    expect(getTransactionDetail(db, row.id)!.note).toBe('Vegetables and milk');

    setNote(db, row.id, 'Team lunch', NOW);
    expect(getTransactionDetail(db, row.id)!.note).toBe('Team lunch');

    // An emptied box stores NULL, not an empty string, so nothing downstream
    // has to tell the two apart.
    setNote(db, row.id, null, NOW);
    expect(getTransactionDetail(db, row.id)!.note).toBeNull();
  });

  it('is searchable', () => {
    const db = freshDb();
    const row = createManualTransaction(db, entry({ recipientName: 'Ratnadeep' }), NOW);
    setNote(db, row.id, 'Vegetables and milk', NOW);

    expect(listTransactions(db, filter({ search: 'vegetables' }), NOW)).toHaveLength(1);
  });
});

describe('remembering a category against the payee', () => {
  /**
   * Section 10.3 resolves a transaction's category as its own when the user
   * set one and the merchant's otherwise. Setting it on the merchant is what
   * makes the choice stick for next time, which is the difference between
   * categorising a payee once and categorising it forever.
   */
  function threePaymentsTo(db: SqlDatabase, payee: string) {
    return [
      createManualTransaction(db, entry({ recipientName: payee, amount: 10_000 }), NOW),
      createManualTransaction(db, entry({ recipientName: payee, amount: 20_000 }), NOW),
      createManualTransaction(db, entry({ recipientName: payee, amount: 30_000 }), NOW),
    ];
  }

  it('counts the payments a payee-level category would reach', () => {
    const db = freshDb();
    const rows = threePaymentsTo(db, 'Amman Cool Bar');
    const merchantId = rows[0]!.merchant_id!;

    // All three follow the payee; excluding the one being edited leaves two.
    expect(paymentsFollowingMerchantCategory(db, merchantId)).toBe(3);
    expect(paymentsFollowingMerchantCategory(db, merchantId, rows[0]!.id)).toBe(2);
  });

  it('does not count a payment the user has already set itself', () => {
    const db = freshDb();
    const rows = threePaymentsTo(db, 'Amman Cool Bar');
    const food = findCategoryBySystemKey(db, 'food')!;
    setTransactionCategory(db, rows[1]!.id, food.id, NOW);

    expect(paymentsFollowingMerchantCategory(db, rows[0]!.merchant_id!)).toBe(2);
  });

  it('categorises every past payment to that payee at once', () => {
    const db = freshDb();
    const rows = threePaymentsTo(db, 'Amman Cool Bar');
    const food = findCategoryBySystemKey(db, 'food')!;

    setUserCategory(db, rows[0]!.merchant_id!, food.id, NOW);

    for (const row of rows) {
      expect(getTransactionDetail(db, row.id)!.category_name).toBe('Food & Dining');
    }
  });

  it('files the next payment to that payee without being asked again', () => {
    const db = freshDb();
    const rows = threePaymentsTo(db, 'Amman Cool Bar');
    const food = findCategoryBySystemKey(db, 'food')!;
    setUserCategory(db, rows[0]!.merchant_id!, food.id, NOW);

    const later = createManualTransaction(
      db,
      entry({ recipientName: 'Amman Cool Bar', amount: 5_000 }),
      NOW,
    );

    expect(getTransactionDetail(db, later.id)!.category_name).toBe('Food & Dining');
  });

  it('leaves a payment the user set itself alone', () => {
    const db = freshDb();
    const rows = threePaymentsTo(db, 'Amman Cool Bar');
    const food = findCategoryBySystemKey(db, 'food')!;
    const transport = findCategoryBySystemKey(db, 'transport')!;

    setTransactionCategory(db, rows[1]!.id, transport.id, NOW);
    setUserCategory(db, rows[0]!.merchant_id!, food.id, NOW);

    expect(getTransactionDetail(db, rows[1]!.id)!.category_name).toBe('Transport');
    expect(getTransactionDetail(db, rows[0]!.id)!.category_name).toBe('Food & Dining');
  });

  it('is keyed by the UPI ID when the message carried one', () => {
    const db = freshDb();
    // Section 8.4's identity: the UPI ID wins over the name, so the same
    // handle writing its name two ways is still one payee.
    const first = createManualTransaction(
      db,
      entry({ recipientName: 'CHAI POINT', upiId: 'chaipoint@ybl' }),
      NOW,
    );
    const second = createManualTransaction(
      db,
      entry({ recipientName: 'Chai Point Koramangala', upiId: 'chaipoint@ybl' }),
      NOW,
    );
    expect(second.merchant_id).toBe(first.merchant_id);

    const food = findCategoryBySystemKey(db, 'food')!;
    setUserCategory(db, first.merchant_id!, food.id, NOW);
    expect(getTransactionDetail(db, second.id)!.category_name).toBe('Food & Dining');
  });
});

describe('tapping a bubble that stands for more than one payee', () => {
  /**
   * Every bubble on Home claims an amount. Tapping it has to produce the
   * payments that add up to it — including the two bubbles that are not a
   * single payee: the gathered tail, and the payments that named nobody.
   */
  function paymentWithNoPayee(db: SqlDatabase, amount: number) {
    db.execute(
      `INSERT INTO transactions
         (amount, transaction_type, occurred_at, occurred_on, source,
          dedup_key, created_at, updated_at)
       VALUES (?, 'DEBIT', ?, '2026-10-24', 'SMS', ?, ?, ?)`,
      [amount, NOW, `none:${amount}`, NOW, NOW],
    );
  }

  it('opens the payments that named nobody', () => {
    const db = freshDb();
    paymentWithNoPayee(db, 525_400);
    createManualTransaction(db, entry({ recipientName: 'Swiggy', amount: 10_000 }), NOW);

    const slice = byPayee(db, thisWeek(NOW)).find((s) => s.key === NO_PAYEE)!;
    expect(slice.total).toBe(525_400);

    const rows = listTransactions(
      db,
      filter({ datePreset: 'WEEK', spendingOnly: true, payeeKeys: [slice.key] }),
      NOW,
      500,
    );

    // The bug: the key came through as the word "unknown", which matched a
    // payee of that name and so matched nothing at all.
    expect(rows).toHaveLength(1);
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(slice.total);
  });

  it('opens every payee a gathered slice stands for', () => {
    const db = freshDb();
    const payees = ['A Shop', 'B Shop', 'C Shop', 'D Shop'];
    payees.forEach((name, index) =>
      createManualTransaction(db, entry({ recipientName: name, amount: (index + 1) * 10_000 }), NOW),
    );

    const slices = byPayee(db, thisWeek(NOW));
    // The screen keeps the largest few and gathers the rest; the gathered
    // one carries its members so the filter can name them.
    const tail = slices.slice(2);
    const gathered = {
      key: 'others',
      total: tail.reduce((sum, s) => sum + s.total, 0),
      members: tail,
    };

    const rows = listTransactions(
      db,
      filter({
        datePreset: 'WEEK',
        spendingOnly: true,
        payeeKeys: gathered.members.map((m) => m.key),
      }),
      NOW,
      500,
    );

    expect(rows).toHaveLength(tail.length);
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(gathered.total);
  });
});

describe('picking the dates by hand', () => {
  /** October 2026. NOW is the 24th, so the 26th is still to come. */
  const at = (day: number) => new Date(2026, 9, day, 12, 0, 0).getTime();

  /**
   * A range as the user picked it, both ends inclusive.
   *
   * `customTo` is exclusive — the SQL compares `<` against it — so a range
   * ending on the 21st is stored as ending on the 22nd. Getting this wrong
   * silently drops the last day of every range the user picks, which is the
   * one thing the calendar must never do.
   */
  const range = (firstDay: number, lastDay: number): TransactionFilter =>
    filter({
      datePreset: 'CUSTOM',
      customFrom: new Date(2026, 9, firstDay).getTime(),
      customTo: new Date(2026, 9, lastDay + 1).getTime(),
    });

  function seedDays(db: SqlDatabase) {
    for (const day of [18, 20, 21, 24]) {
      createManualTransaction(
        db,
        entry({ recipientName: `Shop ${day}`, amount: day * 100, occurredAt: at(day) }),
        NOW,
      );
    }
  }

  it('keeps both ends of the range the user picked', () => {
    const db = freshDb();
    seedDays(db);

    const rows = listTransactions(db, range(18, 21), NOW);
    expect(rows.map((row) => row.occurred_on)).toEqual([
      '2026-10-21',
      '2026-10-20',
      '2026-10-18',
    ]);
  });

  it('is one day when both ends are the same day', () => {
    const db = freshDb();
    seedDays(db);

    const rows = listTransactions(db, range(20, 20), NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.occurred_on).toBe('2026-10-20');
  });

  it('counts the same rows the list shows', () => {
    const db = freshDb();
    seedDays(db);

    expect(filterTotals(db, range(18, 21), NOW).count).toBe(3);
    expect(filterTotals(db, range(22, 23), NOW).count).toBe(0);
  });

  it('is left alone by the other filters it is combined with', () => {
    const db = freshDb();
    seedDays(db);
    createManualTransaction(
      db,
      entry({
        recipientName: 'Refund',
        amount: 5_000,
        transactionType: 'CREDIT',
        occurredAt: at(20),
      }),
      NOW,
    );

    const rows = listTransactions(db, { ...range(20, 20), type: 'DEBIT' }, NOW);
    expect(rows.map((row) => row.display_name)).toEqual(['Shop 20']);
  });

  it('knows the first and last day on record', () => {
    const db = freshDb();
    expect(transactionDateBounds(db)).toBeNull();

    seedDays(db);
    expect(transactionDateBounds(db)).toEqual({
      first: '2026-10-18',
      last: '2026-10-24',
    });
  });

  it('offers the days the rest of the filter would find something on', () => {
    const db = freshDb();
    const food = findCategoryBySystemKey(db, 'food')!;
    createManualTransaction(
      db,
      entry({ recipientName: 'Chai', amount: 3_000, categoryId: food.id, occurredAt: at(18) }),
      NOW,
    );
    createManualTransaction(
      db,
      entry({ recipientName: 'Bus', amount: 2_000, occurredAt: at(20) }),
      NOW,
    );

    const october = {
      from: new Date(2026, 9, 1).getTime(),
      to: new Date(2026, 10, 1).getTime(),
    };

    // The date part is dropped: asking which days to offer through the
    // window being chosen would answer only with days already chosen.
    expect(daysWithActivity(db, filter({ datePreset: 'TODAY' }), october, NOW)).toEqual(
      new Set(['2026-10-18', '2026-10-20']),
    );

    // Everything else the user has chosen still applies, so a dot means a
    // day worth tapping rather than a day that merely had something on it.
    expect(
      daysWithActivity(db, filter({ categories: [food.id] }), october, NOW),
    ).toEqual(new Set(['2026-10-18']));
  });
});

describe('what the date chip says', () => {
  const custom = (from: Date, toExclusive: Date): TransactionFilter =>
    filter({
      datePreset: 'CUSTOM',
      customFrom: from.getTime(),
      customTo: toExclusive.getTime(),
    });

  it('names the preset', () => {
    expect(dateFilterLabel(filter(), NOW)).toBe('This month');
    expect(dateFilterLabel(filter({ datePreset: 'ALL' }), NOW)).toBe('All time');
    expect(dateFilterLabel(filter({ datePreset: 'TODAY' }), NOW)).toBe('Today');
  });

  it('has nothing to name until a range is picked', () => {
    expect(dateFilterLabel(filter({ datePreset: 'CUSTOM' }), NOW)).toBe('Custom range');
  });

  it('names one day, not the two the range is stored as', () => {
    expect(
      dateFilterLabel(custom(new Date(2026, 9, 26), new Date(2026, 9, 27)), NOW),
    ).toBe('26 Oct');
  });

  it('says the month once when the range stays inside it', () => {
    expect(
      dateFilterLabel(custom(new Date(2026, 9, 1), new Date(2026, 9, 16)), NOW),
    ).toBe('1\u201315 Oct');
  });

  it('says both months when the range crosses one', () => {
    expect(
      dateFilterLabel(custom(new Date(2026, 10, 28), new Date(2026, 11, 6)), NOW),
    ).toBe('28 Nov \u2013 5 Dec');
  });

  it('adds the year only when the range leaves this one', () => {
    expect(
      dateFilterLabel(custom(new Date(2025, 11, 20), new Date(2026, 0, 4)), NOW),
    ).toBe('20 Dec 2025 \u2013 3 Jan 2026');
  });
});

describe('naming a direction after drilling in from a Home figure', () => {
  /** What Home hands over when a spending figure is tapped. */
  const fromHome = filter({ datePreset: 'ALL', spendingOnly: true });

  it('cannot be answered while the figure\'s definition is still on', () => {
    const db = freshDb();
    const paid = createManualTransaction(db, entry(), NOW);
    createManualTransaction(
      db,
      entry({ amount: 500_000, transactionType: 'CREDIT', recipientName: 'Karthik' }),
      NOW,
    );

    // `spendingOnly` adds a DEBIT of its own, so `Money in` asks for CREDIT
    // beside it and matches nothing, and `Both` goes on hiding the credit.
    // This is the state the chips were left in before `withType`.
    expect(listTransactions(db, { ...fromHome, type: 'CREDIT' }, NOW, 500)).toEqual([]);
    expect(
      listTransactions(db, { ...fromHome, type: 'BOTH' }, NOW, 500).map((row) => row.id),
    ).toEqual([paid.id]);
  });

  it('finds the money coming in once the direction is named', () => {
    const db = freshDb();
    const paid = createManualTransaction(db, entry(), NOW);
    const received = createManualTransaction(
      db,
      entry({ amount: 500_000, transactionType: 'CREDIT', recipientName: 'Karthik' }),
      NOW,
    );

    expect(
      listTransactions(db, withType(fromHome, 'CREDIT'), NOW, 500).map((row) => row.id),
    ).toEqual([received.id]);
    expect(
      listTransactions(db, withType(fromHome, 'BOTH'), NOW, 500)
        .map((row) => row.id)
        .sort(),
    ).toEqual([paid.id, received.id].sort());
  });

  it('changes the direction and that definition, and nothing else', () => {
    const narrowed = filter({
      datePreset: 'ALL',
      spendingOnly: true,
      hideFixedCosts: true,
      search: 'zepto',
    });

    expect(withType(narrowed, 'DEBIT')).toEqual({
      ...narrowed,
      type: 'DEBIT',
      spendingOnly: false,
    });
  });
});

describe('the search box', () => {
  function seedForSearch(db: SqlDatabase) {
    createManualTransaction(db, entry({ recipientName: 'Swiggy' }), NOW);
    createManualTransaction(db, entry({ recipientName: 'Ratnadeep' }), NOW);
    createManualTransaction(
      db,
      entry({ recipientName: 'Bank', note: '100% cashback' }),
      NOW,
    );
    createManualTransaction(db, entry({ recipientName: 'a_b stores' }), NOW);
    createManualTransaction(db, entry({ recipientName: 'axb stores' }), NOW);
  }

  it('treats a per-cent sign as a character, not as everything', () => {
    const db = freshDb();
    seedForSearch(db);

    // `%` is a wildcard to LIKE, so this used to match every payee, note and
    // UPI ID on record — a wrong answer with nothing on screen to explain it.
    const found = listTransactions(db, filter({ search: '%' }), NOW);

    expect(found).toHaveLength(1);
    expect(found[0]!.note).toBe('100% cashback');
  });

  it('treats an underscore as a character, not as any character', () => {
    const db = freshDb();
    seedForSearch(db);

    const found = listTransactions(db, filter({ search: 'a_b' }), NOW);

    expect(found.map((row) => row.display_name)).toEqual(['a_b stores']);
  });

  it('still finds a payee by part of the name', () => {
    const db = freshDb();
    seedForSearch(db);

    expect(listTransactions(db, filter({ search: 'swig' }), NOW)).toHaveLength(1);
    expect(listTransactions(db, filter({ search: 'stores' }), NOW)).toHaveLength(2);
  });
});
