/**
 * Section 2.3, the fixed sequence every message goes through:
 *
 *   1. Is this a transaction at all? The three gates in section 2.1.
 *   2. What is the amount? If no amount is found, stop here.
 *   3. Is it money in or money out? If that cannot be decided, stop here.
 *   4. Everything else: the merchant, the reference number, the account
 *      digits, the balance.
 *
 * "Stopping at step two or three is what keeps a half read message out of the
 * database. A message with a merchant and an account but no amount is not a
 * transaction with a field missing, it is a message that was not understood,
 * and it is recorded as unreadable rather than guessed at."
 */

import { resolveBanks } from './banks';
import { withDefaults } from './banks/defaults';
import type { BankDefinition, ExtractionContext } from './banks/types';
import { runGates } from './gates';
import { normalizeMessageBody } from './normalize';
import { maskBalances } from './patterns';
import type {
  ExtractedTransaction,
  NoMatchReason,
  ParseResult,
  RawSms,
} from './types';

type BankAttempt =
  | { ok: true; transaction: ExtractedTransaction }
  | { ok: false; reason: NoMatchReason };

function runBank(bank: BankDefinition, ctx: ExtractionContext): BankAttempt {
  const steps = withDefaults(bank.steps);

  // Step two. No amount means the message was not understood.
  const amount = steps.amount(ctx);
  if (!amount) {
    return { ok: false, reason: 'NO_AMOUNT' };
  }

  // Step three. Money in or money out, or stop.
  const transactionType = steps.direction(ctx);
  if (!transactionType) {
    return { ok: false, reason: 'NO_DIRECTION' };
  }

  // Step four. Everything that is allowed to be missing.
  const timestamp = steps.timestamp(ctx);
  const recipientName = steps.merchant(ctx);
  const upiId = steps.upiId(ctx);

  return {
    ok: true,
    transaction: {
      amount: amount.paise,
      currency: amount.foreignCurrency ?? 'INR',
      transactionType,
      occurredAt: timestamp.occurredAt,
      occurredOn: timestamp.occurredOn,
      hasExplicitTime: timestamp.hasExplicitTime,
      // A bare UPI ID caught by the merchant shape is not a name.
      recipientName:
        recipientName && recipientName === upiId ? null : recipientName,
      upiId,
      rrn: steps.reference(ctx),
      accountLastFour: steps.accountDigits(ctx),
      bankKey: bank.bankKey,
      bankName: bank.bankName,
      senderId: ctx.senderId,
      parserId: bank.id,
      balance: ctx.balance,
    },
  };
}

/**
 * Reads one message. Never throws; a message that cannot be read comes back as
 * `NO_MATCH` so it can be recorded and shown on the unreadable messages screen.
 */
export function parseSms(sms: RawSms): ParseResult {
  const body = normalizeMessageBody(sms.body);

  const gate = runGates(sms.senderId, body);
  if (!gate.passed) {
    return { status: 'IGNORED', reason: gate.reason, parserId: null };
  }

  const { actionText, balance } = maskBalances(body);
  const ctx: ExtractionContext = {
    body,
    actionText,
    balance,
    senderId: sms.senderId,
    receivedAt: sms.receivedAt,
  };

  // The sender narrows the candidates; the message content decides between
  // them. The first reader that actually produces a transaction wins.
  const candidates = resolveBanks(sms.senderId);
  let lastFailure: { reason: NoMatchReason; parserId: string } | null = null;

  for (const bank of candidates) {
    const attempt = runBank(bank, ctx);
    if (attempt.ok) {
      return {
        status: 'PARSED',
        parserId: bank.id,
        transaction: attempt.transaction,
      };
    }
    lastFailure = { reason: attempt.reason, parserId: bank.id };
  }

  return lastFailure
    ? { status: 'NO_MATCH', reason: lastFailure.reason, parserId: lastFailure.parserId }
    : { status: 'NO_MATCH', reason: 'NO_PARSER_PRODUCED_A_TRANSACTION', parserId: null };
}
