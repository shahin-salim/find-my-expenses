/**
 * Runs the section 12 migration against a copy of the real database and
 * reports what the Lending page would show.
 *
 * The schema change is a column add over however many thousand rows a phone
 * already holds, and the 23 payments already filed under Lend become open
 * lends the moment it lands. This answers both questions — does the migration
 * survive the real data, and what does the user see afterwards — without
 * touching the phone. The copy it reads is the local one under `.local/db`,
 * and it is copied again before anything is written to it.
 *
 *   npm run db && npx jest --config '{"preset":"@react-native/jest-preset","testMatch":["**\/scripts/diagnostics/lendMigration.report.ts"]}' --silent=false
 */

import { copyFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initializeDatabase } from '../../src/core/db/database';
import { listLends, lendingTotals } from '../../src/core/lending/lends';
import { openNodeDatabase } from '../../src/core/db/nodeSqlite';

const SOURCE = join(__dirname, '../../.local/db/find-my-expense.sqlite');
const WORKING = join(tmpdir(), 'lend-migration-check.sqlite');

describe('the section 12 migration against real data', () => {
  it('adds the column and reads the lends out', () => {
    if (!existsSync(SOURCE)) {
      console.log('No local database copy. Run `npm run db` first.');
      return;
    }
    copyFileSync(SOURCE, WORKING);

    const before = openNodeDatabase(WORKING);
    const columnsBefore = before.execute<{ name: string }>(`PRAGMA table_info(transactions)`).rows;
    const rowsBefore = before.execute<{ n: number }>(
      `SELECT COUNT(*) AS n FROM transactions`,
    ).rows[0]!.n;
    before.close();

    const db = initializeDatabase(openNodeDatabase(WORKING));

    const columnsAfter = db.execute<{ name: string }>(`PRAGMA table_info(transactions)`).rows;
    const rowsAfter = db.execute<{ n: number }>(`SELECT COUNT(*) AS n FROM transactions`)
      .rows[0]!.n;
    const index = db.execute<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_tx_repays'`,
    ).rows;

    const { open, closed } = listLends(db);
    const totals = lendingTotals(db);

    console.log(
      [
        '',
        `  columns      ${columnsBefore.length} → ${columnsAfter.length}`,
        `  rows         ${rowsBefore} → ${rowsAfter}`,
        `  new column   ${columnsAfter.some((c) => c.name === 'repays_transaction_id')}`,
        `  new index    ${index.length === 1}`,
        '',
        `  open lends   ${open.length}`,
        `  closed lends ${closed.length}`,
        `  left to get back  ₹${(totals.left / 100).toLocaleString('en-IN')}`,
        `  across       ${totals.people} people`,
        '',
      ].join('\n'),
    );

    expect(columnsAfter.some((c) => c.name === 'repays_transaction_id')).toBe(true);
    expect(index).toHaveLength(1);
    // A column add must not lose a row.
    expect(rowsAfter).toBe(rowsBefore);
  });
});
