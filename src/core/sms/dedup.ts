/**
 * Section 3.2, the transaction-level deduplication key.
 *
 * "Every transaction is stored with a deduplication key, and that key must be
 * unique. If a new transaction produces a key that already exists, the
 * transaction is not stored."
 *
 * This catches what the message-level check cannot: one payment that arrives
 * as two differently worded messages, such as an account alert and a card
 * alert for the same purchase.
 */

import { floorToMinute } from '../time/dates';
import { normalizeMerchantName } from './normalize';
import type { ExtractedTransaction, TransactionType } from './types';

/**
 * The key a transaction with a reference number gets.
 *
 * Section 4.1 depends on being able to build this from either side: "from a
 * credit the key of the matching debit can be built directly and looked up on
 * the unique index that already exists."
 */
export function dedupKeyForReference(
  rrn: string,
  transactionType: TransactionType,
): string {
  return `rrn:${rrn}:${transactionType}`;
}

export interface DedupInputs {
  transaction: ExtractedTransaction;
  /** The id the device gave the message in its inbox. */
  providerId: number;
  /** Resolved account row id, or null when the message gave no digits. */
  accountId: number | null;
}

export function dedupKeyForSms({
  transaction,
  providerId,
  accountId,
}: DedupInputs): string {
  if (transaction.rrn) {
    return dedupKeyForReference(transaction.rrn, transaction.transactionType);
  }

  if (transaction.hasExplicitTime) {
    // The minute is deliberately narrow: "A user can pay the same amount to
    // the same place twice in a day, for example two metro journeys of the
    // same fare, and those are different payments that must both be kept."
    const recipient = transaction.recipientName
      ? normalizeMerchantName(transaction.recipientName)
      : transaction.upiId ?? '';
    const minute = floorToMinute(transaction.occurredAt);
    return [
      'fp',
      accountId ?? 'noacct',
      transaction.amount,
      transaction.transactionType,
      recipient,
      minute,
    ].join(':');
  }

  // Section 2.2: "a phone that was switched off or out of coverage receives a
  // batch of older messages at once, and every one of them is timed to the
  // moment the batch arrived. This is why a message with no time of its own is
  // never used to merge transactions." Every such message gets its own key.
  return `sms:${providerId}`;
}

/** Manual entries can never collide with each other or with a parsed message. */
export function dedupKeyForManualEntry(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `manual:${Date.now().toString(36)}:${random}`;
}
