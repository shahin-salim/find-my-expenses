/**
 * Section 12.1: what makes a transaction a lend, and section 12.6's figures.
 */

import { setUserCategory } from '../../db/dao/merchants';
import { createCategory } from '../../db/dao/categories';
import { setRepaid } from '../../db/dao/transactions';
import { findLend, listLends, lendingTotals } from '../lends';
import { attachRepayment } from '../repayments';
import {
  DAY,
  TODAY,
  addCredit,
  addLend,
  addTransaction,
  freshDb,
  lendCategoryId,
  merchantFor,
} from './helpers';

describe('what counts as a lend', () => {
  it('reads a debit in the Lend category as a lend', () => {
    const db = freshDb();
    addLend(db, 'Karthik', 200_000, 22, 'Trip advance');

    const { open } = listLends(db);
    expect(open).toHaveLength(1);
    expect(open[0]!.person).toBe('Karthik');
    expect(open[0]!.amount).toBe(200_000);
    expect(open[0]!.left).toBe(200_000);
    expect(open[0]!.note).toBe('Trip advance');
  });

  it('leaves an ordinary payment alone', () => {
    const db = freshDb();
    addTransaction(db, { amount: 50_000, person: 'A Shop' });

    expect(listLends(db).open).toHaveLength(0);
  });

  it('turns every payment to a payee into a lend when the payee is categorised', () => {
    const db = freshDb();
    const merchantId = merchantFor(db, 'Karthik');
    addTransaction(db, { amount: 100_000, merchantId, at: TODAY - 30 * DAY });
    addTransaction(db, { amount: 200_000, merchantId, at: TODAY - 20 * DAY });
    expect(listLends(db).open).toHaveLength(0);

    // Section 12.1: the payment borrows the payee's category, so one write
    // reaches every payment that has none of its own.
    setUserCategory(db, merchantId, lendCategoryId(db));

    expect(listLends(db).open).toHaveLength(2);
  });

  it('reads a category the user marked as tracking repayment, not only Lend', () => {
    const db = freshDb();
    // Section 8.2 lets the user keep a category per person they lend to.
    const own = createCategory(db, {
      name: 'Lent to Asha',
      icon: 'person',
      color: 'pink',
      tracksRepayment: true,
    });
    addTransaction(db, { amount: 75_000, person: 'Asha', categoryId: own.id });

    expect(listLends(db).open).toHaveLength(1);
  });

  it('refuses a credit, a deleted row and a payment in a foreign currency', () => {
    const db = freshDb();
    const lendId = lendCategoryId(db);
    addTransaction(db, { type: 'CREDIT', amount: 10_000, person: 'K', categoryId: lendId });
    addTransaction(db, { amount: 10_000, person: 'K2', categoryId: lendId, currency: 'USD' });
    const deleted = addLend(db, 'K3', 10_000);
    db.execute(`UPDATE transactions SET is_deleted = 1 WHERE id = ?`, [deleted.id]);

    expect(listLends(db).open).toHaveLength(0);
  });

  it('keeps a lend the user has acted on after it is recategorised away', () => {
    const db = freshDb();
    const lend = addLend(db, 'Karthik', 100_000);
    const credit = addCredit(db, 'Karthik', 40_000);
    attachRepayment(db, credit.id, lend.id, TODAY);

    // Section 12.7: a flag the user can no longer see is one they cannot undo.
    db.execute(`UPDATE transactions SET category_id = NULL, category_cleared = 1 WHERE id = ?`, [
      lend.id,
    ]);

    expect(findLend(db, lend.id)?.repaid).toBe(40_000);
  });
});

describe('what is left', () => {
  it('subtracts the credits attached to it', () => {
    const db = freshDb();
    const lend = addLend(db, 'Karthik', 200_000);
    for (const amount of [50_000, 30_000, 20_000]) {
      const credit = addCredit(db, 'Karthik', amount);
      attachRepayment(db, credit.id, lend.id, TODAY);
    }

    const row = findLend(db, lend.id)!;
    expect(row.repaid).toBe(100_000);
    expect(row.left).toBe(100_000);
    expect(row.repayment_count).toBe(3);
  });

  it('never goes below zero, and reports the excess as a surplus', () => {
    const db = freshDb();
    const lend = addLend(db, 'Karthik', 100_000);
    const credit = addCredit(db, 'Karthik', 150_000);
    attachRepayment(db, credit.id, lend.id, TODAY);

    const row = findLend(db, lend.id)!;
    expect(row.left).toBe(0);
    expect(row.surplus).toBe(50_000);
    expect(row.closed).toBe(true);
  });

  it('stops counting a repayment that was deleted', () => {
    const db = freshDb();
    const lend = addLend(db, 'Karthik', 100_000);
    const credit = addCredit(db, 'Karthik', 60_000);
    attachRepayment(db, credit.id, lend.id, TODAY);
    db.execute(`UPDATE transactions SET is_deleted = 1 WHERE id = ?`, [credit.id]);

    // Section 12.2's reason for not storing a running total.
    expect(findLend(db, lend.id)!.left).toBe(100_000);
  });
});

describe('the Lending page figures', () => {
  it('adds up what is left across the open lends only', () => {
    const db = freshDb();
    addLend(db, 'Karthik', 200_000, 22);
    addLend(db, 'Karthik', 200_000, 12);
    addLend(db, 'Ananya', 200_000, 12);
    const settled = addLend(db, 'Divya', 50_000, 19);
    setRepaid(db, settled.id, true, TODAY);

    const totals = lendingTotals(db);
    expect(totals.left).toBe(600_000);
    expect(totals.openLends).toBe(3);
    expect(totals.people).toBe(2);
  });

  it('sorts the closed ones into their own group', () => {
    const db = freshDb();
    addLend(db, 'Karthik', 100_000);
    const settled = addLend(db, 'Divya', 50_000);
    setRepaid(db, settled.id, true, TODAY);

    const { open, closed } = listLends(db);
    expect(open.map((lend) => lend.person)).toEqual(['Karthik']);
    expect(closed.map((lend) => lend.person)).toEqual(['Divya']);
  });

  it('is zero when nothing is out', () => {
    expect(lendingTotals(freshDb())).toEqual({ left: 0, openLends: 0, people: 0 });
  });
});

describe('a lend closed by hand', () => {
  it('has nothing left to get back, even with no repayments recorded', () => {
    const db = freshDb();
    const lend = addLend(db, 'Divya', 50_000, 19);
    // The payment screen's switch — section 12.3. No credit is attached.
    setRepaid(db, lend.id, true, TODAY);

    const row = findLend(db, lend.id)!;
    expect(row.closed).toBe(true);
    expect(row.left).toBe(0);
    expect(row.repaid).toBe(0);
    expect(row.repayment_count).toBe(0);
  });

  it('is kept out of the total left to get back', () => {
    const db = freshDb();
    addLend(db, 'Karthik', 100_000, 22);
    const settled = addLend(db, 'Divya', 50_000, 19);
    setRepaid(db, settled.id, true, TODAY);

    expect(lendingTotals(db).left).toBe(100_000);
  });
});
