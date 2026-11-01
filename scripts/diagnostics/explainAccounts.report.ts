/**
 * Explains where every discovered account came from.
 *
 * Stage one of the import (section 1.1) reads a year of messages for one thing
 * only: the bank behind the sender ID and the account or card digits. When a
 * row turns up that the user does not recognise, the question is always the
 * same — which message produced it, and which rule fired. This answers that.
 *
 * It runs the real `scanForAccount`, not a copy, so what it reports is what
 * the app actually did.
 *
 *   adb -s <serial> shell "content query --uri content://sms/inbox \
 *     --projection address:body:date" > inbox.txt
 *   npm run explain-accounts -- inbox.txt
 *
 * The dump stays wherever it was written. Nothing here sends anything anywhere.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolveBanks } from '../../src/core/sms/banks';
import { normalizeMessageBody } from '../../src/core/sms/normalize';
import { findAccountMatch } from '../../src/core/sms/patterns';
import { accountIdentity, scanForAccount } from '../../src/core/sms/accountScan';
import { parseSms } from '../../src/core/sms/parser';
import type { RawSms } from '../../src/core/sms/types';
import { oneYearBefore } from '../../src/core/time/dates';

/** `content query` prints one row per message, bodies and all. */
function parseContentQueryDump(text: string): RawSms[] {
  const messages: RawSms[] = [];
  // Split on the row marker rather than on newlines: a body may contain them.
  for (const chunk of text.split(/^Row: \d+ /m).slice(1)) {
    const match = chunk.match(/^address=([\s\S]*?), body=([\s\S]*), date=(\d+)\s*$/);
    if (!match) {
      continue;
    }
    messages.push({
      providerId: messages.length + 1,
      senderId: match[1]!.trim(),
      body: match[2]!,
      receivedAt: Number(match[3]),
    });
  }
  return messages;
}

interface Evidence {
  senderId: string;
  receivedAt: number;
  /** The exact text the account rule matched, e.g. `A/c XXXXX528307`. */
  matchedText: string;
  /** Enough of the message to recognise it, not the whole thing. */
  excerpt: string;
  /** What the full pipeline made of the same message. */
  parseStatus: string;
}

interface AccountReport {
  bankName: string;
  bankKey: string;
  lastFour: string;
  accountType: string;
  messageCount: number;
  /** How the full pipeline judged those messages. */
  statuses: Map<string, number>;
  senders: Map<string, number>;
  firstSeen: number;
  lastSeen: number;
  examples: Evidence[];
}

const EXCERPT_LENGTH = 130;

function excerptAround(body: string, index: number): string {
  const start = Math.max(0, index - 45);
  const text = body.slice(start, start + EXCERPT_LENGTH).trim();
  return (start > 0 ? '…' : '') + text + (start + EXCERPT_LENGTH < body.length ? '…' : '');
}

function formatDate(epochMillis: number): string {
  return new Date(epochMillis).toISOString().slice(0, 10);
}

function buildReport(messages: RawSms[], windowStart: number) {
  const accounts = new Map<string, AccountReport>();
  const bankSendersWithNoAccount = new Map<string, number>();
  let inWindow = 0;
  let fromBanks = 0;

  for (const sms of messages) {
    if (sms.receivedAt < windowStart) {
      continue;
    }
    inWindow += 1;

    if (resolveBanks(sms.senderId).length === 0) {
      continue;
    }
    fromBanks += 1;

    const discovered = scanForAccount(sms);
    if (!discovered) {
      bankSendersWithNoAccount.set(
        sms.senderId,
        (bankSendersWithNoAccount.get(sms.senderId) ?? 0) + 1,
      );
      continue;
    }

    const key = accountIdentity(discovered);
    let report = accounts.get(key);
    if (!report) {
      report = {
        bankName: discovered.bankName,
        bankKey: discovered.bankKey,
        lastFour: discovered.lastFour,
        accountType: discovered.accountType,
        messageCount: 0,
        statuses: new Map(),
        senders: new Map(),
        firstSeen: sms.receivedAt,
        lastSeen: sms.receivedAt,
        examples: [],
      };
      accounts.set(key, report);
    }

    report.messageCount += 1;
    report.senders.set(sms.senderId, (report.senders.get(sms.senderId) ?? 0) + 1);
    report.firstSeen = Math.min(report.firstSeen, sms.receivedAt);
    report.lastSeen = Math.max(report.lastSeen, sms.receivedAt);

    const body = normalizeMessageBody(sms.body);
    const match = findAccountMatch(body);
    const parsed = parseSms(sms);

    const status =
      parsed.status === 'PARSED' ? 'PARSED' : `${parsed.status}:${parsed.reason}`;
    report.statuses.set(status, (report.statuses.get(status) ?? 0) + 1);

    // Keep one example per distinct wording, so three identical alerts do not
    // crowd out the one message that explains an unexpected row.
    const wording = (match?.matchedText ?? '').toLowerCase();
    const alreadyShown = report.examples.some(
      (example) => example.matchedText.toLowerCase() === wording,
    );
    if (!alreadyShown && report.examples.length < 4) {
      report.examples.push({
        senderId: sms.senderId,
        receivedAt: sms.receivedAt,
        matchedText: match?.matchedText ?? '(none)',
        excerpt: excerptAround(body, match?.index ?? 0),
        parseStatus:
          parsed.status === 'PARSED'
            ? `PARSED by ${parsed.parserId}`
            : `${parsed.status}: ${parsed.reason}`,
      });
    }
  }

  return { accounts, bankSendersWithNoAccount, inWindow, fromBanks };
}

