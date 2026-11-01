/**
 * Section 1.2, new messages arriving after the historical import.
 */

import { spendingTotal, today } from '../../analytics/spending';
import { getProfile, updateProfile } from '../../db/dao/profile';
import { countTransactions } from '../../db/dao/transactions';
import { unreadableCount } from '../../db/dao/smsMessages';
import { initializeDatabase } from '../../db/database';
import { openNodeDatabase } from '../../db/nodeSqlite';
import type { SqlDatabase } from '../../db/types';
import { catchUpOnNewMessages } from '../catchUp';
import { fakeInbox, type InboxMessage } from './fakeInbox';

const NOW = new Date(2026, 9, 25, 17, 30, 0).getTime();
const MINUTE = 60_000;

/** A database in the state the app is in once onboarding has finished. */
function importedDb(watermark: number): SqlDatabase {
  const db = initializeDatabase(openNodeDatabase(':memory:'));
  updateProfile(
    db,
    {
      onboarding_completed: 1,
      import_status: 'COMPLETED',
      last_sms_scanned_at: watermark,
    },
    NOW,
  );
  return db;
}

const spend = (at: number, amount: string): InboxMessage => ({
  sender: 'AD-ICICIT-S',
  body: `ICICI Bank Acct XX903 debited for Rs ${amount} on 25-Oct-26; TEA STALL credited. UPI:912345678901`,
  at,
});

