import type { BankDefinition } from './types';

/**
 * HDFC inherits every shared step. Its messages use `Rs.`, `A/c XX1234` or
 * `A/C *1234`, `UPI Ref No` and `Avl bal`, all of which the shared patterns
 * already know.
 *
 * The sender fragment is `HDFCBK` and not `HDFC`, deliberately. Section 2.3:
 * "a reader claiming `HDFC` broadly will also swallow HDFC's mutual fund
 * alerts". Those arrive from `HDFCMF` and are left to fail gate one.
 */
export const HDFC: BankDefinition = {
  id: 'hdfc',
  bankKey: 'hdfc',
  bankName: 'HDFC Bank',
  senderFragments: ['HDFCBK', 'HDFCBN'],
};
