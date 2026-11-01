import { listAccounts } from '../../db/dao/accounts';
import { findMerchantByIdentity } from '../../db/dao/merchants';
import { getProfile } from '../../db/dao/profile';
import { summarise } from '../../analytics/spending';
import { unreadableCount } from '../../db/dao/smsMessages';
import { initializeDatabase } from '../../db/database';
import type { MerchantRow, TransactionRow } from '../../db/models';
import { openNodeDatabase } from '../../db/nodeSqlite';
import type { SqlDatabase } from '../../db/types';
import { DEFAULT_FILTER, filterTotals } from '../../transactions/query';
import { runImport } from '../importer';
import { fakeInbox, type InboxMessage } from './fakeInbox';

/** 24 Oct 2026 14:30 local — the day the Home mockup shows. */
const TODAY = new Date(2026, 9, 24, 14, 30, 0).getTime();
const DAY = 86_400_000;

function freshDb(): SqlDatabase {
  return initializeDatabase(openNodeDatabase(':memory:'), TODAY);
}

async function importAll(db: SqlDatabase, messages: InboxMessage[]) {
  return runImport(db, {
    source: fakeInbox(messages),
    now: () => TODAY,
    pageSize: 3,
    progressWriteInterval: 2,
  });
}

function transactions(db: SqlDatabase): TransactionRow[] {
  return db.execute<TransactionRow>(
    `SELECT * FROM transactions ORDER BY occurred_at DESC, id DESC`,
  ).rows;
}

describe('stage one — find accounts', () => {
  // The worked example in section 1.1: four messages, three accounts.
  const FOUR_MESSAGES: InboxMessage[] = [
    {
      sender: 'AD-IDFCFB-S',
      body: 'Your A/c XXXXX528307 is debited by Rs.1.00 on 18-Oct-26. RRN 884051972336',
      at: TODAY - 6 * DAY,
    },
    {
      sender: 'JD-IDFCFB-S',
      body: 'Rs.500.00 credited to your A/c XX8307 on 18-Oct-26',
      at: TODAY - 6 * DAY + 1000,
    },
    {
      sender: 'AD-ICICIT-S',
      body: 'ICICI Bank Acct XX903 debited for Rs 1.00 on 19-Oct-26; Rohit Nair credited. UPI:302558741063',
      at: TODAY - 5 * DAY,
    },
    {
      sender: 'VM-HDFCBK-S',
      body: 'Rs.450 debited from A/c XX4821. Avl Bal Rs.45,230.',
      at: TODAY - 4 * DAY,
    },
  ];

  test('four messages produce three accounts, plus the cash row', async () => {
    const db = freshDb();
    await importAll(db, FOUR_MESSAGES);

    const accounts = listAccounts(db);
    expect(accounts.map((a) => [a.bank_key, a.last_four, a.account_type])).toEqual([
      // The two IDFC messages became one account: XXXXX528307 and XX8307
      // normalize to the same last four, and AD- and JD- both resolve to idfc.
      ['hdfc', '4821', 'BANK'],
      ['icici', '903', 'BANK'],
      ['idfc', '8307', 'BANK'],
      // Cash was there from installation, not found in a message.
      ['cash', '', 'CASH'],
    ]);

    // "The import screen reports this as 3 accounts found, counting what the
    // scan discovered rather than what the table holds."
    expect(getProfile(db).accounts_found).toBe(3);
  });

  test('the progress screen is told about each account as it is found', async () => {
    const db = freshDb();
    const stages: string[] = [];
    let highestAccountCount = 0;

    await runImport(db, {
      source: fakeInbox(FOUR_MESSAGES),
      now: () => TODAY,
      pageSize: 1,
      onProgress: (snapshot) => {
        stages.push(snapshot.stage);
        highestAccountCount = Math.max(highestAccountCount, snapshot.accounts.length);
        // Cash is never shown in the found-accounts list.
        expect(snapshot.accounts.every((a) => a.account_type !== 'CASH')).toBe(true);
      },
    });

    expect(stages).toContain('ACCOUNTS');
    expect(stages).toContain('TRANSACTIONS');
    expect(highestAccountCount).toBe(3);
    expect(getProfile(db).messages_total).toBe(4);
  });
});

