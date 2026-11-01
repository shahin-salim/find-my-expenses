/**
 * What the current rules would make of the merchants already on record.
 *
 * Rules only run when a merchant is first created (section 5.3), so a rule
 * added later never reaches the payees it was written for. This says what
 * would change if it did.
 */
import { DatabaseSync } from 'node:sqlite';
import { join } from 'path';
import { categoryKeyForMerchantName } from '../../src/core/categorization/categorize';
import { formatRupees } from '../../src/core/analytics/spending';

const FILE = join(__dirname, '../../.local/db/find-my-expense.sqlite');

test('what the rules would catch now', () => {
  const db = new DatabaseSync(FILE, { readOnly: true });

  const rows = db.prepare(`
    SELECT m.display_name AS name,
           COUNT(*) AS payments,
           SUM(t.amount) AS total,
           c.system_key AS current_key
      FROM transactions t
      JOIN merchants m ON m.id = t.merchant_id
      LEFT JOIN categories c ON c.id = COALESCE(t.category_id, m.category_id)
     WHERE t.is_deleted = 0 AND t.transaction_type = 'DEBIT'
     GROUP BY m.id
  `).all() as Array<{ name: string; payments: number; total: number; current_key: string | null }>;

  const gained = new Map<string, { payments: number; total: number; names: string[] }>();
  const changed: string[] = [];
  let uncategorised = 0;
  let uncategorisedTotal = 0;

  for (const row of rows) {
    const key = categoryKeyForMerchantName(row.name);
    if (row.current_key === null) {
      uncategorised += row.payments;
      uncategorisedTotal += row.total;
    }
    if (key && row.current_key === null) {
      const bucket = gained.get(key) ?? { payments: 0, total: 0, names: [] };
      bucket.payments += row.payments;
      bucket.total += row.total;
      if (bucket.names.length < 4) { bucket.names.push(row.name); }
      gained.set(key, bucket);
    } else if (key && row.current_key && key !== row.current_key) {
      changed.push(`  ${row.name}: ${row.current_key} -> ${key} (${row.payments})`);
    }
  }

  const out: string[] = ['', `Uncategorised now: ${uncategorised} payments, ${formatRupees(uncategorisedTotal)}`, ''];
  out.push('Would gain a category:');
  let totalGained = 0;
  for (const [key, b] of [...gained].sort((a, b) => b[1].total - a[1].total)) {
    totalGained += b.payments;
    out.push(`  ${key.padEnd(11)} ${String(b.payments).padStart(4)} payments  ` +
             `${formatRupees(b.total).padStart(12)}   e.g. ${b.names.join(', ')}`);
  }
  out.push('', `Total newly categorised: ${totalGained} payments`);
  if (changed.length > 0) {
    out.push('', 'Would move category:', ...changed.slice(0, 15));
  }

  // eslint-disable-next-line no-console
  console.log(out.join('\n'));
  db.close();
});
