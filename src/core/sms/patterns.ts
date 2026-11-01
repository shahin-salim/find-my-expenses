/**
 * The shared extraction steps from section 2.3.
 *
 * "Most banks need nothing written for them. The shared patterns already know
 * `Rs.`, `INR` and the rupee sign for amounts, `A/c`, `Acct` and `Card` for
 * account digits, `Ref`, `RRN` and `UPI` for the reference, and `Avl Bal` and
 * `Available Balance` for the balance."
 */

import type { TransactionType } from './types';

/* -------------------------------------------------------------------------- */
/* Amounts                                                                     */
/* -------------------------------------------------------------------------- */

/** Indian digit grouping, e.g. `17,95,899.53`. */
const AMOUNT_NUMBER = String.raw`\d[\d,]*(?:\.\d{1,2})?`;

/**
 * How the rupee is written before the figure.
 *
 * The trailing dot has to be optional on `INR` as well as on `Rs`. IDFC writes
 * its savings interest as `INR.32.00`, and with the dot allowed only after
 * `Rs` the pattern found no amount at all and the credit was recorded as
 * unreadable — a year of monthly interest missing from the user's history.
 */
const RUPEE = String.raw`(?:(?:rs|inr)\.?|₹)`;

const INR_AMOUNT = new RegExp(RUPEE + String.raw`\s*(` + AMOUNT_NUMBER + String.raw`)`, 'i');

/** Currencies seen on Indian cards used abroad or for overseas subscriptions. */
const FOREIGN_AMOUNT = new RegExp(
  String.raw`\b(USD|EUR|GBP|AED|SGD|AUD|CAD|JPY|CHF|MYR|THB)\s*(` +
    AMOUNT_NUMBER +
    String.raw`)`,
);

/**
 * Converts `1,172.06` to paise without going through a float.
 * Section 8.1: "Floating point rounding would drift category and period totals
 * over thousands of transactions."
 */
export function parseAmountToPaise(raw: string): number {
  const cleaned = raw.replace(/,/g, '');
  const [whole, fraction = ''] = cleaned.split('.');
  const paise = (fraction + '00').slice(0, 2);
  return parseInt(whole, 10) * 100 + parseInt(paise, 10);
}

/* -------------------------------------------------------------------------- */
/* Balances — found so they can be masked out before the amount is read        */
/* -------------------------------------------------------------------------- */

const BALANCE_LABEL = String.raw`(?:avl\.?\s*(?:bal(?:ance)?|lmt|limit)` +
  String.raw`|available\s+(?:credit\s+)?(?:bal(?:ance)?|limit)` +
  String.raw`|updated\s+bal(?:ance)?` +
  String.raw`|new\s+bal(?:ance)?` +
  String.raw`|clos(?:ing|ure)\s+bal(?:ance)?` +
  String.raw`|curr(?:ent)?\s+bal(?:ance)?` +
  String.raw`|total\s+bal(?:ance)?` +
  String.raw`|bal(?:ance)?)`;

const BALANCE_CLAUSE = new RegExp(
  BALANCE_LABEL +
    String.raw`\s*(?:is|of)?\s*[:\-]?\s*` + RUPEE + String.raw`?\s*(` +
    AMOUNT_NUMBER +
    String.raw`)`,
  'gi',
);

export interface BalanceMask {
  /** The body with every balance clause replaced by spaces of equal length. */
  actionText: string;
  /** The first balance reported, in paise, or null. */
  balance: number | null;
}

/**
 * Section 2.1: "A message reading `Rs.450 debited from A/c XX4821. Avl Bal
 * Rs.45,230.` is a payment that happens to report the balance afterwards."
 *
 * Masking rather than deleting keeps every other index in the body stable, so
 * the merchant steps that work on position still line up.
 */
export function maskBalances(body: string): BalanceMask {
  let balance: number | null = null;
  const actionText = body.replace(BALANCE_CLAUSE, (match, amount: string) => {
    if (balance === null) {
      balance = parseAmountToPaise(amount);
    }
    return ' '.repeat(match.length);
  });
  return { actionText, balance };
}

