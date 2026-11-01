# Find My Expense

A UPI expense tracker for Android that builds itself out of bank SMS. Nothing
is entered by hand and nothing leaves the device.

The product spec is [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md) and the
technical spec is [TECHNICAL_IMPLEMENTATION.md](TECHNICAL_IMPLEMENTATION.md).
Code comments cite those sections rather than restating them.

## Running it

```bash
npm install
npm start                 # Metro
npm run android           # build and install on a device or emulator
npm test                  # 64 tests, no device needed
npm run typecheck
npm run reset             # back to the welcome screen (see below)
```

### Starting over from onboarding

Once the import finishes, the app opens on Home and keeps doing so. That is
section 8.5: "Only when the import is complete does the app open on the Home
page." The decision is made from two fields in the single `profile` row,
`onboarding_completed` and `import_status`, so onboarding only comes back when
those are reset.

```bash
npm run reset                        # fresh install: data and permissions gone
npm run reset -- --keep-permissions  # data gone, SMS prompt skipped
```

`adb shell pm clear com.findmyexpense` does the same thing on its own, with one
catch the script handles: it also revokes `ACCESS_LOCAL_NETWORK`, which a debug
build needs to reach Metro, so the next launch fails with "Unable to load
script" until that is granted again.

### Filling an emulator with messages to import

```bash
python3 scripts/seed-dummy-sms.py 100 100   # 100 debits, 100 credits
npm run reset -- --keep-permissions
```

The generator spreads messages over the last eleven months across five banks
and all four date formats, and draws payees both from the rules file in section
5.4 and from outside it, so some arrive categorized and some arrive needing a
category. `adb emu sms send` is an emulator console command and does nothing on
real hardware.

Android only. iOS does not permit an app to read SMS, so there is no iOS target.

## What is built

**The whole SMS pipeline, end to end.** A message goes through the three gates
in section 2.1, the fixed extraction sequence in 2.3, deduplication in 3, the
reversal and transfer match in 4.1 and 8.4, and automatic categorization in 5 —
and comes out as rows in the schema from section 8.

**The onboarding flow.** Welcome (9.1), SMS disclosure (9.2), permission denied
(9.3), and the two-stage import with progress (9.4).

The import screen does not walk itself to Home. It finishes on a summary of
what was found, behind a Continue button, because an import of a few hundred
messages otherwise completes inside the screen's own slide-in animation and the
user sees nothing. For the same reason each stage is held on screen for at
least `MINIMUM_STAGE_MILLIS`, which tops a stage up to a readable duration
rather than delaying one that already took longer.

**Home, partly.** The three period totals with their comparisons, and the
recent payments list. The chart, the median line, the category bubbles, the
calendar and the top transactions are not built yet.

## Layout

```
src/
  core/
    sms/            parsing: gates, shared patterns, per-bank readers, dedup
      banks/        one file per bank that needs a step replaced
        __fixtures__/messages.ts   every format pinned by a real message
    categorization/ the rules file from section 5.4, and the matcher
    db/             schema, migrations, DAOs, and the two SQLite adapters
    import/         the two-stage historical import
    transactions/   ingest and reconciliation, shared by import and live SMS
    analytics/      the spending definition from section 10
    platform/       SMS reader and permissions
  design/           theme, and the components built on it
  features/         onboarding and home screens
  navigation/       where the app opens, per section 8.5
android/app/src/main/java/com/findmyexpense/sms/   the SMS reader native module
```

## Two things worth knowing before changing anything

**Adding a bank format means adding its example first.** Section 2.3:
"This is what makes it safe to change one bank's pattern without discovering
months later that it broke another." The fixtures in
`src/core/sms/banks/__fixtures__/messages.ts` are the contract. Several of them
exist because a real message broke something the spec's own examples did not
reach — a payee read out of an amount, a bank whose only movement word is
`Sent`, a payee hidden inside a `UPI/P2M/.../NAME` block.

**The data layer runs against two SQLite drivers.** op-sqlite on the device,
`node:sqlite` in tests, behind the `SqlDatabase` interface in
`src/core/db/types.ts`. That is what lets the import tests exercise the real
schema, the real indexes and the real unique constraints rather than a mock.

## The release build has no network permission

`android/app/src/main/AndroidManifest.xml` declares no `INTERNET` permission.
"Your data stays on your phone" is therefore enforced by the OS rather than
promised on a screen: the app cannot open a socket even if a dependency tries
to. Metro needs the network during development, so `src/debug/AndroidManifest.xml`
adds it back for debug builds only.

## Decisions taken where the spec left a gap

- **Everyday spending vs everything that left.** The Home filter sheet and
  the Transactions filter both hide "rent, SIP and regular bills", but no
  field in section 8 carries that. Added `categories.is_fixed_cost`, set on
  Rent, Bills and Transfers.

  Home offered three views for a while: everyday spending, all spending, and
  everything that left. The middle one counted rent and bills as spending,
  which is the question "what do I spend?" answered with a number nobody can
  act on — a month's figure that rent is inside is a fact about the lease.
  A fixed cost now leaves the spending figures outright, the same way
  `excluded_from_totals` always has, which left the middle view returning the
  first view's number under a second name. It is gone. The two flags stay
  separate because the filter sheet reports them separately: one says what is
  being hidden, the other what would be added back.
- **A reference that comes round again.** Section 4.3 describes the bug and its
  fix ("within about a week") and files it as a later change. It is one
  comparison and the failure is a year-old payment silently leaving the user's
  spending, so it is implemented, in `MAX_REFERENCE_MATCH_GAP`.
- **Foreign currency.** Section 2.3 says a USD card purchase must not be read
  as the rupee credit limit beside it, but does not say what it should be. It
  is recorded as unreadable, which puts it on the Settings list in 11.1 rather
  than inventing an exchange rate.
- **Unicode look-alike letters.** Section 2.4 presents SBI's spelling as a
  failure. The fold back to ASCII is implemented, so those messages parse.
- **Stage one applies the gates before taking the digits.** Section 1.1 says
  stage one looks for "one thing only: the bank behind the sender ID and the
  account or card digits", with no mention of the gates in 2.1. On a real
  inbox that invents accounts: five of eleven found on a test device came only
  from messages that never became a transaction — two NCMC prepaid transit
  cards whose top-up alerts carry a card number, a debit card named in a failed
  service-charge notice, and a debit card known only from standing-instruction
  and OTP alerts. Each showed on the import screen as an account holding no
  money. Gates two and three now run first. This stays within the reason stage
  one is quick: they are two shared regex lists, not a bank's full extraction.
  `npm run explain-accounts` is the tool that found it.
- **Debit cards are not separate accounts.** Section 8.3 settles three digits
  meeting four but not this. A debit card draws on the account whose digits it
  carries, so `SBI Debit Card XX0863` and `A/c X0863` resolve to one row. Found
  on a real device, where they had become two rows holding the same money. A
  credit card still gets its own row, because it is its own balance.

## Working out where an account came from

When the import reports an account the user does not recognise, this traces it
back to the messages that produced it, the exact text the account rule matched,
and what the full pipeline then made of each one.

```bash
adb -s <serial> shell "content query --uri content://sms/inbox \
  --projection address:body:date" > inbox.txt
INBOX_DUMP=inbox.txt npm run explain-accounts
```

It runs the real `scanForAccount`, so what it reports is what the app did. An
account whose messages never produced a transaction is called out, which is how
the phantom accounts above were found. The dump stays where it is written;
nothing is sent anywhere.

## Not built yet

Section 1.2 new-message receiver, section 6 location, the rest of section 10,
the Transactions screen, Categories, Profile, and the Settings screens in 11.
