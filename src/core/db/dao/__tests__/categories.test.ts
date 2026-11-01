/**
 * Section 8.2, categories.
 */

import { spendingTotal, today } from '../../../analytics/spending';
import { categoryKeyForMerchantName } from '../../../categorization/categorize';
import { createManualTransaction } from '../../../transactions/manual';
import { setRepaid } from '../transactions';
import { initializeDatabase } from '../../database';
import { openNodeDatabase } from '../../nodeSqlite';
import type { SqlDatabase } from '../../types';
import {
  archiveCategory,
  categoryNameInUse,
  categoryUsage,
  createCategory,
  findCategoryById,
  findCategoryBySystemKey,
  listCategories,
  unarchiveCategory,
  updateCategory,
} from '../categories';

const NOW = new Date(2026, 9, 25, 12, 0, 0).getTime();

function freshDb(): SqlDatabase {
  return initializeDatabase(openNodeDatabase(':memory:'));
}

function spend(db: SqlDatabase, payee: string, amount: number, categoryId: number | null) {
  createManualTransaction(
    db,
    {
      amount, transactionType: 'DEBIT', recipientName: payee,
      upiId: null, categoryId, accountId: null, occurredAt: NOW, note: null,
    },
    NOW,
  );
}

describe('creating one', () => {
  it('keeps the chosen icon, colour and flags', () => {
    const db = freshDb();
    const created = createCategory(
      db,
      { name: 'Travel trips', icon: 'pin', color: 'violet', excludedFromTotals: true },
      NOW,
    );

    expect(created.name).toBe('Travel trips');
    expect(created.icon).toBe('pin');
    expect(created.color).toBe('violet');
    expect(created.excluded_from_totals).toBe(1);
    // Section 8.2: a user-created category has no system key and can be
    // archived, unlike a built-in one.
    expect(created.system_key).toBeNull();
    expect(created.is_system).toBe(0);
  });

  it('sorts after everything already there', () => {
    const db = freshDb();
    const created = createCategory(db, { name: 'Travel', icon: 'pin', color: 'blue' }, NOW);
    const highest = Math.max(...listCategories(db).map((c) => c.sort_order));
    expect(created.sort_order).toBe(highest);
  });
});

describe('names', () => {
  it('will not take one already used, whatever the case', () => {
    const db = freshDb();
    expect(categoryNameInUse(db, 'Food & Dining')).toBe(true);
    expect(categoryNameInUse(db, 'food & dining')).toBe(true);
    expect(categoryNameInUse(db, 'Travel trips')).toBe(false);
  });

  it('does not count the category being edited as a clash with itself', () => {
    const db = freshDb();
    const food = findCategoryBySystemKey(db, 'food')!;
    expect(categoryNameInUse(db, 'Food & Dining', food.id)).toBe(false);
  });
});

describe('renaming a built-in category', () => {
  it('does not break the rules that point at it', () => {
    const db = freshDb();
    const food = findCategoryBySystemKey(db, 'food')!;

    updateCategory(db, food.id, { name: 'Eating out' }, NOW);

    const renamed = findCategoryById(db, food.id)!;
    expect(renamed.name).toBe('Eating out');
    // Section 8.2: the rules map to the key, never the display name.
    expect(renamed.system_key).toBe('food');
    expect(categoryKeyForMerchantName('Swiggy')).toBe('food');
    expect(findCategoryBySystemKey(db, 'food')!.id).toBe(food.id);
  });

  it('can be restyled and have its totals flag changed', () => {
    const db = freshDb();
    const food = findCategoryBySystemKey(db, 'food')!;

    updateCategory(db, food.id, { icon: 'star', color: 'red', isFixedCost: true }, NOW);

    const after = findCategoryById(db, food.id)!;
    expect(after.icon).toBe('star');
    expect(after.color).toBe('red');
    expect(after.is_fixed_cost).toBe(1);
  });
});

describe('archiving', () => {
  it('hides a user category from the pickers but keeps it resolving', () => {
    const db = freshDb();
    const travel = createCategory(db, { name: 'Travel', icon: 'pin', color: 'blue' }, NOW);
    spend(db, 'Airline', 50_000, travel.id);

    archiveCategory(db, travel.id, NOW);

    expect(listCategories(db).map((c) => c.id)).not.toContain(travel.id);
    expect(listCategories(db, true).map((c) => c.id)).toContain(travel.id);
    // The transaction keeps its name and colour, which is the whole point of
    // archiving rather than deleting.
    expect(findCategoryById(db, travel.id)!.name).toBe('Travel');
    expect(categoryUsage(db).get(travel.id)?.transactions).toBe(1);
  });

  it('refuses to archive a built-in category', () => {
    const db = freshDb();
    const food = findCategoryBySystemKey(db, 'food')!;

    archiveCategory(db, food.id, NOW);

    expect(findCategoryById(db, food.id)!.is_archived).toBe(0);
  });

  it('can be undone', () => {
    const db = freshDb();
    const travel = createCategory(db, { name: 'Travel', icon: 'pin', color: 'blue' }, NOW);
    archiveCategory(db, travel.id, NOW);
    unarchiveCategory(db, travel.id, NOW);
    expect(listCategories(db).map((c) => c.id)).toContain(travel.id);
  });
});

