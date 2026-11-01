import type { BankDefinition } from './types';

/**
 * ESAF writes `A/c XXX7143`, `Rs. 1.00` and `UPI Ref No:`, all shared.
 *
 * Section 8.4 notes that its credit alerts are one of the cases where a
 * transfer cannot be matched, because the credit side carries no merchant.
 */
export const ESAF: BankDefinition = {
  id: 'esaf',
  bankKey: 'esaf',
  bankName: 'ESAF Small Finance Bank',
  senderFragments: ['ESAFBK', 'ESAFSB', 'ESAFBN'],
};
