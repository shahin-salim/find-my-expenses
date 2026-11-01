/**
 * Section 6, the location attached to a payment as its message arrives.
 *
 * "Historical transactions will not have location information" is the line
 * that shapes all of this. A scan reads forward from a watermark and can take
 * in a message from ten seconds ago and one from three days ago in the same
 * pass, so the question is never "where is the phone" but "which of these
 * payments is that the answer for".
 */

import { findTransactionById } from '../../db/dao/transactions';
import { getProfile, updateProfile } from '../../db/dao/profile';
import { initializeDatabase } from '../../db/database';
import { openNodeDatabase } from '../../db/nodeSqlite';
import type { SqlDatabase } from '../../db/types';
import type { LocationFix } from '../../transactions/ingest';
import { catchUpOnNewMessages } from '../catchUp';
import { fakeInbox, type InboxMessage } from './fakeInbox';

const NOW = new Date(2026, 9, 25, 17, 30, 0).getTime();
const MINUTE = 60_000;
const DAY = 86_400_000;

const BENGALURU: LocationFix = {
  latitude: 12.97159,
  longitude: 77.59457,
  label: null,
  capturedAt: NOW - 20_000,
};

function importedDb(watermark: number): SqlDatabase {
  const db = initializeDatabase(openNodeDatabase(':memory:'));
  updateProfile(
    db,
    { onboarding_completed: 1, import_status: 'COMPLETED', last_sms_scanned_at: watermark },
    NOW,
  );
  return db;
}

/** A payment. The reference has to differ, or section 3.2 dedups the pair. */
let reference = 912345678900;
const spend = (at: number, amount: string): InboxMessage => ({
  sender: 'AD-ICICIT-S',
  body:
    `ICICI Bank Acct XX903 debited for Rs ${amount} on 25-Oct-26; ` +
    `TEA STALL credited. UPI:${(reference += 1)}`,
  at,
});

/** An OTP: passes no gate, creates nothing. */
const otp = (at: number): InboxMessage => ({
  sender: 'AD-ICICIT-S',
  body: '452913 is your OTP for login. Do not share it with anyone.',
  at,
});

/** Counts how often the hardware was actually asked. */
function finder(fix: LocationFix | null) {
  const calls = { count: 0 };
  return {
    calls,
    locate: async () => {
      calls.count += 1;
      return fix;
    },
  };
}

describe('attaching a location to a new payment', () => {
  it('stamps the payment whose message has just arrived', async () => {
    const db = importedDb(NOW - 60 * MINUTE);
    const { locate, calls } = finder(BENGALURU);

    const outcome = await catchUpOnNewMessages(
      db,
      fakeInbox([spend(NOW - MINUTE, '10.00')]),
      NOW,
      { locate },
    );

    expect(calls.count).toBe(1);
    expect(outcome.located).toBe(1);

    const row = findTransactionById(db, 1)!;
    expect(row.latitude).toBeCloseTo(12.97159, 5);
    expect(row.longitude).toBeCloseTo(77.59457, 5);
    // When the fix was taken, not when the row was written: a fix the system
    // already held is older than the payment that borrowed it.
    expect(row.location_captured_at).toBe(NOW - 20_000);
  });

  it('leaves a backlog unstamped, and does not ask for a fix at all', async () => {
    // The phone was off for two days. These payments happened somewhere
    // else, and where the phone is standing now is not evidence about them.
    const db = importedDb(NOW - 3 * DAY);
    const { locate, calls } = finder(BENGALURU);

    const outcome = await catchUpOnNewMessages(
      db,
      fakeInbox([spend(NOW - 2 * DAY, '10.00'), spend(NOW - DAY, '20.00')]),
      NOW,
      { locate },
    );

    expect(outcome.created).toBe(2);
    expect(outcome.located).toBe(0);
    expect(calls.count).toBe(0);
    expect(findTransactionById(db, 1)!.latitude).toBeNull();
    expect(findTransactionById(db, 2)!.latitude).toBeNull();
  });

  it('asks once for a run, however many payments it created', async () => {
    const db = importedDb(NOW - 60 * MINUTE);
    const { locate, calls } = finder(BENGALURU);

    const outcome = await catchUpOnNewMessages(
      db,
      fakeInbox([spend(NOW - MINUTE, '10.00'), spend(NOW - 2 * MINUTE, '20.00')]),
      NOW,
      { locate },
    );

    expect(outcome.located).toBe(2);
    expect(calls.count).toBe(1);
  });

  it('never wakes the hardware for a message that was not a payment', async () => {
    const db = importedDb(NOW - 60 * MINUTE);
    const { locate, calls } = finder(BENGALURU);

    const outcome = await catchUpOnNewMessages(db, fakeInbox([otp(NOW - MINUTE)]), NOW, {
      locate,
    });

    expect(outcome.created).toBe(0);
    expect(calls.count).toBe(0);
  });

  it('never asks when the user has turned location off', async () => {
    const db = importedDb(NOW - 60 * MINUTE);
    updateProfile(db, { location_enabled: 0 }, NOW);
    const { locate, calls } = finder(BENGALURU);

    const outcome = await catchUpOnNewMessages(
      db,
      fakeInbox([spend(NOW - MINUTE, '10.00')]),
      NOW,
      { locate },
    );

    expect(outcome.created).toBe(1);
    expect(calls.count).toBe(0);
    expect(findTransactionById(db, 1)!.latitude).toBeNull();
    // The preference, not the permission: section 8.5 keeps the two apart.
    expect(getProfile(db).location_enabled).toBe(0);
  });

  it('still records the payment when there is no fix to be had', async () => {
    const db = importedDb(NOW - 60 * MINUTE);
    const { locate } = finder(null);

    const outcome = await catchUpOnNewMessages(
      db,
      fakeInbox([spend(NOW - MINUTE, '10.00')]),
      NOW,
      { locate },
    );

    expect(outcome.created).toBe(1);
    expect(outcome.located).toBe(0);
    expect(findTransactionById(db, 1)!.latitude).toBeNull();
  });

  it('does not move a payment that already has one', async () => {
    const db = importedDb(NOW - 60 * MINUTE);
    const inbox = fakeInbox([spend(NOW - MINUTE, '10.00')]);
    await catchUpOnNewMessages(db, inbox, NOW, { locate: finder(BENGALURU).locate });

    // The same message read again — the watermark is wound back by hand, the
    // way a re-import would. Section 3.1 drops the message, and the row it
    // already created keeps the place it was made in.
    updateProfile(db, { last_sms_scanned_at: NOW - 60 * MINUTE }, NOW);
    const elsewhere: LocationFix = {
      latitude: 19.07609,
      longitude: 72.87765,
      label: null,
      capturedAt: NOW,
    };
    await catchUpOnNewMessages(db, inbox, NOW, { locate: finder(elsewhere).locate });

    expect(findTransactionById(db, 1)!.latitude).toBeCloseTo(12.97159, 5);
  });
});
