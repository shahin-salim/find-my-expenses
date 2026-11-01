/**
 * Turning one message into database rows.
 *
 * Section 5.3: "Categorization runs whenever a transaction is created, whether
 * it came from an imported message, a newly received message, or manual
 * entry." The same is true of deduplication, account resolution and reversal
 * matching, so all of it lives here and both the historical import and the new
 * message receiver call it.
 */

import { categoryKeyForMerchantName } from '../categorization/categorize';
import { markDataChanged } from '../db/changes';
import { upsertDiscoveredAccount } from '../db/dao/accounts';
import { findCategoryBySystemKey } from '../db/dao/categories';
import {
  applyAutomaticCategory,
  findOrCreateMerchant,
} from '../db/dao/merchants';
import { hasProcessedMessage, recordMessage } from '../db/dao/smsMessages';
import { insertTransactionIfNew } from '../db/dao/transactions';
import type { TransactionRow } from '../db/models';
import type { SqlDatabase } from '../db/types';
import { scanForAccount } from '../sms/accountScan';
import { dedupKeyForSms } from '../sms/dedup';
import { parseSms } from '../sms/parser';
import type { RawSms } from '../sms/types';
import { matchLending, type LendMatch } from '../lending/match';
import { reconcileByReference, type ReconcileOutcome } from './reconcile';

export interface LocationFix {
  latitude: number;
  longitude: number;
  label: string | null;
  capturedAt: number;
}

export type IngestResult =
  | { kind: 'SKIPPED_ALREADY_READ' }
  | { kind: 'IGNORED'; reason: string }
  | { kind: 'UNREADABLE'; reason: string }
  | { kind: 'DUPLICATE'; transaction: TransactionRow }
  | {
      kind: 'CREATED';
      transaction: TransactionRow;
      reconciled: ReconcileOutcome;
      /** Section 12.4. Empty unless this row joined up with a lend. */
      lendMatches: LendMatch[];
      accountCreated: boolean;
      merchantCreated: boolean;
    };

export interface IngestOptions {
  /**
   * Section 6: location is attached to new messages only. "Historical
   * transactions will not have location information."
   */
  location?: LocationFix | null;
  now?: number;
}

/**
 * Reads one message and writes whatever it produces. Never throws for a
 * message it cannot understand; that message is recorded as unreadable so it
 * shows up on the Settings screen in section 11.1.
 */