describe('usage', () => {
  it("counts what each category carries, through the merchant too", () => {
    const db = freshDb();
    const food = findCategoryBySystemKey(db, 'food')!;

    // Categorised through the merchant, not on the row — section 10.3's rule.
    spend(db, 'Swiggy', 30_000, null);

    expect(categoryUsage(db).get(food.id)).toEqual({
      category_id: food.id, transactions: 1, total: 30_000,
    });
  });

  it('totals the same money the Home screen totals', () => {
    const db = freshDb();
    const food = findCategoryBySystemKey(db, 'food')!;
    spend(db, 'A real lunch', 30_000, food.id);

    // Everything below is money the Home screen does not count, filed under
    // the same category. The figure here used to count all of it, so the two
    // screens gave two answers for one category.
    spend(db, 'Moved to my own account', 500_000, food.id);
    db.execute("UPDATE transactions SET is_transfer = 1 WHERE recipient_name = 'Moved to my own account'");
    spend(db, 'Reversed by the bank', 400_000, food.id);
    db.execute("UPDATE transactions SET is_refunded = 1 WHERE recipient_name = 'Reversed by the bank'");
    spend(db, 'Left out by the user', 300_000, food.id);
    db.execute("UPDATE transactions SET is_excluded = 1 WHERE recipient_name = 'Left out by the user'");
    // Section 8.1: a card used abroad reports its own currency and no rupee
    // figure, so 1180 here is 11.80 Singapore dollars and not 1,180 paise.
    spend(db, 'Dinner in Singapore', 1_180, food.id);
    db.execute("UPDATE transactions SET currency = 'SGD' WHERE recipient_name = 'Dinner in Singapore'");

    const usage = categoryUsage(db).get(food.id)!;

    expect(usage.total).toBe(30_000);
    expect(usage.total).toBe(spendingTotal(db, today(NOW)));
    // The count is deliberately not filtered: the edit screen uses it to say
    // how many payments are already filed under the category, and all five
    // are.
    expect(usage.transactions).toBe(5);
  });
});

