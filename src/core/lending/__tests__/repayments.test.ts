/**
 * Sections 12.2, 12.3, 12.5 and 12.7: attaching money, closing a lend,
 * recording one by hand and editing it.
 */

import { movedMoneyTotal, spendingTotal, thisMonth } from '../../analytics/spending';
import { getCashAccount } from '../../db/dao/accounts';
import { findTransactionById, setRepaid } from '../../db/dao/transactions';
import { findLend, listLends, listRepayments } from '../lends';
import {
  attachRepayment,
  createCashLend,
  detachRepayment,
  recordCashRepayment,
  updateLend,
  validateCashLend,
} from '../repayments';
import { DAY, TODAY, addCredit, addLend, freshDb } from './helpers';

describe('attaching and taking off', () => {
  it('points a credit at a lend and brings down what is left', () => {
    const db = freshDb();
    const lend = addLend(db, 'Karthik', 200_000, 22);
    const credit = addCredit(db, 'Karthik', 100_000, 6);

    const result = attachRepayment(db, credit.id, lend.id, TODAY);

    expect(result).toMatchObject({ ok: true, closed: false });
    expect(findTransactionById(db, credit.id)!.repays_transaction_id).toBe(lend.id);
    expect(listRepayments(db, lend.id)).toHaveLength(1);
  });

  it('refuses a debit, a credit from before the lend, and the lend itself', () => {
    const db = freshDb();
    const lend = addLend(db, 'Karthik', 200_000, 10);
    const earlier = addCredit(db, 'Karthik', 50_000, 20);
    const debit = addLend(db, 'Rohan', 50_000, 2);

    expect(attachRepayment(db, debit.id, lend.id, TODAY)).toEqual({
      ok: false,
      reason: 'NOT_A_CREDIT',
    });
    expect(attachRepayment(db, earlier.id, lend.id, TODAY)).toEqual({
      ok: false,
      reason: 'BEFORE_THE_LEND',
    });
    expect(attachRepayment(db, lend.id, lend.id, TODAY)).toEqual({
      ok: false,
      reason: 'NOT_A_CREDIT',
    });
  });

  it('refuses a credit already attached to another lend', () => {
    const db = freshDb();
    const first = addLend(db, 'Karthik', 100_000, 22);
    const second = addLend(db, 'Karthik', 100_000, 20);
    const credit = addCredit(db, 'Karthik', 40_000, 2);
    attachRepayment(db, credit.id, first.id, TODAY);

    expect(attachRepayment(db, credit.id, second.id, TODAY)).toEqual({
      ok: false,
      reason: 'ALREADY_ATTACHED',
    });
  });

  it('gives the credit back and reopens the lend', () => {
    const db = freshDb();
    const lend = addLend(db, 'Divya', 50_000, 19);
    const credit = addCredit(db, 'Divya', 50_000, 16);
    attachRepayment(db, credit.id, lend.id, TODAY);
    expect(findLend(db, lend.id)!.closed).toBe(true);

    expect(detachRepayment(db, credit.id, TODAY)).toBe(lend.id);

    expect(findTransactionById(db, credit.id)!.repays_transaction_id).toBeNull();
    expect(findLend(db, lend.id)!.closed).toBe(false);
    expect(findLend(db, lend.id)!.left).toBe(50_000);
  });

  it('does nothing for a credit that was never attached', () => {
    const db = freshDb();
    const credit = addCredit(db, 'Karthik', 50_000);
    expect(detachRepayment(db, credit.id, TODAY)).toBeNull();
  });
});

describe('when a lend is closed', () => {
  it('closes only once the repayments cover the whole amount', () => {
    const db = freshDb();
    const lend = addLend(db, 'Karthik', 100_000, 22);

    attachRepayment(db, addCredit(db, 'Karthik', 40_000, 10).id, lend.id, TODAY);
    expect(findLend(db, lend.id)!.closed).toBe(false);

    attachRepayment(db, addCredit(db, 'Karthik', 60_000, 5).id, lend.id, TODAY);
    expect(findLend(db, lend.id)!.closed).toBe(true);
  });

  it('leaves a lend closed by hand alone when nothing is attached to it', () => {
    const db = freshDb();
    const lend = addLend(db, 'Karthik', 100_000, 22);
    // The payment screen's "Did this money come back?" switch — section 12.3.
    setRepaid(db, lend.id, true, TODAY);

    // An edit that recomputes closure must not undo it.
    updateLend(
      db,
      lend.id,
      { person: 'Karthik', amount: 100_000, occurredAt: TODAY - 22 * DAY, note: 'Trip' },
      TODAY,
    );

    expect(findLend(db, lend.id)!.closed).toBe(true);
  });

  it('keeps repaid_at in step with the repayments, both ways', () => {
    const db = freshDb();
    const lend = addLend(db, 'Karthik', 100_000, 22);
    const first = addCredit(db, 'Karthik', 100_000, 10);
    attachRepayment(db, first.id, lend.id, TODAY);
    expect(findTransactionById(db, lend.id)!.repaid_at).not.toBeNull();

    detachRepayment(db, first.id, TODAY);
    expect(findTransactionById(db, lend.id)!.repaid_at).toBeNull();
  });
});

