/**
 * Section 5.3's gap: a rule added later reaching the merchants already there.
 */

import { findCategoryBySystemKey } from '../../db/dao/categories';
import { findMerchantById, setUserCategory } from '../../db/dao/merchants';
import { initializeDatabase } from '../../db/database';
import { openNodeDatabase } from '../../db/nodeSqlite';
import type { SqlDatabase } from '../../db/types';
import { createManualTransaction } from '../../transactions/manual';
import { applyRulesToExistingMerchants } from '../backfill';
import { categoryKeyForMerchantName } from '../categorize';
import { findOrCreateMerchant } from '../../db/dao/merchants';

const NOW = new Date(2026, 9, 25, 12, 0, 0).getTime();

function freshDb(): SqlDatabase {
  return initializeDatabase(openNodeDatabase(':memory:'));
}

function payTo(db: SqlDatabase, payee: string): number {
  const row = createManualTransaction(
    db,
    {
      amount: 10_000, transactionType: 'DEBIT', recipientName: payee,
      upiId: null, categoryId: null, accountId: null, occurredAt: NOW, note: null,
    },
    NOW,
  );
  return row.merchant_id!;
}

/** Puts a merchant back the way it was before the rule existed. */
function clearCategory(db: SqlDatabase, merchantId: number) {
  db.execute(
    `UPDATE merchants SET category_id = NULL, category_source = 'NONE' WHERE id = ?`,
    [merchantId],
  );
}

describe('reaching merchants that already exist', () => {
  it('categorises one the rules can now place', () => {
    const db = freshDb();
    const id = payTo(db, 'PALCO FUELS');
    clearCategory(db, id);

    const outcome = applyRulesToExistingMerchants(db, NOW);

    expect(outcome.categorised).toBe(1);
    expect(findMerchantById(db, id)!.category_id).toBe(
      findCategoryBySystemKey(db, 'fuel')!.id,
    );
    expect(findMerchantById(db, id)!.category_source).toBe('AUTO');
  });

  it('moves one an earlier rule placed wrongly', () => {
    const db = freshDb();
    const id = payTo(db, 'Lic Metro Station');
    // Pretend the old `LIC` rule had filed it as a transfer.
    db.execute(
      `UPDATE merchants SET category_id = ?, category_source = 'AUTO' WHERE id = ?`,
      [findCategoryBySystemKey(db, 'transfers')!.id, id],
    );

    const outcome = applyRulesToExistingMerchants(db, NOW);

    expect(outcome.moved).toBe(1);
    expect(findMerchantById(db, id)!.category_id).toBe(
      findCategoryBySystemKey(db, 'transport')!.id,
    );
  });

  it('never overrules a category the user chose', () => {
    const db = freshDb();
    const id = payTo(db, 'PALCO FUELS');
    const shopping = findCategoryBySystemKey(db, 'shopping')!;
    setUserCategory(db, id, shopping.id, NOW);

    applyRulesToExistingMerchants(db, NOW);

    const after = findMerchantById(db, id)!;
    expect(after.category_id).toBe(shopping.id);
    expect(after.category_source).toBe('USER');
  });

  it('changes nothing on a second run', () => {
    const db = freshDb();
    const id = payTo(db, 'PALCO FUELS');
    clearCategory(db, id);

    applyRulesToExistingMerchants(db, NOW);
    expect(applyRulesToExistingMerchants(db, NOW)).toEqual({ categorised: 0, moved: 0 });
  });

  it('leaves a merchant no rule matches alone', () => {
    const db = freshDb();
    const id = payTo(db, 'Imran Qureshi');

    applyRulesToExistingMerchants(db, NOW);

    expect(findMerchantById(db, id)!.category_id).toBeNull();
    expect(findMerchantById(db, id)!.category_source).toBe('NONE');
  });
});

describe('what the rules are allowed to read', () => {
  it('never matches against a UPI ID, the way ingestion never does', () => {
    const db = freshDb();
    // A payee seen only as a handle: section 8.4 falls `display_name` back to
    // the handle itself, and `normalized_name` stays empty because no message
    // ever gave a name.
    const merchant = findOrCreateMerchant(
      db,
      { recipientName: null, upiId: 'swiggy.stores@axb' },
      NOW,
      NOW,
    )!.merchant;
    expect(merchant.normalized_name).toBeNull();
    expect(merchant.display_name).toBe('swiggy.stores@axb');

    // Not a vacuous test: the rules really do match the text of that handle,
    // which is exactly why reading `display_name` was a bug and not a
    // harmless fallback.
    expect(categoryKeyForMerchantName('swiggy.stores@axb')).toBe('food');

    const outcome = applyRulesToExistingMerchants(db, NOW);

    // Section 5.2: "If the name is not found, or the message carried only a
    // UPI ID with no name, the merchant is created without a category."
    // `ingest.ts` leaves this payee alone; a pass that runs on every launch
    // and disagrees would file them one way when the message arrives and
    // another way the next morning.
    expect(outcome.categorised).toBe(0);
    expect(findMerchantById(db, merchant.id)!.category_id).toBeNull();
  });

  it('still categorises a payee that has a real name', () => {
    const db = freshDb();
    const id = payTo(db, 'SWIGGY');
    clearCategory(db, id);

    expect(applyRulesToExistingMerchants(db, NOW).categorised).toBe(1);
    expect(findMerchantById(db, id)!.category_id).not.toBeNull();
  });
});
