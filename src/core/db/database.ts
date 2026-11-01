/**
 * Opening, migrating and seeding the database.
 *
 * The seed is what section 1.1 assumes is already there before an import
 * starts: "cash is already there as row 1, created when the app was installed
 * rather than found in a message."
 */

import { applyRulesToExistingMerchants } from '../categorization/backfill';
import { DEFAULT_CATEGORIES } from '../categorization/defaultCategories';
import { CREATE_STATEMENTS, INDEXES_AFTER_COLUMNS, SCHEMA_VERSION } from './schema';
import type { SqlDatabase } from './types';

/**
 * Columns added after the first release. `CREATE TABLE IF NOT EXISTS` does
 * nothing to a table that is already there, so a column added to the statement
 * reaches a fresh install and no existing one. Checking the table and adding
 * what is missing covers both, and does not depend on which version a given
 * phone happens to be upgrading from.
 */
const ADDED_COLUMNS: Array<{ table: string; column: string; definition: string }> = [
  { table: 'transactions', column: 'currency', definition: `TEXT NOT NULL DEFAULT 'INR'` },
  { table: 'transactions', column: 'repaid_at', definition: 'INTEGER' },
  {
    table: 'categories',
    column: 'tracks_repayment',
    definition: 'INTEGER NOT NULL DEFAULT 0',
  },
  // No CHECK on the added column: SQLite cannot add a constrained column to
  // a table that already has rows. The one in the schema covers every
  // database created from here on, and the only writer is a typed union.
  { table: 'profile', column: 'home_period', definition: `TEXT NOT NULL DEFAULT 'DAY'` },
  // Section 10.3's third case: a payment the user has deliberately left
  // without a category, which is not the same as one that has said
  // nothing and takes its payee's.
  { table: 'transactions', column: 'category_cleared', definition: 'INTEGER NOT NULL DEFAULT 0' },
  // Section 12.2's link from a repayment to the lend it pays back. Nullable
  // with no default, so it is a plain column add over however many rows the
  // phone already holds. No REFERENCES clause: SQLite cannot add a foreign
  // key to an existing table, and the schema above carries it for every
  // database created from here on.
  { table: 'transactions', column: 'repays_transaction_id', definition: 'INTEGER' },
];

/**
 * Keeps the built-in categories level with the list they are defined from.
 *
 * `INSERT OR IGNORE` reaches a fresh install and nothing else, so a release
 * that adds a flag or reorders the categories leaves every existing phone on
 * the old values — and a new category inserted beside old ones ends up with a
 * `sort_order` that collides with theirs. The same hole `addMissingColumns`
 * exists for, one table along.
 *
 * What it will not do is undo the user. `sort_order` is not editable
 * anywhere, so it is always brought into line; everything else is written
 * only while the row is untouched, which `updated_at` still matching
 * `created_at` is the proof of. Section 8.2 lets a built-in category be
 * renamed, and a rename must survive every release after it.
 */
function syncDefaultCategories(db: SqlDatabase, now: number): void {
  for (const category of DEFAULT_CATEGORIES) {
    db.execute(
      `UPDATE categories SET sort_order = ?
        WHERE system_key = ? AND sort_order IS NOT ?`,
      [category.sortOrder, category.systemKey, category.sortOrder],
    );
    db.execute(
      `UPDATE categories
          SET icon = ?, color = ?, excluded_from_totals = ?, is_fixed_cost = ?,
              tracks_repayment = ?
        WHERE system_key = ? AND updated_at = created_at`,
      [
        category.icon,
        category.color,
        category.excludedFromTotals ? 1 : 0,
        category.isFixedCost ? 1 : 0,
        category.tracksRepayment ? 1 : 0,
        category.systemKey,
      ],
    );
  }
  // `now` is deliberately not written: touching `updated_at` here would make
  // every category look edited and stop the next release reaching it.
  void now;
}

function addMissingColumns(db: SqlDatabase): void {
  for (const { table, column, definition } of ADDED_COLUMNS) {
    const { rows } = db.execute<{ name: string }>(`PRAGMA table_info(${table})`);
    if (rows.length === 0 || rows.some((row) => row.name === column)) {
      continue;
    }
    db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function migrate(db: SqlDatabase): void {
  db.transaction(() => {
    for (const statement of CREATE_STATEMENTS) {
      db.execute(statement);
    }
    addMissingColumns(db);
    for (const statement of INDEXES_AFTER_COLUMNS) {
      db.execute(statement);
    }
    db.execute(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  });
}

export function seed(db: SqlDatabase, now: number = Date.now()): void {
  db.transaction(() => {
    // Cash first, so it takes row 1 and the "Paid from" selector on the manual
    // entry screen is a single query over one table.
    db.execute(
      `INSERT OR IGNORE INTO accounts
         (bank_name, bank_key, last_four, account_type, created_at, updated_at)
       VALUES ('Cash', 'cash', '', 'CASH', ?, ?)`,
      [now, now],
    );

    for (const category of DEFAULT_CATEGORIES) {
      db.execute(
        `INSERT OR IGNORE INTO categories
           (name, system_key, icon, color, is_system, sort_order,
            excluded_from_totals, is_fixed_cost, tracks_repayment,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
        [
          category.name,
          category.systemKey,
          category.icon,
          category.color,
          category.sortOrder,
          // Was hardcoded to 0, which silently dropped the flag for any
          // default category that wanted it.
          category.excludedFromTotals ? 1 : 0,
          category.isFixedCost ? 1 : 0,
          category.tracksRepayment ? 1 : 0,
          now,
          now,
        ],
      );
    }

    syncDefaultCategories(db, now);

    db.execute(
      `INSERT OR IGNORE INTO profile (id, created_at, updated_at) VALUES (1, ?, ?)`,
      [now, now],
    );
  });
}

/** Creates the schema and the rows the app assumes exist. Safe to re-run. */
export function initializeDatabase(db: SqlDatabase, now: number = Date.now()): SqlDatabase {
  migrate(db);
  seed(db, now);
  // A release that adds a category or a rule has to reach the payees already
  // on record, or the rule only ever applies to people who install the app
  // after it was written. Idempotent, so running it every launch costs a
  // single pass over the merchants and changes nothing when nothing has.
  applyRulesToExistingMerchants(db, now);
  return db;
}
