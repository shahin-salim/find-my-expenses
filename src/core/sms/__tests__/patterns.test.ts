/**
 * Section 8.4's preferred identity: the payee's UPI handle, when the message
 * carries one.
 */

import { findUpiId } from '../patterns';

describe('finding the handle', () => {
  it('looks past a support address to the payee', () => {
    // Plenty of bank messages print a helpdesk address before they name the
    // payee. Rejecting that one used to mean giving up on the message, after
    // which the payee was identified by name instead — and the same person
    // ends up as two merchant rows the moment a message does carry a handle.
    expect(
      findUpiId(
        'For queries write to care@hdfcbank.com. Sent Rs.250 to swiggy.stores@axb',
      ),
    ).toBe('swiggy.stores@axb');
  });

  it('still returns nothing when every candidate is an email address', () => {
    expect(findUpiId('For queries write to care@hdfcbank.com only')).toBeNull();
  });

  it('takes the first handle when the message leads with one', () => {
    expect(findUpiId('Sent Rs.250 to swiggy.stores@axb from rahul@okicici')).toBe(
      'swiggy.stores@axb',
    );
  });
});
