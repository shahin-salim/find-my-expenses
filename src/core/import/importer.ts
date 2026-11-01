/**
 * The historical import, section 1.1.
 *
 * "The scan runs in two stages over the same set of messages."
 *
 *   Stage one, find accounts. Read through the messages looking for one thing
 *   only: the bank behind the sender ID and the account or card digits.
 *
 *   Stage two, build transactions. Read through the same messages again, this
 *   time with the full extraction described in Section 2.
 *
 * "Accounts are found first because money moved between the user's own
 * accounts is not spending. That can only be recognised once every account is
 * already known, so finding them up front lets stage two mark those transfers
 * as it creates them, instead of writing them in wrong and correcting them
 * afterwards."
 */

import { listAccounts, upsertDiscoveredAccount } from '../db/dao/accounts';
import { getProfile, updateProfile } from '../db/dao/profile';
import { processedProviderIds } from '../db/dao/smsMessages';
import type { AccountRow, ImportStage } from '../db/models';
import type { SqlDatabase } from '../db/types';
import type { SmsSource } from '../platform/smsReader';
import { accountIdentity, scanForAccount } from '../sms/accountScan';
import { oneYearBefore, toLocalDateString } from '../time/dates';
import { ingestMessage } from '../transactions/ingest';

export interface ImportSnapshot {
  stage: ImportStage;
  messagesTotal: number;
  messagesScanned: number;
  accountsFound: number;
  transactionsFound: number;
  /** Shown as a list on step one of the import screen, as each is found. */
  accounts: AccountRow[];
}

export interface ImportOptions {
  source: SmsSource;
  onProgress?: (snapshot: ImportSnapshot) => void;
  /** Checked between pages so the screen can stop a running import. */
  shouldStop?: () => boolean;
  /**
   * Awaited when a stage finishes, before the next one starts.
   *
   * The progress screen uses this to keep a stage on screen long enough to
   * read. A few hundred messages parse in well under a second, so without it
   * step one is never actually seen. The importer does not know or care why it
   * is being held.
   */
  onStageFinished?: (stage: ImportStage) => Promise<void>;
  now?: () => number;
  pageSize?: number;
  /** Section 8.5: "The counters are written every few hundred messages." */
  progressWriteInterval?: number;
}

const DEFAULT_PAGE_SIZE = 200;
const DEFAULT_PROGRESS_WRITE_INTERVAL = 200;

export type ImportOutcome = 'COMPLETED' | 'STOPPED' | 'FAILED';

