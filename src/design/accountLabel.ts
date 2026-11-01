/**
 * How an account is written on screen.
 *
 * The screens in `screens/` use two forms. A transaction row has little room
 * and writes `HDFC • • 4821`, while the payment detail screen and the import
 * list have the width for `HDFC Bank • • 4821`.
 */

import type { AccountRow } from '../core/db/models';

/** `4821` reads as `• • 4821`, the way every screen writes it. */
export function maskedDigits(lastFour: string): string {
  return lastFour ? `• • ${lastFour}` : '';
}

/**
 * The bank's own name without the word `Bank`: `IDFC First Bank` becomes
 * `IDFC`, `Kotak Mahindra Bank` becomes `Kotak`.
 *
 * In a transaction row the last four digits are what identify the account, so
 * they must never be the part that gets truncated. Dropping everything after
 * the first word is what keeps them on screen.
 */
export function shortBankName(bankName: string): string {
  return bankName.trim().split(/\s+/)[0] ?? bankName;
}

/**
 * The screens label these "Savings" and "RuPay card". A bank message never
 * says which product an account is, so the label says only what was actually
 * read from it.
 */
export function accountTypeLabel(type: AccountRow['account_type']): string {
  switch (type) {
    case 'CARD':
      return 'Card';
    case 'WALLET':
      return 'Wallet';
    case 'CASH':
      return 'Cash';
    default:
      return 'Bank account';
  }
}

/**
 * How an account is written on a chip: `Cash`, `HDFC • • 4821`.
 *
 * Cash has no digits by design — section 8.3 stores an empty string rather
 * than NULL so two cash rows cannot both exist — so it is named outright
 * instead of being drawn with an empty mask after it.
 */
export function accountChipLabel(account: AccountRow): string {
  if (account.account_type === 'CASH' || account.last_four === '') {
    return account.account_type === 'CASH' ? 'Cash' : shortBankName(account.bank_name);
  }
  return `${shortBankName(account.bank_name)} ${maskedDigits(account.last_four)}`;
}