describe('stage two — build transactions', () => {
  test('writes the payments and leaves the rest alone', async () => {
    const db = freshDb();
    await importAll(db, [
      {
        sender: 'VM-HDFCBK-S',
        body: 'Rs.386.00 debited from A/c XX4821 on 24-Oct-26 to swiggy.stores@axb (UPI Ref No 429813770512)',
        at: TODAY - 3600_000,
      },
      {
        sender: 'HD-HDFCBK',
        body: 'OTP for your txn of Rs.450 at SWIGGY is 847291. Do not share.',
        at: TODAY - 7200_000,
      },
      {
        sender: 'VM-HDFCBK-S',
        body: 'Avl Bal in your A/c XX4821 is Rs.45,230.00 as on 24-Oct-26.',
        at: TODAY - 7300_000,
      },
      {
        sender: 'AX-AMZNIN',
        body: 'Your order of Rs.1,899 has been shipped.',
        at: TODAY - 7400_000,
      },
    ]);

    const rows = transactions(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe(38_600);
    expect(rows[0]!.transaction_type).toBe('DEBIT');
    expect(getProfile(db).transactions_found).toBe(1);

    // The OTP and the balance alert are recorded so they are never read again,
    // but neither is a failure and neither shows up as unreadable.
    const recorded = db.execute<{ parse_status: string; count: number }>(
      `SELECT parse_status, COUNT(*) AS count FROM sms_messages GROUP BY parse_status`,
    ).rows;
    expect(recorded).toEqual(
      expect.arrayContaining([
        { parse_status: 'PARSED', count: 1 },
        { parse_status: 'IGNORED', count: 2 },
      ]),
    );
    // The non-bank message was never recorded at all.
    expect(db.execute(`SELECT * FROM sms_messages`).rows).toHaveLength(3);
    expect(unreadableCount(db)).toBe(0);
  });

  test('categorizes the merchant, and the category applies to every payment from it', async () => {
    const db = freshDb();
    await importAll(db, [
      {
        sender: 'VM-HDFCBK-S',
        body: 'Rs.386.00 debited from A/c XX4821 on 24-Oct-26 to swiggy.stores@axb (UPI Ref No 429813770512)',
        at: TODAY - 3600_000,
      },
      {
        sender: 'VM-HDFCBK-S',
        body: 'Rs.640.00 debited from A/c XX4821 on 23-Oct-26 to swiggy.stores@axb (UPI Ref No 429813770513)',
        at: TODAY - DAY,
      },
    ]);

    const merchant = findMerchantByIdentity(db, 'upi:swiggy.stores@axb')!;
    expect(merchant).toBeTruthy();

    // Section 5.2: the message carried only a UPI ID and no name, so there is
    // nothing for the rules to match on and the merchant is left for the user.
    // This is what the Transactions screen shows as "Needs a category".
    expect(merchant.category_source).toBe('NONE');
    expect(merchant.category_id).toBeNull();

    // One merchant row for both payments, so categorizing it once covers both.
    expect(transactions(db)).toHaveLength(2);
    expect(
      new Set(transactions(db).map((t) => t.merchant_id)),
    ).toEqual(new Set([merchant.id]));
  });

  test('a named merchant is categorized automatically', async () => {
    const db = freshDb();
    await importAll(db, [
      {
        sender: 'AD-IDFCFB-S',
        body: 'Your A/c XX8307 debited by Rs. 1,172.06 on 23/10/26; REDBUS credited. RRN 060649915527.',
        at: TODAY - DAY,
      },
    ]);

    const merchant = db.execute<MerchantRow>(
      `SELECT * FROM merchants WHERE display_name = 'REDBUS'`,
    ).rows[0]!;
    expect(merchant.category_source).toBe('AUTO');

    const category = db.execute<{ system_key: string }>(
      `SELECT system_key FROM categories WHERE id = ?`,
      [merchant.category_id],
    ).rows[0]!;
    expect(category.system_key).toBe('transport');
  });
});

describe('deduplication', () => {
  test('one payment reported twice is stored once', async () => {
    const db = freshDb();
    await importAll(db, [
      // The account alert and the card alert for the same purchase, worded
      // differently but carrying the same reference.
      {
        sender: 'VM-HDFCBK-S',
        body: 'Rs.1,899.00 debited from A/c XX4821 on 23-Oct-26 to MYNTRA (UPI Ref No 555666777888)',
        at: TODAY - DAY,
      },
      {
        sender: 'HD-HDFCBK',
        body: 'Rs.1,899.00 spent on HDFC Bank Card x4821 at MYNTRA on 23-Oct-26. Ref 555666777888',
        at: TODAY - DAY + 30_000,
      },
    ]);

    expect(transactions(db)).toHaveLength(1);
  });

  test('running the import twice changes nothing', async () => {
    const messages: InboxMessage[] = [
      {
        sender: 'VM-HDFCBK-S',
        body: 'Rs.386.00 debited from A/c XX4821 on 24-Oct-26 to SWIGGY (UPI Ref No 429813770512)',
        at: TODAY - 3600_000,
      },
      {
        sender: 'AD-AXISBK',
        body: 'INR 410.00 debited from A/c no. XX589034 on UBER 23-10-2026 20:55:00 IST. Avl bal: INR 98919.81.',
        at: TODAY - DAY,
      },
    ];

    const db = freshDb();
    await importAll(db, messages);
    const first = transactions(db);

    // A reinstall, or an import that runs a second time — section 3.1.
    await importAll(db, messages);
    expect(transactions(db)).toEqual(first);
  });

  test('two identical fares in one day are both kept', async () => {
    const db = freshDb();
    await importAll(db, [
      // Axis carries no reference number, so these fall back to the
      // account/amount/minute key. Different minutes, two transactions.
      {
        sender: 'AD-AXISBK',
        body: 'INR 45.00 debited from A/c no. XX589034 on NAMMA METRO 24-10-2026 09:10:00 IST.',
        at: TODAY - 5 * 3600_000,
      },
      {
        sender: 'AD-AXISBK',
        body: 'INR 45.00 debited from A/c no. XX589034 on NAMMA METRO 24-10-2026 18:40:00 IST.',
        at: TODAY - 1 * 3600_000,
      },
    ]);

    expect(transactions(db)).toHaveLength(2);
  });
});

describe('refunds and reversals, section 4', () => {
  test('a credit returning to the same account marks the debit refunded', async () => {
    const db = freshDb();
    await importAll(db, [
      {
        sender: 'VM-HDFCBK-S',
        body: 'Rs.500.00 debited from A/c XX4821 on 20-Oct-26 to SOME MERCHANT (UPI Ref No 999888777666)',
        at: TODAY - 4 * DAY,
      },
      {
        sender: 'VM-HDFCBK-S',
        body: 'Your payment of Rs.500.00 to SOME MERCHANT has failed. Rs.500.00 has been credited back to your A/c XX4821 on 20-Oct-26. UPI Ref No 999888777666',
        at: TODAY - 4 * DAY + 3600_000,
      },
    ]);

    const rows = transactions(db);
    expect(rows).toHaveLength(2);

    const debit = rows.find((r) => r.transaction_type === 'DEBIT')!;
    const credit = rows.find((r) => r.transaction_type === 'CREDIT')!;

    // "The original transaction is marked as refunded and stops counting as
    // spending. The credit is kept as a transaction of its own."
    expect(debit.is_refunded).toBe(1);
    expect(credit.is_refunded).toBe(0);
    expect(debit.is_transfer).toBe(0);
  });

  test('a reversal moves neither figure in the header', async () => {
    const db = freshDb();
    await importAll(db, [
      {
        sender: 'VM-HDFCBK-S',
        body: 'Rs.500.00 debited from A/c XX4821 on 20-Oct-26 to SOME MERCHANT (UPI Ref No 999888777666)',
        at: TODAY - 4 * DAY,
      },
      {
        sender: 'VM-HDFCBK-S',
        body: 'Your payment of Rs.500.00 to SOME MERCHANT has failed. Rs.500.00 has been credited back to your A/c XX4821 on 20-Oct-26. UPI Ref No 999888777666',
        at: TODAY - 4 * DAY + 3600_000,
      },
    ]);

    const totals = filterTotals(db, DEFAULT_FILTER, TODAY);

    // The payment never happened, so nothing was spent — section 4 — and the
    // money coming straight back for it is not income either. The credit
    // carries no flag of its own by design, so this is the half that used to
    // be counted: the header reported ₹500 received against a payment it was
    // already not counting as spent.
    expect(totals.out).toBe(0);
    expect(totals.in).toBe(0);
    // Both rows are still there and still shown. How many transactions the
    // filter matched is a different question from what they came to.
    expect(totals.count).toBe(2);
  });

  test('ordinary money in is still money in', async () => {
    // The guard above must not reach a credit that is nobody's reversal.
    const db = freshDb();
    await importAll(db, [
      {
        sender: 'JD-IDFCFB-S',
        body: 'Rs.500.00 credited to your A/c XX8307 on 18-Oct-26',
        at: TODAY - 6 * DAY,
      },
    ]);

    expect(filterTotals(db, DEFAULT_FILTER, TODAY).in).toBe(50_000);
  });

  test('the match works when the credit is read first', async () => {
    // The historical import reads messages newest first, so during import the
    // reversal is seen before the payment it reverses.
    const db = freshDb();
    await importAll(db, [
      {
        sender: 'VM-HDFCBK-S',
        body: 'Rs.500.00 debited from A/c XX4821 on 20-Oct-26 to SOME MERCHANT (UPI Ref No 111222333444)',
        at: TODAY - 4 * DAY,
      },
      {
        sender: 'VM-HDFCBK-S',
        body: 'Rs.500.00 has been credited back to your A/c XX4821 on 20-Oct-26. UPI Ref No 111222333444',
        at: TODAY - 4 * DAY + 60_000,
      },
    ]);

    const debit = transactions(db).find((r) => r.transaction_type === 'DEBIT')!;
    expect(debit.is_refunded).toBe(1);
  });

  test('a reference that comes round a year later is not treated as a reversal', async () => {
    const db = freshDb();
    await importAll(db, [
      {
        sender: 'VM-HDFCBK-S',
        body: 'Rs.500.00 debited from A/c XX4821 on 25-Oct-25 to SOME MERCHANT (UPI Ref No 777777777777)',
        at: TODAY - 364 * DAY,
      },
      {
        sender: 'VM-HDFCBK-S',
        body: 'Rs.500.00 credited to your A/c XX4821 on 24-Oct-26. UPI Ref No 777777777777',
        at: TODAY - 3600_000,
      },
    ]);

    const debit = transactions(db).find((r) => r.transaction_type === 'DEBIT')!;
    // Section 4.3: "a payment the user saw and accepted a year ago quietly
    // stops counting as spending" is the bug the time window closes.
    expect(debit.is_refunded).toBe(0);
  });
});

describe('transfers between the users own accounts, section 8.4', () => {
  test('one reference across two accounts marks both halves and the payee', async () => {
    const db = freshDb();
    await importAll(db, [
      {
        sender: 'AD-ICICIT-S',
        body: 'ICICI Bank Acct XX903 debited for Rs 5,000.00 on 19-Oct-26; Rohit Nair credited. UPI:884051972336',
        at: TODAY - 5 * DAY,
      },
      {
        sender: 'AD-IDFCFB-S',
        body: 'Rs.5,000.00 credited to your A/c XX8307 on 19-Oct-26. RRN 884051972336',
        at: TODAY - 5 * DAY + 120_000,
      },
    ]);

    const rows = transactions(db);
    expect(rows).toHaveLength(2);
    // Neither half is spending, and neither is income.
    expect(rows.every((r) => r.is_transfer === 1)).toBe(true);
    expect(rows.every((r) => r.is_refunded === 0)).toBe(true);

    // The flag is set on the merchant too, so later payments to the same payee
    // are recognised without needing a second match.
    const merchant = db.execute<MerchantRow>(
      `SELECT * FROM merchants WHERE display_name = 'Rohit Nair'`,
    ).rows[0]!;
    expect(merchant.is_self).toBe(1);
  });

  test('a later payment to a payee already known to be the user is a transfer', async () => {
    const db = freshDb();
    await importAll(db, [
      {
        sender: 'AD-ICICIT-S',
        body: 'ICICI Bank Acct XX903 debited for Rs 5,000.00 on 19-Oct-26; Rohit Nair credited. UPI:884051972336',
        at: TODAY - 5 * DAY,
      },
      {
        sender: 'AD-IDFCFB-S',
        body: 'Rs.5,000.00 credited to your A/c XX8307 on 19-Oct-26. RRN 884051972336',
        at: TODAY - 5 * DAY + 120_000,
      },
      {
        // Weeks later, and this time only one side has a message.
        sender: 'AD-ICICIT-S',
        body: 'ICICI Bank Acct XX903 debited for Rs 2,000.00 on 24-Oct-26; Rohit Nair credited. UPI:884051972388',
        at: TODAY - 3600_000,
      },
    ]);

    const latest = transactions(db)[0]!;
    expect(latest.amount).toBe(200_000);
    expect(latest.is_transfer).toBe(1);
  });
});

describe('unreadable messages, section 11.1', () => {
  test('a bank format that cannot be read is recorded, not guessed at', async () => {
    const db = freshDb();
    await importAll(db, [
      {
        sender: 'AD-ICICIT',
        // Says money moved, so it passes the gates, but names no amount —
        // section 2.3 stops at step two rather than guessing.
        body: 'ICICI Bank Card XX7004 has been debited. Call 18002662 if not you.',
        at: TODAY - 40 * DAY,
      },
    ]);

    expect(transactions(db)).toHaveLength(0);
    expect(unreadableCount(db)).toBe(1);
  });

  test('a card used abroad keeps its own currency and stays out of the totals', async () => {
    const db = freshDb();
    await importAll(db, [
      {
        sender: 'AD-ICICIT',
        body: 'USD 11.80 spent using ICICI Bank Card XX7004 on 24-Oct-26 on 1xJetBrains AI. Avl Limit: INR 17,95,899.53.',
        at: TODAY - 3600_000,
      },
      {
        sender: 'VM-HDFCBK-S',
        body: 'Rs.450.00 debited from A/c XX4821 on 24-Oct-26 to CHAI POINT (UPI Ref No 100000000001)',
        at: TODAY - 1800_000,
      },
    ]);

    const rows = transactions(db);
    expect(rows).toHaveLength(2);

    const abroad = rows.find((row) => row.currency === 'USD')!;
    expect(abroad.amount).toBe(1_180);
    expect(abroad.transaction_type).toBe('DEBIT');

    // Never seventeen lakh rupees, and never eleven rupees eighty either: the
    // only figure in today's spending is the rupee one.
    expect(summarise(db, 'DAY', TODAY).total).toBe(45_000);
    expect(unreadableCount(db)).toBe(0);
  });
});

describe('resuming', () => {
  test('an import that stopped continues instead of starting again', async () => {
    const messages: InboxMessage[] = Array.from({ length: 9 }, (_, index) => ({
      sender: 'VM-HDFCBK-S',
      body: `Rs.${100 + index}.00 debited from A/c XX4821 on 24-Oct-26 to SHOP${index} (UPI Ref No 10000000000${index})`,
      at: TODAY - (index + 1) * 60_000,
    }));

    const db = freshDb();
    let pagesSeen = 0;
    const outcome = await runImport(db, {
      source: fakeInbox(messages),
      now: () => TODAY,
      pageSize: 2,
      progressWriteInterval: 1,
      // Stop partway through stage two, once some transactions exist.
      shouldStop: () =>
        getProfile(db).import_stage === 'TRANSACTIONS' && ++pagesSeen > 2,
    });
    expect(outcome).toBe('STOPPED');
    expect(getProfile(db).import_status).toBe('IN_PROGRESS');

    const afterStop = transactions(db).length;
    expect(afterStop).toBeGreaterThan(0);
    expect(afterStop).toBeLessThan(9);

    const second = await runImport(db, {
      source: fakeInbox(messages),
      now: () => TODAY,
      pageSize: 2,
    });
    expect(second).toBe('COMPLETED');
    expect(transactions(db)).toHaveLength(9);

    const profile = getProfile(db);
    expect(profile.import_status).toBe('COMPLETED');
    // The moment the import started, not the newest message it recorded —
    // the whole window up to here has been read, whoever sent what is in it.
    expect(profile.last_sms_scanned_at).toBe(TODAY);
  });
});

describe('the watermark the catch-up scan reads forward from', () => {
  const BANK: InboxMessage = {
    sender: 'AD-ICICIT-S',
    body: 'ICICI Bank Acct XX903 debited for Rs 1.00 on 19-Oct-26; Rohit Nair credited. UPI:302558741063',
    at: TODAY - 5 * DAY,
  };
  /** Gate one drops this before anything is written about it. */
  const NOT_A_BANK: InboxMessage = {
    sender: 'AX-ZOMATO',
    body: 'Your order has been picked up and is on its way.',
    at: TODAY - 1000,
  };

  it('is the moment the import started reading', async () => {
    const db = freshDb();
    await importAll(db, [BANK, NOT_A_BANK]);

    // Not the newest bank message, which is five days older than the newest
    // message in the inbox. A watermark behind an ordinary message means the
    // catch-up re-reads the tail of the inbox on every single run.
    expect(getProfile(db).last_sms_scanned_at).toBe(TODAY);
  });

  it('is set even when nothing in the inbox came from a bank', async () => {
    const db = freshDb();
    await importAll(db, [NOT_A_BANK]);

    // `sms_messages` is empty here, because only bank messages are recorded.
    // Reading the watermark off that table answered NULL, which sent the
    // catch-up back over a year of inbox on every launch — more messages
    // than one run is allowed to read, every time.
    expect(getProfile(db).last_sms_scanned_at).toBe(TODAY);
  });

  it('survives an import that was stopped and resumed', async () => {
    const db = freshDb();
    const messages = [BANK, NOT_A_BANK];
    let stop = true;

    const stopped = await runImport(db, {
      source: fakeInbox(messages),
      now: () => TODAY,
      pageSize: 3,
      shouldStop: () => stop,
    });
    expect(stopped).toBe('STOPPED');

    stop = false;
    // A later moment, so the two starts can be told apart.
    await runImport(db, {
      source: fakeInbox(messages),
      now: () => TODAY + DAY,
      pageSize: 3,
    });

    // The first attempt's start, not the second's: anything that arrived
    // while the import was paused has to stay ahead of the watermark.
    expect(getProfile(db).last_sms_scanned_at).toBe(TODAY);
  });
});
