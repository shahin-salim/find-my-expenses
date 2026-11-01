/**
 * Section 3.1, the message-level check: "It records what has already been
 * processed, so the same message is never read twice."
 *
 * It lives in `ingestMessage` because that is the one place the historical
 * import and the catch-up scan both go through. The import used to carry its
 * own set of what it had read, which is gone the moment the import is, and
 * the catch-up scan had nothing — it re-reads the message sitting exactly on
 * the watermark by design, and only the unique index on the dedup key stood
 * between that and a second copy of the payment.
 */

import { listAccounts } from '../../db/dao/accounts';
import { countTransactions } from '../../db/dao/transactions';
import { unreadableCount } from '../../db/dao/smsMessages';
import { initializeDatabase } from '../../db/database';
import { openNodeDatabase } from '../../db/nodeSqlite';
import type { SqlDatabase } from '../../db/types';
import type { RawSms } from '../../sms/types';
import { ingestMessage } from '../ingest';

const NOW = new Date(2026, 9, 25, 17, 30, 0).getTime();

const freshDb = (): SqlDatabase =>
  initializeDatabase(openNodeDatabase(':memory:'), NOW);

const payment: RawSms = {
  providerId: 4_001,
  senderId: 'AD-ICICIT-S',
  body:
    'ICICI Bank Acct XX903 debited for Rs 10.00 on 25-Oct-26; TEA STALL ' +
    'credited. UPI:912345678901',
  receivedAt: NOW - 60_000,
};

describe('a message that has already been read', () => {
  it('is skipped before it is parsed', () => {
    const db = freshDb();
    expect(ingestMessage(db, payment, { now: NOW }).kind).toBe('CREATED');

    const again = ingestMessage(db, payment, { now: NOW });

    expect(again.kind).toBe('SKIPPED_ALREADY_READ');
    expect(countTransactions(db)).toBe(1);
  });

  it('does not discover its account a second time', () => {
    const db = freshDb();
    ingestMessage(db, payment, { now: NOW });
    const after = listAccounts(db).length;

    ingestMessage(db, payment, { now: NOW });

    // The account scan and the payee lookup used to run again on every
    // re-read, writing nothing new but asking every question twice.
    expect(listAccounts(db).length).toBe(after);
  });

  it('is skipped whatever the message turned out to be the first time', () => {
    const db = freshDb();
    const otp: RawSms = {
      providerId: 4_002,
      senderId: 'AD-ICICIT-S',
      body: 'OTP for your txn of Rs.450 at SWIGGY is 847291. Do not share.',
      receivedAt: NOW - 60_000,
    };
    const unreadable: RawSms = {
      providerId: 4_003,
      senderId: 'AD-ICICIT-S',
      body: 'ICICI Bank Card XX7004 has been debited. Call 18002662 if not you.',
      receivedAt: NOW - 60_000,
    };

    expect(ingestMessage(db, otp, { now: NOW }).kind).toBe('IGNORED');
    expect(ingestMessage(db, unreadable, { now: NOW }).kind).toBe('UNREADABLE');

    expect(ingestMessage(db, otp, { now: NOW }).kind).toBe('SKIPPED_ALREADY_READ');
    expect(ingestMessage(db, unreadable, { now: NOW }).kind).toBe(
      'SKIPPED_ALREADY_READ',
    );
    // And the second look does not count the failure twice on the screen in
    // section 11.1.
    expect(unreadableCount(db)).toBe(1);
  });

  it('still lets a message through that was never recorded', () => {
    const db = freshDb();
    const notABank: RawSms = {
      providerId: 4_004,
      senderId: 'AX-ZOMATO',
      body: 'Your order has been picked up and is on its way.',
      receivedAt: NOW - 60_000,
    };

    // Gate one drops it before anything is written, so there is no row to
    // skip on and nothing to go stale.
    expect(ingestMessage(db, notABank, { now: NOW }).kind).toBe('IGNORED');
    expect(ingestMessage(db, notABank, { now: NOW }).kind).toBe('IGNORED');
  });
});
