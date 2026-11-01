/**
 * Section 12.4: attaching money that comes back to the lend it pays back.
 */

import { markMerchantAsSelf, setUserCategory } from '../../db/dao/merchants';
import { createManualTransaction } from '../../transactions/manual';
import { findLend, listLends } from '../lends';
import {
  matchCreditToLend,
  matchLendToCredits,
  matchLending,
  matchLendingForMerchant,
} from '../match';
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

describe('matching a credit to a lend', () => {
  it('attaches money back from the same payee', () => {
    const db = freshDb();
    const lend = addLend(db, 'Karthik', 200_000, 22);
    const credit = addCredit(db, 'Karthik', 100_000, 6);

    const match = matchCreditToLend(db, credit, TODAY);

    expect(match).toEqual({ creditId: credit.id, lendId: lend.id, closed: false });
    expect(findLend(db, lend.id)!.left).toBe(100_000);
  });

  it('closes the lend when the whole amount comes back', () => {
    const db = freshDb();
    const lend = addLend(db, 'Divya', 50_000, 19);
    const credit = addCredit(db, 'Divya', 50_000, 16);

    expect(matchCreditToLend(db, credit, TODAY)!.closed).toBe(true);
    expect(findLend(db, lend.id)!.closed).toBe(true);
  });

  it('matches on the payee, not on the UPI ID', () => {
    const db = freshDb();
    // The measured case: the debit carried a handle, the credit names the
    // sender and carries none. Section 8.4's identity key covers both.
    const merchantId = merchantFor(db, 'Karthik', 'karthik.v@okaxis');
    const lend = addTransaction(db, {
      amount: 200_000,
      merchantId,
      at: TODAY - 22 * DAY,
      categoryId: lendCategoryId(db),
    });
    const credit = addTransaction(db, {
      type: 'CREDIT',
      amount: 200_000,
      merchantId,
      at: TODAY - 4 * DAY,
    });

    expect(matchCreditToLend(db, credit, TODAY)?.lendId).toBe(lend.id);
  });

  it('never reaches a lend to somebody else', () => {
    const db = freshDb();
    addLend(db, 'Karthik', 200_000, 22);
    const credit = addCredit(db, 'Rohan', 200_000, 4);

    expect(matchCreditToLend(db, credit, TODAY)).toBeNull();
  });
});

describe('choosing between several open lends', () => {
  it('prefers the lend whose remainder the credit matches exactly', () => {
    const db = freshDb();
    const oldest = addLend(db, 'Karthik', 200_000, 22);
    const exact = addLend(db, 'Karthik', 80_000, 12);
    const credit = addCredit(db, 'Karthik', 80_000, 2);

    expect(matchCreditToLend(db, credit, TODAY)?.lendId).toBe(exact.id);
    expect(findLend(db, oldest.id)!.left).toBe(200_000);
  });

  it('falls back to the oldest when nothing matches exactly', () => {
    const db = freshDb();
    const oldest = addLend(db, 'Karthik', 200_000, 22);
    addLend(db, 'Karthik', 150_000, 12);
    const credit = addCredit(db, 'Karthik', 70_000, 2);

    expect(matchCreditToLend(db, credit, TODAY)?.lendId).toBe(oldest.id);
  });

  it('keeps a surplus on the lend rather than spreading it to the next', () => {
    const db = freshDb();
    const oldest = addLend(db, 'Karthik', 100_000, 22);
    const other = addLend(db, 'Karthik', 100_000, 12);
    const credit = addCredit(db, 'Karthik', 160_000, 2);

    matchCreditToLend(db, credit, TODAY);

    // Section 12.4: one credit, one lend. The schema cannot say otherwise.
    expect(findLend(db, oldest.id)!.closed).toBe(true);
    expect(findLend(db, oldest.id)!.surplus).toBe(60_000);
    expect(findLend(db, other.id)!.left).toBe(100_000);
  });

  it('ignores a lend that is already closed', () => {
    const db = freshDb();
    const first = addLend(db, 'Karthik', 100_000, 22);
    const second = addLend(db, 'Karthik', 100_000, 12);
    matchCreditToLend(db, addCredit(db, 'Karthik', 100_000, 8), TODAY);
    expect(findLend(db, first.id)!.closed).toBe(true);

    matchCreditToLend(db, addCredit(db, 'Karthik', 40_000, 2), TODAY);
    expect(findLend(db, second.id)!.repaid).toBe(40_000);
  });
});