function render(
  result: ReturnType<typeof buildReport>,
  totalMessages: number,
): string {
  const lines: string[] = [];
  const say = (text = '') => lines.push(text);

  say('ACCOUNTS FOUND — and the messages that produced them');
  say('='.repeat(72));
  say(`${totalMessages} messages in the inbox`);
  say(`${result.inWindow} within the one year window stage one reads`);
  say(`${result.fromBanks} of those from a sender the app recognises as a bank`);
  say(`${result.accounts.size} accounts discovered`);
  say();

  const sorted = [...result.accounts.values()].sort(
    (a, b) =>
      a.bankName.localeCompare(b.bankName) || a.lastFour.localeCompare(b.lastFour),
  );

  for (const account of sorted) {
    say('-'.repeat(72));
    say(`${account.bankName}  ··${account.lastFour}  ${account.accountType}`);
    say(
      `  built from ${account.messageCount} message(s), ` +
        `${formatDate(account.firstSeen)} to ${formatDate(account.lastSeen)}`,
    );
    const senders = [...account.senders.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([sender, count]) => `${sender} (${count})`)
      .join(', ');
    say(`  senders: ${senders}`);

    const parsedCount = account.statuses.get('PARSED') ?? 0;
    const statuses = [...account.statuses.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([status, count]) => `${status} ${count}`)
      .join(', ');
    say(`  outcomes: ${statuses}`);
    if (parsedCount === 0) {
      // Stage one takes the digits before the gates run, so an account can be
      // created by messages that never become a transaction.
      say('  >>> NO message on this account ever produced a transaction.');
    }
    say();
    for (const example of account.examples) {
      say(`  matched "${example.matchedText}"  →  kept ··${account.lastFour}`);
      say(`    ${example.senderId} · ${formatDate(example.receivedAt)} · ${example.parseStatus}`);
      say(`    ${example.excerpt}`);
      say();
    }
  }

  const noAccount = [...result.bankSendersWithNoAccount.entries()].sort(
    (a, b) => b[1] - a[1],
  );
  if (noAccount.length > 0) {
    say('-'.repeat(72));
    say('Bank senders whose messages carried no account digits');
    say('(these contribute no account, which is correct)');
    for (const [sender, count] of noAccount) {
      say(`  ${sender}: ${count}`);
    }
  }

  return lines.join('\n');
}

test('explains where each discovered account came from', () => {
  const dumpPath = process.env.INBOX_DUMP;
  if (!dumpPath) {
    throw new Error('Set INBOX_DUMP to the path of a `content query` dump.');
  }

  const messages = parseContentQueryDump(readFileSync(dumpPath, 'utf8'));
  expect(messages.length).toBeGreaterThan(0);

  const newest = Math.max(...messages.map((message) => message.receivedAt));
  const report = render(buildReport(messages, oneYearBefore(newest)), messages.length);

  const outputPath = process.env.REPORT_OUT ?? dumpPath + '.accounts.txt';
  writeFileSync(outputPath, report + '\n');
  // eslint-disable-next-line no-console
  console.log(`\n${report}\n\nWritten to ${outputPath}`);
});
