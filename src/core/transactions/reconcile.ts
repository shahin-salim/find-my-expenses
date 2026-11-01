/**
 * Matching the two halves of a reversal (section 4.1) and of a transfer
 * between the user's own accounts (section 8.4).
 *
 * Both start from the same fact: the two messages carry the same reference
 * number. What tells them apart is the account.
 *
 *   "The account check is what separates a reversal from a transfer between
 *   the user's own accounts. Those also produce a debit and a credit sharing
 *   one RRN, but the money lands somewhere else. A reversal always returns
 *   money to the account it left."
 *
 * No new index is needed. The dedup key for a transaction with a reference
 * number is the RRN and the transaction type, so from one side the key of the
 * other can be built directly and looked up on the unique index that already
 * exists.
 */

import {
  findByDedupKey,
  markMerchantTransactionsAsTransfers,
  markRefunded,
  markTransfer,
} from '../db/dao/transactions';
import { markMerchantAsSelf } from '../db/dao/merchants';
import type { TransactionRow } from '../db/models';
import type { SqlDatabase } from '../db/types';
import { dedupKeyForReference } from '../sms/dedup';
import { MILLIS_PER_DAY } from '../time/dates';

/**
 * Section 4.3 names this gap and names its fix: "Because the numbering is
 * built from a year digit, it wraps roughly every twelve months and the same
 * value is issued again... Requiring the two to be within about a week of each
 * other rules it out, since a reversal arrives within days."
 *
 * The spec files that as a later change. It is one comparison and it is the
 * difference between a payment the user accepted a year ago quietly leaving
 * their spending and not, so it is here.
 */
export const MAX_REFERENCE_MATCH_GAP = 7 * MILLIS_PER_DAY;

export type ReconcileOutcome =
  | { kind: 'NONE' }
  | { kind: 'REVERSAL'; debitId: number; creditId: number }
  | { kind: 'TRANSFER'; debitId: number; creditId: number };

/**
 * Looks for the other half of `transaction` and marks both sides when it finds
 * it. Runs in both directions, because "the historical import reads messages
 * newest first, so during import the reversal is seen before the payment it
 * reverses."
 */
export function reconcileByReference(
  db: SqlDatabase,
  transaction: TransactionRow,
  now: number = Date.now(),
): ReconcileOutcome {
  if (!transaction.rrn) {
    return { kind: 'NONE' };
  }

  const oppositeType = transaction.transaction_type === 'DEBIT' ? 'CREDIT' : 'DEBIT';
  const counterpart = findByDedupKey(
    db,
    dedupKeyForReference(transaction.rrn, oppositeType),
  );
  if (!counterpart || counterpart.id === transaction.id) {
    return { kind: 'NONE' };
  }

  // Same amount, or it is not the same money coming back.
  if (counterpart.amount !== transaction.amount) {
    return { kind: 'NONE' };
  }

  if (Math.abs(counterpart.occurred_at - transaction.occurred_at) > MAX_REFERENCE_MATCH_GAP) {
    return { kind: 'NONE' };
  }

  const debit =
    transaction.transaction_type === 'DEBIT' ? transaction : counterpart;
  const credit =
    transaction.transaction_type === 'CREDIT' ? transaction : counterpart;

  // An account we could not read cannot answer "same account or not", and
  // section 8.4 is explicit that an unmatched transfer is left as spending.
  if (debit.account_id === null || credit.account_id === null) {
    return { kind: 'NONE' };
  }

  if (debit.account_id === credit.account_id) {
    // Money returned to the account it left: a failed payment coming back.
    //
    // The debit only. Section 4: "The credit is kept as a transaction of its
    // own so the user can see the money arriving" — it is not struck through
    // and not badged, because the money really did arrive. What it must not
    // do is read as income, and `IS_REVERSAL_CREDIT` is how the figures tell
    // that it is the other half of this pair without a flag to look at.
    markRefunded(db, debit.id, now);
    return { kind: 'REVERSAL', debitId: debit.id, creditId: credit.id };
  }

  // Money landed in another of the user's accounts: neither half is spending.
  markTransfer(db, debit.id, now);
  markTransfer(db, credit.id, now);

  // "Marking the merchant is what makes one match worth having. A matched pair
  // proves one payment was a transfer, but the flag is set on the merchant" —
  // so every later payment to the same payee is recognised without a match.
  for (const merchantId of [debit.merchant_id, credit.merchant_id]) {
    if (merchantId !== null) {
      markMerchantAsSelf(db, merchantId, now);
      markMerchantTransactionsAsTransfers(db, merchantId, now);
    }
  }

  return { kind: 'TRANSFER', debitId: debit.id, creditId: credit.id };
}
