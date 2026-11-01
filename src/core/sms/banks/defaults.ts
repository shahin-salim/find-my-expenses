/**
 * The shared implementation of every step. A bank inherits all of these and
 * replaces only the ones where it differs.
 */

import {
  findAccountDigits,
  findAmount,
  findDirection,
  findReference,
  findUpiId,
} from '../patterns';
import { resolveTimestamp } from '../dateParsing';
import type { ExtractionContext, ExtractionSteps } from './types';

/**
 * Words that can follow the preposition a merchant sits behind without being
 * the merchant: `debited on 20-Oct-25`, `credited to your account`.
 */
const NOT_A_MERCHANT =
  /^(?:your|you|the|a\/c|acct|account|card|upi|vpa|date|dated|ref|rrn|info|avl|bal|balance|rs|inr)$/i;

/**
 * Where a merchant name ends: a bracket, a semicolon, a comma, or a full stop
 * that actually ends a clause.
 *
 * The full stop has to be qualified. A plain `.` in the terminator cuts
 * `swiggy.stores@axb` down to `swiggy` at its first dot, and the UPI ID stops
 * being recognisable as one.
 */
const NAME_END = String.raw`(?:\s*[(;,]|\s*\.(?:\s|$)|$)`;

/** The body of a name: letters, digits, and the punctuation UPI IDs use. */
const NAME_BODY = String.raw`[A-Za-z0-9][A-Za-z0-9 &'._@*-]{1,40}?`;

/** A merchant name sits in a different place in every bank's wording. */
const MERCHANT_SHAPES: RegExp[] = [
  // The payee at the end of a UPI info block, which is the most reliable
  // place it ever appears:
  //   Info- UPI/P2M/718820044119/CHAI POINT.
  //   Info: UPI/612290014477/Payment to NAMMA YATRI.
  new RegExp(
    String.raw`\bupi\/(?:[A-Za-z0-9]+\/)?\d{6,20}\/(?:pay(?:ment)?\s+to\s+)?(` +
      NAME_BODY + String.raw`)(?=` + NAME_END + String.raw`)`,
    'i',
  ),
  // IDFC and ICICI: `; REDBUS credited.` — the name sits before the word.
  new RegExp(String.raw`[;,.]\s*(` + NAME_BODY + String.raw`)\s+credited\b`, 'i'),
  // HDFC: `to merchant@upi (UPI Ref No ...)`, `to VPA swiggy.stores@axb`
  new RegExp(
    String.raw`\bto\s+(?:vpa\s+)?(` + NAME_BODY +
      String.raw`)(?=` + NAME_END + String.raw`|\s+on\b|\s+UPI\b|\s+ref(?:no\.?|erence)?\s*(?:no\.?|number)?\s*[:#-]?\s*\d)`,
    'i',
  ),
  // Card messages: `at AMAZON on 20-Oct-25`
  new RegExp(
    String.raw`\bat\s+(` + NAME_BODY + String.raw`)(?=` + NAME_END + String.raw`|\s+on\b)`,
    'i',
  ),
  // SBI UPI: `trf to SWIGGY Refno 123`
  new RegExp(
    String.raw`\btrf\s+to\s+(` + NAME_BODY +
      String.raw`)(?=` + NAME_END + String.raw`|\s+ref(?:no\.?|erence)?\s*(?:no\.?|number)?\s*[:#-]?\s*\d)`,
    'i',
  ),
  // ESAF and others: `from JOHN DOE`
  new RegExp(
    String.raw`\bfrom\s+(?:vpa\s+)?([A-Za-z][A-Za-z0-9 &'._@-]{1,40}?)(?=` +
      NAME_END + String.raw`|\s+on\b)`,
    'i',
  ),
];

/**
 * A loose shape can run past the end of the name and into the rest of the
 * sentence: `to SWIGGY has failed` yields `SWIGGY has failed`. Cutting at the
 * first of these words keeps the name and drops the sentence.
 *
 * The list is deliberately short. Words that turn up inside real merchant
 * names, such as `and` or `the`, are not on it.
 */
const SENTENCE_TAIL =
  /\s+(?:has|have|is|was|were|will|your|info|avl|bal|lmt|not|via|from|on|ref|rrn|upi|towards|using|call)\b.*$/i;

function tidyMerchantName(raw: string): string {
  return raw.replace(SENTENCE_TAIL, '').trim().replace(/[.,;:-]+$/, '').trim();
}

/**
 * `Rs.5,000.00 credited to your A/c` and `; REDBUS credited` have the same
 * shape: something, then the word `credited`. The comma inside `5,000.00` sits
 * exactly where a payee sits, so without this check the payee of every credit
 * comes out as `000.00`.
 */
const LOOKS_LIKE_AN_AMOUNT = /^(?:(?:rs|inr)\.?|₹)?\s*[\d,]+(?:\.\d{1,2})?$/i;

/**
 * An account reference is never a payee.
 *
 * ICICI words an incoming UPI payment as `Acct XX903 is credited with Rs 2.00
 * on 15-Oct-26 from Google Cloud.` The subject of that sentence sits exactly
 * where the payee sits in `; REDBUS credited.`, and once the sentence tail
 * trims `is` away what is left looks like a perfectly ordinary name. The
 * payer after `from` is then never reached.
 *
 * Section 8.4 makes the consequence worse than a wrong label: the account is
 * recognised as one of the user's own, so every payment anyone sends them is
 * filed as a transfer between their own accounts and leaves their income.
 */
const ACCOUNT_REFERENCE = /^(?:a\/c|acct|account|card)\b|^[x*]+\d+$/i;

function isPlausibleName(name: string): boolean {
  return /[A-Za-z]/.test(name) && !LOOKS_LIKE_AN_AMOUNT.test(name);
}

export function defaultMerchant(ctx: ExtractionContext): string | null {
  for (const shape of MERCHANT_SHAPES) {
    const match = ctx.body.match(shape);
    if (!match) {
      continue;
    }
    const name = tidyMerchantName(match[1]);
    if (
      !name ||
      NOT_A_MERCHANT.test(name) ||
      ACCOUNT_REFERENCE.test(name) ||
      !isPlausibleName(name)
    ) {
      continue;
    }
    // A bare date caught by a loose shape is not a name either.
    if (/^\d{1,2}[-/]/.test(name)) {
      continue;
    }
    return name;
  }
  return null;
}

export const DEFAULT_STEPS: ExtractionSteps = {
  amount: (ctx) => findAmount(ctx.actionText),
  direction: (ctx) => findDirection(ctx.actionText),
  accountDigits: (ctx) => findAccountDigits(ctx.body),
  reference: (ctx) => findReference(ctx.body),
  merchant: defaultMerchant,
  upiId: (ctx) => findUpiId(ctx.body),
  timestamp: (ctx) => resolveTimestamp(ctx.body, ctx.receivedAt),
};

/** Fills the steps a bank did not replace with the shared ones. */
export function withDefaults(
  overrides: Partial<ExtractionSteps> | undefined,
): ExtractionSteps {
  return { ...DEFAULT_STEPS, ...(overrides ?? {}) };
}