/** Lets the UI paint between pages; an import of 5,000 messages is not quick. */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function runImport(
  db: SqlDatabase,
  options: ImportOptions,
): Promise<ImportOutcome> {
  const now = options.now ?? (() => Date.now());
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const writeInterval = options.progressWriteInterval ?? DEFAULT_PROGRESS_WRITE_INTERVAL;

  const startedAt = now();
  const windowStart = oneYearBefore(startedAt);

  let profile = getProfile(db);
  const resuming =
    profile.import_status === 'IN_PROGRESS' && profile.import_stage !== null;

  if (!resuming) {
    updateProfile(
      db,
      {
        import_status: 'IN_PROGRESS',
        import_stage: 'ACCOUNTS',
        import_window_start: toLocalDateString(windowStart),
        import_started_at: startedAt,
        scan_cursor_at: null,
        messages_scanned: 0,
        accounts_found: 0,
        transactions_found: 0,
      },
      startedAt,
    );
    profile = getProfile(db);
  }

  const emit = (stage: ImportStage, scanned: number, counters: {
    accountsFound: number;
    transactionsFound: number;
  }) => {
    options.onProgress?.({
      stage,
      messagesTotal: getProfile(db).messages_total,
      messagesScanned: scanned,
      accountsFound: counters.accountsFound,
      transactionsFound: counters.transactionsFound,
      accounts: listAccounts(db).filter((account) => account.account_type !== 'CASH'),
    });
  };

  try {
    // Both stages read the same year of messages, so the total is counted once.
    if (profile.messages_total === 0) {
      const total = await options.source.count(windowStart, startedAt);
      updateProfile(db, { messages_total: total }, now());
      profile = getProfile(db);
    }

    /* ------------------------------------------------------- stage one --- */
    if (profile.import_stage === 'ACCOUNTS') {
      const discovered = new Set<string>();
      // A resumed import continues from the cursor rather than starting again.
      let cursor = profile.scan_cursor_at ?? startedAt;
      let scanned = profile.messages_scanned;
      let accountsFound = profile.accounts_found;
      let sinceWrite = 0;
      let offset = 0;

      for (;;) {
        if (options.shouldStop?.()) {
          updateProfile(db, { messages_scanned: scanned, accounts_found: accountsFound }, now());
          return 'STOPPED';
        }

        const page = await options.source.page({
          minDate: windowStart,
          maxDate: cursor,
          offset,
          limit: pageSize,
        });
        if (page.length === 0) {
          break;
        }

        db.transaction(() => {
          for (const sms of page) {
            // Nothing else is written in this stage: not the amount, not the
            // date, not the name, not the reference number.
            const account = scanForAccount(sms);
            if (account) {
              const identity = accountIdentity(account);
              const upserted = upsertDiscoveredAccount(db, account, now());
              if (upserted.created && !discovered.has(identity)) {
                accountsFound += 1;
              }
              discovered.add(identity);
            }
            scanned += 1;
            sinceWrite += 1;
          }
        });

        const oldest = page[page.length - 1]!.receivedAt;
        offset += page.length;

        if (sinceWrite >= writeInterval) {
          updateProfile(
            db,
            {
              messages_scanned: scanned,
              accounts_found: accountsFound,
              scan_cursor_at: oldest,
            },
            now(),
          );
          sinceWrite = 0;
        }

        emit('ACCOUNTS', scanned, { accountsFound, transactionsFound: 0 });

        if (page.length < pageSize) {
          break;
        }
        await yieldToUi();
      }

      await options.onStageFinished?.('ACCOUNTS');

      // Stage two relies on the SMS messages table being empty when it starts,
      // which stage one never writes to.
      updateProfile(
        db,
        {
          messages_scanned: 0,
          scan_cursor_at: null,
          accounts_found: accountsFound,
          import_stage: 'TRANSACTIONS',
        },
        now(),
      );
      profile = getProfile(db);
      emit('TRANSACTIONS', 0, { accountsFound, transactionsFound: 0 });
    }

    /* ------------------------------------------------------- stage two --- */
    {
      const alreadyRead = processedProviderIds(db);
      let cursor = profile.scan_cursor_at ?? startedAt;
      let scanned = profile.messages_scanned;
      let transactionsFound = profile.transactions_found;
      const accountsFound = profile.accounts_found;
      let sinceWrite = 0;
      let offset = 0;

      for (;;) {
        if (options.shouldStop?.()) {
          updateProfile(
            db,
            { messages_scanned: scanned, transactions_found: transactionsFound },
            now(),
          );
          return 'STOPPED';
        }

        const page = await options.source.page({
          minDate: windowStart,
          maxDate: cursor,
          offset,
          limit: pageSize,
        });
        if (page.length === 0) {
          break;
        }

        db.transaction(() => {
          for (const sms of page) {
            // Section 3.1, the message-level check: a message already read is
            // skipped and nothing is parsed.
            if (!alreadyRead.has(sms.providerId)) {
              const result = ingestMessage(db, sms, { now: now() });
              if (result.kind === 'CREATED') {
                transactionsFound += 1;
              }
              alreadyRead.add(sms.providerId);
            }
            scanned += 1;
            sinceWrite += 1;
          }
        });

        const oldest = page[page.length - 1]!.receivedAt;
        offset += page.length;

        if (sinceWrite >= writeInterval) {
          updateProfile(
            db,
            {
              messages_scanned: scanned,
              transactions_found: transactionsFound,
              scan_cursor_at: oldest,
            },
            now(),
          );
          sinceWrite = 0;
        }

        emit('TRANSACTIONS', scanned, { accountsFound, transactionsFound });

        if (page.length < pageSize) {
          break;
        }
        await yieldToUi();
      }

      // Section 1.2: the point a catch-up scan on launch reads forward from.
      //
      // The moment the import started reading, rather than the newest message
      // it recorded. `sms_messages` holds bank messages only — gate one drops
      // everything else before anything is written — so `MAX(received_at)`
      // over that table answers NULL for an inbox with no recognised bank,
      // and otherwise sits behind every ordinary message newer than the last
      // bank one, which is the common case. The first left the watermark NULL
      // and sent every launch back over a year of inbox; the second re-read
      // the tail of it on every run, forever.
      //
      // What the import actually covered is the window ending at
      // `import_started_at`. On a resumed import that is the first attempt's
      // start and not this one's, so a message that arrived while the import
      // was paused stays ahead of the watermark for the catch-up to find.
      const coveredTo = getProfile(db).import_started_at ?? startedAt;

      updateProfile(
        db,
        {
          messages_scanned: scanned,
          transactions_found: transactionsFound,
          import_status: 'COMPLETED',
          import_completed_at: now(),
          last_sms_scanned_at: coveredTo,
        },
        now(),
      );
      emit('TRANSACTIONS', scanned, { accountsFound, transactionsFound });
      await options.onStageFinished?.('TRANSACTIONS');
    }

    return 'COMPLETED';
  } catch (error) {
    updateProfile(db, { import_status: 'FAILED' }, now());
    throw error;
  }
}