export interface AmountReading {
  paise: number;
  /** Set when the action is in a currency other than rupees. */
  foreignCurrency?: string;
}

/**
 * Reads the amount out of the part of the message that describes the action.
 * `actionText` is expected to have had its balance clauses masked already.
 */
export function findAmount(actionText: string): AmountReading | null {
  const foreign = actionText.match(FOREIGN_AMOUNT);
  const inr = actionText.match(INR_AMOUNT);

  // Section 2.3: ICICI's `USD 11.80 spent ... Avl Limit: INR 17,95,899.53` is
  // the case this ordering exists for. When a foreign amount comes first it is
  // the action, and any rupee figure after it is not.
  if (foreign && (!inr || foreign.index! < inr.index!)) {
    return {
      paise: parseAmountToPaise(foreign[2]),
      foreignCurrency: foreign[1],
    };
  }
  return inr ? { paise: parseAmountToPaise(inr[1]) } : null;
}

/* -------------------------------------------------------------------------- */
/* Direction                                                                   */
/* -------------------------------------------------------------------------- */

const DIRECTION_TOKENS: Array<{ regex: RegExp; type: TransactionType }> = [
  { regex: /\bdebited\b/gi, type: 'DEBIT' },
  { regex: /\bcredited\b/gi, type: 'CREDIT' },
  { regex: /\bspent\b/gi, type: 'DEBIT' },
  { regex: /\bwithdrawn\b/gi, type: 'DEBIT' },
  { regex: /\bwithdrawal\b/gi, type: 'DEBIT' },
  { regex: /\bdeducted\b/gi, type: 'DEBIT' },
  { regex: /\breceived\b/gi, type: 'CREDIT' },
  { regex: /\bdeposited\b/gi, type: 'CREDIT' },
  { regex: /\bpaid\b/gi, type: 'DEBIT' },
  // `Sent Rs.1299.00 From HDFC Bank A/C x4412 To ...` — HDFC and Kotak both
  // word it this way, and nothing else in the message says money moved.
  { regex: /\bsent\b/gi, type: 'DEBIT' },
  { regex: /\btransferred\b/gi, type: 'DEBIT' },
];

/**
 * Whichever movement word comes first in the message governs.
 *
 * ICICI writes `ICICI Bank Acct XX123 debited for Rs 500.00 ...; merchant
 * credited.` — both words are present, and the one describing the user's
 * account is the one that comes first. The same holds for IDFC's
 * `... debited by Rs. 1,172.06 ...; REDBUS credited.`
 */
export function findDirection(actionText: string): TransactionType | null {
  let earliestIndex = Number.MAX_SAFE_INTEGER;
  let earliestType: TransactionType | null = null;

  for (const { regex, type } of DIRECTION_TOKENS) {
    regex.lastIndex = 0;
    const match = regex.exec(actionText);
    if (match && match.index < earliestIndex) {
      earliestIndex = match.index;
      earliestType = type;
    }
  }

  if (earliestType === 'DEBIT') {
    // `transferred to your A/c` is money arriving, not leaving.
    const transferTo = /\btransferred\s+(?:to|into)\s+(?:your|a\/c|acct)/i;
    if (transferTo.test(actionText) && !/\bdebited\b/i.test(actionText)) {
      return 'CREDIT';
    }
  }
  return earliestType;
}

/* -------------------------------------------------------------------------- */
/* Account digits                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Ordered longest-label-first so `A/c no.` is not read as `A/c` with a stray
 * `no.`, and `Credit Card` is not read as bare `Card`.
 */
const ACCOUNT_LABEL =
  String.raw`(?:a\/c\s*(?:no\.?|number)?|acct\.?|account|acc\.?|ac\.?` +
  String.raw`|(?:credit|debit|rupay|visa|master)?\s*card` +
  String.raw`|ending\s+(?:with|in)|xxxx)`;

const ACCOUNT_RUN = new RegExp(
  // The leading boundary is what keeps the short `ac` and `acc` forms from
  // matching inside an ordinary word.
  String.raw`\b` + ACCOUNT_LABEL + String.raw`\s*[:#]?\s*(?:no\.?\s*)?([Xx*••\d]{3,24})`,
  'i',
);

