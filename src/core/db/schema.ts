/**
 * The schema from section 8. SQLite on the device; nothing is sent to a server.
 *
 * Every constraint here is load-bearing and the reason is in the design notes
 * of the section it comes from.
 */

export const SCHEMA_VERSION = 6;

export const CREATE_STATEMENTS: string[] = [
  /* ------------------------------------------------- 8.2 Categories ------- */
  `CREATE TABLE IF NOT EXISTS categories (
     id          INTEGER PRIMARY KEY AUTOINCREMENT,
     name        TEXT    NOT NULL CHECK (length(name) <= 24),
     system_key  TEXT    UNIQUE,
     icon        TEXT    NOT NULL,
     color       TEXT    NOT NULL,
     is_system   INTEGER NOT NULL DEFAULT 0,
     sort_order  INTEGER NOT NULL DEFAULT 0,
     is_archived INTEGER NOT NULL DEFAULT 0,
     -- The category-create screen's "Leave out of spending totals" toggle.
     -- Also what the Home filter sheet's "Everyday spending" option reads to
     -- decide which categories are fixed costs.
     excluded_from_totals INTEGER NOT NULL DEFAULT 0,
     -- What the Home filter sheet's "Everyday spending" option and the
     -- Transactions filter's "Hide rent and fixed payments" toggle read.
     -- Rent, bills and SIPs recur at a size that drowns out everyday spending.
     is_fixed_cost        INTEGER NOT NULL DEFAULT 0,
     -- Money handed over on the understanding that it comes back, which is
     -- what Lend ships set. A payment in a category marked this way is asked
     -- whether it has been paid back, and stops counting once it has.
     --
     -- A flag on the category rather than a check for the Lend row, because
     -- section 8.2 lets a built-in category be renamed and lets the user make
     -- their own: someone with a category per person they lend to should get
     -- the same question on all of them.
     tracks_repayment     INTEGER NOT NULL DEFAULT 0,
     created_at  INTEGER NOT NULL,
     updated_at  INTEGER NOT NULL
   )`,
  // UNIQUE here is what enforces "Must be different from your other categories".
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_cat_name ON categories (name COLLATE NOCASE)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_cat_system_key ON categories (system_key)`,
  `CREATE INDEX IF NOT EXISTS idx_cat_order ON categories (is_archived, sort_order)`,

  /* --------------------------------------------------- 8.3 Accounts ------- */
  `CREATE TABLE IF NOT EXISTS accounts (
     id           INTEGER PRIMARY KEY AUTOINCREMENT,
     bank_name    TEXT    NOT NULL,
     bank_key     TEXT    NOT NULL,
     -- Empty string for cash, never NULL: SQLite treats two NULLs in a unique
     -- index as different values, so a NULL here would not stop a second cash
     -- row being created.
     last_four    TEXT    NOT NULL CHECK (last_four = '' OR length(last_four) BETWEEN 3 AND 4),
     account_type TEXT    NOT NULL CHECK (account_type IN ('BANK','CARD','WALLET','CASH')),
     created_at   INTEGER NOT NULL,
     updated_at   INTEGER NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_acct_identity
     ON accounts (bank_key, last_four, account_type)`,
  `CREATE INDEX IF NOT EXISTS idx_acct_type ON accounts (account_type)`,

  /* -------------------------------------------------- 8.4 Merchants ------- */
  `CREATE TABLE IF NOT EXISTS merchants (
     id              INTEGER PRIMARY KEY AUTOINCREMENT,
     identity_key    TEXT    NOT NULL UNIQUE,
     display_name    TEXT    NOT NULL,
     normalized_name TEXT,
     upi_id          TEXT,
     category_id     INTEGER REFERENCES categories(id),
     category_source TEXT    NOT NULL DEFAULT 'NONE'
                     CHECK (category_source IN ('NONE','AUTO','USER')),
     is_self         INTEGER NOT NULL DEFAULT 0,
     first_seen_at   INTEGER NOT NULL,
     last_seen_at    INTEGER NOT NULL,
     created_at      INTEGER NOT NULL,
     updated_at      INTEGER NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_merchant_identity ON merchants (identity_key)`,
  `CREATE INDEX IF NOT EXISTS idx_merchant_normalized ON merchants (normalized_name)`,
  `CREATE INDEX IF NOT EXISTS idx_merchant_category ON merchants (category_id)`,

  /* ----------------------------------------------- 8.6 SMS messages ------- */
  `CREATE TABLE IF NOT EXISTS sms_messages (
     id           INTEGER PRIMARY KEY AUTOINCREMENT,
     provider_id  INTEGER NOT NULL UNIQUE,
     sender_id    TEXT    NOT NULL,
     received_at  INTEGER NOT NULL,
     parse_status TEXT    NOT NULL CHECK (parse_status IN ('PARSED','NO_MATCH','IGNORED')),
     parser_id    TEXT,
     -- Not in the spec's column list, but the unreadable-messages screen in
     -- 11.1 groups by bank and needs a reason to tell a format it cannot read
     -- from an OTP it chose to skip.
     detail       TEXT,
     scanned_at   INTEGER NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_provider ON sms_messages (provider_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sms_status ON sms_messages (parse_status)`,

  /* ----------------------------------------------- 8.1 Transactions ------- */
  `CREATE TABLE IF NOT EXISTS transactions (
     id                   INTEGER PRIMARY KEY AUTOINCREMENT,
     -- Minor units of the currency column below. Always positive; the sign
     -- comes from transaction_type.
     amount               INTEGER NOT NULL CHECK (amount > 0),
     -- Almost always INR, where the minor unit is the paise section 8.1
     -- describes. A card used abroad reports its own currency and no rupee
     -- figure at all, and there is no exchange rate on the device, so the
     -- amount is kept in the currency the bank wrote. Section 10's spending
     -- clause requires INR, so a foreign row can never be added into a rupee
     -- total whatever else is done to it.
     currency             TEXT    NOT NULL DEFAULT 'INR',
     transaction_type     TEXT    NOT NULL CHECK (transaction_type IN ('DEBIT','CREDIT')),
     occurred_at          INTEGER NOT NULL,
     -- Stored, not derived: every screen groups by local day.
     occurred_on          TEXT    NOT NULL,
     merchant_id          INTEGER REFERENCES merchants(id),
     recipient_name       TEXT,
     account_id           INTEGER REFERENCES accounts(id),
     -- An override over the merchant's category, not the category itself.
     category_id          INTEGER REFERENCES categories(id),
     -- The user saying this payment has no category, which NULL above
     -- cannot say. NULL means "whatever the payee says"; section 10.3
     -- resolves it through the merchant, so a payment to a payee that
     -- carries a category could never be left blank. This can.
     --
     -- Separate from category_id rather than a sentinel value in it,
     -- because that column is a foreign key and a sentinel would have to
     -- be a real row in categories that is not a real category.
     category_cleared     INTEGER NOT NULL DEFAULT 0,
     source               TEXT    NOT NULL CHECK (source IN ('SMS','MANUAL')),
     source_sms_id        INTEGER REFERENCES sms_messages(id),
     bank_sender_id       TEXT,
     rrn                  TEXT,
     parser_id            TEXT,
     dedup_key            TEXT    NOT NULL UNIQUE,
     latitude             REAL,
     longitude            REAL,
     location_label       TEXT,
     location_captured_at INTEGER,
     note                 TEXT,
     is_transfer          INTEGER NOT NULL DEFAULT 0,
     is_excluded          INTEGER NOT NULL DEFAULT 0,
     is_refunded          INTEGER NOT NULL DEFAULT 0,
     -- When the user said the money came back, for a payment in a category
     -- that tracks repayment. NULL means it is still out there.
     --
     -- Separate from is_refunded, which section 4 sets by itself when the
     -- bank reverses a payment. One is the app matching two messages, the
     -- other is the user telling it something no message will ever say, and
     -- the reconciler must not be able to overwrite the second with the first.
     repaid_at            INTEGER,
     -- Section 12.2. On the credit: which lend this money is paying back.
     -- NULL on every debit and on every credit that is not a repayment.
     --
     -- The pointer is on the credit rather than a list on the lend because a
     -- lend is paid back in any number of instalments and each instalment
     -- answers to exactly one lend. What is left on a lend is its amount less
     -- the sum of the credits pointing here; nothing stores that figure,
     -- because a stored total is a copy of these rows and drifts the first
     -- time one of them is deleted.
     repays_transaction_id INTEGER REFERENCES transactions(id),
     is_deleted           INTEGER NOT NULL DEFAULT 0,
     created_at           INTEGER NOT NULL,
     updated_at           INTEGER NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_dedup ON transactions (dedup_key)`,
  `CREATE INDEX IF NOT EXISTS idx_tx_time ON transactions (occurred_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_tx_day ON transactions (occurred_on)`,
  `CREATE INDEX IF NOT EXISTS idx_tx_merchant ON transactions (merchant_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions (category_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions (account_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tx_spend
     ON transactions (transaction_type, is_deleted, is_transfer, is_excluded,
                      is_refunded, occurred_at)`,

  /* ----------------------------------------------------- 8.5 Profile ------ */
  `CREATE TABLE IF NOT EXISTS profile (
     id                    INTEGER PRIMARY KEY CHECK (id = 1),
     display_name          TEXT,
     theme                 TEXT    NOT NULL DEFAULT 'SYSTEM'
                           CHECK (theme IN ('SYSTEM','LIGHT','DARK')),
     timezone              TEXT,
     -- Which of Home's three cards was last selected. Not a setting the
     -- user is ever shown: it is where they left the page, and reopening
     -- on This month after a week of reading This week is the app losing
     -- their place. DAY is what a first launch opens on.
     home_period           TEXT    NOT NULL DEFAULT 'DAY'
                           CHECK (home_period IN ('DAY','WEEK','MONTH')),
     location_enabled      INTEGER NOT NULL DEFAULT 1,
     notifications_enabled INTEGER NOT NULL DEFAULT 0,
     onboarding_completed  INTEGER NOT NULL DEFAULT 0,
     import_status         TEXT    NOT NULL DEFAULT 'NOT_STARTED'
                           CHECK (import_status IN ('NOT_STARTED','IN_PROGRESS','COMPLETED','FAILED')),
     import_stage          TEXT    CHECK (import_stage IN ('ACCOUNTS','TRANSACTIONS')),
     import_window_start   TEXT,
     scan_cursor_at        INTEGER,
     last_sms_scanned_at   INTEGER,
     messages_total        INTEGER NOT NULL DEFAULT 0,
     messages_scanned      INTEGER NOT NULL DEFAULT 0,
     accounts_found        INTEGER NOT NULL DEFAULT 0,
     transactions_found    INTEGER NOT NULL DEFAULT 0,
     import_started_at     INTEGER,
     import_completed_at   INTEGER,
     created_at            INTEGER NOT NULL,
     updated_at            INTEGER NOT NULL
   )`,
];

/**
 * Indexes over columns that `ADDED_COLUMNS` adds.
 *
 * They cannot sit in `CREATE_STATEMENTS`. That list runs before the columns
 * are added, so on a phone upgrading from an earlier release the index names
 * a column the table does not have yet and the whole migration throws. Run
 * after, they reach a fresh install and an upgraded one alike.
 */
export const INDEXES_AFTER_COLUMNS: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_tx_repays ON transactions (repays_transaction_id)`,
];
