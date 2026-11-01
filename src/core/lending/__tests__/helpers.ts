/**
 * Fixtures for the lending tests.
 *
 * Rows are written straight in rather than through the ingest path, so each
 * test states only the facts it is about. The behaviour of the ingest path
 * itself is covered where it is tested, in `match.test.ts`.
 */

import { findCategoryBySystemKey } from '../../db/dao/categories';
import { findOrCreateMerchant } from '../../db/dao/merchants';
import { insertTransactionIfNew } from '../../db/dao/transactions';
import { initializeDatabase } from '../../db/database';
import type { TransactionRow } from '../../db/models';
import { openNodeDatabase } from '../../db/nodeSqlite';
import type { SqlDatabase } from '../../db/types';
import { toLocalDateString } from '../../time/dates';

export const TODAY = new Date(2026, 9, 24, 14, 30, 0).getTime();
export const DAY = 86_400_000;

export function freshDb(): SqlDatabase {
  return initializeDatabase(openNodeDatabase(':memory:'), TODAY);
}

export function lendCategoryId(db: SqlDatabase): number {
  return findCategoryBySystemKey(db, 'lend')!.id;
}

export function merchantFor(db: SqlDatabase, name: string, upiId: string | null = null): number {
  return findOrCreateMerchant(db, { recipientName: name, upiId }, TODAY, TODAY)!.merchant.id;
}

let sequence = 0;

export interface Fixture {
  type?: 'DEBIT' | 'CREDIT';
  amount: number;
  at?: number;
  person?: string;
  merchantId?: number | null;
  categoryId?: number | null;
  currency?: string;
  rrn?: string | null;
  isTransfer?: boolean;
  note?: string | null;
  source?: 'SMS' | 'MANUAL';
}

export function addTransaction(db: SqlDatabase, fixture: Fixture): TransactionRow {
  sequence += 1;
  const at = fixture.at ?? TODAY;
  const person = fixture.person ?? null;
  const merchantId =
    fixture.merchantId !== undefined
      ? fixture.merchantId
      : person
      ? merchantFor(db, person)
      : null;

  return insertTransactionIfNew(
    db,
    {
      amount: fixture.amount,
      currency: fixture.currency ?? 'INR',
      transactionType: fixture.type ?? 'DEBIT',
      occurredAt: at,
      occurredOn: toLocalDateString(at),
      merchantId,
      recipientName: person,
      accountId: null,
      categoryId: fixture.categoryId ?? null,
      source: fixture.source ?? 'SMS',
      sourceSmsId: null,
      bankSenderId: null,
      rrn: fixture.rrn ?? null,
      parserId: null,
      dedupKey: `fixture:${sequence}`,
      note: fixture.note ?? null,
      isTransfer: fixture.isTransfer ?? false,
    },
    TODAY,
  ).row;
}

/** A lend of `amount` to `person`, `daysAgo` days back. */
export function addLend(
  db: SqlDatabase,
  person: string,
  amount: number,
  daysAgo = 10,
  note: string | null = null,
): TransactionRow {
  return addTransaction(db, {
    type: 'DEBIT',
    amount,
    at: TODAY - daysAgo * DAY,
    person,
    categoryId: lendCategoryId(db),
    note,
  });
}

/** Money arriving from `person`, `daysAgo` days back. */
export function addCredit(
  db: SqlDatabase,
  person: string,
  amount: number,
  daysAgo = 1,
): TransactionRow {
  return addTransaction(db, {
    type: 'CREDIT',
    amount,
    at: TODAY - daysAgo * DAY,
    person,
  });
}
