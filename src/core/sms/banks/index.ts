import { AXIS } from './axis';
import { ESAF } from './esaf';
import { GENERIC_BANKS } from './generic';
import { HDFC } from './hdfc';
import { ICICI } from './icici';
import { IDFC } from './idfc';
import { SBI, SBI_CARD } from './sbi';
import type { BankDefinition } from './types';

/**
 * Section 2.3: "They are tried in a fixed order and the first one that
 * recognises the sender takes the message... the narrower reader has to sit
 * ahead of the broader one in the list. This failure is silent: the message
 * still parses, it just parses as the wrong thing."
 *
 * So anything whose fragments could be swallowed by a broader reader goes
 * first. `SBI_CARD` ahead of `SBI` is the live example: the `SBI` fragment
 * matches inside `SBICRD`.
 */
export const BANK_REGISTRY: BankDefinition[] = [
  SBI_CARD,
  HDFC,
  ICICI,
  IDFC,
  AXIS,
  ESAF,
  SBI,
  ...GENERIC_BANKS,
];

/** `AD-IDFCFB-S` becomes `ADIDFCFBS`, so `IDFCFB` matches inside it. */
export function normalizeSenderId(senderId: string): string {
  return senderId.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Every reader that recognises this sender, in registry order.
 *
 * Section 2.3: "More than one reader can claim the same sender. When that
 * happens each is tried in turn and the first one that actually produces a
 * transaction wins, so the sender narrows the candidates and the message
 * content decides between them."
 */
export function resolveBanks(senderId: string): BankDefinition[] {
  const normalized = normalizeSenderId(senderId);
  return BANK_REGISTRY.filter((bank) =>
    bank.senderFragments.some((fragment) => normalized.includes(fragment)),
  );
}

/** Gate one in section 2.1: is this sender a bank the app knows at all? */
export function isKnownBankSender(senderId: string): boolean {
  return resolveBanks(senderId).length > 0;
}

export type { BankDefinition, ExtractionContext, ExtractionSteps } from './types';
