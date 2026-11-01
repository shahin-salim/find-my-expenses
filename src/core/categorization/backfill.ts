/**
 * Applying the rules to merchants that already exist.
 *
 * Section 5.3 runs categorization "whenever a transaction is created", which
 * means a rule added later never reaches the payees it was written for. The
 * merchants are already there with no category, so the rule that would have
 * caught them has nothing left to catch.
 *
 * This is the same shape of problem as section 3.1's message check: the fix
 * is written, and the data it was written for is out of its reach. It runs on
 * every launch because it is cheap and idempotent — a merchant whose rule has
 * not changed is left exactly as it was.
 */

import { findCategoryBySystemKey } from '../db/dao/categories';
import type { SqlDatabase } from '../db/types';
import { categoryKeyForMerchantName } from './categorize';

/** Only the columns the pass reads, out of a table that can be large. */
interface BackfillCandidate {
  id: number;
  normalized_name: string | null;
  category_id: number | null;
}

export interface BackfillOutcome {
  /** Merchants that had no category and now have one. */
  categorised: number;
  /** Merchants the rules now place somewhere else than they used to. */
  moved: number;
}

export function applyRulesToExistingMerchants(
  db: SqlDatabase,
  now: number = Date.now(),
): BackfillOutcome {
  const outcome: BackfillOutcome = { categorised: 0, moved: 0 };

  // The user's own choice is never touched. Section 8.4 keeps
  // `category_source` precisely so that an automatic pass can tell what it is
  // allowed to overwrite, and `USER` is the answer to that question.
  //
  // Three columns rather than `SELECT *`: this runs on every database open,
  // including inside the background SMS service, and a year of UPI payments
  // is thousands of payees. Nothing below reads anything else.
  const { rows } = db.execute<BackfillCandidate>(
    `SELECT id, normalized_name, category_id
       FROM merchants
      WHERE category_source IN ('NONE', 'AUTO')`,
  );

  const idForKey = new Map<string, number | null>();
  const resolve = (key: string): number | null => {
    if (!idForKey.has(key)) {
      idForKey.set(key, findCategoryBySystemKey(db, key)?.id ?? null);
    }
    return idForKey.get(key) ?? null;
  };

  const pending: Array<{ id: number; categoryId: number; had: number | null }> = [];

  for (const merchant of rows) {
    // Section 5.2: the rules are matched against the name, never the UPI ID.
    //
    // Which is why `display_name` is not a fallback here. Section 8.4 sets it
    // to the handle itself for a payee first seen as `somshop.payments@ybl`,
    // so reading it when there is no name fed the UPI ID straight into the
    // keyword rules — the one thing the line above forbids. `ingest.ts` has
    // nothing to match on in that case and leaves the payee alone; this has
    // to agree with it, or a payee is filed one way when the message arrives
    // and another way on the next launch.
    if (!merchant.normalized_name) {
      continue;
    }
    const key = categoryKeyForMerchantName(merchant.normalized_name);
    if (!key) {
      continue;
    }
    const categoryId = resolve(key);
    if (categoryId === null || categoryId === merchant.category_id) {
      continue;
    }
    pending.push({ id: merchant.id, categoryId, had: merchant.category_id });
  }

  // The common launch changes nothing, and then this costs one SELECT and no
  // transaction at all. When there is something to write, it is one
  // transaction rather than one implicit transaction and one fsync per row.
  if (pending.length === 0) {
    return outcome;
  }

  db.transaction(() => {
    for (const update of pending) {
      db.execute(
        `UPDATE merchants SET category_id = ?, category_source = 'AUTO', updated_at = ?
          WHERE id = ? AND category_source IN ('NONE', 'AUTO')`,
        [update.categoryId, now, update.id],
      );
    }
  });

  for (const update of pending) {
    if (update.had === null) {
      outcome.categorised += 1;
    } else {
      // An earlier guess the rules now disagree with — `LIC Metro Station`
      // filed as an insurer is the case this exists for.
      outcome.moved += 1;
    }
  }

  return outcome;
}
