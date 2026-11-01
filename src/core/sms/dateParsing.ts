/**
 * Pulling the transaction date and time out of a message body.
 *
 * Section 2.4: "Dates come in four shapes, and one has no separators at all."
 * `20-Oct-25`, `15/01/26`, `04-12-2025` and SBI's `13Sep25`.
 *
 * Section 2.2: when the message gives no time, the time the message was
 * received is used instead, and that is recorded so section 3.2 can refuse to
 * use it as a dedup key.
 */

import { toLocalDateString } from '../time/dates';

export interface MessageTimestamp {
  occurredAt: number;
  occurredOn: string;
  /** True only when the body itself carried a clock time. */
  hasExplicitTime: boolean;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

/** Two-digit years are this century; banks never send a 19xx transaction. */
function expandYear(raw: string): number {
  const value = parseInt(raw, 10);
  return raw.length <= 2 ? 2000 + value : value;
}

interface DateParts {
  year: number;
  month: number;
  day: number;
}

/**
 * How long the month actually is.
 *
 * `new Date(2025, 1, 31)` is 3 March and says nothing about it, so a body
 * reading `31-02-25` used to be recorded as a payment made on a day it names
 * nowhere. A day number is only a day if its month has one.
 */
function daysInMonth(year: number, month: number): number {
  // Day zero of the next month is the last day of this one.
  return new Date(year, month + 1, 0).getDate();
}

/**
 * Ordered so the alphabetic-month shapes are tried before the all-numeric one.
 * An alphabetic month is unambiguous; `04-12-2025` is not, and India writes
 * day first, so it is read as 4 December.
 */
const DATE_PATTERNS: Array<{
  regex: RegExp;
  read: (m: RegExpMatchArray, fallbackYear: number) => DateParts | null;
}> = [
  {
    // 2025-10-20 — HDFC card alerts write the year first
    regex: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g,
    read: (m) => ({
      year: parseInt(m[1], 10),
      month: parseInt(m[2], 10) - 1,
      day: parseInt(m[3], 10),
    }),
  },
  {
    // 20-Oct-25, 03 Sep 2025, 15/Jan/26
    regex: /\b(\d{1,2})[-/ ]([A-Za-z]{3,4})[-/ ](\d{2,4})\b/g,
    read: (m) => {
      const month = MONTHS[m[2].toLowerCase()];
      return month === undefined
        ? null
        : { day: parseInt(m[1], 10), month, year: expandYear(m[3]) };
    },
  },
  {
    // 13Sep25 — SBI, no separators at all
    regex: /\b(\d{1,2})([A-Za-z]{3})(\d{2,4})\b/g,
    read: (m) => {
      const month = MONTHS[m[2].toLowerCase()];
      return month === undefined
        ? null
        : { day: parseInt(m[1], 10), month, year: expandYear(m[3]) };
    },
  },
  {
    // 15/01/26, 04-12-2025
    regex: /\b(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})\b/g,
    read: (m) => ({
      day: parseInt(m[1], 10),
      month: parseInt(m[2], 10) - 1,
      year: expandYear(m[3]),
    }),
  },
  {
    // 20-Oct with no year at all; take the year from when the message arrived.
    regex: /\b(\d{1,2})[-/ ]([A-Za-z]{3,4})\b(?![-/ ]?\d)/g,
    read: (m, fallbackYear) => {
      const month = MONTHS[m[2].toLowerCase()];
      return month === undefined
        ? null
        : { day: parseInt(m[1], 10), month, year: fallbackYear };
    },
  },
];

const TIME_PATTERNS: RegExp[] = [
  // 1:42 PM, 11:05 am
  /\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp])\.?[Mm]\.?\b/g,
  // 13:13:27, 09:05
  /\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/g,
];

interface TimeParts {
  hours: number;
  minutes: number;
  seconds: number;
}

function findTime(body: string): TimeParts | null {
  for (const regex of TIME_PATTERNS) {
    // Every match the pattern makes, not only the first one. A failed
    // candidate says nothing about the rest of the body, and treating it as
    // if it did was how a reference number shaped like a clock time earlier
    // in the message took the whole pattern down with it.
    for (const match of body.matchAll(regex)) {
      let hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      const seconds = match[3] ? parseInt(match[3], 10) : 0;
      const meridiem = match[4]?.toLowerCase();

      if (meridiem === 'p' && hours < 12) {
        hours += 12;
      }
      if (meridiem === 'a' && hours === 12) {
        hours = 0;
      }
      if (hours > 23 || minutes > 59 || seconds > 59) {
        continue;
      }
      return { hours, minutes, seconds };
    }
  }
  return null;
}

function findDate(body: string, fallbackYear: number): DateParts | null {
  for (const { regex, read } of DATE_PATTERNS) {
    // As in `findTime`: the first thing shaped like a date is often not one.
    // `Txn ref 12ABC34 on 13Sep25` matches the no-separator pattern at the
    // reference number, where `ABC` is not a month — and giving up on the
    // pattern there meant the real `13Sep25` a few words later was never
    // read. The message then fell back to its arrival time, which also
    // changes its dedup key (section 3.2), so the same payment arriving
    // twice was stored twice.
    for (const match of body.matchAll(regex)) {
      const parts = read(match, fallbackYear);
      if (!parts) {
        continue;
      }
      if (parts.month < 0 || parts.month > 11) {
        continue;
      }
      if (parts.day < 1 || parts.day > daysInMonth(parts.year, parts.month)) {
        continue;
      }
      return parts;
    }
  }
  return null;
}

/**
 * Works out when a transaction happened.
 *
 * The date is taken from the message when it gives one and from the message's
 * arrival otherwise. The time is taken from the message when it gives one, and
 * from the arrival otherwise — which is right nearly all of the time, because
 * a message normally arrives within seconds of the payment.
 */
export function resolveTimestamp(body: string, receivedAt: number): MessageTimestamp {
  const received = new Date(receivedAt);
  const date = findDate(body, received.getFullYear());
  const time = findTime(body);

  if (!date) {
    // No date in the body: the arrival is all we have, for both parts.
    return {
      occurredAt: receivedAt,
      occurredOn: toLocalDateString(receivedAt),
      hasExplicitTime: false,
    };
  }

  const at = new Date(
    date.year,
    date.month,
    date.day,
    time ? time.hours : received.getHours(),
    time ? time.minutes : received.getMinutes(),
    time ? time.seconds : received.getSeconds(),
    0,
  );

  // A date that reads as the future means the year was guessed wrong — a
  // December message arriving in January, for instance. Step it back a year.
  const ONE_DAY_OF_SLACK = 86_400_000;
  if (at.getTime() > receivedAt + ONE_DAY_OF_SLACK) {
    // All three fields at once, and the day clamped to the month it is
    // landing in. `setFullYear(year - 1)` on its own carries 29 February
    // into 1 March in a year that has no 29th — the same silent overflow
    // `daysInMonth` exists to stop above.
    const year = date.year - 1;
    at.setFullYear(year, date.month, Math.min(date.day, daysInMonth(year, date.month)));
  }

  return {
    occurredAt: at.getTime(),
    occurredOn: toLocalDateString(at.getTime()),
    hasExplicitTime: time !== null,
  };
}