export function ingestMessage(
  db: SqlDatabase,
  sms: RawSms,
  options: IngestOptions = {},
): IngestResult {
  const now = options.now ?? Date.now();

  // Section 3.1, the message-level check, before anything is parsed. A
  // message already in `sms_messages` has been through all of this once, and
  // reading it a second time re-runs the account scan, touches the payee row
  // and asks the parser the same question for an answer that is already
  // recorded. Only the unique index on the dedup key kept that from leaving
  // a second copy of the payment behind.
  //
  // It belongs here because this is the one place both ingestion paths share.
  // The import had its own in-memory set of what it had read, which is gone
  // the moment the import is, and the catch-up scan had nothing at all — it
  // deliberately re-reads the message sitting exactly on the watermark, and
  // the comment there says this check is what drops it.
  //
  // `retryUnreadable` deletes the row before calling this, on purpose, so a
  // parser fix can still reach the messages it was written for.
  if (hasProcessedMessage(db, sms.providerId)) {
    return { kind: 'SKIPPED_ALREADY_READ' };
  }

  const parsed = parseSms(sms);

  // A message that fails gate one is not from a bank and is not recorded at
  // all — section 2.1.
  if (parsed.status === 'IGNORED' && parsed.reason === 'NOT_A_BANK_SENDER') {
    return { kind: 'IGNORED', reason: parsed.reason };
  }

  if (parsed.status === 'IGNORED') {
    recordMessage(
      db,
      {
        providerId: sms.providerId,
        senderId: sms.senderId,
        receivedAt: sms.receivedAt,
        parseStatus: 'IGNORED',
        detail: parsed.reason,
      },
      now,
    );
    return { kind: 'IGNORED', reason: parsed.reason };
  }

  if (parsed.status === 'NO_MATCH') {
    recordMessage(
      db,
      {
        providerId: sms.providerId,
        senderId: sms.senderId,
        receivedAt: sms.receivedAt,
        parseStatus: 'NO_MATCH',
        parserId: parsed.parserId,
        detail: parsed.reason,
      },
      now,
    );
    return { kind: 'UNREADABLE', reason: parsed.reason };
  }

  const extracted = parsed.transaction;
  const smsId = recordMessage(
    db,
    {
      providerId: sms.providerId,
      senderId: sms.senderId,
      receivedAt: sms.receivedAt,
      parseStatus: 'PARSED',
      parserId: parsed.parserId,
    },
    now,
  );

  // The account. Stage one of the import has normally created it already, in
  // which case this resolves to the same row rather than making another.
  let accountId: number | null = null;
  let accountCreated = false;
  const discovered = scanForAccount(sms);
  if (discovered) {
    const upserted = upsertDiscoveredAccount(db, discovered, now);
    accountId = upserted.row.id;
    accountCreated = upserted.created;
  }

  // The merchant, and the category that hangs off it.
  const merchantResult = findOrCreateMerchant(
    db,
    { recipientName: extracted.recipientName, upiId: extracted.upiId },
    extracted.occurredAt,
    now,
  );
  const merchant = merchantResult?.merchant ?? null;

  if (merchant && merchant.category_id === null) {
    // Section 5.2: "If the name is not found, or the message carried only a
    // UPI ID with no name, the merchant is created without a category." So the
    // rules are matched against the name only, never against the UPI ID.
    const systemKey = categoryKeyForMerchantName(
      extracted.recipientName ?? merchant.normalized_name,
    );
    if (systemKey) {
      const category = findCategoryBySystemKey(db, systemKey);
      if (category) {
        applyAutomaticCategory(db, merchant.id, category.id, now);
      }
    }
  }

  const dedupKey = dedupKeyForSms({
    transaction: extracted,
    providerId: sms.providerId,
    accountId,
  });

  const inserted = insertTransactionIfNew(
    db,
    {
      amount: extracted.amount,
      currency: extracted.currency,
      transactionType: extracted.transactionType,
      occurredAt: extracted.occurredAt,
      occurredOn: extracted.occurredOn,
      merchantId: merchant?.id ?? null,
      recipientName: extracted.recipientName,
      accountId,
      categoryId: null,
      source: 'SMS',
      sourceSmsId: smsId,
      bankSenderId: extracted.senderId,
      rrn: extracted.rrn,
      parserId: extracted.parserId,
      dedupKey,
      // Section 8.4: a payee already known to be one of the user's own
      // accounts makes this a transfer without needing the pair to match.
      isTransfer: merchant?.is_self === 1,
      latitude: options.location?.latitude ?? null,
      longitude: options.location?.longitude ?? null,
      locationLabel: options.location?.label ?? null,
      locationCapturedAt: options.location?.capturedAt ?? null,
    },
    now,
  );

  if (!inserted.created) {
    return { kind: 'DUPLICATE', transaction: inserted.row };
  }

  const reconciled = reconcileByReference(db, inserted.row, now);

  // Section 12.4, and only once the reference match has had its say: money
  // that came back because the payment failed, or because it was moved
  // between the user's own accounts, is not a friend paying off a lend.
  const lendMatches =
    reconciled.kind === 'NONE' ? matchLending(db, inserted.row, now) : [];

  markDataChanged();

  return {
    kind: 'CREATED',
    transaction: inserted.row,
    reconciled,
    lendMatches,
    accountCreated,
    merchantCreated: merchantResult?.created ?? false,
  };
}