/**
 * Section 2.2: the digits are taken from the run attached to the account word,
 * and the last four of that run are kept. Never any other digits in the
 * message, because the balance reported afterwards is also a run of digits.
 *
 * Three digits is kept as-is: "Three digits is all some banks ever reveal, so
 * for those it is the account's identity and it matches itself every time."
 */
export interface AccountMatch {
  /** The last four digits, or three when that is all the bank gives. */
  digits: string;
  /** The exact text that matched, e.g. `A/c XXXXX528307`. */
  matchedText: string;
  /** Where that text starts in the body. */
  index: number;
}

/** The same reading, with the evidence kept, for diagnostics and section 11.1. */
export function findAccountMatch(body: string): AccountMatch | null {
  const match = body.match(ACCOUNT_RUN);
  if (!match || match.index === undefined) {
    return null;
  }
  const digits = match[1].replace(/\D/g, '');
  if (digits.length === 0) {
    return null;
  }
  return {
    digits: digits.length <= 3 ? digits : digits.slice(-4),
    matchedText: match[0],
    index: match.index,
  };
}

export function findAccountDigits(body: string): string | null {
  return findAccountMatch(body)?.digits ?? null;
}

/* -------------------------------------------------------------------------- */
/* Reference number (RRN)                                                      */
/* -------------------------------------------------------------------------- */

const REFERENCE_PATTERNS: RegExp[] = [
  // `UPI Ref No 123456789012`, `UPI Ref No: 123...`, `UPI Reference 123...`
  /upi\s*ref(?:erence)?\s*(?:no\.?|number)?\s*[:#\-]?\s*(\d{6,20})/i,
  // `RRN 884051972336`, `RRN:884051972336`
  /\brrn\s*[:#\-]?\s*(\d{6,20})/i,
  // `UPI/P2M/123456789012/Swiggy`, and ICICI's shorter
  // `UPI/612290014477/Payment to NAMMA YATRI` with no segment in between.
  /\bupi\s*\/\s*(?:[A-Za-z0-9]+\s*\/\s*)?(\d{6,20})/i,
  // `UPI:302558741063`, `UPI 543210987654`
  /\bupi\s*[:#\-]?\s*(\d{6,20})/i,
  // `Reference: 123`, `Ref No. 123`, `Ref 123456`
  /\bref(?:erence)?\s*(?:no\.?|number)?\s*[:#\-]?\s*(\d{6,20})/i,
  // SBI's `transaction number 123456789012`
  /\btransaction\s*(?:number|no\.?|id|ref(?:erence)?)\s*[:#\-]?\s*(\d{6,20})/i,
  /\btxn\s*(?:no\.?|id|ref(?:erence)?)\s*[:#\-]?\s*(\d{6,20})/i,
];

/**
 * Section 4.3: "Reference numbers must be stored as text." The twelve digit
 * RRN is built from a year digit and a day, and read as a number it loses its
 * leading zeros.
 */
export function findReference(body: string): string | null {
  for (const regex of REFERENCE_PATTERNS) {
    const match = body.match(regex);
    if (match) {
      return match[1];
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* UPI ID                                                                      */
/* -------------------------------------------------------------------------- */

/** A UPI handle such as `swiggy.stores@axb` or `paytmqr2810050501@paytm`. */
const UPI_ID = /\b([a-z0-9][a-z0-9._-]{1,60}@[a-z][a-z0-9.]{1,30})\b/gi;

/** Bank messages occasionally carry a support email; those are not payees. */
const EMAIL_DOMAINS = /\.(com|in|org|net|co\.in|gov|edu)$/i;

/**
 * The first handle in the body that is not an email address.
 *
 * Every candidate, not just the first one: plenty of bank messages print a
 * support address before they name the payee, and rejecting that address used
 * to mean giving up on the message. The payee then fell back to a name-based
 * `identity_key` (section 8.4), which splits one person's history across two
 * merchant rows the moment a message does carry their handle.
 */
export function findUpiId(body: string): string | null {
  for (const match of body.matchAll(UPI_ID)) {
    if (!EMAIL_DOMAINS.test(match[1])) {
      return match[1];
    }
  }
  return null;
}
