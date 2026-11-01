import { markDataChanged } from '../changes';
import type { CategoryRow } from '../models';
import type { SqlDatabase } from '../types';
import { RESOLVED_CATEGORY } from '../resolvedCategory';
import { IS_SPENDING } from '../spendingClause';

export function listCategories(db: SqlDatabase, includeArchived = false): CategoryRow[] {
  return db.execute<CategoryRow>(
    `SELECT * FROM categories ${includeArchived ? '' : 'WHERE is_archived = 0'}
      ORDER BY is_archived, sort_order, name`,
  ).rows;
}

export function findCategoryBySystemKey(
  db: SqlDatabase,
  systemKey: string,
): CategoryRow | null {
  const { rows } = db.execute<CategoryRow>(
    `SELECT * FROM categories WHERE system_key = ?`,
    [systemKey],
  );
  return rows[0] ?? null;
}

export function findCategoryById(db: SqlDatabase, id: number): CategoryRow | null {
  const { rows } = db.execute<CategoryRow>(`SELECT * FROM categories WHERE id = ?`, [id]);
  return rows[0] ?? null;
}

export interface NewCategory {
  name: string;
  icon: string;
  color: string;
  excludedFromTotals?: boolean;
  isFixedCost?: boolean;
  tracksRepayment?: boolean;
}

export function createCategory(
  db: SqlDatabase,
  category: NewCategory,
  now: number = Date.now(),
): CategoryRow {
  const { rows } = db.execute<{ next: number }>(
    `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM categories`,
  );
  const sortOrder = rows[0]?.next ?? 1;

  const result = db.execute(
    `INSERT INTO categories
       (name, system_key, icon, color, is_system, sort_order,
        excluded_from_totals, is_fixed_cost, tracks_repayment,
        created_at, updated_at)
     VALUES (?, NULL, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
    [
      category.name.trim(),
      category.icon,
      category.color,
      sortOrder,
      category.excludedFromTotals ? 1 : 0,
      category.isFixedCost ? 1 : 0,
      category.tracksRepayment ? 1 : 0,
      now,
      now,
    ],
  );
  markDataChanged();
  return findCategoryById(db, result.insertId)!;
}

export interface CategoryChanges {
  name?: string;
  icon?: string;
  color?: string;
  excludedFromTotals?: boolean;
  isFixedCost?: boolean;
  tracksRepayment?: boolean;
}

/**
 * Renaming and restyling, for built-in categories as well as the user's own.
 *
 * Section 8.2: "`system_key` keeps renaming from breaking automatic
 * categorization... If the rules referenced the display name instead, a user
 * renaming 'Food & Dining' to 'Eating out' would silently stop every rule for
 * that category from matching." So the name is free to change and the key
 * never does — it is not even writable here.
 */
export function updateCategory(
  db: SqlDatabase,
  id: number,
  changes: CategoryChanges,
  now: number = Date.now(),
): CategoryRow | null {
  const sets: string[] = [];
  const params: Array<string | number> = [];

  if (changes.name !== undefined) {
    sets.push('name = ?');
    params.push(changes.name.trim());
  }
  if (changes.icon !== undefined) {
    sets.push('icon = ?');
    params.push(changes.icon);
  }
  if (changes.color !== undefined) {
    sets.push('color = ?');
    params.push(changes.color);
  }
  if (changes.excludedFromTotals !== undefined) {
    sets.push('excluded_from_totals = ?');
    params.push(changes.excludedFromTotals ? 1 : 0);
  }
  if (changes.isFixedCost !== undefined) {
    sets.push('is_fixed_cost = ?');
    params.push(changes.isFixedCost ? 1 : 0);
  }
  if (changes.tracksRepayment !== undefined) {
    sets.push('tracks_repayment = ?');
    params.push(changes.tracksRepayment ? 1 : 0);
  }
  if (sets.length === 0) {
    return findCategoryById(db, id);
  }

  sets.push('updated_at = ?');
  params.push(now, id);
  db.execute(`UPDATE categories SET ${sets.join(', ')} WHERE id = ?`, params);
  markDataChanged();
  return findCategoryById(db, id);
}

/**
 * Whether a name is already taken, ignoring case and ignoring the category
 * being edited.
 *
 * The unique index enforces this anyway, but an insert that throws reaches
 * the user as a crash rather than as "Must be different from your other
 * categories", which is what the screen promises.
 */
export function categoryNameInUse(
  db: SqlDatabase,
  name: string,
  exceptId?: number,
): boolean {
  const { rows } = db.execute<{ one: number }>(
    `SELECT 1 AS one FROM categories
      WHERE name = ? COLLATE NOCASE AND id IS NOT ?
      LIMIT 1`,
    [name.trim(), exceptId ?? null],
  );
  return rows.length > 0;
}

export interface CategoryUsage {
  category_id: number;
  /** Payments filed under it, deleted ones excluded. */
  transactions: number;
  /** Spent under it, in paise. */
  total: number;
}

/**
 * How much each category is actually carrying.
 *
 * The categories screen shows it against every row, because the decision the
 * user is making there — rename this, archive that — is one they cannot make
 * sensibly without knowing which categories their money is in.
 *
 * The total is the shared definition of spending, not every debit. Summing
 * every debit added a card payment made abroad to a rupee total as though its
 * amount were paise, and counted transfers between the user's own accounts,
 * bank reversals and repaid loans as money that went out — so the figure
 * beside a category here disagreed with the figure Home gave for the same
 * category, which is two answers to one question.
 *
 * The count still counts everything filed under the category. That is what
 * the edit screen means by "the N payments already filed under it", and a
 * credit filed under a category is still filed under it.
 */
export function categoryUsage(db: SqlDatabase): Map<number, CategoryUsage> {
  const { rows } = db.execute<CategoryUsage>(
    `SELECT ${RESOLVED_CATEGORY} AS category_id,
            COUNT(*) AS transactions,
            SUM(CASE WHEN ${IS_SPENDING} THEN t.amount ELSE 0 END) AS total
       FROM transactions t
       LEFT JOIN merchants m ON m.id = t.merchant_id
      WHERE t.is_deleted = 0
        AND ${RESOLVED_CATEGORY} IS NOT NULL
      -- Grouped by the expression rather than by the alias, because the
      -- short name is a real column on both joined tables and so ambiguous.
      GROUP BY ${RESOLVED_CATEGORY}`,
  );
  return new Map(rows.map((row) => [row.category_id, row]));
}

/** Brings an archived category back into the pickers. */
export function unarchiveCategory(db: SqlDatabase, id: number, now = Date.now()): void {
  db.execute(
    `UPDATE categories SET is_archived = 0, updated_at = ? WHERE id = ?`,
    [now, id],
  );
  markDataChanged();
}

/**
 * Section 8.2: "Categories are archived, not deleted. Deleting a category that
 * already has transactions would push those transactions back to
 * uncategorized." A system category cannot even be archived; it can only be
 * renamed.
 */
export function archiveCategory(db: SqlDatabase, id: number, now = Date.now()): void {
  db.execute(
    `UPDATE categories SET is_archived = 1, updated_at = ?
      WHERE id = ? AND is_system = 0`,
    [now, id],
  );
  markDataChanged();
}
