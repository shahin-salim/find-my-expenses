/**
 * The one open database for this JavaScript context.
 *
 * There are two callers now, not one. `AppProvider` opens it when a screen is
 * about to be drawn, and the headless task in section 6.1 opens it when a
 * message arrives with no screen anywhere — and when the app happens to be
 * alive in the background, both of those are the same process. Opening the
 * file twice there would be two connections writing the same tables, which
 * SQLite permits and WAL survives, but which gets the two sides of the app
 * disagreeing about what has been written for no benefit at all.
 *
 * So it is opened once and handed out. Migration and seeding run on that
 * first open, which is why nothing else calls `initializeDatabase`.
 */

import { initializeDatabase } from './database';
import { openDeviceDatabase } from './opSqlite';
import type { SqlDatabase } from './types';

let instance: SqlDatabase | null = null;

export function appDatabase(): SqlDatabase {
  if (instance === null) {
    instance = initializeDatabase(openDeviceDatabase());
  }
  return instance;
}
