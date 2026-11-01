import { findAmount } from '../patterns';
import type { BankDefinition, ExtractionContext } from './types';
import type { AmountReading } from '../patterns';

/**
 * SBI needs two things the shared steps do not give it.
 *
 * Its UPI alerts omit the currency entirely:
 *
 *   Dear UPI user A/C X1234 debited by 500.0 on date 13Sep25 trf to SWIGGY
 *   refno 123456789012
 *
 * and its card messages are written in Unicode look-alike letters, which
 * section 2.4 calls out: "the word that reads as `spent on your SBI Credit
 * Card` is not made of ordinary letters, so a pattern looking for the plain
 * word matches nothing and the whole message is unreadable." Folding those
 * back to ASCII happens before any step runs, in normalize.ts, so nothing
 * bank-specific is needed for it here.
 */

/** `debited by 500.0`, `credited by 1,200` — no `Rs.` anywhere. */
const BARE_AMOUNT = /\b(?:debited|credited)\s+by\s+(\d[\d,]*(?:\.\d{1,2})?)/i;

function sbiAmount(ctx: ExtractionContext): AmountReading | null {
  // The shared pattern runs first; only when there is no currency marker at
  // all does the bare form apply.
  const shared = findAmount(ctx.actionText);
  if (shared) {
    return shared;
  }
  const match = ctx.actionText.match(BARE_AMOUNT);
  if (!match) {
    return null;
  }
  const cleaned = match[1].replace(/,/g, '');
  const [whole, fraction = ''] = cleaned.split('.');
  return {
    paise: parseInt(whole, 10) * 100 + parseInt((fraction + '00').slice(0, 2), 10),
  };
}

export const SBI: BankDefinition = {
  id: 'sbi',
  bankKey: 'sbi',
  bankName: 'SBI',
  senderFragments: ['ATMSBI', 'SBIUPI', 'SBIINB', 'SBIPSG', 'SBIBNK', 'SBI'],
  steps: { amount: sbiAmount },
};

/**
 * SBI Card is a different issuer from the bank and sits ahead of it in the
 * registry, because `SBICRD` would otherwise be claimed by the broad `SBI`
 * fragment above and the transaction would be filed against a savings account
 * that does not exist.
 */
export const SBI_CARD: BankDefinition = {
  id: 'sbicard',
  bankKey: 'sbicard',
  bankName: 'SBI Card',
  senderFragments: ['SBICRD', 'SBICARD'],
  defaultAccountType: 'CARD',
  steps: { amount: sbiAmount },
};
