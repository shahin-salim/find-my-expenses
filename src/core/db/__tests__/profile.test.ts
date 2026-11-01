/**
 * The profile row, and the one thing about it that can break on upgrade.
 *
 * A column added after release reaches an existing phone through
 * `ADDED_COLUMNS` rather than through the schema, because `CREATE TABLE IF
 * NOT EXISTS` is a no-op against a table that is already there. Getting that
 * wrong is not a wrong number on a screen, it is a query against a column
 * that does not exist on first launch after an update — so it is worth a
 * test that actually starts from the old shape.
 */

import { initializeDatabase } from '../database';
import { getProfile, updateProfile } from '../dao/profile';
import { openNodeDatabase } from '../nodeSqlite';
import type { SqlDatabase } from '../types';

function columns(db: SqlDatabase, table: string): string[] {
  return db
    .execute<{ name: string }>(`PRAGMA table_info(${table})`)
    .rows.map((row) => row.name);
}

describe('the Home period the app reopens on', () => {
  it('opens on Today until the user has chosen otherwise', () => {
    const db = initializeDatabase(openNodeDatabase(':memory:'));
    expect(getProfile(db).home_period).toBe('DAY');
  });

  it('remembers the card that was tapped', () => {
    const db = initializeDatabase(openNodeDatabase(':memory:'));
    updateProfile(db, { home_period: 'MONTH' });
    expect(getProfile(db).home_period).toBe('MONTH');
  });

  it('reaches a database that was created before the column existed', () => {
    const raw = openNodeDatabase(':memory:');
    // The profile table as it shipped, without `home_period`. The schema's
    // CREATE will not touch it, so only the migration can.
    raw.execute(`CREATE TABLE profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      display_name TEXT,
      theme TEXT NOT NULL DEFAULT 'SYSTEM',
      timezone TEXT,
      location_enabled INTEGER NOT NULL DEFAULT 1,
      notifications_enabled INTEGER NOT NULL DEFAULT 0,
      onboarding_completed INTEGER NOT NULL DEFAULT 0,
      import_status TEXT NOT NULL DEFAULT 'NOT_STARTED',
      import_stage TEXT,
      import_window_start TEXT,
      scan_cursor_at INTEGER,
      last_sms_scanned_at INTEGER,
      messages_total INTEGER NOT NULL DEFAULT 0,
      messages_scanned INTEGER NOT NULL DEFAULT 0,
      accounts_found INTEGER NOT NULL DEFAULT 0,
      transactions_found INTEGER NOT NULL DEFAULT 0,
      import_started_at INTEGER,
      import_completed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    raw.execute(
      `INSERT INTO profile (id, display_name, created_at, updated_at)
       VALUES (1, 'Someone mid-upgrade', 1, 1)`,
    );
    expect(columns(raw, 'profile')).not.toContain('home_period');

    const db = initializeDatabase(raw);

    expect(columns(db, 'profile')).toContain('home_period');
    const profile = getProfile(db);
    // The row they already had, with a sensible answer for the new column.
    expect(profile.display_name).toBe('Someone mid-upgrade');
    expect(profile.home_period).toBe('DAY');
  });
});
