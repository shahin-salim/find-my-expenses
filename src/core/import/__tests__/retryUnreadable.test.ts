/**
 * Section 11.1: "When a later release adds the bank, those messages are read
 * again on their own and the payments appear in the user's history."
 */

import { getProfile } from '../../db/dao/profile';
import { listUnreadable, unreadableCount } from '../../db/dao/smsMessages';
import { initializeDatabase } from '../../db/database';
import type { TransactionRow } from '../../db/models';
import { openNodeDatabase } from '../../db/nodeSqlite';
import type { SqlDatabase } from '../../db/types';
import type { RawSms } from '../../sms/types';
import { runImport } from '../importer';
import { retryUnreadable } from '../retryUnreadable';
import { fakeInbox, type InboxMessage } from './fakeInbox';

const TODAY = new Date(2026, 9, 24, 14, 30, 0).getTime();
const DAY = 86_400_000;

/** The IDFC interest format, which `INR.` once made unreadable. */
const INTEREST: InboxMessage = {
  sender: 'JM-IDFCFB-S',
  body:
    'Monthly interest of INR.32.00 earned on your Savings A/c XX4614 has been ' +
    'credited to your A/C on 30/09/26. New bal: INR.1,80,109.09. IDFC FIRST Bank',
  at: TODAY - 24 * DAY,
};

/** A format no reader will ever understand, so it stays unreadable. */
const UNREADABLE: InboxMessage = {
  sender: 'JD-IDFCFB-S',
  body: 'Your A/c XX4614 has been debited. IDFC FIRST Bank',
  at: TODAY - 20 * DAY,
};

function freshDb(): SqlDatabase {
  return initializeDatabase(openNodeDatabase(':memory:'), TODAY);
}

function transactions(db: SqlDatabase): TransactionRow[] {
  return db.execute<TransactionRow>(`SELECT * FROM transactions`).rows;
}

/** Reads from the same inbox the import read, the way the device does. */
function inboxReader(messages: InboxMessage[]) {
  const all = fakeInbox(messages).all;
  return async (providerId: number): Promise<RawSms | null> =>
    all.find((sms) => sms.providerId === providerId) ?? null;
}

async function importAll(db: SqlDatabase, messages: InboxMessage[]) {
  return runImport(db, { source: fakeInbox(messages), now: () => TODAY, pageSize: 3 });
}

describe('retrying the unreadable messages', () => {
  it('turns a message the parser can now read into a transaction', async () => {
    const db = freshDb();
    const messages = [INTEREST, UNREADABLE];
    await importAll(db, messages);

    // Simulates the state a parser fix leaves behind: the message is already
    // recorded as a failure, so section 3.1 will never look at it again.
    db.execute(
      `UPDATE sms_messages SET parse_status = 'NO_MATCH', detail = 'NO_AMOUNT'
        WHERE provider_id = (SELECT provider_id FROM sms_messages
                              WHERE parse_status = 'PARSED' LIMIT 1)`,
    );
    db.execute(`DELETE FROM transactions`);
    expect(unreadableCount(db)).toBe(2);

    const outcome = await retryUnreadable(db, inboxReader(messages), () => TODAY);

    expect(outcome.checked).toBe(2);
    expect(outcome.recovered).toBe(1);
    expect(outcome.stillUnreadable).toBe(1);
    expect(outcome.missing).toBe(0);

    const rows = transactions(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe(3_200);
    expect(rows[0]!.transaction_type).toBe('CREDIT');

    // The one that is still unreadable stays listed, so the screen keeps it.
    expect(unreadableCount(db)).toBe(1);
    expect(listUnreadable(db)[0]!.sender_id).toBe('JD-IDFCFB-S');
  });

  it('counts a message deleted from the inbox without losing its row', async () => {
    const db = freshDb();
    await importAll(db, [UNREADABLE]);
    expect(unreadableCount(db)).toBe(1);

    const outcome = await retryUnreadable(db, async () => null, () => TODAY);

    expect(outcome).toEqual({
      checked: 1,
      recovered: 0,
      stillUnreadable: 0,
      missing: 1,
      settled: 0,
      unavailable: 0,
    });
    // Section 11.1: the row is still there with its bank and its date.
    expect(unreadableCount(db)).toBe(1);
  });

  it('tells a message it could not read apart from one the user deleted', async () => {
    const db = freshDb();
    await importAll(db, [UNREADABLE]);

    // SMS access revoked between opening the screen and pressing the button.
    const outcome = await retryUnreadable(
      db,
      async () => {
        throw new Error('READ_SMS has not been granted');
      },
      () => TODAY,
    );

    // Reported as deleted, it would have told the user their message was
    // gone from the inbox when nothing of the sort had happened.
    expect(outcome.missing).toBe(0);
    expect(outcome.unavailable).toBe(1);
    expect(unreadableCount(db)).toBe(1);
  });

  it('keeps its numbers adding up when a message is no longer a failure', async () => {
    const db = freshDb();
    await importAll(db, [UNREADABLE]);

    // The message comes back as something the gates now skip. The row
    // recording the failure is dropped either way, so if this went uncounted
    // the unreadable count would simply fall with nothing to explain it.
    const outcome = await retryUnreadable(
      db,
      async (providerId) => ({
        providerId,
        senderId: 'JD-IDFCFB-S',
        body: 'OTP for your txn of Rs.450 is 847291. Do not share.',
        receivedAt: TODAY - 1000,
      }),
      () => TODAY,
    );

    expect(outcome.settled).toBe(1);
    expect(
      outcome.recovered +
        outcome.stillUnreadable +
        outcome.missing +
        outcome.settled +
        outcome.unavailable,
    ).toBe(outcome.checked);
    expect(unreadableCount(db)).toBe(0);
  });

  it('adds what it recovered to the count the Home card shows', async () => {
    const db = freshDb();
    const messages = [INTEREST];
    await importAll(db, messages);

    db.execute(`UPDATE sms_messages SET parse_status = 'NO_MATCH', detail = 'NO_AMOUNT'`);
    db.execute(`DELETE FROM transactions`);
    const before = getProfile(db).transactions_found;

    await retryUnreadable(db, inboxReader(messages), () => TODAY);

    expect(getProfile(db).transactions_found).toBe(before + 1);
    expect(unreadableCount(db)).toBe(0);
  });
});
