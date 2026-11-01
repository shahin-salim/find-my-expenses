/**
 * Section 2.1, deciding whether a message is a transaction.
 *
 * "Each message passes three gates in order. The first gate it fails ends it
 * there."
 *
 * The rules here are shared by every bank and are never copied into a bank's
 * reader. Section 2.3: "Copies of a list like that drift apart, and the drift
 * shows up as reminders and one-time passwords being recorded as spending for
 * whichever bank's copy fell behind."
 */

import { isKnownBankSender } from './banks';
import type { IgnoreReason } from './types';

export type GateResult = { passed: true } | { passed: false; reason: IgnoreReason };

/* -------------------------------------------------------------------------- */
/* Gate two — the reject list                                                  */
/* -------------------------------------------------------------------------- */

/**
 * "Some wording means the message is not a payment whatever else it contains.
 * The reject list is checked before any bank pattern, so a reject always beats
 * a match."
 */
export const REJECT_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  // One-time passwords
  { label: 'otp', regex: /\botp\b/i },
  { label: 'otp', regex: /\bone[\s-]?time\s+(?:password|pin|passcode)\b/i },
  { label: 'otp', regex: /\bdo\s*n[o']?t\s+share\b/i },
  { label: 'otp', regex: /\bnever\s+share\b/i },
  { label: 'otp', regex: /\bverification\s+code\b/i },
  { label: 'otp', regex: /\bsecure\s+code\b/i },

  // Collect requests
  { label: 'collect', regex: /\bis\s+requesting\b/i },
  { label: 'collect', regex: /\bhas\s+requested\b/i },
  { label: 'collect', regex: /\bcollect\s+request\b/i },
  { label: 'collect', regex: /\bapprove\s+to\s+pay\b/i },
  { label: 'collect', regex: /\bpayment\s+request\b/i },
  { label: 'collect', regex: /\brequesting\s+money\b/i },

  // Payments that have not happened yet
  { label: 'upcoming', regex: /\bwill\s+be\s+debited\b/i },
  { label: 'upcoming', regex: /\bwill\s+be\s+deducted\b/i },
  { label: 'upcoming', regex: /\bwill\s+be\s+charged\b/i },
  { label: 'upcoming', regex: /\bis\s+due\b/i },
  { label: 'upcoming', regex: /\bdue\s+on\b/i },
  { label: 'upcoming', regex: /\bscheduled\s+for\b/i },
  { label: 'upcoming', regex: /\bauto[\s-]?pay\b/i },

  // Credit card bills that have not been paid yet.
  //
  // The monthly reminder names the amount outstanding and the date it has to
  // be paid by, then signs off `Ignore if paid` — and `paid` is a movement
  // verb, so gate three reads the message as money that has already moved and
  // lets it through. The bill is then recorded as a payment on the day the
  // reminder arrived, and recorded a second time when it is genuinely paid.
  //
  // `due on` above does not cover these: the wording is `Amount Due of Rs X
  // ... by 08-Oct-26`, which never puts `due` and a date next to each other.
  { label: 'due', regex: /\b(?:amount|amt\.?)\s+due\b/i },
  { label: 'due', regex: /\bdue\s+(?:by|date)\b/i },
  { label: 'due', regex: /\bignore\s+if\s+(?:already\s+)?paid\b/i },

  // Offers and reminders
  { label: 'offer', regex: /\bpre[\s-]?approved\b/i },
  { label: 'offer', regex: /\boffer\b/i },
  { label: 'offer', regex: /\bapply\s+now\b/i },
  { label: 'offer', regex: /\breward\s+points\b/i },
  { label: 'offer', regex: /\bupgrade\b/i },
];

export function findRejectReason(body: string): string | null {
  for (const { label, regex } of REJECT_PATTERNS) {
    if (regex.test(body)) {
      return label;
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Gate three — money that has already moved                                   */
/* -------------------------------------------------------------------------- */

/**
 * "What survives has to say that money actually moved and that it has already
 * happened... An amount on its own is never enough."
 */
const MOVEMENT_VERBS =
  /\b(debited|credited|spent|paid|withdrawn|withdrawal|transferred|received|deducted|deposited|sent)\b/gi;

/**
 * Wording that turns the verb immediately after it into something that did not
 * happen: `could not be debited`, `was not credited`.
 *
 * The window is deliberately short. Section 2.1: "A reversal often arrives
 * worded as a failure, for example a payment that failed and the amount
 * credited back... Rejecting on the word 'failed' would throw it away, and the
 * debit it reverses would stay in the user's spending for good."
 *
 * So `failed. Rs.500 has been credited` keeps its credit, while
 * `could not be debited` loses its debit.
 */
const NEGATION_BEFORE_VERB =
  /(?:\bnot|n't|\bunable\s+to|\bfailed\s+to|\bcannot|\bdeclined\s+to|\bunsuccessful)\s+(?:be\s+|been\s+|get\s+)?$/i;

const NEGATION_WINDOW = 16;

/** True when at least one movement verb in the body is not negated. */
export function describesCompletedMovement(body: string): boolean {
  MOVEMENT_VERBS.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = MOVEMENT_VERBS.exec(body)) !== null) {
    const windowStart = Math.max(0, match.index - NEGATION_WINDOW);
    const preceding = body.slice(windowStart, match.index);
    if (!NEGATION_BEFORE_VERB.test(preceding)) {
      return true;
    }
  }

  // No verb at all, or every one of them negated: nothing moved.
  return false;
}

/* -------------------------------------------------------------------------- */
/* The gates in order                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Runs all three gates. `body` must already be normalized, because SBI's
 * look-alike letters would otherwise slip past gate two as well as gate three.
 */
export function runGates(senderId: string, body: string): GateResult {
  // Gate one: "Anything else is skipped without the body being read at all.
  // This is also what keeps the promise made on the permission screen, that
  // only bank messages are read."
  if (!isKnownBankSender(senderId)) {
    return { passed: false, reason: 'NOT_A_BANK_SENDER' };
  }

  if (findRejectReason(body) !== null) {
    return { passed: false, reason: 'REJECT_LIST' };
  }

  // Gate three catches what no reject phrase would: balance alerts, credit
  // limit notices, and declined payments.
  if (!describesCompletedMovement(body)) {
    return { passed: false, reason: 'NO_MONEY_MOVED' };
  }

  return { passed: true };
}
