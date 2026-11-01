/**
 * Section 2.3: "Every format is pinned by an example. Each bank has a set of
 * real messages written down alongside the amount, merchant, account digits
 * and type that each one should produce. Adding a format means adding its
 * example first. This is what makes it safe to change one bank's pattern
 * without discovering months later that it broke another."
 *
 * Every message marked `source: 'spec'` is quoted from
 * TECHNICAL_IMPLEMENTATION.md. The rest are the same formats with the parts
 * that vary filled in differently.
 */

import type { TransactionType } from '../../types';

export interface Expectation {
  status: 'PARSED' | 'IGNORED' | 'NO_MATCH';
  /** Minor units of `currency`. */
  amount?: number;
  /** Defaults to INR when the fixture does not say. */
  currency?: string;
  type?: TransactionType;
  merchant?: string | null;
  upiId?: string | null;
  lastFour?: string | null;
  rrn?: string | null;
  occurredOn?: string;
  hasExplicitTime?: boolean;
  balance?: number | null;
  reason?: string;
  parserId?: string;
}

export interface Fixture {
  name: string;
  sender: string;
  body: string;
  /** Local epoch millis for when the message arrived. */
  receivedAt: number;
  source?: 'spec';
  expect: Expectation;
}

/** 24 Oct 2026, 14:30 local — the "today" the Home screen mockup shows. */
const ARRIVED = new Date(2026, 9, 24, 14, 30, 0).getTime();

/** Builds the Unicode look-alike spelling section 2.4 describes for SBI Card. */
function mathSansSerif(text: string): string {
  return [...text]
    .map((char) => {
      if (char >= 'A' && char <= 'Z') {
        return String.fromCodePoint(0x1d5a0 + char.charCodeAt(0) - 0x41);
      }
      if (char >= 'a' && char <= 'z') {
        return String.fromCodePoint(0x1d5ba + char.charCodeAt(0) - 0x61);
      }
      return char;
    })
    .join('');
}

