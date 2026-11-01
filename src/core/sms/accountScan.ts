/**
 * Stage one of the historical import, section 1.1.
 *
 * "Read through the messages looking for one thing only: the bank behind the
 * sender ID and the account or card digits. Every distinct bank and digit pair
 * becomes a row in the accounts table. Nothing else is written in this stage."
 *
 * "Stage one is also quick, because it looks for account digits rather than
 * running every bank's full transaction pattern." So this deliberately does
 * not call parseSms: no gates beyond the sender, no amount, no direction.
 */

import { resolveBanks } from './banks';
import { describesCompletedMovement, findRejectReason } from './gates';
import { normalizeMessageBody } from './normalize';
import { findAccountDigits } from './patterns';
import type { DiscoveredAccount, RawSms } from './types';

/**
 * Wording that means the digits belong to a card of its own rather than to a
 * bank account.
 *
 * A debit card is deliberately not on this list. It draws on the bank account
 * whose digits it carries, so `SBI Debit Card XX0863` and `A/c X0863` are one
 * account, not two. Filing them apart splits the user's spending across a
 * savings row and a card row that hold the same money.
 */
const CARD_CONTEXT =
  /\b(?:credit\s+card|cc\s+xx|rupay\s+(?:credit|card)|card\s+(?:no\.?|ending|xx))/i;

/** A debit card transaction belongs to the account behind the card. */
const DEBIT_CARD = /\bdebit\s+card\b/i;

/**
 * Takes the bank and the account digits out of one message, or nothing.
 *
 * A message with no account digits contributes no account, which is correct:
 * "Not the amount, not the date, not the name, not the reference number."
 */
export function scanForAccount(sms: RawSms): DiscoveredAccount | null {
  const banks = resolveBanks(sms.senderId);
  if (banks.length === 0) {
    return null;
  }

  const body = normalizeMessageBody(sms.body);

  /*
   * Gates two and three from section 2.1, before the digits are taken.
   *
   * Section 1.1 describes stage one as looking for "one thing only: the bank
   * behind the sender ID and the account or card digits", with no mention of
   * the gates. On a real inbox that invents accounts. Found on a device where
   * five of eleven accounts came only from messages that never became a
   * transaction: two NCMC prepaid transit cards whose top-up alerts carry a
   * card number, a debit card named in a failed service-charge notice, and a
   * debit card known only from standing-instruction and OTP messages.
   *
   * Each of those showed on Home as an account holding no money.
   *
   * This stays within the reason stage one is quick. The gates are two shared
   * regex lists, not "every bank's full transaction pattern" — the amount, the
   * direction and the merchant are still not read here.
   */
  if (findRejectReason(body) !== null || !describesCompletedMovement(body)) {
    return null;
  }

  const lastFour = findAccountDigits(body);
  if (!lastFour) {
    return null;
  }

  const bank = banks[0];
  const accountType =
    bank.defaultAccountType ??
    (!DEBIT_CARD.test(body) && CARD_CONTEXT.test(body) ? 'CARD' : 'BANK');

  return {
    bankKey: bank.bankKey,
    bankName: bank.bankName,
    lastFour,
    accountType,
  };
}

/** The identity used to tell one discovered account from another. */
export function accountIdentity(account: DiscoveredAccount): string {
  return `${account.bankKey}|${account.lastFour}|${account.accountType}`;
}
