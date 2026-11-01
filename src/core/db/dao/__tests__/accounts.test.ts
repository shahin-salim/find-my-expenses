/**
 * Section 8.3, the one case that needs deciding: three digits meeting four.
 */

import { initializeDatabase } from '../../database';
import { openNodeDatabase } from '../../nodeSqlite';
import type { SqlDatabase } from '../../types';
import { listAccounts, upsertDiscoveredAccount } from '../accounts';
import type { DiscoveredAccount } from '../../../sms/types';

const NOW = new Date(2026, 9, 25, 12, 0, 0).getTime();

const freshDb = (): SqlDatabase =>
  initializeDatabase(openNodeDatabase(':memory:'), NOW);

const icici = (lastFour: string): DiscoveredAccount => ({
  bankName: 'ICICI Bank',
  bankKey: 'icici',
  lastFour,
  accountType: 'BANK',
});

/** Everything the bank gave us, ignoring the cash row the seed creates. */
const bankRows = (db: SqlDatabase) =>
  listAccounts(db).filter((row) => row.account_type !== 'CASH');

describe('one account that the bank describes two ways', () => {
  it('is one account when the three digit message came first', () => {
    const db = freshDb();
    upsertDiscoveredAccount(db, icici('172'), NOW);
    const second = upsertDiscoveredAccount(db, icici('6172'), NOW);

    expect(second.created).toBe(false);
    expect(bankRows(db)).toHaveLength(1);
  });

  it('is one account when the four digit message came first', () => {
    const db = freshDb();
    upsertDiscoveredAccount(db, icici('6172'), NOW);
    const second = upsertDiscoveredAccount(db, icici('172'), NOW);

    // This was the split. The import reads the inbox newest first, so the
    // shape the bank sent most recently is the one that creates the row —
    // and when that was the four digit one, the three digit message behind
    // it opened a second account for the same real account. The user saw
    // one account twice on Home with their spending divided between them.
    expect(second.created).toBe(false);
    expect(bankRows(db)).toHaveLength(1);
  });

  it('keeps two real accounts apart when three digits cannot tell them apart', () => {
    const db = freshDb();
    upsertDiscoveredAccount(db, icici('6172'), NOW);
    upsertDiscoveredAccount(db, icici('9172'), NOW);

    // Both end in 172. Folding the ambiguous message into either one would
    // file money against an account the user never paid from, so it gets a
    // row of its own — wrong in a way that is at least visible.
    const third = upsertDiscoveredAccount(db, icici('172'), NOW);

    expect(third.created).toBe(true);
    expect(bankRows(db)).toHaveLength(3);
  });

  it('does not reach across banks or across account types', () => {
    const db = freshDb();
    upsertDiscoveredAccount(db, icici('6172'), NOW);
    upsertDiscoveredAccount(db, { ...icici('172'), bankKey: 'sbi', bankName: 'SBI' }, NOW);
    upsertDiscoveredAccount(db, { ...icici('172'), accountType: 'CARD' }, NOW);

    expect(bankRows(db)).toHaveLength(3);
  });
});
