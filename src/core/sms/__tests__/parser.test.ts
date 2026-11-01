import { FIXTURES } from '../banks/__fixtures__/messages';
import { parseSms } from '../parser';
import type { RawSms } from '../types';

function toRawSms(fixture: (typeof FIXTURES)[number], index: number): RawSms {
  return {
    providerId: 1000 + index,
    senderId: fixture.sender,
    body: fixture.body,
    receivedAt: fixture.receivedAt,
  };
}

describe('parseSms — every format pinned by an example', () => {
  FIXTURES.forEach((fixture, index) => {
    test(fixture.name, () => {
      const result = parseSms(toRawSms(fixture, index));
      const { expect: want } = fixture;

      expect(result.status).toBe(want.status);

      if (result.status === 'IGNORED' || result.status === 'NO_MATCH') {
        if (want.reason !== undefined) {
          expect(result.reason).toBe(want.reason);
        }
        return;
      }

      const tx = result.transaction;
      if (want.parserId !== undefined) {
        expect(result.parserId).toBe(want.parserId);
      }
      if (want.amount !== undefined) {
        expect(tx.amount).toBe(want.amount);
      }
      // Every fixture that does not say otherwise must come out in rupees,
      // so a currency can never leak in unnoticed.
      expect(tx.currency).toBe(want.currency ?? 'INR');
      if (want.type !== undefined) {
        expect(tx.transactionType).toBe(want.type);
      }
      if (want.merchant !== undefined) {
        expect(tx.recipientName).toBe(want.merchant);
      }
      if (want.upiId !== undefined) {
        expect(tx.upiId).toBe(want.upiId);
      }
      if (want.lastFour !== undefined) {
        expect(tx.accountLastFour).toBe(want.lastFour);
      }
      if (want.rrn !== undefined) {
        expect(tx.rrn).toBe(want.rrn);
      }
      if (want.occurredOn !== undefined) {
        expect(tx.occurredOn).toBe(want.occurredOn);
      }
      if (want.hasExplicitTime !== undefined) {
        expect(tx.hasExplicitTime).toBe(want.hasExplicitTime);
      }
      if (want.balance !== undefined) {
        expect(tx.balance).toBe(want.balance);
      }
    });
  });
});
