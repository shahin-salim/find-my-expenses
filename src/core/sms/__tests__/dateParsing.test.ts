/**
 * Section 2.4's date shapes, and the two ways reading them used to go wrong.
 *
 * Both are about giving up too early. A pattern was asked for its first match
 * in the body and no more, so anything shaped like a date that was not one
 * took the whole pattern down with it; and a day number was checked against
 * 31 rather than against its own month, so `31-02` became 3 March without a
 * word. The cost of the first is in section 3.2: a message with no readable
 * time falls back to its arrival, which changes its dedup key, and the same
 * payment arriving twice is then stored twice.
 */

import { resolveTimestamp } from '../dateParsing';

/** 20 Sep 2025, 10:00 local. */
const RECEIVED = new Date(2025, 8, 20, 10, 0, 0).getTime();

describe('reading the date', () => {
  it('looks past a reference number shaped like a date', () => {
    // `12ABC34` matches SBI's no-separator pattern exactly — two digits,
    // three letters, two digits — and `ABC` is not a month. The real date is
    // four words later and used to be unreachable.
    const result = resolveTimestamp(
      'Txn ref 12ABC34 on 13Sep25 Rs.500 debited',
      RECEIVED,
    );

    expect(result.occurredOn).toBe('2025-09-13');
  });

  it('refuses a day its month does not have', () => {
    // `new Date(2025, 1, 31)` is 3 March and says nothing about it. Falling
    // back to the arrival is the honest answer: the body named a day that
    // does not exist, so the body is no help.
    const result = resolveTimestamp('Rs.100 debited on 31-02-25', RECEIVED);

    expect(result.occurredOn).toBe('2025-09-20');
    expect(result.occurredOn).not.toBe('2025-03-03');
  });

  it('still reads a real end-of-month day', () => {
    // The guard above must not cost a legitimate 31st.
    const result = resolveTimestamp('Rs.100 debited on 31-01-25', RECEIVED);

    expect(result.occurredOn).toBe('2025-01-31');
  });

  it('keeps February in February when it steps the year back', () => {
    // A date that reads as the future means the year was guessed wrong, and
    // stepping it back one field at a time carried 29 February into 1 March
    // in a year with no 29th. Which day in February it lands on is a guess
    // either way; landing in March is a different month.
    const result = resolveTimestamp('Rs.100 debited on 29-Feb-28', RECEIVED);

    expect(result.occurredOn).toBe('2027-02-28');
    expect(result.occurredOn).not.toBe('2027-03-01');
  });
});

describe('reading the time', () => {
  it('looks past something shaped like a clock time that is not one', () => {
    const result = resolveTimestamp(
      'Ref 99:99 txn at 14:05 on 20-Sep-25',
      RECEIVED,
    );

    expect(result.hasExplicitTime).toBe(true);
    expect(new Date(result.occurredAt).getHours()).toBe(14);
    expect(new Date(result.occurredAt).getMinutes()).toBe(5);
  });

  it('falls back to the arrival when the body really has no time', () => {
    const result = resolveTimestamp('Rs.100 debited on 20-Sep-25', RECEIVED);

    expect(result.hasExplicitTime).toBe(false);
    expect(result.occurredAt).toBe(RECEIVED);
  });
});
