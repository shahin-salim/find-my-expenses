/**
 * Section 8.4's payee rows, and the one place a name gets overwritten.
 *
 * A merchant can be created from a message that carried only a handle, in
 * which case its display name is the handle and the row is waiting for a real
 * name to arrive. Telling that row apart from one that already has a name is
 * the whole job, and testing it for an at-sign was the wrong question: shop
 * names carry those too.
 */

import { findMerchantById, findOrCreateMerchant } from '../merchants';
import { initializeDatabase } from '../../database';
import { openNodeDatabase } from '../../nodeSqlite';
import type { SqlDatabase } from '../../types';

const NOW = new Date(2026, 9, 24, 14, 30, 0).getTime();

function freshDb(): SqlDatabase {
  return initializeDatabase(openNodeDatabase(':memory:'), NOW);
}

describe('a name arriving after the handle', () => {
  it('fills in the real name on a row that is still showing a handle', () => {
    const db = freshDb();
    const first = findOrCreateMerchant(
      db,
      { recipientName: null, upiId: 'ccd@okicici' },
      NOW,
      NOW,
    )!.merchant;
    expect(first.display_name).toBe('ccd@okicici');

    findOrCreateMerchant(
      db,
      { recipientName: 'Cafe Coffee Day', upiId: 'ccd@okicici' },
      NOW,
      NOW,
    );

    expect(findMerchantById(db, first.id)!.display_name).toBe('Cafe Coffee Day');
  });

  it('does not overwrite a real name that happens to contain an at-sign', () => {
    const db = freshDb();
    // QR signage names like this are ordinary. Under the old at-sign test one
    // mis-parsed name — a sentence tail read as a payee — replaced it for
    // good, because there is nothing that puts it back.
    const first = findOrCreateMerchant(
      db,
      { recipientName: 'CAFE@MG ROAD', upiId: 'ccd@okicici' },
      NOW,
      NOW,
    )!.merchant;
    expect(first.display_name).toBe('CAFE@MG ROAD');

    findOrCreateMerchant(
      db,
      { recipientName: 'Payment', upiId: 'ccd@okicici' },
      NOW,
      NOW,
    );

    expect(findMerchantById(db, first.id)!.display_name).toBe('CAFE@MG ROAD');
  });

  it('leaves a name-keyed payee alone, having no handle to compare against', () => {
    const db = freshDb();
    const first = findOrCreateMerchant(
      db,
      { recipientName: 'Ratnadeep', upiId: null },
      NOW,
      NOW,
    )!.merchant;

    findOrCreateMerchant(db, { recipientName: 'Ratnadeep', upiId: null }, NOW, NOW);

    expect(findMerchantById(db, first.id)!.display_name).toBe('Ratnadeep');
  });
});
