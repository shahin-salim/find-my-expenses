/**
 * Writes db.log: the whole transactions table, joined to the message each row
 * was read from.
 *
 * The join cannot be done in SQL alone. Section 8.6 keeps one row per message
 * but deliberately does not keep the text — "The message text is not stored.
 * Only the provider id is kept, which is enough to read the message back from
 * the inbox." So the bodies are read off the phone and loaded into a scratch
 * table in the pulled copy, which lets the join, and the table that comes out
 * of it, be ordinary SQL.
 *
 * Usage:  npm run db:log
 *         npm run db:log -- --limit 50
 *         npm run db:log -- --where "currency <> 'INR'"
 */

const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DB = path.join(ROOT, '.local/db/find-my-expense.sqlite');
const OUT = path.join(ROOT, 'db.log');

/* ----------------------------------------------------------- arguments --- */

const argv = process.argv.slice(2);
const option = (name) => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? null : argv[at + 1];
};
const where = option('where');
const limit = option('limit');

/* ------------------------------------------------- the inbox, for bodies -- */

/**
 * `content query` prints one record per line as `Row: 0 _id=1, body=...`,
 * except that a body containing a newline runs onto the next line. Splitting
 * on the row marker rather than on newlines is what keeps those together.
 */
function readInbox() {
  const serial = process.env.ANDROID_SERIAL;
  const args = serial ? ['-s', serial] : [];
  const raw = execFileSync(
    'adb',
    [...args, 'exec-out', 'content', 'query',
     '--uri', 'content://sms', '--projection', '_id:body'],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );

  const bodies = [];
  for (const chunk of raw.split(/^Row: \d+ /m)) {
    const match = chunk.match(/^_id=(\d+), body=([\s\S]*)$/);
    if (match) {
      // A box table draws one row per line, so an embedded newline would
      // break the frame. Collapsed here rather than in SQL so the column is
      // measured at its real width.
      bodies.push([Number(match[1]), match[2].replace(/\s+/g, ' ').trim()]);
    }
  }
  return bodies;
}

/* ------------------------------------------------------------- the join -- */

if (!fs.existsSync(DB)) {
  console.error('No local copy of the database. Run `npm run db` first.');
  process.exit(1);
}

const bodies = readInbox();

// Written into the pulled copy, never the phone. `npm run db` replaces that
// copy wholesale, so this table is rebuilt on every run and never goes stale.
const db = new DatabaseSync(DB);
db.exec(`DROP TABLE IF EXISTS inbox_bodies`);
db.exec(`CREATE TABLE inbox_bodies (provider_id INTEGER PRIMARY KEY, body TEXT)`);
const insert = db.prepare(`INSERT OR REPLACE INTO inbox_bodies VALUES (?, ?)`);
db.exec('BEGIN');
for (const [id, body] of bodies) { insert.run(id, body); }
db.exec('COMMIT');

// t.* is every column of the transactions table, in schema order, with
// nothing dropped. The sms columns follow, then the body last, because it is
// much the widest and a trailing column keeps the rest readable.
const QUERY = `
  SELECT t.*,
         s.provider_id  AS sms_provider_id,
         s.sender_id    AS sms_sender_id,
         s.received_at  AS sms_received_at,
         s.parse_status AS sms_parse_status,
         s.parser_id    AS sms_parser_id,
         s.detail       AS sms_detail,
         s.scanned_at   AS sms_scanned_at,
         b.body         AS message
    FROM transactions t
    INNER JOIN sms_messages s ON s.id = t.source_sms_id
    LEFT  JOIN inbox_bodies b ON b.provider_id = s.provider_id
   ${where ? `WHERE ${where}` : ''}
   ORDER BY t.occurred_at DESC
   ${limit ? `LIMIT ${Number(limit)}` : ''}
`;

const counted = db.prepare(
  `SELECT COUNT(*) AS n FROM (${QUERY})`,
).get().n;
const orphans = db.prepare(
  `SELECT COUNT(*) AS n FROM transactions WHERE source_sms_id IS NULL`,
).get().n;
db.close();

/* --------------------------------------------------------------- output -- */

// Rendered by the sqlite3 CLI rather than by hand: it sizes every column to
// its widest value and draws the same box table the shell does.
const table = execFileSync(
  'sqlite3',
  ['-box', '-cmd', '.headers on', DB, QUERY],
  { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 },
);

fs.writeFileSync(OUT, table);

console.log(`Wrote db.log — ${counted} transactions, ` +
            `${(fs.statSync(OUT).size / 1024).toFixed(0)}K`);
if (orphans) {
  console.log(`${orphans} transaction(s) have no source message (manual entry); ` +
              `the inner join leaves them out.`);
}
