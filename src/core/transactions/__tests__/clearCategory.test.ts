/**
 * Section 10.3's third case: a payment the user has deliberately left with
 * no category, and a payee category taken back.
 */

import { byCategory } from '../../analytics/breakdown';
import { thisWeek } from '../../analytics/spending';
import {
  categoryUsage,
  findCategoryBySystemKey,
} from '../../db/dao/categories';
import { clearUserCategory, setUserCategory } from '../../db/dao/merchants';
import {
  clearTransactionCategory,
  setTransactionCategory,
} from '../../db/dao/transactions';
import { initializeDatabase } from '../../db/database';
import { openNodeDatabase } from '../../db/nodeSqlite';
import type { SqlDatabase } from '../../db/types';
import {
  createManualTransaction,
  getTransactionDetail,
  updateManualTransaction,
  type ManualEntry,
} from '../manual';
import { DEFAULT_FILTER, listTransactions } from '../query';

const NOW = new Date(2026, 9, 24, 12, 0, 0).getTime();

function freshDb(): SqlDatabase {
  return initializeDatabase(openNodeDatabase(':memory:'));
}

function entry(overrides: Partial<ManualEntry> = {}): ManualEntry {
  return {
    amount: 100,
    transactionType: 'DEBIT',
    recipientName: 'DIVYA RAO',
    upiId: null,
    categoryId: null,
    accountId: null,
    occurredAt: NOW,
    note: null,
    ...overrides,
  };
}

/** A payee carrying a category, and two payments resolving through it. */
function payeeWithCategory(db: SqlDatabase) {
  const people = findCategoryBySystemKey(db, 'people')!;
  const first = createManualTransaction(db, entry({ amount: 100 }), NOW);
  const second = createManualTransaction(db, entry({ amount: 300_000 }), NOW);
  setUserCategory(db, first.merchant_id!, people.id);
  return { people, first: first.id, second: second.id, merchantId: first.merchant_id! };
}

describe('a payment that borrows its payee category', () => {
  it('cannot be left blank by clearing its own, which is the whole problem', () => {
    const db = freshDb();
    const { first, people } = payeeWithCategory(db);

    // NULL has always meant "ask the payee", so this is a no-op here.
    setTransactionCategory(db, first, null);

    expect(getTransactionDetail(db, first)!.resolved_category_id).toBe(people.id);
  });

  it('can be left blank outright, without touching the payee', () => {
    const db = freshDb();
    const { first, second, people } = payeeWithCategory(db);

    clearTransactionCategory(db, first);

    expect(getTransactionDetail(db, first)!.resolved_category_id).toBeNull();
    // The other payment to the same payee is untouched.
    expect(getTransactionDetail(db, second)!.resolved_category_id).toBe(people.id);
  });

  it('still knows what the payee carries, so the screen can say so', () => {
    const db = freshDb();
    const { first, people } = payeeWithCategory(db);
    clearTransactionCategory(db, first);

    const detail = getTransactionDetail(db, first)!;
    expect(detail.category_cleared).toBe(1);
    expect(detail.merchant_category_id).toBe(people.id);
    expect(detail.merchant_category_name).toBe('People');
  });

  it('goes back to following the payee when asked', () => {
    const db = freshDb();
    const { first, people } = payeeWithCategory(db);
    clearTransactionCategory(db, first);

    setTransactionCategory(db, first, null);

    expect(getTransactionDetail(db, first)!.resolved_category_id).toBe(people.id);
    expect(getTransactionDetail(db, first)!.category_cleared).toBe(0);
  });

  it('is not undone by picking a category afterwards', () => {
    const db = freshDb();
    const { first } = payeeWithCategory(db);
    const food = findCategoryBySystemKey(db, 'food')!;
    clearTransactionCategory(db, first);

    setTransactionCategory(db, first, food.id);

    expect(getTransactionDetail(db, first)!.resolved_category_id).toBe(food.id);
  });
});

describe('a cleared payment, everywhere else', () => {
  it('drops out of the breakdown rather than staying in its old slice', () => {
    const db = freshDb();
    const { first, second } = payeeWithCategory(db);
    clearTransactionCategory(db, first);

    const slices = byCategory(db, thisWeek(NOW), 'EVERYTHING');
    const people = slices.find((slice) => slice.label === 'People')!;
    const none = slices.find((slice) => slice.label === 'Uncategorised')!;

    // Only the payment that still resolves is counted under People.
    expect(people.total).toBe(300_000);
    expect(none.total).toBe(100);
    void second;
  });

  it('stops counting towards the category on the categories screen', () => {
    const db = freshDb();
    const { first, people } = payeeWithCategory(db);
    expect(categoryUsage(db).get(people.id)!.transactions).toBe(2);

    clearTransactionCategory(db, first);

    expect(categoryUsage(db).get(people.id)!.transactions).toBe(1);
  });

  it('is found by the Uncategorized filter in the list', () => {
    const db = freshDb();
    const { first } = payeeWithCategory(db);
    clearTransactionCategory(db, first);

    const rows = listTransactions(
      db,
      { ...DEFAULT_FILTER, onlyUncategorized: true },
      NOW,
    );
    expect(rows.map((row) => row.id)).toEqual([first]);
  });
});