describe('a release that changes the built-in categories', () => {
  /** An install made before the newest categories and flags existed. */
  function olderInstall(): SqlDatabase {
    const db = freshDb();
    // Put it back the way an earlier release left it: wrong order, the flag
    // that had not been invented yet, and the new categories missing.
    db.execute(`DELETE FROM categories WHERE system_key IN ('people','investment')`);
    db.execute(`UPDATE categories SET sort_order = 7 WHERE system_key = 'transfers'`);
    db.execute(`UPDATE categories SET excluded_from_totals = 0 WHERE system_key = 'investment'`);
    return db;
  }

  it('adds the categories the install never had', () => {
    const db = olderInstall();
    initializeDatabase(db, NOW);

    const keys = listCategories(db).map((c) => c.system_key);
    expect(keys).toContain('people');
    expect(keys).toContain('investment');
  });

  it('brings a flag the install predates into line', () => {
    const db = olderInstall();
    initializeDatabase(db, NOW);

    // Section 8.2's "leave out of spending totals", which did not exist on
    // the category when this install was made.
    expect(findCategoryBySystemKey(db, 'investment')!.excluded_from_totals).toBe(1);
  });

  it('repairs an order a new category collided with', () => {
    const db = olderInstall();
    initializeDatabase(db, NOW);

    const orders = listCategories(db).map((c) => c.sort_order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('never undoes a rename', () => {
    const db = olderInstall();
    const food = findCategoryBySystemKey(db, 'food')!;
    updateCategory(db, food.id, { name: 'Eating out', color: 'red' }, NOW);

    initializeDatabase(db, NOW);

    const after = findCategoryBySystemKey(db, 'food')!;
    expect(after.name).toBe('Eating out');
    // An edited row is left alone entirely, colour included.
    expect(after.color).toBe('red');
  });
});

describe('EMI', () => {
  /** A phone that was installed before EMI existed. */
  function beforeEmi(): SqlDatabase {
    const db = freshDb();
    db.execute(`DELETE FROM categories WHERE system_key = 'emi'`);
    // The order EMI was inserted into the middle of.
    db.execute(`UPDATE categories SET sort_order = 10 WHERE system_key = 'people'`);
    db.execute(`UPDATE categories SET sort_order = 16 WHERE system_key = 'others'`);
    return db;
  }

  it('reaches a phone that was set up before it existed', () => {
    const db = beforeEmi();
    expect(findCategoryBySystemKey(db, 'emi')).toBeNull();

    initializeDatabase(db, NOW);

    const emi = findCategoryBySystemKey(db, 'emi')!;
    expect(emi.name).toBe('EMI');
    expect(emi.is_system).toBe(1);
  });

  it('is a fixed cost, like rent and insurance', () => {
    const db = freshDb();
    const emi = findCategoryBySystemKey(db, 'emi')!;

    expect(emi.is_fixed_cost).toBe(1);
    // Not money that merely moved: an instalment has genuinely left, so it
    // stays inside the spending figures rather than dropping out of them.
    expect(emi.excluded_from_totals).toBe(0);
  });

  it('leaves everything after it with an order of its own', () => {
    const db = beforeEmi();
    initializeDatabase(db, NOW);

    const orders = listCategories(db).map((c) => c.sort_order);
    expect(new Set(orders).size).toBe(orders.length);
    // It belongs with the other recurring obligations rather than at the
    // end, which is where `MAX(sort_order) + 1` would have put it.
    const emi = findCategoryBySystemKey(db, 'emi')!;
    const others = findCategoryBySystemKey(db, 'others')!;
    expect(emi.sort_order).toBeLessThan(others.sort_order);
  });

  it('is left out of everyday spending, and counted in everything', () => {
    const db = freshDb();
    const emi = findCategoryBySystemKey(db, 'emi')!;
    spend(db, 'Bike loan', 650_000, emi.id);

    expect(spendingTotal(db, today(NOW), 'EVERYDAY')).toBe(0);
    expect(spendingTotal(db, today(NOW), 'EVERYTHING')).toBe(650_000);
  });
});

describe('Lend', () => {
  it('is money that has moved but not been spent', () => {
    const db = freshDb();
    const lend = findCategoryBySystemKey(db, 'lend')!;

    expect(lend.excluded_from_totals).toBe(1);
    // Not a fixed cost: those are still spending and come back under "All
    // spending" on Home. This is out of the figures altogether.
    expect(lend.is_fixed_cost).toBe(0);
  });

  it('keeps a loan to a friend out of the spending total', () => {
    const db = freshDb();
    const lend = findCategoryBySystemKey(db, 'lend')!;

    createManualTransaction(
      db,
      {
        amount: 500_000, transactionType: 'DEBIT', recipientName: 'Naveen T',
        upiId: null, categoryId: lend.id, accountId: null, occurredAt: NOW, note: null,
      },
      NOW,
    );
    spend(db, 'Swiggy', 30_000, null);

    expect(spendingTotal(db, today(NOW))).toBe(30_000);
  });

  it('is the only default category that asks whether the money came back', () => {
    const db = freshDb();

    expect(findCategoryBySystemKey(db, 'lend')!.tracks_repayment).toBe(1);
    // Not Investment, which is also money that moved rather than money spent
    // — but it is not coming back as the same rupees, and asking would be
    // asking the wrong question.
    expect(findCategoryBySystemKey(db, 'investment')!.tracks_repayment).toBe(0);
    expect(findCategoryBySystemKey(db, 'food')!.tracks_repayment).toBe(0);
  });

  it('drops out of every view once the money has come back', () => {
    const db = freshDb();
    const lend = findCategoryBySystemKey(db, 'lend')!;

    const loan = createManualTransaction(
      db,
      {
        amount: 500_000, transactionType: 'DEBIT', recipientName: 'Naveen T',
        upiId: null, categoryId: lend.id, accountId: null, occurredAt: NOW, note: null,
      },
      NOW,
    );
    spend(db, 'Swiggy', 30_000, null);

    // "Everything that left" is the one view a loan shows up in, because the
    // money did leave — until it comes back, at which point it did not.
    expect(spendingTotal(db, today(NOW), 'EVERYTHING')).toBe(530_000);

    setRepaid(db, loan.id, true, NOW);
    expect(spendingTotal(db, today(NOW), 'EVERYTHING')).toBe(30_000);

    // And undoing it puts the money back out there, for the user who tapped
    // the wrong row.
    setRepaid(db, loan.id, false, NOW);
    expect(spendingTotal(db, today(NOW), 'EVERYTHING')).toBe(530_000);
  });

  it('can be asked of any category the user marks that way', () => {
    const db = freshDb();
    // Someone who lends often wants a category per borrower rather than one
    // Lend bucket, and the question has to follow them there.
    const perPerson = createCategory(
      db,
      { name: 'Lent to Ravi', icon: 'person', color: 'pink', tracksRepayment: true },
      NOW,
    );

    expect(perPerson.tracks_repayment).toBe(1);

    const loan = createManualTransaction(
      db,
      {
        amount: 120_000, transactionType: 'DEBIT', recipientName: 'Ravi',
        upiId: null, categoryId: perPerson.id, accountId: null, occurredAt: NOW,
        note: null,
      },
      NOW,
    );

    expect(spendingTotal(db, today(NOW))).toBe(120_000);
    setRepaid(db, loan.id, true, NOW);
    expect(spendingTotal(db, today(NOW))).toBe(0);
  });
});
