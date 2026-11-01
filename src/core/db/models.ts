/** Row shapes as they come back from SQLite. Booleans arrive as 0 or 1. */

export type SqlBool = 0 | 1;

export interface CategoryRow {
  id: number;
  name: string;
  system_key: string | null;
  icon: string;
  color: string;
  is_system: SqlBool;
  sort_order: number;
  is_archived: SqlBool;
  excluded_from_totals: SqlBool;
  is_fixed_cost: SqlBool;
  /** Payments here are asked whether the money came back — see `repaid_at`. */
  tracks_repayment: SqlBool;
  created_at: number;
  updated_at: number;
}

export interface AccountRow {
  id: number;
  bank_name: string;
  bank_key: string;
  last_four: string;
  account_type: 'BANK' | 'CARD' | 'WALLET' | 'CASH';
  created_at: number;
  updated_at: number;
}

export interface MerchantRow {
  id: number;
  identity_key: string;
  display_name: string;
  normalized_name: string | null;
  upi_id: string | null;
  category_id: number | null;
  category_source: 'NONE' | 'AUTO' | 'USER';
  is_self: SqlBool;
  first_seen_at: number;
  last_seen_at: number;
  created_at: number;
  updated_at: number;
}

export interface TransactionRow {
  id: number;
  /** Minor units of `currency`. */
  amount: number;
  /** `INR` unless the card was used abroad — see section 8.1. */
  currency: string;
  transaction_type: 'DEBIT' | 'CREDIT';
  occurred_at: number;
  occurred_on: string;
  merchant_id: number | null;
  recipient_name: string | null;
  account_id: number | null;
  category_id: number | null;
  /** The user said this payment has none, overriding the payee's. */
  category_cleared: 0 | 1;
  source: 'SMS' | 'MANUAL';
  source_sms_id: number | null;
  bank_sender_id: string | null;
  rrn: string | null;
  parser_id: string | null;
  dedup_key: string;
  latitude: number | null;
  longitude: number | null;
  location_label: string | null;
  location_captured_at: number | null;
  note: string | null;
  is_transfer: SqlBool;
  is_excluded: SqlBool;
  is_refunded: SqlBool;
  /** When the user said the money came back. NULL while it is still out. */
  repaid_at: number | null;
  /**
   * Section 12.2. On a repayment, the lend it pays back; NULL on everything
   * else. A lend holds nothing pointing the other way — see `core/lending`.
   */
  repays_transaction_id: number | null;
  is_deleted: SqlBool;
  created_at: number;
  updated_at: number;
}

export type ImportStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
export type ImportStage = 'ACCOUNTS' | 'TRANSACTIONS';

export interface ProfileRow {
  id: 1;
  display_name: string | null;
  theme: 'SYSTEM' | 'LIGHT' | 'DARK';
  timezone: string | null;
  /** Which Home card the user last had open. See `PeriodKind`. */
  home_period: 'DAY' | 'WEEK' | 'MONTH';
  location_enabled: SqlBool;
  notifications_enabled: SqlBool;
  onboarding_completed: SqlBool;
  import_status: ImportStatus;
  import_stage: ImportStage | null;
  import_window_start: string | null;
  scan_cursor_at: number | null;
  last_sms_scanned_at: number | null;
  messages_total: number;
  messages_scanned: number;
  accounts_found: number;
  transactions_found: number;
  import_started_at: number | null;
  import_completed_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface SmsMessageRow {
  id: number;
  provider_id: number;
  sender_id: string;
  received_at: number;
  parse_status: 'PARSED' | 'NO_MATCH' | 'IGNORED';
  parser_id: string | null;
  detail: string | null;
  scanned_at: number;
}