describe('a lend and a repayment added by hand', () => {
  it('writes the lend as a cash payment in the Lend category', () => {
    const db = freshDb();
    const created = createCashLend(
      db,
      { person: 'Rohan', amount: 50_000, occurredAt: TODAY, note: 'Lunch' },
      TODAY,
    )!;

    expect(created.transaction_type).toBe('DEBIT');
    expect(created.source).toBe('MANUAL');
    expect(created.account_id).toBe(getCashAccount(db)!.id);
    expect(findLend(db, created.id)!.left).toBe(50_000);
  });

  it('sets the category on the payment, not on the person', () => {
    const db = freshDb();
    // Lending someone cash once must not make every payment to them a lend.
    const created = createCashLend(
      db,
      { person: 'Rohan', amount: 50_000, occurredAt: TODAY, note: null },
      TODAY,
    )!;
    const { rows } = db.execute<{ category_id: number | null }>(
      `SELECT category_id FROM merchants WHERE id = ?`,
      [created.merchant_id],
    );
    expect(rows[0]!.category_id).toBeNull();
  });

  it('refuses an empty name, nothing lent, and a date in the future', () => {
    const errors = validateCashLend(
      { person: '  ', amount: 0, occurredAt: TODAY + DAY, note: null },
      TODAY,
    );
    expect(Object.keys(errors).sort()).toEqual(['amount', 'occurredAt', 'person']);
  });

  it('records a cash repayment against the lend', () => {
    const db = freshDb();
    const lend = addLend(db, 'Karthik', 200_000, 22);

    const credit = recordCashRepayment(
      db,
      { lendId: lend.id, amount: 100_000, occurredAt: TODAY },
      TODAY,
    )!;

    expect(credit.transaction_type).toBe('CREDIT');
    expect(credit.repays_transaction_id).toBe(lend.id);
    expect(credit.account_id).toBe(getCashAccount(db)!.id);
    expect(findLend(db, lend.id)!.left).toBe(100_000);
  });

  it('never lets a repayment take more than the lend is owed', () => {
    const db = freshDb();
    const lend = addLend(db, 'Karthik', 100_000, 22);

    recordCashRepayment(db, { lendId: lend.id, amount: 500_000, occurredAt: TODAY }, TODAY);

    const row = findLend(db, lend.id)!;
    expect(row.repaid).toBe(100_000);
    expect(row.surplus).toBe(0);
    expect(row.closed).toBe(true);
  });
});

describe('editing a lend', () => {
  it('changes what is left without touching what came back', () => {
    const db = freshDb();
    const lend = addLend(db, 'Karthik', 200_000, 22, 'Trip advance');
    attachRepayment(db, addCredit(db, 'Karthik', 50_000, 10).id, lend.id, TODAY);

    updateLend(
      db,
      lend.id,
      { person: 'Karthik', amount: 120_000, occurredAt: TODAY - 22 * DAY, note: 'Trip' },
      TODAY,
    );

    const row = findLend(db, lend.id)!;
    expect(row.amount).toBe(120_000);
    expect(row.repaid).toBe(50_000);
    expect(row.left).toBe(70_000);
    expect(row.note).toBe('Trip');
  });

  it('closes the lend when the amount drops below what has come back', () => {
    const db = freshDb();
    const lend = addLend(db, 'Karthik', 200_000, 22);
    attachRepayment(db, addCredit(db, 'Karthik', 150_000, 10).id, lend.id, TODAY);

    updateLend(
      db,
      lend.id,
      { person: 'Karthik', amount: 100_000, occurredAt: TODAY - 22 * DAY, note: null },
      TODAY,
    );

    const row = findLend(db, lend.id)!;
    expect(row.left).toBe(0);
    expect(row.closed).toBe(true);
    expect(row.surplus).toBe(50_000);
  });

  it('will not rewrite the payee on a lend that came from a bank message', () => {
    const db = freshDb();
    // Section 12.7: the name is parse evidence, and changing it here would
    // move the payment onto a different payee entirely.
    const lend = addLend(db, 'Karthik', 200_000, 22);

    updateLend(
      db,
      lend.id,
      { person: 'Somebody Else', amount: 200_000, occurredAt: TODAY - 22 * DAY, note: null },
      TODAY,
    );

    expect(findLend(db, lend.id)!.person).toBe('Karthik');
  });

  it('does rewrite the person on a lend added by hand', () => {
    const db = freshDb();
    const created = createCashLend(
      db,
      { person: 'Rohan', amount: 50_000, occurredAt: TODAY - DAY, note: null },
      TODAY,
    )!;

    updateLend(
      db,
      created.id,
      { person: 'Rohan K', amount: 50_000, occurredAt: TODAY - DAY, note: null },
      TODAY,
    );

    expect(findLend(db, created.id)!.person).toBe('Rohan K');
  });

  it('refuses an amount of nothing', () => {
    const db = freshDb();
    const lend = addLend(db, 'Karthik', 200_000, 22);

    expect(
      updateLend(
        db,
        lend.id,
        { person: 'Karthik', amount: 0, occurredAt: TODAY - 22 * DAY, note: null },
        TODAY,
      ),
    ).toBeNull();
    expect(listLends(db).open[0]!.amount).toBe(200_000);
  });
});

