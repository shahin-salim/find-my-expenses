/**
 * Types for the SMS → transaction pipeline described in TECHNICAL_IMPLEMENTATION.md
 * sections 2 (extraction) and 3 (deduplication).
 */

export type TransactionType = 'DEBIT' | 'CREDIT';

/** A message as it comes off the device inbox. */
export interface RawSms {
  /** The id the device gives this message in its inbox. Unique per message. */
  providerId: number;
  /** Sender ID as received, e.g. `AD-HDFCBK-S`. */
  senderId: string;
  body: string;
  /** When the message arrived, epoch millis. */
  receivedAt: number;
}

/** Why a message was not turned into a transaction. */
export type IgnoreReason =
  | 'NOT_A_BANK_SENDER' // gate one
  | 'REJECT_LIST' // gate two
  | 'NO_MONEY_MOVED'; // gate three

/** Why a message from a bank sender could not be read. */
export type NoMatchReason =
  | 'NO_AMOUNT'
  | 'NO_DIRECTION'
  | 'NO_PARSER_PRODUCED_A_TRANSACTION';

/** Everything section 2.2 asks to be pulled out of a message. */
export interface ExtractedTransaction {
  /**
   * The amount in the minor unit of `currency`, always positive. The sign
   * comes from `transactionType`.
   */
  amount: number;
  /**
   * `INR` for all but a card used abroad. Section 2.3: the rupee figure in
   * `USD 11.80 spent ... Avl Limit: INR 17,95,899.53` is the credit limit, not
   * the purchase, so there is no rupee amount to record and no exchange rate
   * on the device to make one. The purchase is kept in the currency the bank
   * wrote rather than dropped, and section 10's spending clause requires INR
   * so it can never be added into a rupee total.
   */
  currency: string;
  transactionType: TransactionType;
  /** Epoch millis. Falls back to the message arrival when the body gives no time. */
  occurredAt: number;
  /** Local date `YYYY-MM-DD`, used for day/week/month grouping. */
  occurredOn: string;
  /**
   * Whether the body itself carried a clock time. Section 3.2: a message with no
   * time of its own is never used to merge transactions, because a batch of
   * delayed messages all arrive at the same instant.
   */
  hasExplicitTime: boolean;
  /** Merchant or recipient name exactly as the message wrote it. */
  recipientName: string | null;
  upiId: string | null;
  /** UPI reference number / RRN. Always text — see section 4.3. */
  rrn: string | null;
  /** Last four (or three) digits of the account or card. */
  accountLastFour: string | null;
  bankKey: string;
  bankName: string;
  senderId: string;
  /** Which bank pattern matched, stored on the transaction as parse evidence. */
  parserId: string;
  /** Balance reported after the action, in paise. Not currently persisted. */
  balance: number | null;
}

export type ParseResult =
  | { status: 'PARSED'; parserId: string; transaction: ExtractedTransaction }
  | { status: 'IGNORED'; reason: IgnoreReason; parserId: string | null }
  | { status: 'NO_MATCH'; reason: NoMatchReason; parserId: string | null };

/** What stage one of the import (section 1.1) takes from a message. */
export interface DiscoveredAccount {
  bankKey: string;
  bankName: string;
  /** Normalized to the last four digits, or three when that is all the bank gives. */
  lastFour: string;
  accountType: 'BANK' | 'CARD';
}
