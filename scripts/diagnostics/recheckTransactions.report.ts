/**
 * Re-reads every stored transaction's message with the current parser and
 * reports the ones the app would no longer create.
 *
 * Section 3.1 skips any message already in `sms_messages`, so tightening a
 * gate never reaches the rows that gate was written for — a reminder recorded
 * as spending last month stays in the totals forever unless something goes
 * back for it. This is what goes back for it, and it answers the question a
 * gate change always raises: how many real transactions did I just break?
 *
 * It runs the real `parseSms`, not a copy, against the database pulled by
 * `npm run db` and the bodies loaded alongside it by `npm run db:log`.
 *
 *   npm run db && npm run db:log && npm run recheck
 *
 * Nothing is written to the phone and nothing is sent anywhere; the copy it
 * reads is the local one under .local/db.
 */

import { DatabaseSync } from 'node:sqlite';
import { join } from 'path';
import { parseSms } from '../../src/core/sms/parser';

const DB = join(__dirname, '../../.local/db/find-my-expense.sqlite');

interface Row {
  id: number;
  amount: number;
  currency: string;
  transaction_type: string;
  occurred_on: string;
  recipient_name: string | null;
  provider_id: number;
  sender_id: string;
  received_at: number;
  body: string;
}

const rupees = (minor: number) =>
  (minor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });

test('re-reads every stored transaction with the current parser', () => {
  const db = new DatabaseSync(DB, { readOnly: true });

  const rows = db.prepare(`
    SELECT t.id, t.amount, t.currency, t.transaction_type, t.occurred_on,
           t.recipient_name, s.provider_id, s.sender_id, s.received_at, b.body
      FROM transactions t
      JOIN sms_messages s ON s.id = t.source_sms_id
      JOIN inbox_bodies b ON b.provider_id = s.provider_id
     WHERE t.is_deleted = 0
     ORDER BY t.occurred_at DESC
  `).all() as unknown as Row[];

  const dropped: Array<{ row: Row; reason: string }> = [];
  const changed: Array<{ row: Row; was: string; now: string }> = [];

  for (const row of rows) {
    const result = parseSms({
      providerId: row.provider_id,
      senderId: row.sender_id,
      body: row.body,
      receivedAt: row.received_at,
    });

    if (result.status !== 'PARSED') {
      dropped.push({ row, reason: `${result.status} · ${result.reason}` });
      continue;
    }

    // A row the parser still produces, but differently, is worth seeing too:
    // a changed amount or direction is a silent correction otherwise.
    const now = `${result.transaction.transactionType} ` +
                `${result.transaction.currency} ${result.transaction.amount}` +
                ` · ${result.transaction.recipientName ?? '—'}`;
    const was = `${row.transaction_type} ${row.currency} ${row.amount}` +
                ` · ${row.recipient_name ?? '—'}`;
    if (now !== was) {
      changed.push({ row, was, now });
    }
  }

  const lines: string[] = [];
  const say = (text = '') => lines.push(text);

  say(`Re-read ${rows.length} transactions with the current parser.`);
  say(`  ${dropped.length} would no longer be created`);
  say(`  ${changed.length} would be created with different values`);
  say();

  if (dropped.length > 0) {
    const byReason = new Map<string, Array<{ row: Row }>>();
    for (const entry of dropped) {
      const list = byReason.get(entry.reason) ?? [];
      list.push(entry);
      byReason.set(entry.reason, list);
    }

    say('-'.repeat(72));
    say('No longer transactions');
    for (const [reason, entries] of [...byReason].sort((a, b) => b[1].length - a[1].length)) {
      const total = entries.reduce((sum, e) => sum + e.row.amount, 0);
      say();
      say(`${reason} — ${entries.length} rows, ${rupees(total)}`);
      for (const { row } of entries) {
        say(`  #${row.id}  ${row.occurred_on}  ${row.transaction_type} ` +
            `${rupees(row.amount)}  ${row.recipient_name ?? ''}`);
        say(`    ${row.body.slice(0, 120)}`);
      }
    }
  }

  if (changed.length > 0) {
    say();
    say('-'.repeat(72));
    say('Same message, different result');
    // Grouped: one wording that changed usually affects many rows, and the
    // shape of the change matters more than the individual rows.
    const byChange = new Map<string, number>();
    for (const { was, now } of changed) {
      const key = `${was}\n    now  ${now}`;
      byChange.set(key, (byChange.get(key) ?? 0) + 1);
    }
    for (const [key, count] of [...byChange].sort((a, b) => b[1] - a[1])) {
      say(`  was  ${key}   (${count} row${count === 1 ? '' : 's'})`);
    }
  }

  // eslint-disable-next-line no-console
  console.log('\n' + lines.join('\n'));

  db.close();
});
