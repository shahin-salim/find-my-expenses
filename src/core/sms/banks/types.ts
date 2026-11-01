/**
 * Section 2.3: "This cannot be one pattern that covers everything, and it
 * cannot be a separate reader written from scratch per bank either, because
 * then the same mistake has to be fixed a few hundred times. What works is a
 * fixed sequence of steps, where any one step can be replaced for a bank that
 * needs it."
 */

import type { AmountReading } from '../patterns';
import type { MessageTimestamp } from '../dateParsing';
import type { TransactionType } from '../types';

export interface ExtractionContext {
  /** The body after look-alike folding and whitespace collapsing. */
  body: string;
  /**
   * The same body with balance clauses masked out by spaces. Amount and
   * direction are read from here so a reported balance is never mistaken for
   * the action. Indices still line up with `body`.
   */
  actionText: string;
  /** The balance the message reported, in paise, or null. */
  balance: number | null;
  senderId: string;
  receivedAt: number;
}

/**
 * Every step a bank may replace. A bank that does not replace a step inherits
 * the shared one, and a bank's own step is free to try the shared pattern
 * first and fall back to its own.
 */
export interface ExtractionSteps {
  amount(ctx: ExtractionContext): AmountReading | null;
  direction(ctx: ExtractionContext): TransactionType | null;
  accountDigits(ctx: ExtractionContext): string | null;
  reference(ctx: ExtractionContext): string | null;
  merchant(ctx: ExtractionContext): string | null;
  upiId(ctx: ExtractionContext): string | null;
  timestamp(ctx: ExtractionContext): MessageTimestamp;
}

export interface BankDefinition {
  /** Stored on the transaction as `parser_id`. */
  id: string;
  /** Stable key that drives the logo lookup and groups sender IDs. */
  bankKey: string;
  bankName: string;
  /**
   * Matched against the sender ID with punctuation stripped and uppercased,
   * so `AD-IDFCFB-S` becomes `ADIDFCFBS` and `IDFCFB` matches inside it.
   *
   * Section 2.3: "Sender matching is deliberately loose, on the bank's part of
   * the sender ID rather than the whole thing, because one bank sends from
   * many sender IDs."
   */
  senderFragments: string[];
  /** Only the steps this bank differs on. */
  steps?: Partial<ExtractionSteps>;
  /**
   * Extra rejections layered on top of the shared list. Section 2.3: "A bank
   * that needs an extra rejection adds it on top of the shared list rather
   * than restating the list."
   */
  extraRejects?: RegExp[];
  /** What kind of payment source this bank's messages describe by default. */
  defaultAccountType?: 'BANK' | 'CARD';
}