describe('a lend that is already closed', () => {
  it('takes no further repayment', () => {
    const db = freshDb();
    const lend = addLend(db, 'Divya', 50_000, 19);
    setRepaid(db, lend.id, true, TODAY);

    // `left` is zero on a closed lend, so without a guard the clamp would
    // record a single paisa against it.
    expect(
      recordCashRepayment(db, { lendId: lend.id, amount: 10_000, occurredAt: TODAY }, TODAY),
    ).toBeNull();
    expect(listRepayments(db, lend.id)).toHaveLength(0);
  });
});

describe('what a repayment does to the rest of the app', () => {
  it('changes no spending figure, because a credit is never spending', () => {
    const db = freshDb();
    const lend = addLend(db, 'Karthik', 200_000, 2);
    const period = thisMonth(TODAY);

    const spentBefore = spendingTotal(db, period);
    const movedBefore = movedMoneyTotal(db, period);

    recordCashRepayment(db, { lendId: lend.id, amount: 120_000, occurredAt: TODAY }, TODAY);

    // The money arriving is a real row the user can see in their list, and
    // it still must not move a total. Section 12: lent money is not spending
    // and money coming back is not income.
    expect(spendingTotal(db, period)).toBe(spentBefore);
    expect(movedMoneyTotal(db, period)).toBe(movedBefore);
  });

  it('shows up as an ordinary credit in the transactions list', () => {
    const db = freshDb();
    const lend = addLend(db, 'Karthik', 200_000, 2);
    recordCashRepayment(db, { lendId: lend.id, amount: 120_000, occurredAt: TODAY }, TODAY);

    const credit = db.execute<{ id: number; transaction_type: string; amount: number }>(
      `SELECT id, transaction_type, amount FROM transactions
        WHERE repays_transaction_id = ?`,
      [lend.id],
    ).rows[0]!;

    expect(credit.transaction_type).toBe('CREDIT');
    expect(credit.amount).toBe(120_000);
  });
});

describe('a cash lend finds money already sent back', () => {
  it('runs the forward match itself, without the screen asking', () => {
    const db = freshDb();
    // Section 12.4 in the forward direction. The friend paid it back by UPI
    // days ago; the cash that went out is only being typed in now.
    const credit = addCredit(db, 'Rupesh', 50_000, 3);

    const lend = createCashLend(
      db,
      { person: 'Rupesh', amount: 50_000, occurredAt: TODAY - 10 * DAY, note: null },
      TODAY,
    )!;

    expect(findTransactionById(db, credit.id)!.repays_transaction_id).toBe(lend.id);
    expect(findLend(db, lend.id)).toMatchObject({ closed: true, left: 0 });
    // Closed by the match, inside the same transaction that wrote the lend —
    // so the row handed back already says so.
    expect(lend.repaid_at).not.toBeNull();
  });

  it('leaves a credit that arrived before the lend alone', () => {
    const db = freshDb();
    const credit = addCredit(db, 'Rupesh', 50_000, 20);

    const lend = createCashLend(
      db,
      { person: 'Rupesh', amount: 50_000, occurredAt: TODAY - 10 * DAY, note: null },
      TODAY,
    )!;

    expect(findTransactionById(db, credit.id)!.repays_transaction_id).toBeNull();
    expect(findLend(db, lend.id)).toMatchObject({ closed: false, left: 50_000 });
  });
});
