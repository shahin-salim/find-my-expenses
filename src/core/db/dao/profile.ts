/**
 * Section 8.5. A single row holding the user's details, the app settings, and
 * the state of the SMS import.
 */

import type { ProfileRow } from '../models';
import type { SqlDatabase, SqlValue } from '../types';

export function getProfile(db: SqlDatabase): ProfileRow {
  const { rows } = db.execute<ProfileRow>(`SELECT * FROM profile WHERE id = 1`);
  if (!rows[0]) {
    throw new Error('profile row is missing; the database was not seeded');
  }
  return rows[0];
}

/** Column names that may be written through `updateProfile`. */
const WRITABLE = new Set<keyof ProfileRow>([
  'display_name', 'theme', 'timezone', 'home_period', 'location_enabled',
  'notifications_enabled', 'onboarding_completed', 'import_status',
  'import_stage', 'import_window_start', 'scan_cursor_at',
  'last_sms_scanned_at', 'messages_total', 'messages_scanned',
  'accounts_found', 'transactions_found', 'import_started_at',
  'import_completed_at',
]);

export function updateProfile(
  db: SqlDatabase,
  changes: Partial<ProfileRow>,
  now: number = Date.now(),
): void {
  const columns: string[] = [];
  const values: SqlValue[] = [];

  for (const [key, value] of Object.entries(changes)) {
    if (!WRITABLE.has(key as keyof ProfileRow)) {
      continue;
    }
    columns.push(`${key} = ?`);
    values.push(value as SqlValue);
  }
  if (columns.length === 0) {
    return;
  }

  columns.push('updated_at = ?');
  values.push(now);
  db.execute(`UPDATE profile SET ${columns.join(', ')} WHERE id = 1`, values);
}
