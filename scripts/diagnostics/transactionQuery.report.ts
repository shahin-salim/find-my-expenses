/**
 * Runs the Transactions screen's reads against the pulled database, so the
 * filters can be checked against real rows rather than only fixtures.
 *
 *   npm run db && npm run check-transactions
 */
import { DatabaseSync } from 'node:sqlite';
import { join } from 'path';
import { formatRupees } from '../../src/core/analytics/spending';
import type { SqlDatabase, SqlValue } from '../../src/core/db/types';
import {
  DEFAULT_FILTER,
  amountBounds,
  filterTotals,
  groupByDay,
  listTransactions,
  type TransactionFilter,
} from '../../src/core/transactions/query';

const FILE = join(__dirname, '../../.local/db/find-my-expense.sqlite');

function openReadOnly(): SqlDatabase {
  const raw = new DatabaseSync(FILE, { readOnly: true });
  return {
    execute: (sql: string, params: SqlValue[] = []) => {
      const stmt = raw.prepare(sql);
      return {
        rows: stmt.all(...(params as never[])) as never[],
        insertId: 0,
        rowsAffected: 0,
      };
    },
    transaction: <T,>(fn: () => T) => fn(),
    close: () => raw.close(),
  } as SqlDatabase;
}

test('the transactions list against real rows', () => {
  const db = openReadOnly();
  const now = Date.now();
  const out: string[] = [];

  const run = (name: string, overrides: Partial<TransactionFilter>) => {
    const filter = { ...DEFAULT_FILTER, ...overrides };
    const totals = filterTotals(db, filter, now);
    const rows = listTransactions(db, filter, now, 5000);
    const groups = groupByDay(rows);
    out.push(
      `${name.padEnd(30)} ${String(totals.count).padStart(5)} rows  ` +
        `out ${formatRupees(totals.out).padStart(12)}  ` +
        `in ${formatRupees(totals.in).padStart(12)}  ` +
        `${groups.length} days`,
    );
    // The list and the totals must always be counting the same set.
    expect(rows.length).toBe(totals.count);
  };

  run('this month', {});
  run('all time', { datePreset: 'ALL' });
  run('today', { datePreset: 'TODAY' });
  run('money in only', { datePreset: 'ALL', type: 'CREDIT' });
  run('uncategorized only', { datePreset: 'ALL', onlyUncategorized: true });
  run('no fixed costs', { datePreset: 'ALL', hideFixedCosts: true });
  run('no self-transfers', { datePreset: 'ALL', hideSelfTransfers: true });
  run('search "swiggy"', { datePreset: 'ALL', search: 'swiggy' });
  run('search "386"', { datePreset: 'ALL', search: '386' });
  run('over 10,000', { datePreset: 'ALL', minAmount: 1_000_000 });
  run('uncategorized chip', { datePreset: 'ALL', categories: ['NONE'] });

  // Where a self-transfer can actually be seen.
  const seen = (name: string, overrides: Partial<TransactionFilter>) => {
    const rows = listTransactions(db, { ...DEFAULT_FILTER, ...overrides }, now, 5000);
    const transfers = rows.filter((row) => row.is_transfer === 1);
    out.push(`${name.padEnd(30)} ${String(rows.length).padStart(5)} rows, ` +
             `${transfers.length} of them transfers`);
  };
  out.push('', '--- self-transfers ---');
  seen('default list (this month)', {});
  seen('default list (all time)', { datePreset: 'ALL' });
  seen('hide self-transfers on', { datePreset: 'ALL', hideSelfTransfers: true });
  seen('opened from a Home figure', { datePreset: 'MONTH', spendingOnly: true });

  const bounds = amountBounds(db);
  out.push(`\namount range on record: ${formatRupees(bounds.min)} – ${formatRupees(bounds.max)}`);

  // eslint-disable-next-line no-console
  console.log('\n' + out.join('\n'));
  db.close();
});