describe('taking back a payee category', () => {
  it('loosens every payment that was resolving through it', () => {
    const db = freshDb();
    const { first, second, merchantId } = payeeWithCategory(db);

    clearUserCategory(db, merchantId);

    expect(getTransactionDetail(db, first)!.resolved_category_id).toBeNull();
    expect(getTransactionDetail(db, second)!.resolved_category_id).toBeNull();
  });

  it('leaves a payment that had a category of its own alone', () => {
    const db = freshDb();
    const { first, second, merchantId } = payeeWithCategory(db);
    const food = findCategoryBySystemKey(db, 'food')!;
    setTransactionCategory(db, second, food.id);

    clearUserCategory(db, merchantId);

    expect(getTransactionDetail(db, first)!.resolved_category_id).toBeNull();
    expect(getTransactionDetail(db, second)!.resolved_category_id).toBe(food.id);
  });

  it('is not undone by the rules on the next launch', () => {
    const db = freshDb();
    // A payee a rule would categorise, so the next launch has something to
    // try. `applyRulesToExistingMerchants` only fills in a merchant whose
    // source is NONE, which is why clearing leaves it at USER.
    const payment = createManualTransaction(db, entry({ recipientName: 'ZEPTO' }), NOW);
    const merchantId = payment.merchant_id!;
    expect(getTransactionDetail(db, payment.id)!.resolved_category_id).not.toBeNull();

    clearUserCategory(db, merchantId);
    initializeDatabase(db, NOW);

    expect(getTransactionDetail(db, payment.id)!.resolved_category_id).toBeNull();
  });
});

describe('a database made before any of this existed', () => {
  it('gains the column without losing a row', () => {
    const db = openNodeDatabase(':memory:');
    initializeDatabase(db, NOW);
    const { first } = payeeWithCategory(db);

    // Put it back the way an earlier release left it.
    db.execute(`CREATE TABLE t_backup AS SELECT * FROM transactions`);
    db.execute(`DROP TABLE transactions`);
    db.execute(
      `CREATE TABLE transactions (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         amount INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'INR',
         transaction_type TEXT NOT NULL, occurred_at INTEGER NOT NULL,
         occurred_on TEXT NOT NULL, merchant_id INTEGER, recipient_name TEXT,
         account_id INTEGER, category_id INTEGER, source TEXT NOT NULL,
         source_sms_id INTEGER, bank_sender_id TEXT, rrn TEXT, parser_id TEXT,
         dedup_key TEXT NOT NULL UNIQUE, latitude REAL, longitude REAL,
         location_label TEXT, location_captured_at INTEGER, note TEXT,
         is_transfer INTEGER NOT NULL DEFAULT 0,
         is_excluded INTEGER NOT NULL DEFAULT 0,
         is_refunded INTEGER NOT NULL DEFAULT 0,
         repaid_at INTEGER, is_deleted INTEGER NOT NULL DEFAULT 0,
         created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
       )`,
    );
    db.execute(
      `INSERT INTO transactions
         SELECT id, amount, currency, transaction_type, occurred_at, occurred_on,
                merchant_id, recipient_name, account_id, category_id, source,
                source_sms_id, bank_sender_id, rrn, parser_id, dedup_key,
                latitude, longitude, location_label, location_captured_at, note,
                is_transfer, is_excluded, is_refunded, repaid_at, is_deleted,
                created_at, updated_at
           FROM t_backup`,
    );
    db.execute(`DROP TABLE t_backup`);

    initializeDatabase(db, NOW);

    // The column is there, defaulted off, and the payments still resolve.
    const detail = getTransactionDetail(db, first)!;
    expect(detail.category_cleared).toBe(0);
    expect(detail.resolved_category_id).not.toBeNull();

    clearTransactionCategory(db, first);
    expect(getTransactionDetail(db, first)!.resolved_category_id).toBeNull();
  });
});

describe('editing a payment that was left deliberately blank', () => {
  it('takes the category the user picks, rather than swallowing it', () => {
    const db = freshDb();
    const food = findCategoryBySystemKey(db, 'food')!;
    const row = createManualTransaction(db, entry({ amount: 25_000 }), NOW);
    clearTransactionCategory(db, row.id, NOW);

    // The user opens the payment, edits it, and picks Food & Dining.
    updateManualTransaction(db, row.id, entry({ amount: 25_000, categoryId: food.id }), NOW);

    const after = getTransactionDetail(db, row.id)!;
    expect(after.category_id).toBe(food.id);
    // The mark outranks the column, so writing the column and leaving the
    // mark alone wrote an answer nothing would ever read: the payment stayed
    // uncategorised in front of a user who had just categorised it.
    expect(after.category_cleared).toBe(0);
    expect(after.resolved_category_id).toBe(food.id);
  });

  it('leaves it blank when the edit was about something else', () => {
    const db = freshDb();
    const { first, people } = payeeWithCategory(db);
    clearTransactionCategory(db, first, NOW);

    // Changing the amount, with the category field left empty. Leaving it
    // empty is not an answer, so the payee category must not creep back in.
    updateManualTransaction(db, first, entry({ amount: 900 }), NOW);

    const after = getTransactionDetail(db, first)!;
    expect(after.category_cleared).toBe(1);
    expect(after.resolved_category_id).toBeNull();
    void people;
  });
});
