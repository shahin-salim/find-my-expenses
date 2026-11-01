import type { BankDefinition } from './types';

/**
 * IDFC First sends from both `IDFCFB` and `IDFCBK`. Section 2.4: "Matching on
 * the bank's part of the sender rather than the whole sender ID is what keeps
 * these together."
 *
 * Formats are covered by the shared steps:
 *   Your A/c XX4614 debited by Rs. 1,172.06 on 15/01/26; REDBUS credited.
 *   RRN 060649915527. Available balance Rs. 9,134.15.
 */
export const IDFC: BankDefinition = {
  id: 'idfc',
  bankKey: 'idfc',
  bankName: 'IDFC First Bank',
  senderFragments: ['IDFCFB', 'IDFCBK', 'IDFCFIRST'],
};
