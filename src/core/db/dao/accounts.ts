/**
 * Section 8.3: "Accounts are discovered, not entered. A row is created the
 * first time a parsed message yields a bank and last four digits. The unique
 * index is what makes a repeated import map to the same row."
 */

import type { DiscoveredAccount } from '../../sms/types';
import type { AccountRow } from '../models';
import type { SqlDatabase } from '../types';

export function listAccounts(db: SqlDatabase): AccountRow[] {
  return db.execute<AccountRow>(
    `SELECT * FROM accounts ORDER BY CASE account_type WHEN 'CASH' THEN 1 ELSE 0 END,
            bank_name, last_four`,
  ).rows;
}

export function findAccount(
  db: SqlDatabase,
  bankKey: string,
  lastFour: string,
  accountType: string,
): AccountRow | null {
  const { rows } = db.execute<AccountRow>(
    `SELECT * FROM accounts WHERE bank_key = ? AND last_four = ? AND account_type = ?`,
    [bankKey, lastFour, accountType],
  );
  return rows[0] ?? null;
}

export interface AccountUpsert {
  row: AccountRow;
  /** True when this call is what created the row. */
  created: boolean;
}

/**
 * Section 8.3: "Three digits meeting four is the one case that needs deciding.
 * If a bank sends `XX6172` in one message and `XX903` in another, the two
 * still look like different accounts."
 *
 * Resolved here by letting the two find each other whichever arrives first.
 * A four digit run adopts an existing three digit row for the same bank when
 * the three digits are its tail, and a three digit run adopts an existing
 * four digit row the same way.
 *
 * Both directions are needed because the order is not ours to choose. The
 * import reads the inbox newest first, so whichever of the two shapes the
 * bank sent most recently is the one that creates the row — and when that was
 * the four digit one, the three digit message that followed it used to find
 * no exact match and open a second account for the same real account. The
 * user then saw one account twice on Home with their spending divided between
 * the two, which is the outcome this function exists to prevent.
 */
export function upsertDiscoveredAccount(
  db: SqlDatabase,
  account: DiscoveredAccount,
  now: number = Date.now(),
): AccountUpsert {
  const exact = findAccount(db, account.bankKey, account.lastFour, account.accountType);
  if (exact) {
    return { row: exact, created: false };
  }

  if (account.lastFour.length === 4) {
    const { rows } = db.execute<AccountRow>(
      `SELECT * FROM accounts
        WHERE bank_key = ? AND account_type = ? AND length(last_four) = 3`,
      [account.bankKey, account.accountType],
    );
    const sameTail = rows.find((row) => account.lastFour.endsWith(row.last_four));
    if (sameTail) {
      return { row: sameTail, created: false };
    }
  }

  if (account.lastFour.length === 3) {
    const { rows } = db.execute<AccountRow>(
      `SELECT * FROM accounts
        WHERE bank_key = ? AND account_type = ? AND length(last_four) = 4`,
      [account.bankKey, account.accountType],
    );
    // Only when exactly one account could be meant. Two cards from the same
    // bank whose last four digits happen to end in the same three are two
    // cards, and folding one into the other would file money against an
    // account the user never paid from. An ambiguous three digit run opens
    // its own row instead, which is wrong in a way that is visible.
    const candidates = rows.filter((row) => row.last_four.endsWith(account.lastFour));
    if (candidates.length === 1) {
      return { row: candidates[0]!, created: false };
    }
  }

  db.execute(
    `INSERT INTO accounts (bank_name, bank_key, last_four, account_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [account.bankName, account.bankKey, account.lastFour, account.accountType, now, now],
  );
  const row = findAccount(db, account.bankKey, account.lastFour, account.accountType)!;
  return { row, created: true };
}

export function getCashAccount(db: SqlDatabase): AccountRow | null {
  const { rows } = db.execute<AccountRow>(
    `SELECT * FROM accounts WHERE account_type = 'CASH' LIMIT 1`,
  );
  return rows[0] ?? null;
}