describe('what cannot be a repayment', () => {
  it('refuses a credit that arrived before the money went out', () => {
    const db = freshDb();
    addLend(db, 'Karthik', 200_000, 10);
    const credit = addCredit(db, 'Karthik', 200_000, 20);

    expect(matchCreditToLend(db, credit, TODAY)).toBeNull();
  });

  it('refuses a credit with no payee the app could identify', () => {
    const db = freshDb();
    addLend(db, 'Karthik', 200_000, 22);
    const credit = addTransaction(db, {
      type: 'CREDIT',
      amount: 200_000,
      merchantId: null,
      at: TODAY - 2 * DAY,
    });

    expect(matchCreditToLend(db, credit, TODAY)).toBeNull();
  });

  it("refuses money arriving from one of the user's own accounts", () => {
    const db = freshDb();
    const merchantId = merchantFor(db, 'Karthik');
    addTransaction(db, {
      amount: 200_000,
      merchantId,
      at: TODAY - 22 * DAY,
      categoryId: lendCategoryId(db),
    });
    markMerchantAsSelf(db, merchantId, TODAY);
    const credit = addTransaction(db, {
      type: 'CREDIT',
      amount: 200_000,
      merchantId,
      at: TODAY - 2 * DAY,
    });

    expect(matchCreditToLend(db, credit, TODAY)).toBeNull();
  });

  it('refuses a credit already flagged as a transfer', () => {
    const db = freshDb();
    addLend(db, 'Karthik', 200_000, 22);
    const credit = addTransaction(db, {
      type: 'CREDIT',
      amount: 200_000,
      person: 'Karthik',
      at: TODAY - 2 * DAY,
      isTransfer: true,
    });

    expect(matchCreditToLend(db, credit, TODAY)).toBeNull();
  });

  it('refuses a reversal, which shares its reference with a payment', () => {
    const db = freshDb();
    addLend(db, 'Karthik', 200_000, 22);
    // Section 4.1 marks the debit refunded and leaves the credit unflagged,
    // so the shared reference is the only thing left to recognise it by.
    addTransaction(db, { amount: 200_000, person: 'Karthik', rrn: '556677889900', at: TODAY - 3 * DAY });
    const credit = addTransaction(db, {
      type: 'CREDIT',
      amount: 200_000,
      person: 'Karthik',
      rrn: '556677889900',
      at: TODAY - 3 * DAY,
    });

    expect(matchCreditToLend(db, credit, TODAY)).toBeNull();
  });

  it('refuses a credit that is already attached somewhere', () => {
    const db = freshDb();
    const first = addLend(db, 'Karthik', 100_000, 22);
    const second = addLend(db, 'Karthik', 100_000, 20);
    const credit = addCredit(db, 'Karthik', 40_000, 2);
    matchCreditToLend(db, credit, TODAY);

    const again = matchCreditToLend(db, { ...credit, repays_transaction_id: first.id }, TODAY);
    expect(again).toBeNull();
    expect(findLend(db, second.id)!.repaid).toBe(0);
  });
});

describe('matching the other way round', () => {
  it('finds money that came back before the payment was called a lend', () => {
    const db = freshDb();
    // The import reads newest first, and a payment can be categorised months
    // after the friend paid it back — section 12.4.
    const merchantId = merchantFor(db, 'Karthik');
    const lend = addTransaction(db, { amount: 200_000, merchantId, at: TODAY - 40 * DAY });
    addTransaction(db, { type: 'CREDIT', amount: 120_000, merchantId, at: TODAY - 30 * DAY });

    db.execute(`UPDATE transactions SET category_id = ? WHERE id = ?`, [
      lendCategoryId(db),
      lend.id,
    ]);
    const matches = matchLendToCredits(db, lend.id, TODAY);

    expect(matches).toHaveLength(1);
    expect(findLend(db, lend.id)!.left).toBe(80_000);
  });

  it('takes only as much as the lend is owed', () => {
    const db = freshDb();
    const merchantId = merchantFor(db, 'Karthik');
    const lend = addTransaction(db, {
      amount: 100_000,
      merchantId,
      at: TODAY - 40 * DAY,
      categoryId: lendCategoryId(db),
    });
    addTransaction(db, { type: 'CREDIT', amount: 100_000, merchantId, at: TODAY - 30 * DAY });
    addTransaction(db, { type: 'CREDIT', amount: 100_000, merchantId, at: TODAY - 20 * DAY });

    expect(matchLendToCredits(db, lend.id, TODAY)).toHaveLength(1);
  });

  it('offers every lend to a payee the credits that came back', () => {
    const db = freshDb();
    const merchantId = merchantFor(db, 'Karthik');
    addTransaction(db, { amount: 100_000, merchantId, at: TODAY - 40 * DAY });
    addTransaction(db, { amount: 60_000, merchantId, at: TODAY - 35 * DAY });
    addTransaction(db, { type: 'CREDIT', amount: 100_000, merchantId, at: TODAY - 20 * DAY });
    addTransaction(db, { type: 'CREDIT', amount: 60_000, merchantId, at: TODAY - 10 * DAY });

    // One category write creates both lends — section 12.1.
    setUserCategory(db, merchantId, lendCategoryId(db));
    matchLendingForMerchant(db, merchantId, TODAY);

    expect(listLends(db).open).toHaveLength(0);
    expect(listLends(db).closed).toHaveLength(2);
  });
});

describe('matching as part of writing a transaction', () => {
  it('attaches a repayment typed in by hand', () => {
    const db = freshDb();
    const lend = addLend(db, 'Karthik', 200_000, 22);

    createManualTransaction(
      db,
      {
        amount: 120_000,
        transactionType: 'CREDIT',
        recipientName: 'Karthik',
        upiId: null,
        categoryId: null,
        accountId: null,
        occurredAt: TODAY - DAY,
        note: null,
      },
      TODAY,
    );

    expect(findLend(db, lend.id)!.left).toBe(80_000);
  });

  it('does nothing when there is no lend to pay back', () => {
    const db = freshDb();
    const credit = addCredit(db, 'Karthik', 100_000);

    expect(matchLending(db, credit, TODAY)).toEqual([]);
  });
});
