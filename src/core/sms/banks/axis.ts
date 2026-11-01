import { defaultMerchant } from './defaults';
import type { BankDefinition, ExtractionContext } from './types';

/**
 * Axis puts the merchant between `on` and the date, which no other bank does:
 *
 *   INR 2000.00 debited from A/c no. XX589034 on BURGRILL 04-12-2025
 *   13:13:27 IST. Avl bal: INR 98919.81.
 *
 * Section 2.4 also notes that Axis debit alerts carry no reference number, so
 * these transactions cannot be matched as transfers or reversals. Nothing is
 * done about that here; the shared reference step simply returns null and
 * section 4.3 covers the consequence.
 */

const MERCHANT_BEFORE_DATE =
  /\bon\s+([A-Za-z][A-Za-z0-9 &'._-]{1,40}?)\s+(?=\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{1,2}[-/][A-Za-z]{3})/;

function axisMerchant(ctx: ExtractionContext): string | null {
  const match = ctx.body.match(MERCHANT_BEFORE_DATE);
  if (match) {
    const name = match[1].trim();
    if (!/^(?:a\/c|acct|account|card|date|dated)$/i.test(name)) {
      return name;
    }
  }
  return defaultMerchant(ctx);
}

export const AXIS: BankDefinition = {
  id: 'axis',
  bankKey: 'axis',
  bankName: 'Axis Bank',
  senderFragments: ['AXISBK', 'AXISBANK'],
  steps: { merchant: axisMerchant },
};