describe('a message arriving after the import', () => {
  it('becomes a transaction and lands in today', async () => {
    const watermark = NOW - 60 * MINUTE;
    const db = importedDb(watermark);
    const inbox = fakeInbox([spend(NOW - MINUTE, '10.00')]);

    const outcome = await catchUpOnNewMessages(db, inbox, NOW);

    expect(outcome).toEqual({
      scanned: 1, created: 1, createdIds: [1], unreadable: 0, located: 0,
    });
    expect(countTransactions(db)).toBe(1);
    expect(spendingTotal(db, today(NOW))).toBe(1_000);
  });

  it('moves the watermark, so a second run does nothing', async () => {
    const db = importedDb(NOW - 60 * MINUTE);
    const inbox = fakeInbox([spend(NOW - MINUTE, '10.00')]);

    await catchUpOnNewMessages(db, inbox, NOW);
    expect(getProfile(db).last_sms_scanned_at).toBe(NOW - MINUTE);

    const again = await catchUpOnNewMessages(db, inbox, NOW);
    expect(again.created).toBe(0);
    expect(countTransactions(db)).toBe(1);
  });

  it('never reads a message the import already read', async () => {
    const watermark = NOW - 10 * MINUTE;
    const db = importedDb(watermark);
    // Older than the watermark: already seen during the import.
    const inbox = fakeInbox([spend(NOW - 30 * MINUTE, '99.00')]);

    const outcome = await catchUpOnNewMessages(db, inbox, NOW);
    expect(outcome.scanned).toBe(0);
    expect(countTransactions(db)).toBe(0);
  });

  it('is safe to run twice at once, because the key already exists', async () => {
    const db = importedDb(NOW - 60 * MINUTE);
    const inbox = fakeInbox([spend(NOW - MINUTE, '10.00')]);

    // Section 3.1 stops the second read before a transaction is built.
    await Promise.all([
      catchUpOnNewMessages(db, inbox, NOW),
      catchUpOnNewMessages(db, inbox, NOW),
    ]);
    expect(countTransactions(db)).toBe(1);
  });

  it('counts a credit as well as a debit', async () => {
    const db = importedDb(NOW - 60 * MINUTE);
    const inbox = fakeInbox([
      spend(NOW - 2 * MINUTE, '10.00'),
      {
        sender: 'JD-IDFCFB-S',
        body: 'Your A/C XXXXX528307 is credited with INR 500.00 on 25/10/26 17:00. Your new balance is INR 1,000.00.',
        at: NOW - MINUTE,
      },
    ]);

    await catchUpOnNewMessages(db, inbox, NOW);

    expect(countTransactions(db)).toBe(2);
    // Section 10: money coming in is never counted as spending.
    expect(spendingTotal(db, today(NOW))).toBe(1_000);
  });

  it('puts the gates in front of it, like the import does', async () => {
    const db = importedDb(NOW - 60 * MINUTE);
    const inbox = fakeInbox([
      {
        sender: 'AD-ICICIT-S',
        body: 'OTP for your txn of Rs.450 at SWIGGY is 847291. Do not share.',
        at: NOW - MINUTE,
      },
    ]);

    const outcome = await catchUpOnNewMessages(db, inbox, NOW);

    expect(outcome.created).toBe(0);
    expect(outcome.unreadable).toBe(0);
    expect(countTransactions(db)).toBe(0);
  });

  it('records a bank message it cannot read, for section 11.1', async () => {
    const db = importedDb(NOW - 60 * MINUTE);
    const inbox = fakeInbox([
      {
        sender: 'AD-ICICIT-S',
        body: 'ICICI Bank Card XX7004 has been debited. Call 18002662 if not you.',
        at: NOW - MINUTE,
      },
    ]);

    const outcome = await catchUpOnNewMessages(db, inbox, NOW);

    expect(outcome.unreadable).toBe(1);
    expect(unreadableCount(db)).toBe(1);
  });

  it('waits for the historical import to finish', async () => {
    const db = initializeDatabase(openNodeDatabase(':memory:'));
    updateProfile(db, { import_status: 'IN_PROGRESS' }, NOW);
    const inbox = fakeInbox([spend(NOW - MINUTE, '10.00')]);

    // Until the import has established where "already seen" ends, a scan
    // forward from nothing would read the whole year a second time.
    expect(await catchUpOnNewMessages(db, inbox, NOW)).toEqual({
      scanned: 0, created: 0, createdIds: [], unreadable: 0, located: 0,
    });
  });

  it('hands the payment over before it goes looking for a location', async () => {
    const db = importedDb(NOW - 60 * MINUTE);
    const inbox = fakeInbox([spend(NOW - MINUTE, '10.00')]);
    const order: string[] = [];

    await catchUpOnNewMessages(db, inbox, NOW, {
      onRecorded: (ids) => {
        order.push(`recorded ${ids.length}`);
      },
      locate: async () => {
        order.push('located');
        return null;
      },
    });

    // The question "what was this for" does not depend on where the user
    // was, and a fix can take twelve seconds of radio. Making the prompt
    // wait behind it only made it late — late enough that a service killed
    // in the meantime never asked at all.
    expect(order).toEqual(['recorded 1', 'located']);
  });

  it('says nothing about a scan that recorded nothing', async () => {
    const db = importedDb(NOW - 60 * MINUTE);
    const inbox = fakeInbox([
      {
        sender: 'AD-ICICIT-S',
        body: 'OTP for your txn of Rs.450 at SWIGGY is 847291. Do not share.',
        at: NOW - MINUTE,
      },
    ]);
    const recorded = jest.fn();

    await catchUpOnNewMessages(db, inbox, NOW, { onRecorded: recorded });

    expect(recorded).not.toHaveBeenCalled();
  });

  it('keeps the payment count on the profile honest', async () => {
    const db = importedDb(NOW - 60 * MINUTE);
    updateProfile(db, { transactions_found: 1_567 }, NOW);
    const inbox = fakeInbox([spend(NOW - MINUTE, '10.00')]);

    await catchUpOnNewMessages(db, inbox, NOW);
    expect(getProfile(db).transactions_found).toBe(1_568);
  });
});