export const FIXTURES: Fixture[] = [
  /* ---------------------------------------------------------------- HDFC -- */
  {
    name: 'HDFC debit to a UPI handle',
    source: 'spec',
    sender: 'HD-HDFCBK',
    body: 'Rs.500.00 debited from A/c XX1234 on 20-Oct-25 to merchant@upi (UPI Ref No 123456789012)',
    receivedAt: ARRIVED,
    expect: {
      status: 'PARSED',
      parserId: 'hdfc',
      amount: 50_000,
      type: 'DEBIT',
      lastFour: '1234',
      rrn: '123456789012',
      upiId: 'merchant@upi',
      // The merchant shape found the UPI handle, which is not a name.
      merchant: null,
      occurredOn: '2025-10-20',
    },
  },
  {
    name: 'HDFC debit reporting a balance afterwards',
    source: 'spec',
    sender: 'VM-HDFCBK-S',
    body: 'Rs.450 debited from A/c XX4821. Avl Bal Rs.45,230.',
    receivedAt: ARRIVED,
    expect: {
      status: 'PARSED',
      amount: 45_000, // not 45,230 — section 2.1
      type: 'DEBIT',
      lastFour: '4821',
      balance: 4_523_000,
      rrn: null,
      // No date in the body at all, so the arrival is used for both parts.
      occurredOn: '2026-10-24',
      hasExplicitTime: false,
    },
  },
  {
    name: 'HDFC card purchase, ISO date',
    sender: 'HD-HDFCBK',
    body: 'Rs.1,899.00 spent on HDFC Bank Card x4821 at MYNTRA on 2025-10-23. Avl bal Rs.12,000.00',
    receivedAt: ARRIVED,
    expect: {
      status: 'PARSED',
      amount: 189_900,
      type: 'DEBIT',
      lastFour: '4821',
      merchant: 'MYNTRA',
      occurredOn: '2025-10-23',
    },
  },

  /* --------------------------------------------------------------- ICICI -- */
  {
    name: 'ICICI debit naming the payee before "credited"',
    source: 'spec',
    sender: 'AD-ICICIT',
    body: 'ICICI Bank Acct XX123 debited for Rs 500.00 on 01-Oct-25; merchant credited. UPI: 543210987654. Updated Bal: Rs 5,000.00',
    receivedAt: ARRIVED,
    expect: {
      status: 'PARSED',
      parserId: 'icici',
      amount: 50_000,
      type: 'DEBIT',
      // Three digits is all this bank ever reveals, and that is its identity.
      lastFour: '123',
      merchant: 'merchant',
      rrn: '543210987654',
      balance: 500_000,
      occurredOn: '2025-10-01',
    },
  },
  {
    name: 'ICICI debit to a person',
    source: 'spec',
    sender: 'AD-ICICIT-S',
    body: 'ICICI Bank Acct XX903 debited for Rs 1.00 on 19-Oct-26; Rohit Nair credited. UPI:302558741063',
    receivedAt: ARRIVED,
    expect: {
      status: 'PARSED',
      amount: 100,
      type: 'DEBIT',
      lastFour: '903',
      merchant: 'Rohit Nair',
      rrn: '302558741063',
      occurredOn: '2026-10-19',
    },
  },
  {
    name: 'ICICI card purchase in a foreign currency',
    source: 'spec',
    sender: 'AD-ICICIT',
    body: 'USD 11.80 spent using ICICI Bank Card XX7004 on 03-Sep-25 on 1xJetBrains AI. Avl Limit: INR 17,95,899.53.',
    receivedAt: ARRIVED,
    expect: {
      // Seventeen lakh is the credit limit, not the purchase. The dollars are
      // kept as dollars; section 10's spending clause requires INR, so this
      // row can never be added into a rupee total.
      status: 'PARSED',
      parserId: 'icici',
      amount: 1_180,
      currency: 'USD',
      type: 'DEBIT',
      lastFour: '7004',
      merchant: '1xJetBrains AI',
      occurredOn: '2025-09-03',
    },
  },
  {
    name: 'ICICI card purchase in rupees, merchant after the date',
    sender: 'AD-ICICIB',
    body: 'INR 2,310.00 spent using ICICI Bank Card XX7765 on 23-Oct-26 on MYNTRA. Avl Limit: INR 1,20,000.00.',
    receivedAt: ARRIVED,
    expect: {
      status: 'PARSED',
      amount: 231_000,
      type: 'DEBIT',
      lastFour: '7765',
      merchant: 'MYNTRA',
      occurredOn: '2026-10-23',
    },
  },

  /* ----------------------------------------------------------- IDFC First -- */
  {
    name: 'IDFC debit with a leading-zero RRN',
    source: 'spec',
    sender: 'AD-IDFCFB-S',
    body: 'Your A/c XX4614 debited by Rs. 1,172.06 on 15/01/26; REDBUS credited. RRN 060649915527. Available balance Rs. 9,134.15.',
    receivedAt: ARRIVED,
    expect: {
      status: 'PARSED',
      parserId: 'idfc',
      amount: 117_206,
      type: 'DEBIT',
      lastFour: '4614',
      merchant: 'REDBUS',
      // Section 4.3: stored as text, so the leading zero survives.
      rrn: '060649915527',
      balance: 913_415,
      occurredOn: '2026-01-15',
    },
  },
  {
    name: 'IDFC debit written with a long mask',
    source: 'spec',
    sender: 'AD-IDFCFB-S',
    body: 'Your A/c XXXXX528307 is debited by Rs.1.00 on 18-Oct-26. RRN 884051972336',
    receivedAt: ARRIVED,
    expect: {
      status: 'PARSED',
      amount: 100,
      type: 'DEBIT',
      // XXXXX528307 and XX8307 are the same account.
      lastFour: '8307',
      rrn: '884051972336',
      occurredOn: '2026-10-18',
    },
  },
  {
    name: 'IDFC credit written with a short mask',
    source: 'spec',
    sender: 'JD-IDFCFB-S',
    body: 'Rs.500.00 credited to your A/c XX8307 on 18-Oct-26',
    receivedAt: ARRIVED,
    expect: {
      status: 'PARSED',
      amount: 50_000,
      type: 'CREDIT',
      lastFour: '8307',
      occurredOn: '2026-10-18',
    },
  },

  /* ----------------------------------------------------------------- SBI -- */
  {
    name: 'SBI debit, date with no separators',
    source: 'spec',
    sender: 'AD-ATMSBI',
    body: 'Rs.500 debited from A/c X1234 on 13Sep25. Avl Bal Rs.999999999',
    receivedAt: ARRIVED,
    expect: {
      status: 'PARSED',
      parserId: 'sbi',
      amount: 50_000,
      type: 'DEBIT',
      lastFour: '1234',
      merchant: null,
      rrn: null,
      occurredOn: '2025-09-13',
    },
  },
  {
    name: 'SBI UPI alert with no currency marker',
    sender: 'CP-SBIUPI',
    body: 'Dear UPI user A/C X0937 debited by 640.0 on date 23Oct26 trf to SWIGGY refno 429813770512-ICICI Bank',
    receivedAt: ARRIVED,
    expect: {
      status: 'PARSED',
      amount: 64_000,
      type: 'DEBIT',
      lastFour: '0937',
      merchant: 'SWIGGY',
      rrn: '429813770512',
      occurredOn: '2026-10-23',
    },
  },
  {
    name: 'SBI Card written in Unicode look-alike letters',
    source: 'spec',
    sender: 'AD-SBICRD',
    body:
      'Rs.383.00 ' +
      mathSansSerif('spent on your SBI Credit Card') +
      ' ending with 7765 at BOOKMYSHOW on 13Sep25. Avl limit Rs.50000',
    receivedAt: ARRIVED,
    expect: {
      status: 'PARSED',
      parserId: 'sbicard',
      amount: 38_300,
      type: 'DEBIT',
      lastFour: '7765',
      merchant: 'BOOKMYSHOW',
      occurredOn: '2025-09-13',
    },
  },

  /* ---------------------------------------------------------------- Axis -- */
  {
    name: 'Axis debit, merchant between "on" and the date, no reference',
    source: 'spec',
    sender: 'AD-AXISBK',
    body: 'INR 2000.00 debited from A/c no. XX589034 on BURGRILL 04-12-2025 13:13:27 IST. Avl bal: INR 98919.81.',
    receivedAt: ARRIVED,
    expect: {
      status: 'PARSED',
      parserId: 'axis',
      amount: 200_000,
      type: 'DEBIT',
      // Axis reveals six digits; the last four are the identity.
      lastFour: '9034',
      merchant: 'BURGRILL',
      rrn: null,
      balance: 9_891_981,
      occurredOn: '2025-12-04',
      hasExplicitTime: true,
    },
  },

  /* ---------------------------------------------------------------- ESAF -- */
  {
    name: 'ESAF credit',
    source: 'spec',
    sender: 'AD-ESAFBK',
    body: 'Your A/c XXX7143 is credited with Rs. 1.00 on 18-Oct-26 by UPI Ref No: 884051972336',
    receivedAt: ARRIVED,
    expect: {
      status: 'PARSED',
      parserId: 'esaf',
      amount: 100,
      type: 'CREDIT',
      lastFour: '7143',
      rrn: '884051972336',
      occurredOn: '2026-10-18',
    },
  },

  /* ----------------------------------------------- gate two, reject list -- */
  {
    name: 'One-time password carrying an amount and a merchant',
    source: 'spec',
    sender: 'HD-HDFCBK',
    body: 'OTP for your txn of Rs.450 at SWIGGY is 847291. Do not share.',
    receivedAt: ARRIVED,
    expect: { status: 'IGNORED', reason: 'REJECT_LIST' },
  },
  {
    name: 'Collect request worded like a payment',
    sender: 'AD-ICICIT',
    body: 'Ananya R is requesting Rs.276.00 from you. Approve to pay via UPI. Ref 889900112233',
    receivedAt: ARRIVED,
    expect: { status: 'IGNORED', reason: 'REJECT_LIST' },
  },
  {
    name: 'Scheduled payment that has not happened yet',
    sender: 'AD-IDFCFB-S',
    body: 'Rs.5,000.00 will be debited from A/c XX8307 on 25-Oct-26 towards your SIP.',
    receivedAt: ARRIVED,
    expect: { status: 'IGNORED', reason: 'REJECT_LIST' },
  },
  {
    // `Acct XX903 is credited` sits where `; REDBUS credited` does, so without
    // the account guard the payee comes out as the user's own account and the
    // real payer after `from` is never read.
    name: 'ICICI UPI credit names the payer, not the account credited',
    sender: 'AD-ICICIT-S',
    body:
      'Dear Customer, Acct XX903 is credited with Rs 2.00 on 15-Oct-26 from ' +
      'Google Cloud. UPI:773920184455-ICICI Bank.',
    receivedAt: ARRIVED,
    expect: {
      status: 'PARSED',
      amount: 200,
      type: 'CREDIT',
      merchant: 'Google Cloud',
      rrn: '773920184455',
      lastFour: '903',
    },
  },
  {
    // The shape the guard must not break: here the name really does sit
    // immediately before the verb.
    name: 'Payee named directly before the word credited',
    sender: 'AD-IDFCFB-S',
    body:
      'Your A/c XXXXX528307 is debited by Rs. 1,172.06 on 20-Oct-26; ' +
      'REDBUS credited.',
    receivedAt: ARRIVED,
    expect: {
      status: 'PARSED',
      amount: 117206,
      type: 'DEBIT',
      merchant: 'REDBUS',
    },
  },
  {
    // The reminder ends `Ignore if paid`, and `paid` is a movement verb, so
    // gate three alone would let the whole bill through as a payment made on
    // the day the reminder arrived.
    name: 'Credit card bill reminder, signed off with a movement verb',
    sender: 'AD-ICICIT-S',
    body:
      'Pay Total Amount Due of Rs 1,710.63 or Minimum Amount Due of Rs 1,710.63 ' +
      'by 08-Oct-26 towards ICICI Bank Credit Card XX5502. Delay/Non-payment is ' +
      'reported to Credit Bureaus. Ignore if paid.',
    receivedAt: ARRIVED,
    expect: { status: 'IGNORED', reason: 'REJECT_LIST' },
  },
  {
    name: 'Credit card bill generated, with a due date',
    sender: 'AD-ICICIT-S',
    body:
      'Your credit card bill for ICICI Bank XXXX-5518 has been generated. ' +
      'Total amount: INR 4,932.90 Due date: 08-Aug-26.',
    receivedAt: ARRIVED,
    expect: { status: 'IGNORED', reason: 'REJECT_LIST' },
  },
  {
    // The counterpart that has to keep working: the bill actually being paid
    // is a real movement and must still be read.
    name: 'The bill actually being paid',
    sender: 'AD-ICICIT-S',
    body:
      'Payment of Rs 1,366.45 has been received on your ICICI Bank Credit Card ' +
      'XX5518 through Bharat Bill Payment System on 03-MAY-26.',
    receivedAt: ARRIVED,
    expect: {
      status: 'PARSED',
      amount: 136645,
      type: 'CREDIT',
    },
  },
  {
    name: 'Pre-approved loan offer',
    sender: 'VM-HDFCBK',
    body: 'You have a pre-approved offer of Rs.5,00,000. Apply now and get it credited instantly.',
    receivedAt: ARRIVED,
    expect: { status: 'IGNORED', reason: 'REJECT_LIST' },
  },

  /* --------------------------------------- gate three, money that moved -- */
  {
    name: 'Balance alert: an account and an amount, but nothing moved',
    sender: 'VM-HDFCBK-S',
    body: 'Avl Bal in your A/c XX4821 is Rs.45,230.00 as on 24-Oct-26.',
    receivedAt: ARRIVED,
    expect: { status: 'IGNORED', reason: 'NO_MONEY_MOVED' },
  },
  {
    name: 'Declined payment: the bank saying the money did not move',
    sender: 'AD-AXISBK',
    body: 'Your txn of INR 2000.00 at BURGRILL could not be debited from A/c no. XX589034 on 04-12-2025.',
    receivedAt: ARRIVED,
    expect: { status: 'IGNORED', reason: 'NO_MONEY_MOVED' },
  },
  {
    name: 'Credit card statement notice',
    sender: 'AD-SBICRD',
    body: 'Your SBI Card statement for Oct 2026 is ready. Total amount Rs.12,340.00, available limit Rs.87,660.00.',
    receivedAt: ARRIVED,
    expect: { status: 'IGNORED', reason: 'NO_MONEY_MOVED' },
  },

  /* ------------------------------------- the reversal gate three keeps -- */
  {
    name: 'Failed payment credited back — a reversal, not a decline',
    sender: 'VM-HDFCBK-S',
    body: 'Your payment of Rs.500.00 to SWIGGY has failed. Rs.500.00 has been credited back to your A/c XX4821 on 20-Oct-26. UPI Ref No 123456789012',
    receivedAt: ARRIVED,
    expect: {
      // Section 2.1: "Rejecting on the word 'failed' would throw it away, and
      // the debit it reverses would stay in the user's spending for good."
      status: 'PARSED',
      amount: 50_000,
      type: 'CREDIT',
      lastFour: '4821',
      rrn: '123456789012',
      occurredOn: '2026-10-20',
    },
  },

  /* ------------------------------------------------ gate one, the sender -- */
  {
    name: 'A message that is not from a bank is never read',
    sender: 'AX-AMZNIN',
    body: 'Your order of Rs.1,899 has been shipped. Track it now.',
    receivedAt: ARRIVED,
    expect: { status: 'IGNORED', reason: 'NOT_A_BANK_SENDER' },
  },
  {
    name: 'A personal message is never read',
    sender: '+919845012345',
    body: 'Paid Rs.500 to you for dinner, check your account',
    receivedAt: ARRIVED,
    expect: { status: 'IGNORED', reason: 'NOT_A_BANK_SENDER' },
  },

  /* ------------------------------------------------- found in the wild -- */
  /*
   * Everything below came out of a real inbox rather than out of the spec.
   * Each one broke something the spec's own examples did not reach.
   */
  {
    /*
     * The rupee is written `INR.32.00`, with a dot where every other bank puts
     * a space. The amount pattern allowed that dot after `Rs` but not after
     * `INR`, so it found no amount anywhere in the message and recorded a real
     * credit as unreadable. A year of monthly interest was missing from the
     * history because of one optional character.
     */
    name: 'IDFC monthly savings interest — the rupee is written INR.32.00',
    sender: 'JM-IDFCFB-S',
    body:
      'Monthly interest of INR.32.00 earned on your Savings A/c XX4614 has ' +
      'been credited to your A/C on 30/09/26. New bal: INR.1,80,109.09. ' +
      'IDFC FIRST Bank',
    receivedAt: ARRIVED,
    expect: {
      status: 'PARSED',
      parserId: 'idfc',
      amount: 3_200,
      type: 'CREDIT',
      lastFour: '4614',
      // The message names no payee; `to your A/C` is the user's own account.
      merchant: null,
      rrn: null,
      occurredOn: '2026-09-30',
      hasExplicitTime: false,
      balance: 18_010_909,
    },
  },
  {
    /* The same wording with the balance in the thousands, which is where the
       bare `bal` label and the Indian grouping meet. */
    name: 'IDFC monthly savings interest — four-figure balance',
    sender: 'VA-IDFCFB-S',
    body:
      'Monthly interest of INR.324.00 earned on your Savings A/c XX4614 has ' +
      'been credited to your A/C on 30/06/26. New bal: INR.9,445.88. ' +
      'IDFC FIRST Bank',
    receivedAt: ARRIVED,
    expect: {
      status: 'PARSED',
      parserId: 'idfc',
      amount: 32_400,
      type: 'CREDIT',
      lastFour: '4614',
      merchant: null,
      occurredOn: '2026-06-30',
      balance: 944_588,
    },
  },
  {
    /*
     * Pinned so the dot allowed after `INR` never starts reading a credit
     * limit as the amount. `Avl Limit` is what is left on the card, not what
     * was spent, and there is no rupee figure for the purchase anywhere in the
     * message — so the purchase is kept in Singapore dollars.
     */
    name: 'ICICI card abroad — SGD spent, only the rupee limit follows',
    sender: 'JD-ICICIT-S',
    body:
      'SGD 138.19 spent using ICICI Bank Card XX7004 on 21-Jul-26 on ORACLE ' +
      ' SINGAPO. Avl Limit: INR 42,442.11. If not you, call 1800 2662/SMS ' +
      'BLOCK 7004 to 9215676766.',
    receivedAt: ARRIVED,
    expect: {
      status: 'PARSED',
      parserId: 'icici',
      amount: 13_819,
      currency: 'SGD',
      type: 'DEBIT',
      lastFour: '7004',
      merchant: 'ORACLE SINGAPO',
      occurredOn: '2026-07-21',
    },
  },
  {
    name: 'HDFC "Sent ... From ... To ..." — no debit verb at all',
    sender: 'VM-HDFCBK',
    body: 'Sent Rs.1299.00 From HDFC Bank A/C x4412 To PAYTM*QPZ4471 On 19-09-26 Ref 528813047711 Not You? Call 18002586161',
    receivedAt: ARRIVED,
    expect: {
      status: 'PARSED',
      amount: 129_900,
      type: 'DEBIT',
      lastFour: '4412',
      merchant: 'PAYTM*QPZ4471',
      rrn: '528813047711',
      occurredOn: '2026-09-19',
    },
  },
  {
    name: 'Kotak "Sent ... AC X5510 ..." — the account word is bare AC',
    sender: 'AD-KOTAKB',
    body: 'Sent Rs.455.00 from Kotak Bank AC X5510 to zeptomarket@ybl on 16-09-26. UPI Ref 820011447722.',
    receivedAt: ARRIVED,
    expect: {
      status: 'PARSED',
      parserId: 'kotak',
      amount: 45_500,
      type: 'DEBIT',
      lastFour: '5510',
      upiId: 'zeptomarket@ybl',
      merchant: null,
      rrn: '820011447722',
      occurredOn: '2026-09-16',
    },
  },
  {
    name: 'IDFC "Paid ... via ... to ..." — no account digits anywhere',
    sender: 'VM-IDFCFB',
    body: 'Paid Rs.410.00 via IDFC FIRST Bank to CHAI POINT on 20-09-26. Txn Ref 7781122334.',
    receivedAt: ARRIVED,
    expect: {
      status: 'PARSED',
      amount: 41_000,
      type: 'DEBIT',
      merchant: 'CHAI POINT',
      lastFour: null,
      rrn: '7781122334',
      occurredOn: '2026-09-20',
    },
  },
  {
    name: 'Axis with the payee inside a UPI info block',
    sender: 'VM-AXISBK',
    body: 'INR 89.00 debited from A/c no. XX2208 on 17-09-26, 08:54 IST. Info- UPI/P2M/718820044119/CHAI POINT. Avl Bal- INR 12881.55',
    receivedAt: ARRIVED,
    expect: {
      status: 'PARSED',
      amount: 8_900,
      type: 'DEBIT',
      lastFour: '2208',
      merchant: 'CHAI POINT',
      rrn: '718820044119',
      occurredOn: '2026-09-17',
    },
  },
  {
    name: 'ICICI with "Payment to NAME" inside a UPI info block',
    sender: 'AD-ICICIB',
    body: 'Dear Customer, Acct XX9012 is debited with INR 640.00 on 19-Sep-26. Info: UPI/612290014477/Payment to NAMMA YATRI. Avl Bal INR 42,881.55',
    receivedAt: ARRIVED,
    expect: {
      status: 'PARSED',
      amount: 64_000,
      type: 'DEBIT',
      lastFour: '9012',
      merchant: 'NAMMA YATRI',
      rrn: '612290014477',
      occurredOn: '2026-09-19',
    },
  },
  {
    name: 'HDFC card purchase, "Avl Lmt" rather than "Avl Limit"',
    sender: 'VM-HDFCBK',
    body: 'Spent Rs.2450.00 On HDFC Bank Card x8890 At DECATHLON SPORTS On 15-09-2026 20:11 Avl Lmt Rs.84,200.',
    receivedAt: ARRIVED,
    expect: {
      status: 'PARSED',
      amount: 245_000,
      type: 'DEBIT',
      lastFour: '8890',
      merchant: 'DECATHLON SPORTS',
      balance: 8_420_000,
      occurredOn: '2026-09-15',
    },
  },
  {
    name: 'Paytm reporting the same payment the bank also reported',
    sender: 'VM-PYTMPB',
    body: 'Rs.330 paid to SWIGGY from Paytm UPI. UPI Ref: 900011223344',
    receivedAt: ARRIVED,
    expect: {
      status: 'PARSED',
      amount: 33_000,
      type: 'DEBIT',
      // "from Paytm UPI" is not part of the name.
      merchant: 'SWIGGY',
      lastFour: null,
      rrn: '900011223344',
    },
  },
  {
    name: 'A credit must not take its payee from the amount',
    sender: 'AD-IDFCFB',
    body: 'Rs.5,000.00 credited to your A/c XX8307 on 20-Oct-26. RRN 884051972336',
    receivedAt: ARRIVED,
    expect: {
      status: 'PARSED',
      amount: 500_000,
      type: 'CREDIT',
      lastFour: '8307',
      // The `, ` inside `5,000.00` sits right before the word `credited`, which
      // is exactly where a payee normally is.
      merchant: null,
      rrn: '884051972336',
    },
  },
  {
    name: 'A salary credit names no payee rather than an amount',
    sender: 'VM-HDFCBK',
    body: 'Rs.85000.00 credited to HDFC Bank A/c x4412 on 01-09-26 by SALARY ACME TECH. Avl Bal Rs.1,08,900.00',
    receivedAt: ARRIVED,
    expect: {
      status: 'PARSED',
      amount: 8_500_000,
      type: 'CREDIT',
      lastFour: '4412',
      merchant: null,
      occurredOn: '2026-09-01',
    },
  },
  {
    name: 'A reversal that has not happened yet is not a transaction',
    sender: 'VM-HDFCBK',
    body: 'Your payment of Rs.1299.00 to SWIGGY has failed. The amount will be reversed in 3 working days.',
    receivedAt: ARRIVED,
    expect: { status: 'IGNORED', reason: 'NO_MONEY_MOVED' },
  },
  {
    name: 'A merchant promotion from a non-bank sender is never read',
    sender: 'VM-SWIGGY',
    body: 'Flat Rs.150 OFF on your next 3 orders! Use code EAT150. Order now bit.ly/sw150.',
    receivedAt: ARRIVED,
    expect: { status: 'IGNORED', reason: 'NOT_A_BANK_SENDER' },
  },

  /* ---------------------------------------------------- money coming in -- */
  {
    name: 'Salary credit',
    sender: 'VM-HDFCBK-S',
    body: 'Rs.86,299.00 credited to A/c XX4821 on 01-Oct-26 by NEFT. Avl Bal Rs.1,20,000.00',
    receivedAt: ARRIVED,
    expect: {
      status: 'PARSED',
      amount: 8_629_900,
      type: 'CREDIT',
      lastFour: '4821',
      occurredOn: '2026-10-01',
    },
  },
];
