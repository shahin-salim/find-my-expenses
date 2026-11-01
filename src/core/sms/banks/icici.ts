import { DEFAULT_STEPS, defaultMerchant } from './defaults';
import type { BankDefinition, ExtractionContext } from './types';

/**
 * ICICI is the bank section 2.3 uses as its worked example, for two reasons.
 *
 * It writes the account seven different ways, which the shared account label
 * already covers (`Acct`, `Acc`, `Account`, `Card`, `Credit Card`).
 *
 * And its card messages can be in a foreign currency:
 *
 *   USD 11.80 spent using ICICI Bank Card XX7004 on 03-Sep-25 on
 *   1xJetBrains AI. Avl Limit: INR 17,95,899.53.
 *
 * "The only one of those present is the credit limit at the end, so the shared
 * pattern would record a eleven dollar purchase as a payment of seventeen lakh
 * rupees." The shared amount step handles this by masking the limit and by
 * preferring whichever currency comes first.
 */

/** ICICI card messages put the merchant after the date, not after `at`. */
const MERCHANT_AFTER_DATE =
  /\bon\s+\d{1,2}[-/][A-Za-z0-9]{2,4}[-/]\d{2,4}\s+on\s+([A-Za-z0-9][A-Za-z0-9 &'._-]{1,40}?)(?=\s*[;,]|\s*\.(?:\s|$)|$)/i;

function iciciMerchant(ctx: ExtractionContext): string | null {
  // The bank's own shape runs first here, because the shared `at` and `to`
  // shapes would otherwise take the wrong half of a card message.
  const match = ctx.body.match(MERCHANT_AFTER_DATE);
  if (match) {
    return match[1].trim();
  }
  return defaultMerchant(ctx);
}

export const ICICI: BankDefinition = {
  id: 'icici',
  bankKey: 'icici',
  bankName: 'ICICI Bank',
  senderFragments: ['ICICIT', 'ICICIB', 'ICICIM', 'ICICI'],
  steps: {
    merchant: iciciMerchant,
    amount: DEFAULT_STEPS.amount,
  },
};