describe('a window holding more messages than one run may read', () => {
  /**
   * `MAX_PER_RUN` payments and then some, a minute apart, each with its own
   * reference so none of them deduplicates against another.
   */
  const many = (count: number): InboxMessage[] =>
    Array.from({ length: count }, (_, index) => ({
      sender: 'AD-ICICIT-S',
      body:
        'ICICI Bank Acct XX903 debited for Rs 10.00 on 25-Oct-26; TEA STALL ' +
        `credited. UPI:9${String(index).padStart(11, '0')}`,
      at: NOW - (count - index) * MINUTE,
    }));

  it('leaves none of them behind the watermark', async () => {
    const db = importedDb(NOW - 500 * MINUTE);
    const inbox = fakeInbox(many(450));

    const first = await catchUpOnNewMessages(db, inbox, NOW);

    // The ceiling, and the oldest 400 rather than the newest 400.
    expect(first.scanned).toBe(400);
    expect(first.created).toBe(400);
    // Which puts the watermark on the 400th oldest message. The 50 newer
    // ones are still ahead of it. Moving it to the newest message in the
    // inbox instead — which is what reading newest first would have done —
    // would have buried all 50 permanently, with nothing recording that
    // they had never been read.
    expect(getProfile(db).last_sms_scanned_at).toBe(NOW - 51 * MINUTE);

    const second = await catchUpOnNewMessages(db, inbox, NOW);

    expect(second.created).toBe(50);
    expect(countTransactions(db)).toBe(450);
    expect(getProfile(db).last_sms_scanned_at).toBe(NOW - MINUTE);
  });

  it('counts every message it reads towards the ceiling, not every payment', async () => {
    const db = importedDb(NOW - 500 * MINUTE);
    // One payment, behind 450 one-time passwords. The sender gate runs
    // after the read, so the ceiling is reached by messages that were never
    // going to become anything.
    const noise: InboxMessage[] = Array.from({ length: 450 }, (_, index) => ({
      sender: 'VM-HDFCBK-S',
      body: `OTP for your txn is ${100000 + index}. Do not share.`,
      at: NOW - (460 - index) * MINUTE,
    }));
    const inbox = fakeInbox([...noise, ...many(1)]);

    const first = await catchUpOnNewMessages(db, inbox, NOW);

    expect(first.scanned).toBe(400);
    expect(first.created).toBe(0);
    // And the payment at the newest end is still waiting, rather than lost.
    const second = await catchUpOnNewMessages(db, inbox, NOW);
    expect(second.created).toBe(1);
    expect(countTransactions(db)).toBe(1);
  });
});

describe('where a payment happened', () => {
  const credit = (at: number): InboxMessage => ({
    sender: 'JD-IDFCFB-S',
    body: 'Your A/C XXXXX528307 is credited with INR 500.00 on 25/10/26 17:00. Your new balance is INR 1,000.00.',
    at,
  });

  const fix = async () => ({
    latitude: 12.9234010,
    longitude: 77.6123450,
    label: null,
    capturedAt: NOW,
  });

  const rows = (db: SqlDatabase) =>
    db.execute<{ transaction_type: string; latitude: number | null }>(
      'SELECT transaction_type, latitude FROM transactions ORDER BY id',
    ).rows;

  it('is recorded for money going out', async () => {
    const db = importedDb(NOW - 60 * MINUTE);
    const inbox = fakeInbox([spend(NOW - MINUTE, '10.00')]);

    const outcome = await catchUpOnNewMessages(db, inbox, NOW, { locate: fix });

    expect(outcome.located).toBe(1);
    expect(rows(db)[0]!.latitude).toBeCloseTo(12.9234010);
  });

  it('is not recorded for money coming in', async () => {
    const db = importedDb(NOW - 60 * MINUTE);
    const inbox = fakeInbox([credit(NOW - MINUTE)]);
    const locate = jest.fn(fix);

    const outcome = await catchUpOnNewMessages(db, inbox, NOW, { locate });

    expect(outcome.located).toBe(0);
    expect(rows(db)[0]!.latitude).toBeNull();
    // And the radio is never woken to find that out. A credit arrives from
    // wherever the payer sent it, so there is nothing here worth a fix.
    expect(locate).not.toHaveBeenCalled();
  });

  it('locates the debit and leaves the credit alone when both arrive', async () => {
    const db = importedDb(NOW - 60 * MINUTE);
    const inbox = fakeInbox([
      spend(NOW - 2 * MINUTE, '10.00'),
      credit(NOW - MINUTE),
    ]);

    const outcome = await catchUpOnNewMessages(db, inbox, NOW, { locate: fix });

    expect(outcome.located).toBe(1);
    // By type rather than by position: the window is read oldest first, so
    // the debit is the earlier row.
    const all = rows(db);
    const debit = all.find((row) => row.transaction_type === 'DEBIT')!;
    const received = all.find((row) => row.transaction_type === 'CREDIT')!;
    expect(debit.latitude).toBeCloseTo(12.9234010);
    expect(received.latitude).toBeNull();
  });
});
