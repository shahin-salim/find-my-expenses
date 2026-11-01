# UPI Expense Tracker App – Technical Implementation

> Part 2 of the UPI Expense Tracker App overview. See [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md) for Part 1.

## Screens

The designs live in `screens/`. Each one is linked again from the section that describes it, and the right hand column is also the quickest way to see which screens this document does not cover yet.


| Screen                                                                     | Covered in                                                                              |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [Onboarding 1](screens/Onboarding 1.png)                                   | Section 9.1, Welcome Screen                                                             |
| [Onboarding 2](screens/Onboarding 2 .png)                                  | Section 9.2, SMS Permission Disclosure                                                  |
| [Home](screens/Home.png)                                                   | Section 10, Home Page Calculations                                                      |
| [Home · filter sheet](screens/Home · filter sheet.png)                     | Section 10                                                                              |
| [Categories · create](screens/Categories-create.png)                       | Section 8.2, Categories                                                                 |
| [Transactions · add payment](screens/Transactions · add payment.png)       | Manual entry, Sections 8.1 and 8.3                                                      |
| [Transactions](screens/transactions-page.png)                              | Not specified yet                                                                       |
| [Transactions · payment detail](screens/Transactions · payment detail.png) | Not specified yet. Shows the flags in Section 8.1 and the actions in Sections 4 and 8.4 |
| [Transactions · filters](screens/Transactions · filters.png)               | Not specified yet                                                                       |
| [Navigation · title menu](screens/Navigation · title menu.png)             | Section 12.6, the Lending page is the third destination                                 |
| [Lending · list](screens/Lending · list@1x.png)                            | Section 12.6, The Lending Page                                                          |
| [Lending · lend detail](screens/Lending · lend detail@1x.png)              | Section 12.6                                                                            |
| [Lending · lend detail (closed)](screens/Lending · lend detail (closed)@1x.png) | Sections 12.3 and 12.6                                                             |
| [Lending · new cash lend](screens/Lending · new cash lend@1x.png)          | Section 12.5, Manual Lends and Manual Repayments                                        |
| [Lending · record repayment (part)](screens/Lending · record repayment (part)@1x.png) | Section 12.5                                                                  |
| [Lending · record repayment (full)](screens/Lending · record repayment (full)@1x.png) | Sections 12.3 and 12.5                                                        |
| [Lending · edit lend](screens/Lending · edit lend@1x.png)                  | Section 12.7, Editing and Deleting                                                      |


There is no screen yet for the import progress in Section 9.4, for the permission denied screen in Section 9.3, or for Settings in Section 11.

## 1. Transaction Data Collection Using SMS

We will use SMS messages received on the user's device to identify UPI transactions.

### 1.1 Historical SMS Processing

When the user opens the app for the first time, we will scan historical SMS messages to build their transaction history.

- Scan SMS messages from the past year only.
- Do not scan messages older than one year.

The scan runs in two stages over the same set of messages.

**Stage one, find accounts.** Read through the messages looking for one thing only: the bank behind the sender ID and the account or card digits. Every distinct bank and digit pair becomes a row in the accounts table. Nothing else is written in this stage.

**Stage two, build transactions.** Read through the same messages again, this time with the full extraction described in Section 2. Every message that yields a transaction is written to the transactions table, and merchants, categories, deduplication and location are handled as each transaction is created.

Accounts are found first because money moved between the user's own accounts is not spending. That can only be recognised once every account is already known, so finding them up front lets stage two mark those transfers as it creates them, instead of writing them in wrong and correcting them afterwards. Stage one is also quick, because it looks for account digits rather than running every bank's full transaction pattern.

Stage one does not record anything in the SMS messages table. That table is the record of which messages have already been processed, and stage two relies on it being empty when it starts.

**What stage one produces.** Take four messages out of the year being scanned:

> `AD-IDFCFB-S` — Your A/c XXXXX528307 is debited by Rs.1.00 on 18-Oct-26. RRN 884051972336
> `JD-IDFCFB-S` — Rs.500.00 credited to your A/c XX8307 on 18-Oct-26
> `AD-ICICIT-S` — ICICI Bank Acct XX903 debited for Rs 1.00 on 19-Oct-26; Rohit Nair credited. UPI:302558741063
> `VM-HDFCBK-S` — Rs.450 debited from A/c XX4821. Avl Bal Rs.45,230.

Stage one takes two things from each of them and ignores everything else. Not the amount, not the date, not the name, not the reference number.


| Sender        | Bank            | Digits in the message | Kept   |
| ------------- | --------------- | --------------------- | ------ |
| `AD-IDFCFB-S` | IDFC First Bank | `646415`              | `6415` |
| `JD-IDFCFB-S` | IDFC First Bank | `6415`                | `6415` |
| `AD-ICICIT-S` | ICICI Bank      | `903`                 | `903`  |
| `VM-HDFCBK-S` | HDFC Bank       | `4821`                | `4821` |


Four messages, but the accounts table ends up with three new rows:


| `id` | `bank_name`     | `bank_key` | `last_four` | `account_type` |
| ---- | --------------- | ---------- | ----------- | -------------- |
| 1    | Cash            | `cash`     | *(empty)*   | `CASH`         |
| 2    | IDFC First Bank | `idfc`     | `6415`      | `BANK`         |
| 3    | ICICI Bank      | `icici`    | `903`       | `BANK`         |
| 4    | HDFC Bank       | `hdfc`     | `4821`      | `BANK`         |


Three things in that result are worth pointing at. The two IDFC messages became one account, because the digits are normalized to the last four before the lookup and because `AD-` and `JD-` are telecom routing prefixes that both resolve to the key `idfc`. The ICICI row holds three digits, which is all that bank ever reveals. And cash is already there as row 1, created when the app was installed rather than found in a message.

The import screen reports this as **3 accounts found**, counting what the scan discovered rather than what the table holds. No transaction is written, and the SMS messages table is still empty.

### 1.2 New SMS Processing

Whenever the user receives a new SMS, the app should detect the message, extract the transaction details, and save the information in transaction table.

This will allow us to record both historical and new transactions.

**Messages the app never saw are not recovered yet.** Android does not promise that every new message reaches the app. A force stop, battery optimisation, or a reboot before the app is next opened can all mean the message is never delivered to it. The same goes for a phone that was switched off or out of coverage: the network holds the messages and hands over the whole batch when it comes back, and anything the app is not running to receive at that moment is gone. The payments in those messages never appear, and nothing on screen shows that they are missing. `last_sms_scanned_at` in Section 8.5 holds the newest message already processed, which is the point a catch up scan on launch would read forward from. That scan is a later improvement and is not part of the first version.

## 2. Transaction Data Extraction

A bank sender ID carries far more than payment alerts. The same `HD-HDFCBK` that reports a debit also sends one-time passwords, balance alerts, statement notices, payment reminders and loan offers, and many of those carry an amount, a merchant name and an account number.

> OTP for your txn of Rs.450 at SWIGGY is 847291. Do not share.

Every detail the extraction looks for is in that message. Read without a check it becomes a Rs.450 payment to Swiggy that never happened. So a message is first decided on, and only then extracted.

### 2.1 Deciding Whether a Message Is a Transaction

Each message passes three gates in order. The first gate it fails ends it there.

**Gate one, the sender.** The sender ID has to belong to a bank the app knows. Anything else is skipped without the body being read at all. This is also what keeps the promise made on the permission screen, that only bank messages are read.

**Gate two, the reject list.** Some wording means the message is not a payment whatever else it contains. The reject list is checked before any bank pattern, so a reject always beats a match.


| Not a payment         | Wording that identifies it                                                 |
| --------------------- | -------------------------------------------------------------------------- |
| One-time passwords    | OTP, one time password, do not share, verification code                    |
| Collect requests      | is requesting, has requested, collect request, approve to pay              |
| Payments not made yet | will be debited, will be deducted, is due, due on, scheduled for, auto-pay |
| Offers and reminders  | pre-approved, offer, apply now, reward points, upgrade                     |


Collect requests and scheduled payments matter as much as one-time passwords. Both describe money that has not moved, and both are worded almost exactly like money that has.

**Gate three, money that has already moved.** What survives has to say that money actually moved and that it has already happened: debited, credited, spent, paid, withdrawn, transferred, received. An amount on its own is never enough. This is where the requirement to process only successful transactions is enforced.

This gate catches what no reject phrase would:


| Dropped at gate three              | Why                                         |
| ---------------------------------- | ------------------------------------------- |
| Balance alerts                     | An account and an amount, but nothing moved |
| Credit limit and statement notices | The same                                    |
| Declined payments                  | The bank is saying the money did not move   |


Declined payments are dropped here rather than put on the reject list, and that is deliberate. A reversal often arrives worded as a failure, for example a payment that failed and the amount credited back. That message is a real credit and Section 4 depends on it. Rejecting on the word "failed" would throw it away, and the debit it reverses would stay in the user's spending for good. Asking instead whether money moved keeps the reversal and drops the decline.

**A balance figure inside a real alert is not the same thing.** A message reading `Rs.450 debited from A/c XX4821. Avl Bal Rs.45,230.` is a payment that happens to report the balance afterwards. The amount is taken from the part of the message that describes the action, which is what the bank's pattern already pins down, never from the balance that follows it.

**What happens to a rejected message.** A message that fails gate two or three is recorded in the SMS messages table as ignored, so it is never read again. A message that fails gate one is not from a bank and is not recorded at all. Nothing is lost by rejecting a one-time password: when the payment goes through the bank sends its own debit message, and that one passes all three gates.

### 2.2 What Is Extracted

Every bank has its own SMS format. We need to understand these formats and use regular expressions (regex) to extract the required information.

The details we need to extract include:

- **UPI ID:** The UPI ID associated with the transaction.
- **Merchant or Recipient Name:** Where the money was spent or received from.
- **Transaction Amount:** The amount involved in the transaction.
- **Transaction Date and Time:** When the transaction occurred.
- **UPI Reference Number / RRN:** Used to identify transactions and prevent duplicate records.
- **Transaction Type:** Debit or credit.
- **Account / Card Last Four Digits:** The last four digits of the associated account or card, when available. Banks mask these differently, which is covered below.
- **Bank Name and Sender ID:** The bank name and SMS sender ID.
- **Transaction Status:** Only successful debit and credit transactions reach this point, which Section 2.1 takes care of.

**When the account digits are masked differently**

The same account is not written the same way twice. IDFC sends `A/c XXXXX528307` in one message and `A/c XX8307` in another. ICICI reveals only three digits, `Acct XX903`. Taken as they arrive, one account becomes two rows and the user sees the same bank twice on Home with their spending split between them.

The digits are therefore taken from the run attached to the account word, `A/c`, `Acct` or `Card`, and the last four of that run are kept. Never any other digits in the message, because the balance reported afterwards is also a run of digits.


| Message says      | Digits found | Stored |
| ----------------- | ------------ | ------ |
| `A/c XXXXX528307` | `646415`     | `6415` |
| `A/c XX8307`      | `6415`       | `6415` |
| `Acct XX903`      | `903`        | `903`  |


Three digits is all some banks ever reveal, so for those it is the account's identity and it matches itself every time. Section 8.3 covers the rare case of a bank sending three digits in one message and four in another.

**When the message does not give a time**

Many bank messages give only a date, and some give neither. A message normally arrives within seconds of the payment, so the time the message was received is used as the time of the transaction. The date is taken from the message when it gives one, and from the message's arrival otherwise.

This is right nearly all of the time. Two cases where it is not:

- A payment made just before midnight can be reported in the minutes after it. When the message carries a date the transaction still falls on the correct day, because day, week and month grouping uses the date rather than the time. Only a message that carries no date at all lands on the wrong day.
- A phone that was switched off or out of coverage receives a batch of older messages at once, and every one of them is timed to the moment the batch arrived. This is why a message with no time of its own is never used to merge transactions, which is covered in Section 3.2.



### 2.3 How Bank Formats Are Handled

Every bank words its messages differently, and there are a few hundred of them. This cannot be one pattern that covers everything, and it cannot be a separate reader written from scratch per bank either, because then the same mistake has to be fixed a few hundred times. What works is a fixed sequence of steps, where any one step can be replaced for a bank that needs it.

**The sequence is the same for every message.**

1. Is this a transaction at all? The three gates in Section 2.1.
2. What is the amount? If no amount is found, stop here.
3. Is it money in or money out? If that cannot be decided, stop here.
4. Everything else: the merchant, the reference number, the account digits, the balance.

Stopping at step two or three is what keeps a half read message out of the database. A message with a merchant and an account but no amount is not a transaction with a field missing, it is a message that was not understood, and it is recorded as unreadable rather than guessed at.

**Most banks need nothing written for them.** The shared patterns already know `Rs.`, `INR` and the rupee sign for amounts, `A/c`, `Acct` and `Card` for account digits, `Ref`, `RRN` and `UPI` for the reference, and `Avl Bal` and `Available Balance` for the balance. A bank whose messages use those words is read correctly without a line being written for it.

**A bank replaces only the steps where it differs.** Everything it does not replace, it inherits.

**A bank's own step tries the shared patterns first, then its own.** ICICI writes the account seven different ways depending on the message: `ICICI Bank Card XX7004`, `ICICI Bank Credit Card XX1234`, `ICICI Bank Account XX566`, `ICICI Bank Acct XX123`, `ICICI Bank Acc XX921`, and bare `Acct` and `Acc`. The step tries the shared pattern first, then those in order, and the first that yields digits wins.

**Sometimes the bank's own pattern has to run before the shared one.** An ICICI card message:

> USD 11.80 spent using ICICI Bank Card XX7004 on 03-Sep-25 on 1xJetBrains AI. Avl Limit: INR 17,95,899.53.

The shared amount patterns look for `Rs.`, `INR` or the rupee sign. The only one of those present is the credit limit at the end, so the shared pattern would record a eleven dollar purchase as a payment of seventeen lakh rupees. ICICI's own step checks for a foreign currency first. Order inside a step matters as much as the order of the steps.

**Which reader a message goes to is decided by the sender, and the order of the readers matters.** They are tried in a fixed order and the first one that recognises the sender takes the message. Sender matching is deliberately loose, on the bank's part of the sender ID rather than the whole thing, because one bank sends from many sender IDs. The cost of loose matching is that a reader claiming `HDFC` broadly will also swallow HDFC's mutual fund alerts, so the narrower reader has to sit ahead of the broader one in the list. This failure is silent: the message still parses, it just parses as the wrong thing.

**More than one reader can claim the same sender.** When that happens each is tried in turn and the first one that actually produces a transaction wins, so the sender narrows the candidates and the message content decides between them.

**The rejection rules are shared and are never copied into a bank's reader.** Gate two and gate three in Section 2.1 belong to every bank at once. A bank that needs an extra rejection adds it on top of the shared list rather than restating the list. Copies of a list like that drift apart, and the drift shows up as reminders and one-time passwords being recorded as spending for whichever bank's copy fell behind.

**Every format is pinned by an example.** Each bank has a set of real messages written down alongside the amount, merchant, account digits and type that each one should produce. Adding a format means adding its example first. This is what makes it safe to change one bank's pattern without discovering months later that it broke another.

### 2.4 Bank Message Formats

The same four facts are written differently by every bank. These are taken from real messages.


| Bank       | Sender headers     | Account digits                                            | Amount                      | Reference                   | Balance                                          |
| ---------- | ------------------ | --------------------------------------------------------- | --------------------------- | --------------------------- | ------------------------------------------------ |
| HDFC       | `HDFCBK`           | `A/c XX1234`, `A/C *1234`                                 | `Rs.500.00`                 | `UPI Ref No`, `Ref`         | `Avl bal`                                        |
| ICICI      | `ICICIT`, `ICICIB` | `Acct XX123`, `Acc XX921`, `Account XX566`, `Card XX7004` | `Rs 500.00`, `USD 11.80`    | `UPI:`, `RRN`, `Reference:` | `Avl Bal`, `Updated Bal`, `Available Balance is` |
| IDFC First | `IDFCFB`, `IDFCBK` | `A/C XXXXXXX1234`, `A/c XX4614`                           | `INR 68.00`, `Rs. 1,172.06` | `RRN`                       | `New Bal :`, `Available balance`                 |
| SBI        | `ATMSBI`, `SBICRD` | `A/c X1234`, `ending with 1234`                           | `Rs.383.00`                 | `transaction number`        | `Avl Bal`, `available limit`                     |
| Axis       | `AXISBK`           | `A/c no. XX589034`                                        | `INR 2000.00`               | none in most                | `Avl bal:`                                       |
| ESAF       |                    | `A/c XXX7143`                                             | `Rs. 1.00`                  | `UPI Ref No:`               |                                                  |


Real messages, one debit per bank:

> **HDFC** — Rs.500.00 debited from A/c XX1234 on 20-Oct-25 to merchant@upi (UPI Ref No 123456789012)
> **ICICI** — ICICI Bank Acct XX123 debited for Rs 500.00 on 01-Oct-25; merchant credited. UPI: 543210987654. Updated Bal: Rs 5,000.00
> **IDFC First** — Your A/c XX4614 debited by Rs. 1,172.06 on 15/01/26; REDBUS credited. RRN 060649915527. Available balance Rs. 9,134.15.
> **SBI** — Rs.500 debited from A/c X1234 on 13Sep25. Avl Bal Rs.999999999
> **Axis** — INR 2000.00 debited from A/c no. XX589034 on BURGRILL 04-12-2025 13:13:27 IST. Avl bal: INR 98919.81.

**What is awkward in each of them.**

- **The mask is not the same width or the same character.** HDFC uses `XX1234` and `*1234`, SBI uses a single `X1234`, IDFC uses `XXXXXXX1234`, Axis reveals six digits as `XX589034`, ICICI reveals three as `XX903`. Taking the last four of whatever digits follow the account word is what makes these one rule instead of six.
- **Dates come in four shapes, and one has no separators at all.** `20-Oct-25`, `15/01/26`, `04-12-2025` and SBI's `13Sep25`.
- **The merchant sits in a different place.** HDFC puts it after `to`, IDFC puts it before the word `credited`, Axis puts it between `on` and the date, ICICI's card messages put it after the date.
- **Axis debit alerts carry no reference number.** Nothing to match a transfer or a reversal against, which is the case described in Section 4.3 and Section 8.4.
- **SBI's credit card messages are written in Unicode look-alike letters.** The word that reads as `spent on your SBI Credit Card` is not made of ordinary letters, so a pattern looking for the plain word matches nothing and the whole message is unreadable. Any bank can start doing this, which is the argument for the unreadable messages screen in Section 11.1: it is the only place such a change becomes visible.
- **One bank, several headers.** IDFC sends from both `IDFCFB` and `IDFCBK`, ICICI from both `ICICIT` and `ICICIB`. Matching on the bank's part of the sender rather than the whole sender ID is what keeps these together.



## 3. Transaction Deduplication

The same payment can reach the app more than once, so there are two checks: one that stops a message being read twice, and one that stops a payment being recorded twice.

### 3.1 Message Level

Before a message is parsed, it is checked against the messages already read, using the id the device gives each message in its inbox. If the message has been read before, it is skipped and nothing is parsed.

This covers the cases where the same message reaches the app again:

- A message that arrives while the import is still running, and is then reached by the import as well.
- An import that stopped and resumed, re-reading messages around the point where it left off.
- A reinstall, or an import that runs a second time.
- A message that the system delivers to the app more than once.



### 3.2 Transaction Level

Every transaction is stored with a deduplication key, and that key must be unique. If a new transaction produces a key that already exists, the transaction is not stored.


| Case                                     | Key                                                                                                                   |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| RRN available                            | The RRN and the transaction type                                                                                      |
| RRN not available, message gives a time  | The account, the amount, the transaction type, the normalized recipient name, and the time rounded down to the minute |
| RRN not available, message gives no time | The id the device gives the message in its inbox, so every such message produces its own transaction                  |
| Manual entry                             | A generated unique value, so two manual entries can never collide                                                     |


This catches what the message check cannot: one payment that arrives as two differently worded messages, such as an account alert and a card alert for the same purchase.

The minute is deliberately narrow. A user can pay the same amount to the same place twice in a day, for example two metro journeys of the same fare, and those are different payments that must both be kept.

**Messages with no time of their own are never merged.** When the time came from the message's arrival rather than from the message itself, it is not a fact about the payment and cannot be used to tell two payments apart. A phone coming back online receives a batch of messages that are all timed to the same moment, so three separate metro fares of the same amount would look like one payment reported three times, and two real payments would be dropped with nothing on screen to show it.

These messages use the message's inbox id as their key instead, which gives every one of them its own transaction. Reading the same message again is still safe, because the message check in Section 3.1 stops it before a key is ever built. What is given up is the ability to spot one payment arriving as two differently worded messages when neither message gives a time. The cost of that is a visible duplicate the user can delete, rather than a payment that disappears.

The two ways this can go wrong are not equally bad. A key that is too specific stores the payment twice, which the user can see and delete. A key that is too loose drops a real payment, the totals are quietly wrong, and there is nothing on screen to show it. Where the choice is close, the more specific key is used.

A transaction the user deleted keeps its key, so a later import finds the key already in use and does not bring it back.

### 3.3 What Is Not Covered

- **One message has an RRN and the other does not.** The two messages produce different kinds of key, so neither sees the other and the payment is stored twice.
- **A payment added by hand before the message arrives.** A manual entry has no RRN and its own kind of key, so nothing links it to the message that follows.
- **Reversals, and an authorization followed by a settlement.** These are not duplicates. They are separate transactions that happen to describe the same purchase, and they need their own handling.
- **The same message can produce two different keys, depending on how the app saw it.** A message that arrives while the app is running carries the time the phone network stamped on it. The same message read later from the inbox carries the time the phone wrote it down. The two are a few seconds apart, so a payment that happens to fall either side of a minute boundary gets one key from the live message and a different key from the import, and is stored twice. The message check in Section 3.1 does not stop it, because a message that has just arrived does not have an inbox id yet, so there is nothing to record it by. Building the key from the text of the message instead of from the time would close it, and that is a later change.

In each of these the result is an extra row that the user can see and remove, never a payment that disappears.

## 4. Refunds and Reversals

Money that comes back is not spending. It comes back in two ways.

A **reversal** is a payment that failed after the bank had already taken the money. The account is debited, the payment fails somewhere downstream, and a credit for the same amount arrives minutes or hours later. Neither message says anything about failure, so both read as successful and the payment that never happened stays in the user's spending.

A **refund** is a merchant returning money for something the user did buy, usually days or weeks later.

Both are recorded the same way. The original transaction is marked as refunded and stops counting as spending. The credit is kept as a transaction of its own so the user can see the money arriving, and since credits are never counted as spending it changes no total by itself.

### 4.1 Matching a Reversal

A reversal carries the same reference number as the payment it reverses, which makes it the one case that can be matched with confidence. A credit is treated as a reversal when all of the following are true:

- It carries the same RRN as an existing transaction.
- That transaction is a debit.
- It is for the same amount.
- It is on the same account.

The account check is what separates a reversal from a transfer between the user's own accounts. Those also produce a debit and a credit sharing one RRN, but the money lands somewhere else. A reversal always returns money to the account it left.

This needs no new index. The deduplication key for a transaction with a reference number is the RRN and the transaction type, so from a credit the key of the matching debit can be built directly and looked up on the unique index that already exists.

The check runs in both directions. The historical import reads messages newest first, so during import the reversal is seen before the payment it reverses. When a credit is created the app looks for its debit, and when a debit is created it looks for a credit already waiting.

### 4.2 Refunds

A merchant refund does not share a reference number with the original payment, it arrives days or weeks later, and it is often for part of the amount rather than all of it. There is no dependable way to tell it apart from any other money coming in, so it is not detected automatically. The user can mark a transaction as refunded themselves, which sets the same flag and has the same effect on the totals.

### 4.3 What Is Not Covered

- **Reference numbers must be stored as text.** The twelve digit RRN is built from a year digit and a day, and two banks can issue the same value. Read as a number it loses its leading zeros, which would both miss real matches and let unrelated transactions collide, so it is compared as text.
- **A reference that has come round again can rewrite history, and nothing stops it yet.** Because the numbering is built from a year digit, it wraps roughly every twelve months and the same value is issued again. The match in Section 4.1 compares the reference, the amount and the account, but never how far apart the two transactions are. So a credit arriving a year later, on the same account and for the same amount, carrying a reference that has come round again, is read as a reversal: a payment the user saw and accepted a year ago quietly stops counting as spending. Requiring the two to be within about a week of each other rules it out, since a reversal arrives within days. The same gap applies to the transfer match in Section 8.4, which also matches on the reference and also has no time check. Both are a later change.
- **Part of the amount coming back.** The flag records that a transaction was refunded, not how much came back. A partial refund leaves the original counted in full, which is right for the part the user kept and wrong for the rest. Recording the amount returned is a later change.
- **Totals can change after the fact.** A reversal can arrive days after the payment, so a week the user has already seen can change once it lands. That is the correct outcome, but it does mean past figures are not fixed.



## 5. Automatic Categorization

Every transaction should have a category. Where the merchant can be recognised by name, the category is set automatically. Everywhere else the user sets it once and the app remembers it.

### 5.1 Where the Rules Live

The rules are kept in a JSON file that ships with the app. Each entry maps a merchant name to a category. It is configuration, not user data, so it is updated in a release rather than in the database, and it is never copied into the merchants table.

### 5.2 How a Merchant Is Matched

Matching is done on the merchant or recipient name taken from the message.

- The name from the message is normalized, which means lowercasing it and removing punctuation and trailing words such as private limited, India, technologies or payment.
- The normalized name is compared with the names in the file. Longer names are checked before shorter ones, so `swiggy instamart` is matched before `swiggy`, and the two can point to different categories.
- If the name is found in the file, the merchant is given that category.
- If the name is not found, the keyword pass below is tried.
- If that misses too, or the message carried only a UPI ID with no name, the merchant is created without a category. The transaction then shows as needing a category, and the user chooses one.

**The keyword pass.** Matching names alone only works for well known brands, and on a real phone nine payments in ten go somewhere else: the shop at the end of the road, which no rules file will ever list. Most of those shops say what they are in their own name — a cafe is called a cafe, a chemist is called medicals, a tea shop in Kerala is called a chaya peedika. So the file carries a second block of single words, and a name that matched no rule is searched for one of them.

The rules are always tried first, because `Amazon Fresh` has to beat `fresh` and `Google Play Store` must not be read as a grocery.

A keyword matches a whole word, or the final word of the name cut short. The second case is there because the sender truncates a long name to fit the message, so `NISARGA GARDEN RESTA` is a restaurant with its tail missing. It can only ever cut the last word, and that restriction is what keeps the pass honest: without it `Smart Kottayam` contains `mart` and `Labham Shoppy` contains `lab`. A fragment needs four letters to stand on its own, or two once the earlier words of a multi-word keyword have already matched — nothing else reaches `SUPER MA` having already matched `super`.

Keywords are for trades, never for people. A payment to a person is left uncategorized unless it carries an honorific, because no reading of a personal name can tell a shop from its owner: `SIVA PARVATHI STORE` is only legible as a shop because of the word `STORE`.

### 5.3 When It Runs

Categorization runs whenever a transaction is created, whether it came from an imported message, a newly received message, or manual entry.

If the merchant already has a category, nothing is changed. A category the user has chosen is never replaced by the rules.

Because the category is held on the merchant, the user only has to categorize a merchant once. That choice then applies to every transaction from that merchant, past and future.

### 5.4 Default Categories and Rules

These categories are created when the app is installed, along with the merchant names below.


| Category          | Merchant names in the file                                                                                                                                                                                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Food & Dining     | Swiggy, Zomato, EatSure, Dominos, Pizza Hut, McDonalds, KFC, Burger King, Subway, Starbucks, Cafe Coffee Day, Third Wave Coffee, Blue Tokai, Chai Point, Chaayos, Haldirams, Barbeque Nation, Behrouz, Faasos, Box8, Wow Momo, Theobroma, Baskin Robbins, Dunkin, Saravana Bhavan, Adyar Ananda Bhavan, Rameshwaram Cafe, Meghana Foods, La Pinoz, Truffles, Empire Restaurant |
| Groceries         | Zepto, Blinkit, Swiggy Instamart, BigBasket, JioMart, DMart, Reliance Fresh, Reliance Smart, More Supermarket, Spencers, Star Bazaar, Natures Basket, Ratnadeep, Heritage Fresh, Nilgiris, Amazon Fresh, Licious, FreshToHome, Country Delight, Milkbasket                                                                                                                     |
| Transport         | Uber, Ola, Rapido, Namma Metro, BMRCL, Delhi Metro, DMRC, Hyderabad Metro, Chennai Metro, Mumbai Metro, BMTC, BEST, KSRTC, MSRTC, IRCTC, RedBus, AbhiBus, Indian Oil, HP Petrol, Bharat Petroleum, Shell, Nayara, Jio-bp, FASTag, Zoomcar, Yulu, Bounce, Blu Smart, Quick Ride                                                                                                 |
| Shopping          | Amazon, Flipkart, Myntra, Ajio, Meesho, Nykaa, Tata Cliq, Snapdeal, Croma, Reliance Digital, Vijay Sales, Decathlon, Pepperfry, Urban Ladder, IKEA, Lenskart, Titan, Tanishq, Westside, Lifestyle, Shoppers Stop, Pantaloons, Max Fashion, Zara, H&M, Uniqlo, Bata, Puma, Adidas, Nike, FirstCry, boAt                                                                         |
| Bills & Utilities | BESCOM, BSES, Tata Power, Adani Electricity, MSEDCL, TNEB, TSSPDCL, APSPDCL, KSEB, PSPCL, UPPCL, Airtel, Jio, Vi, Vodafone Idea, BSNL, ACT Fibernet, Hathway, Excitel, Tata Play, Dish TV, Sun Direct, Indane, HP Gas, Bharat Gas, Adani Gas, Netflix, Amazon Prime, Disney Hotstar, SonyLIV, Zee5, Spotify, YouTube Premium, Google One, CRED                                 |
| Rent              | NoBroker, NestAway, Stanza Living, Colive, Zolo, MyGate, ADDA, NoBrokerHood                                                                                                                                                                                                                                                                                                    |
| Transfers         | Zerodha, Groww, Upstox, Angel One, Kuvera, INDmoney, ET Money, Paytm Money, Smallcase, Dhan, 5paisa, LIC, HDFC Life, SBI Life, ICICI Prudential, Policybazaar, Acko, Digit                                                                                                                                                                                                     |
| Others            | Apollo Pharmacy, PharmEasy, Netmeds, Tata 1mg, MedPlus, Practo, Cult.fit, Byjus, Unacademy, Vedantu, Coursera, Udemy, BookMyShow, PVR, INOX                                                                                                                                                                                                                                    |


Others is a real category that the user can choose. It is not the same as a transaction that has no category yet, which is shown separately as needing a category.

## 6. Location Mapping to Transactions

The goal is to associate the device's location with a transaction when a new transaction-related SMS arrives.

Historical transactions will not have location information.

### 6.1 Background Processing

When a transaction-related SMS arrives, the app should receive the event in the background, extract the transaction details, and associate the current device location with the transaction.

## 7. Required Permissions

To support this functionality, the app will need the following permissions:

- **SMS Access:** To read historical SMS messages from the past year and access new messages.
- **Location Access:** To obtain the device's current location when a transaction is detected.
- **Background Processing:** To allow the app to process incoming messages and associate location information while running in the background.



## 8. Database Design

The extracted transaction information will be stored in internal database tables.
The stored transaction data will be used to calculate spending statistics, categorize transactions, and display relevant information throughout the app.

Transaction data is stored on the device in SQLite (via Room). Nothing is sent to a server.

Alongside `transactions`, the schema includes `categories`, `accounts`, `merchants`, `profile` and `sms_messages`. Those are covered in the sections that follow.

### 8.1 Transactions

Holds every transaction, whether parsed from an SMS or added manually by the user.


| Field                  | Type    | Constraints                           | Description                                                                                                        |
| ---------------------- | ------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `id`                   | INTEGER | PK, AUTOINCREMENT                     | Internal row identifier                                                                                            |
| `amount`               | INTEGER | NOT NULL, CHECK > 0                   | Stored in **paise** (₹386 = 38600). Always positive; the sign comes from `transaction_type`                        |
| `transaction_type`     | TEXT    | NOT NULL, CHECK IN ('DEBIT','CREDIT') | Money out or money in                                                                                              |
| `occurred_at`          | INTEGER | NOT NULL                              | Transaction date and time, epoch millis UTC. Falls back to when the message arrived when the message gives no time |
| `occurred_on`          | TEXT    | NOT NULL                              | Local date `YYYY-MM-DD` at capture; used for day, week and month grouping                                          |
| `merchant_id`          | INTEGER | FK → `merchants(id)`, NULL allowed    | The merchant or recipient. NULL when nothing identifiable could be parsed                                          |
| `recipient_name`       | TEXT    | NULL allowed                          | The name exactly as the message wrote it, kept as parse evidence                                                   |
| `account_id`           | INTEGER | FK → `accounts(id)`, NULL allowed     | Source account (bank and last four digits)                                                                         |
| `category_id`          | INTEGER | FK → `categories(id)`, NULL allowed   | Override for this one transaction. NULL means the category is inherited from the merchant                          |
| `source`               | TEXT    | NOT NULL, CHECK IN ('SMS','MANUAL')   | Whether the transaction was parsed from SMS or entered by the user                                                 |
| `source_sms_id`        | INTEGER | FK → `sms_messages(id)`, NULL allowed | Originating SMS; NULL for manual entries                                                                           |
| `bank_sender_id`       | TEXT    | NULL allowed                          | SMS sender ID, e.g. `HD-HDFCBK`                                                                                    |
| `rrn`                  | TEXT    | NULL allowed                          | UPI reference number / RRN                                                                                         |
| `parser_id`            | TEXT    | NULL allowed                          | Which bank pattern matched the message                                                                             |
| `dedup_key`            | TEXT    | NOT NULL, UNIQUE                      | `rrn` + `transaction_type`, or the fallback key described in section 3                                             |
| `latitude`             | REAL    | NULL allowed                          | NULL for historical imports and manual entries                                                                     |
| `longitude`            | REAL    | NULL allowed                          | NULL for historical imports and manual entries                                                                     |
| `location_label`       | TEXT    | NULL allowed                          | Reverse-geocoded label, e.g. `Near Indiranagar, Bengaluru`                                                         |
| `location_captured_at` | INTEGER | NULL allowed                          | When the location fix was taken, epoch millis                                                                      |
| `note`                 | TEXT    | NULL allowed                          | User note, e.g. "team lunch"                                                                                       |
| `is_transfer`          | INTEGER | NOT NULL, DEFAULT 0                   | Money moved between two of the user's own accounts, so it is neither spending nor income                           |
| `is_excluded`          | INTEGER | NOT NULL, DEFAULT 0                   | The user has decided this transaction should not count towards their totals                                        |
| `is_refunded`          | INTEGER | NOT NULL, DEFAULT 0                   | The money came back, as a reversal of a failed payment or a merchant refund, so this does not count as spending    |
| `repaid_at`            | INTEGER | NULL allowed                          | When the money came back, for a payment in a category that tracks repayment. NULL means it is still out there. Section 12.3 |
| `repays_transaction_id`| INTEGER | FK → `transactions(id)`, NULL allowed | The lend this credit pays back. NULL for every credit that is not a repayment. Section 12.2                        |
| `is_deleted`           | INTEGER | NOT NULL, DEFAULT 0                   | Soft delete                                                                                                        |
| `created_at`           | INTEGER | NOT NULL                              | Row created, epoch millis                                                                                          |
| `updated_at`           | INTEGER | NOT NULL                              | Row last modified, epoch millis                                                                                    |


**Indexes**


| Index             | Columns                                                                            | Purpose                                     |
| ----------------- | ---------------------------------------------------------------------------------- | ------------------------------------------- |
| `idx_tx_dedup`    | `dedup_key`                                                                        | UNIQUE; prevents duplicate transactions     |
| `idx_tx_time`     | `occurred_at DESC`                                                                 | Transaction list ordering                   |
| `idx_tx_day`      | `occurred_on`                                                                      | Day grouping and the monthly calendar view  |
| `idx_tx_merchant` | `merchant_id`                                                                      | Resolving the merchant and its category     |
| `idx_tx_category` | `category_id`                                                                      | Finding transactions with a manual override |
| `idx_tx_account`  | `account_id`                                                                       | Account filters                             |
| `idx_tx_spend`    | `transaction_type, is_deleted, is_transfer, is_excluded, is_refunded, occurred_at` | Spending totals and insights                |
| `idx_tx_repays`   | `repays_transaction_id`                                                            | Repayments belonging to a lend              |


**Design notes**

- **Amounts are integers in paise.** Floating point rounding would drift category and period totals over thousands of transactions.
- `occurred_on` **is stored, not derived.** Every screen groups by local day. Computing local dates from epoch millis at query time is slower and changes historical groupings if the user's timezone changes.
- **The category is an override over a default.** `category_id` is set only when the user changes the category of a single transaction. Otherwise the category comes from the merchant, resolved as `COALESCE(transactions.category_id, merchants.category_id)`. Changing a merchant's category therefore updates every past and future transaction from that merchant with a single write, and can never overwrite a correction the user made on one transaction.
- **Three flags keep a transaction out of the totals, and they mean different things.** `is_excluded` is the user deciding a payment should not count. `is_refunded` is money that actually came back, described in Section 4. `is_transfer` is the app saying this was never a payment at all, money moved between the user's own accounts, described in Section 8.4. The transaction list shows each of them differently, and a transfer is hidden by default where the other two are shown with a marker.
- `is_transfer` **is set on both halves of a transfer.** A transfer produces a debit in one account and a credit in another, and neither is spending or income. Marking only the debit would leave the credit counting as money received, so the match sets the flag on both rows at once.
- **Deletes are soft.** If a transaction parsed from SMS were hard deleted, a later re-import would find no matching `dedup_key` and recreate it. The tombstone row keeps it deleted.



### 8.2 Categories

> Screen: [Categories · create](screens/Categories-create.png)

Holds the built-in categories shipped with the app and any categories the user creates.


| Field         | Type    | Constraints                                        | Description                                                                 |
| ------------- | ------- | -------------------------------------------------- | --------------------------------------------------------------------------- |
| `id`          | INTEGER | PK, AUTOINCREMENT                                  | Internal row identifier                                                     |
| `name`        | TEXT    | NOT NULL, UNIQUE COLLATE NOCASE, CHECK length ≤ 24 | Display name, e.g. `Food & Dining`                                          |
| `system_key`  | TEXT    | UNIQUE, NULL allowed                               | Stable key for built-in categories, e.g. `food`; NULL for user-created ones |
| `icon`        | TEXT    | NOT NULL                                           | Icon key from the picker, e.g. `pin`, `star`, `briefcase`                   |
| `color`       | TEXT    | NOT NULL                                           | Palette token, e.g. `violet`                                                |
| `is_system`   | INTEGER | NOT NULL, DEFAULT 0                                | Shipped default category; can be renamed but not deleted                    |
| `sort_order`  | INTEGER | NOT NULL, DEFAULT 0                                | Display order for chips and lists                                           |
| `is_archived` | INTEGER | NOT NULL, DEFAULT 0                                | Hidden from pickers, but still resolves on existing transactions            |
| `created_at`  | INTEGER | NOT NULL                                           | Row created, epoch millis                                                   |
| `updated_at`  | INTEGER | NOT NULL                                           | Row last modified, epoch millis                                             |


**Indexes**


| Index                | Columns                   | Purpose                                                             |
| -------------------- | ------------------------- | ------------------------------------------------------------------- |
| `idx_cat_name`       | `name` COLLATE NOCASE     | UNIQUE; enforces that a category name is different from every other |
| `idx_cat_system_key` | `system_key`              | UNIQUE; lookups from the automatic categorization rules             |
| `idx_cat_order`      | `is_archived, sort_order` | Ordering the visible category list                                  |


**Design notes**

- `system_key` **keeps renaming from breaking automatic categorization.** Built-in rules map a merchant to a key such as `food`. If the rules referenced the display name instead, a user renaming "Food & Dining" to "Eating out" would silently stop every rule for that category from matching.
- **Categories are archived, not deleted.** Deleting a category that already has transactions would push those transactions back to uncategorized and change spending history that the user has already seen. Archiving hides the category from pickers while existing transactions keep their name and colour.
- **Colour is stored as a palette token, not a hex value.** The app supports light and dark themes, so a fixed hex value that reads well on one background will not on the other. The token resolves to the right value per theme.



### 8.3 Accounts

> Screen: [Transactions · add payment](screens/Transactions · add payment.png), where these appear as the "Paid from" selector

Holds every payment source a transaction can come from: bank accounts and cards detected from SMS, and cash for manual entries.


| Field          | Type    | Constraints                                                  | Description                                                                                                           |
| -------------- | ------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `id`           | INTEGER | PK, AUTOINCREMENT                                            | Internal row identifier                                                                                               |
| `bank_name`    | TEXT    | NOT NULL                                                     | Display name, e.g. `HDFC Bank`                                                                                        |
| `bank_key`     | TEXT    | NOT NULL                                                     | Stable key, e.g. `hdfc`; drives logo lookup and groups the bank's sender IDs                                          |
| `last_four`    | TEXT    | NOT NULL, CHECK (`last_four` = '' OR length BETWEEN 3 AND 4) | Last four digits of the account or card, e.g. `4821`. Some banks reveal only three, e.g. `903`. Empty string for cash |
| `account_type` | TEXT    | NOT NULL, CHECK IN ('BANK','CARD','WALLET','CASH')           | What kind of payment source this is                                                                                   |
| `created_at`   | INTEGER | NOT NULL                                                     | Row created, epoch millis                                                                                             |
| `updated_at`   | INTEGER | NOT NULL                                                     | Row last modified, epoch millis                                                                                       |


**Indexes**


| Index               | Columns                             | Purpose                                                                   |
| ------------------- | ----------------------------------- | ------------------------------------------------------------------------- |
| `idx_acct_identity` | `bank_key, last_four, account_type` | UNIQUE; one row per real account, so repeated imports map to the same row |
| `idx_acct_type`     | `account_type`                      | Listing cash and bank sources separately in pickers                       |


**Design notes**

- **Accounts are discovered, not entered.** A row is created the first time a parsed message yields a bank and last four digits. The unique index is what stops a year of messages from the same bank creating hundreds of duplicate accounts.
- **The table is filled before any transaction is written.** During onboarding, stage one of the import builds this table in full before stage two creates the first transaction. This is what makes self-transfer detection possible from the very first transaction rather than only from the point the second account happened to appear. After onboarding, a new account can still turn up, for example a new bank or a new card, and the row is created from the message that revealed it.
- `bank_key` **is separate from** `bank_name`**.** Sender IDs such as `HD-HDFCBK`, `VM-HDFCBK` and `AD-HDFCBK` all resolve to the key `hdfc`, so routing differences between telecom operators do not create separate accounts.
- `transactions.account_id` **stays nullable.** Some bank messages do not include the account digits. Those transactions show no account rather than being attributed to the wrong one.
- **Cash is a row in this table**, with `account_type` of `CASH`. This keeps the "Paid from" selector in the manual entry screen a single query, and keeps `account_id` meaning the same thing on every transaction. It is the one account that is not discovered from a message: it is created when the app is installed, alongside the default categories.
- `last_four` **is an empty string for cash, not null.** SQLite treats two nulls in a unique index as different values, so a null here would not stop a second cash row being created, and the user would end up with several. An empty string is a value like any other and the index rejects the duplicate. Creating the row at install means nothing tries to create it a second time either, so the two together close the gap.
- **The digits are normalized before the account is looked up.** Section 2.2 describes how the last four are taken. Without that step IDFC's `A/c XXXXX528307` and `A/c XX8307` become two accounts for one real account, and the bank appears twice on Home.
- **Three digits is allowed, because some banks give nothing more.** ICICI writes `Acct XX903` and never more than that, so insisting on four would reject the row and every ICICI payment would lose its account. A row storing `903` matches every later ICICI message, because the bank always writes it the same way.
- **Three digits meeting four is the one case that needs deciding.** If a bank sends `XX6172` in one message and `XX903` in another, the two still look like different accounts. So before a three digit account is created, the accounts already found for that bank are checked. If exactly one of them ends with those three digits, that row is used. If none do, the new row is created. If two do, because the user holds both `6172` and `1172` at that bank, the new row is created separately, since guessing would put payments on the wrong account.



### 8.4 Merchants

Holds one row per merchant or recipient the user has transacted with. This table is also where a user's category preference for a merchant is stored, which is what makes saved preferences apply to existing and future transactions.


| Field             | Type    | Constraints                                               | Description                                                                                                 |
| ----------------- | ------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `id`              | INTEGER | PK, AUTOINCREMENT                                         | Internal row identifier                                                                                     |
| `identity_key`    | TEXT    | NOT NULL, UNIQUE                                          | The UPI ID when present, otherwise the normalized name. This is what identifies a merchant across messages  |
| `display_name`    | TEXT    | NOT NULL                                                  | Name shown in the app, e.g. `Swiggy`; the user can edit it                                                  |
| `normalized_name` | TEXT    | NULL allowed                                              | Lowercased and stripped name, used to match automatic categorization rules                                  |
| `upi_id`          | TEXT    | NULL allowed                                              | UPI ID, e.g. `swiggy.stores@axb`                                                                            |
| `category_id`     | INTEGER | FK → `categories(id)`, NULL allowed                       | Default category for every transaction from this merchant                                                   |
| `category_source` | TEXT    | NOT NULL, DEFAULT 'NONE', CHECK IN ('NONE','AUTO','USER') | Whether an automatic rule or the user chose the category. A `USER` choice is never replaced by rule updates |
| `is_self`         | INTEGER | NOT NULL, DEFAULT 0                                       | This recipient is one of the user's own accounts, used to identify self-transfers                           |
| `first_seen_at`   | INTEGER | NOT NULL                                                  | First transaction with this merchant, epoch millis                                                          |
| `last_seen_at`    | INTEGER | NOT NULL                                                  | Most recent transaction with this merchant, epoch millis                                                    |
| `created_at`      | INTEGER | NOT NULL                                                  | Row created, epoch millis                                                                                   |
| `updated_at`      | INTEGER | NOT NULL                                                  | Row last modified, epoch millis                                                                             |


**Indexes**


| Index                     | Columns           | Purpose                                                                |
| ------------------------- | ----------------- | ---------------------------------------------------------------------- |
| `idx_merchant_identity`   | `identity_key`    | UNIQUE; the lookup used when a parsed message is matched to a merchant |
| `idx_merchant_normalized` | `normalized_name` | Applying automatic categorization rules                                |
| `idx_merchant_category`   | `category_id`     | Finding every merchant in a category                                   |


**Design notes**

- **Merchants are created during import.** When a message is parsed, the merchant is looked up by `identity_key` and created if it does not exist. The unique index makes this an insert-or-ignore, which also keeps parallel import workers from creating duplicates.
- **A saved category preference is a single write.** Setting `merchants.category_id` applies to every past and future transaction from that merchant, because transactions resolve their category as `COALESCE(transactions.category_id, merchants.category_id)`. No bulk update of transaction rows is needed, and a per-transaction override the user made earlier is untouched.
- `identity_key` **prefers the UPI ID.** A UPI ID identifies one specific payee, whereas names repeat and are often missing or generic. When a merchant uses more than one UPI ID, this produces separate rows; merging them is a later feature, not a correctness problem.
- `is_self` **marks the user's own accounts.** Money moved between the user's own accounts is not spending, and the transaction list hides it by default. Holding the flag on the merchant rather than on each transaction means marking it once covers every transfer to that account, past and future.
- **A transfer is recognised by its reference number.** Moving money between two of the user's own accounts produces two messages, one from each bank, and both carry the same reference number. When a transaction is created, the app looks for an existing transaction with the same reference number. The two are the halves of one transfer when they are of opposite types, are for the same amount, and land in two **different** accounts the user owns. This is the reason stage one of the import runs first: both accounts have to already exist for the second half to be recognised as the user's own.
- **Banks label that number differently.** The same reference arrives as `UPI:884051972336` from ICICI and `RRN 884051972336` from IDFC, and as `UPI Ref No:` from ESAF. They are one field under three labels, so the parsers normalize them into one, and that is what makes a transfer between two banks matchable at all.
- **Both halves are marked, and so is the merchant.** The two transactions are marked as transfers, because the debit is not spending and the credit is not income. The merchant on the debit side is marked as self as well. These do different jobs: marking the transactions settles this one transfer, and marking the merchant catches every later payment to the same name without needing a pair.
- **The credit side often has no merchant,** which is why the transaction flag is needed and not just the merchant one. An ESAF credit reads `Your ESAF Bank A/c XXX7143 credited with Rs. 1.00 ... UPI Ref No: 019274650338` and names nobody at all, so there is no merchant row to mark.
- **Same reference number but the same account is a reversal, not a transfer.** That is a failed payment coming back, and it belongs to Section 4. Which account the money lands in is the only thing separating the two, so the check has to be made.
- **The check runs in both directions**, for the same reason given in Section 4.1. The import reads messages newest first, so the credit is often created before the debit it pairs with.
- **Marking the merchant is what makes one match worth having.** A matched pair proves one payment was a transfer, but the flag is set on the merchant, so every other payment to the same name is recognised without needing a pair of its own. One match pulls in the rest of that merchant's history and everything that follows.
- **The message does not name the destination account.** A UPI debit names a person, not an account. A debit message reads `ICICI Bank Acct XX903 debited for Rs 1.00 on 19-Oct-26; Rohit Nair credited` — the only account digits in the message are the user's own side. This is why the reference number is used and not the destination.
- **A transfer that cannot be matched is left as spending.** Not every bank puts a reference number in its credit messages. IDFC's credit alert carries none at all, so a transfer into that account has nothing to pair with and the debit stays in the user's spending. The user can mark the merchant as their own account from the transaction detail screen, which applies to that merchant's whole history in a single write, and from then on it is handled automatically.



### 8.5 Profile

A single row holding the user's details, the app settings, and the state of the SMS import. The row is created the first time the app is opened.


| Field                   | Type    | Constraints                                                                                  | Description                                                                                                                                    |
| ----------------------- | ------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                    | INTEGER | PK, CHECK (id = 1)                                                                           | Single-row table                                                                                                                               |
| `display_name`          | TEXT    | NULL allowed                                                                                 | The user's name, taken from bank messages during import. The avatar initials come from this                                                    |
| `theme`                 | TEXT    | NOT NULL, DEFAULT 'SYSTEM', CHECK IN ('SYSTEM','LIGHT','DARK')                               | Light or dark theme, chosen in Profile settings                                                                                                |
| `timezone`              | TEXT    | NULL allowed                                                                                 | The timezone used to group transactions into days, weeks and months. Empty means use the device timezone, which is the default                 |
| `location_enabled`      | INTEGER | NOT NULL, DEFAULT 1                                                                          | Whether location is attached to new transactions                                                                                               |
| `notifications_enabled` | INTEGER | NOT NULL, DEFAULT 0                                                                          | Whether spending alerts are shown                                                                                                              |
| `onboarding_completed`  | INTEGER | NOT NULL, DEFAULT 0                                                                          | The welcome and permission screens have been finished                                                                                          |
| `import_status`         | TEXT    | NOT NULL, DEFAULT 'NOT_STARTED', CHECK IN ('NOT_STARTED','IN_PROGRESS','COMPLETED','FAILED') | State of the import. The app can only be used once this is `COMPLETED`                                                                         |
| `import_stage`          | TEXT    | NULL allowed, CHECK IN ('ACCOUNTS','TRANSACTIONS')                                           | Which of the two import stages is running. Drives the two steps shown on the import screen, and tells a resumed import which stage to continue |
| `import_window_start`   | TEXT    | NULL allowed                                                                                 | The oldest date this import covers, one year back                                                                                              |
| `scan_cursor_at`        | INTEGER | NULL allowed                                                                                 | The oldest message processed so far in the current stage. A resumed import continues from here                                                 |
| `last_sms_scanned_at`   | INTEGER | NULL allowed                                                                                 | The newest message processed, used as the starting point for new messages later                                                                |
| `messages_total`        | INTEGER | NOT NULL, DEFAULT 0                                                                          | Total messages to scan, shown on the import screen                                                                                             |
| `messages_scanned`      | INTEGER | NOT NULL, DEFAULT 0                                                                          | Messages scanned so far in the current stage, and the progress bar. Reset to zero when stage two begins                                        |
| `accounts_found`        | INTEGER | NOT NULL, DEFAULT 0                                                                          | Accounts found so far, shown as the headline count during stage one                                                                            |
| `transactions_found`    | INTEGER | NOT NULL, DEFAULT 0                                                                          | Transactions found so far                                                                                                                      |
| `import_started_at`     | INTEGER | NULL allowed                                                                                 | When the import began, epoch millis                                                                                                            |
| `import_completed_at`   | INTEGER | NULL allowed                                                                                 | When the import finished, epoch millis                                                                                                         |
| `created_at`            | INTEGER | NOT NULL                                                                                     | Row created, epoch millis                                                                                                                      |
| `updated_at`            | INTEGER | NOT NULL                                                                                     | Row last modified, epoch millis                                                                                                                |


There are no indexes, because the table only ever holds one row.

**Design notes**

- **The import decides where the app opens.** If onboarding has not been finished the user is taken to onboarding. If `import_status` is anything other than `COMPLETED` the user is taken back to the import screen, which continues from `import_stage` and `scan_cursor_at` instead of starting again. Only when the import is complete does the app open on the Home page.
- **Both stages share one set of counters.** The two stages read the same year of messages one after the other, never at the same time, so `messages_scanned` and `scan_cursor_at` describe whichever stage `import_stage` names. They are reset when stage two begins, which is also what makes the progress bar restart at the second step.
- **The name comes from the bank messages.** Bank messages usually address the account holder by name, so the name is taken from them during import. When no name can be found it is left as Unknown, and the user can change it in Profile.
- **Permission states are not stored here.** Whether SMS or location access is actually granted is read from the system every time it is needed, because the user can change it in system settings while the app is closed. `location_enabled` and `notifications_enabled` are the user's own preference, which is a separate thing.
- **Progress is written in batches.** Updating this row for every message would mean thousands of writes during an import. The counters are written every few hundred messages, which is often enough for the progress screen.



### 8.6 SMS Messages

One row for every bank message the app has read. It records what has already been processed, so the same message is never read twice, and it keeps a record of messages that could not be understood.


| Field          | Type    | Constraints                                        | Description                                                                                 |
| -------------- | ------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `id`           | INTEGER | PK, AUTOINCREMENT                                  | Internal row identifier                                                                     |
| `provider_id`  | INTEGER | NOT NULL, UNIQUE                                   | The id the device gives this message in its inbox                                           |
| `sender_id`    | TEXT    | NOT NULL                                           | SMS sender ID, e.g. `HD-HDFCBK`                                                             |
| `received_at`  | INTEGER | NOT NULL                                           | When the message arrived, epoch millis                                                      |
| `parse_status` | TEXT    | NOT NULL, CHECK IN ('PARSED','NO_MATCH','IGNORED') | Whether a transaction was created, no pattern matched, or the message was not a transaction |
| `parser_id`    | TEXT    | NULL allowed                                       | Which bank pattern matched the message                                                      |
| `scanned_at`   | INTEGER | NOT NULL                                           | When the app processed the message, epoch millis                                            |


**Indexes**


| Index              | Columns        | Purpose                                                 |
| ------------------ | -------------- | ------------------------------------------------------- |
| `idx_sms_provider` | `provider_id`  | UNIQUE; the check that stops a message being read twice |
| `idx_sms_status`   | `parse_status` | Finding messages that could not be parsed               |


**Design notes**

- **The message text is not stored.** Only the id is kept, which is enough to read the message back from the inbox when it is needed, for example to parse it again after a pattern has been improved. Bank messages are therefore never copied into a second place, which keeps the promise that the data stays where it already is.
- **Messages that could not be parsed are the work list.** A message from a bank sender with a status of `NO_MATCH` is a bank format the app does not support yet. Without this record there is no way to find out which formats are being missed.
- **Ignored messages are kept so they are not read again.** A message from a bank sender that failed one of the checks in Section 2.1, such as a one-time password, a balance alert or a collect request, is stored with status `IGNORED`. It never produces a transaction, and recording it means a later run does not spend time deciding about it a second time.
- **A message deleted from the inbox can no longer be read back.** Any transaction already created from it is unaffected, but it cannot be parsed again.



## 9. Onboarding Flow

The onboarding flow will introduce the app, request the required permissions, import transaction history, and take the user to the home page.

The import itself runs in the two stages described in Section 1.1. The app reads the year of messages once to find the user's accounts, then reads them again to build the transactions. Both stages run on the import screen and are shown there as two steps, **Find accounts** and **Read payments**. The Home page opens only when both have finished.

### 9.1 Welcome Screen

> Screen: [Onboarding 1](screens/Onboarding 1.png)

The welcome screen should include:

- App name.
- A one-line value proposition.
- Three short benefit points covering automatic tracking, categories, and insights.
- A privacy statement: "Your data stays on your phone" if on-device storage is used.
- A primary **Get Started** button.



### 9.2 SMS Permission Disclosure

> Screen: [Onboarding 2](screens/Onboarding 2 .png)

Before displaying the system SMS permission prompt, show a disclosure screen explaining how SMS access will be used.

- **What we read:** Only messages from bank sender IDs.
- **What we don't read:** Personal messages and OTPs.
- **Why we need access:** To build transaction history automatically.

Buttons:

- **Allow SMS Access:** Opens the system permission prompt.
- **Not Now:** Allows the user to decline access.



### 9.3 Permission Denied

If the user denies SMS access, show the following message:

"You can still add transactions manually."

Buttons:

- **Try Again**
- **Continue Without SMS**



### 9.4 Import Progress

Once the required permissions are granted, start importing historical transaction data and show the import progress.

The import runs in the two stages described in Section 1.1, and the screen shows both as numbered steps across the top: **Find accounts**, then **Read payments**. The step in progress is highlighted, a finished step is ticked, and the step still to come is greyed out.

**Step one, find accounts**


| Field            | Example                         |
| ---------------- | ------------------------------- |
| Headline count   | 3 accounts found so far         |
| Progress bar     | 38%                             |
| Status text      | Looking for your accounts…      |
| Messages checked | 1,900 of 5,000 messages checked |
| Accounts list    | HDFC Bank ·· 4821 · Savings     |


Each account appears in the list as it is found, showing the bank logo, the bank name and the last four digits. An empty placeholder row sits below the list while the scan is still running, so it is clear more accounts may still turn up.

A line under the list explains why this step exists: the app finds the accounts first so that money moved between them is marked as a self-transfer rather than spending.

**Step two, read payments**


| Field              | Example                         |
| ------------------ | ------------------------------- |
| Progress bar       | 64%                             |
| Status text        | Reading your bank messages…     |
| Messages scanned   | 3,210 of 5,000 messages checked |
| Transactions found | 412                             |


Both stages read the same year of messages, so the message total is the same in each and the progress bar restarts when step two begins.

The import must finish before the user can use the app. The Home page opens only once both stages are complete. If the user leaves while it is still running, the next launch returns to this screen and the import continues from the stage and the position it stopped at, instead of starting again.

The screen carries a reminder in the footer that everything stays on the phone, since this is the point at which the app is reading a year of the user's messages.

## 10. Home Page Calculations

> Screens: [Home](screens/Home.png), [Home · filter sheet](screens/Home · filter sheet.png)

The home page shows where money is going out. Every figure on the page is money spent. Money coming in is not tracked here in the first version, because the point of the page is to show where money is being lost.

All figures are calculated from the transactions table when the page is opened. There are no stored totals or precalculated tables.

A transaction counts as spending when it is a debit, has not been deleted, has not been excluded by the user, has not been refunded, is not a transfer to the user's own account, and has not been marked as money that came back. Periods are based on the local date of the transaction.

It also has to belong to a category the user is actually watching. Section 8.2 gives a category two flags — `is_fixed_cost` for rent, bills and SIPs, and `excluded_from_totals` for investments and lending — and either one keeps its payments out of every spending figure. Rent recurs at a size that drowns out a month as thoroughly as it drowns out a day, so there is no view in which it is counted as spending; the one view that counts it, `Everything that left`, does not claim to be about spending at all.

**How periods are defined**

- A day runs from local midnight to local midnight.
- A week starts on Monday and ends on Sunday. This is what the calendar grid on the Home page uses, so the week total and the shaded days in the calendar always agree.
- A month is the calendar month, from the first day to the last.
- All of this is worked out in the device timezone. The user can set a different timezone in their profile, and the device timezone is the default. A transaction's date is fixed when the transaction is recorded and is never recalculated afterwards, so a payment made while travelling keeps the date it had in the place it was made.

**How the comparisons work**

Each of the three totals is shown with a comparison against the period before it, and that previous period is always taken in full.

- Today is compared against the whole of yesterday.
- This week is compared against the whole of the previous week, Monday to Sunday.
- This month is compared against the whole of the previous month.

The comparison is made on dates alone. The time of day is never used, so nothing on the Home page depends on the clock.

What these figures are for is telling the user whether they are spending more than they usually do in a day, a week or a month. A complete previous period is a steady reference for that. It is a real amount the user actually spent, it does not move while the current period fills up, and it builds the picture gradually as the day, the week and the month go on.

The known consequence is that a period which has only just started will always compare low. A Monday morning shows a large drop against the whole of the previous week, and the figure climbs back as the week fills in. The same happens on the first of a month and in the early hours of a day. This is expected behaviour and is not corrected for, because the amount spent so far is shown next to it and already makes clear how far into the period the user is.

### 10.1 Spending Overview

Three totals are shown together: today, this week and this month. Each one is the total spent in that period, with a comparison against the period before it. Today is compared with yesterday, this week with last week, and this month with last month.

One of the three is selected at a time. The selected period controls the chart and the breakdown below it.

### 10.2 Spending Chart

The chart follows the selected period.

- Today: one point per day, for the last 7 days.
- This week: one point per week, for the last 7 weeks.
- This month: one point per month, for the last 7 months.

The current period is one of those seven, so the chart shows six finished periods followed by the one that is running. The period in progress is drawn as incomplete rather than as a finished point.

**The average line**

The dashed line across the chart is what the user's spending usually looks like, and it is what the current period is compared against. It is calculated over a longer history than the chart itself shows:


| Selected period | History used for the line  |
| --------------- | -------------------------- |
| Today           | The last 30 complete days  |
| This week       | The last 12 complete weeks |
| This month      | The last 6 complete months |


These windows are deliberately not the same as the seven points on the chart. The chart window is a question of how much a person can read at a glance. The line is a question of how many periods are needed before a usual level means anything, and daily spending in particular is far too uneven to take a usual level from six days. Thirty days also covers a full cycle of salary and monthly bills, which is what makes it representative. For months the two happen to coincide, because six complete months is both the history used for the line and the number of finished points on the chart.

A day with no spending counts as zero in the daily line rather than being skipped. The chart plots those days as zero too, so the line stays comparable to what is drawn above it.

The line is a **median**, not an average. One unusually large payment, such as rent or a yearly bill, would pull an average upwards and make ordinary spending stop looking ordinary. A median is not affected by a single large payment, which also means rent and other fixed payments need no special handling.

Three rules apply to it:

- The current period is never included in its own line. Spending today must not raise the line that today is measured against.
- Only complete periods count. The current week is half finished, and including it would pull the line down at the start of every week.
- There must be enough history before the line is shown: 14 days, 6 weeks, or 3 complete months. Below that the line and the comparison are hidden, because a usual level cannot be established yet. This also covers the first days of use, when the import of older messages is still running.

The dashed line is worked out from the history in the table above, not from the points drawn on the chart. For days and weeks that history reaches further back than the chart window, so part of what shapes the line sits off the left edge of the screen. The current period is left out in every case. This is intended: a line taken from only the periods on screen would move too much to be called usual.

### 10.3 Where Your Money Went

This section breaks down the spending of the selected period only. It never includes earlier periods. If today is selected it shows where money went today, if this week is selected it shows the current week, and if this month is selected it shows the current month.

**By category** shows the total spent in each category, largest first. A transaction uses its own category when the user has changed it, and the merchant's category otherwise.

**By UPI ID** shows the same spending grouped by who was paid, so the user sees names such as Swiggy or Zepto rather than categories.

### 10.4 Calendar

The month shown as a day grid, with the total spent on each day. Days with no spending are left empty. Only money going out is shown here.

### 10.5 Top Transactions

The biggest single payments in the selected period, highest first, each showing what share of the period's total spending it accounts for.

## 11. Settings



### 11.1 Unreadable Messages

Some bank messages cannot be read. The format may be one the app does not support yet, or a bank may have changed its wording on an account that was working until last month. Either way the payment never appears, and nothing anywhere else in the app shows that something is missing. The user sees a quiet gap in their spending and has no way to tell whether they really spent less or the app stopped reading.

This screen is what closes that gap. Settings carries an entry showing the count, for example **Unreadable messages · 48**, and opening it lists them.

**What the list shows.** Messages are grouped by bank, the largest group first. Each group gives the bank name, how many messages, and the range of dates they cover. Opening a group shows the individual messages with their sender ID, when they arrived, and their text.

**The text is read from the inbox, not from the database.** Only the id of each message is stored, as described in Section 8.6, so this screen reads the originals back from the phone's inbox when it opens. Nothing extra is kept to make the screen work, and the messages are not copied anywhere.

**A message the user has deleted cannot be shown.** The row is still there with its bank and date, marked as no longer available, because the id now points at nothing.

**Only unreadable messages appear here.** Messages that were deliberately skipped, such as one-time passwords and balance alerts, are not failures and are not listed.

**Sending one to support.** Each message has a copy action and each group has a share action, so the user can send the formats that are failing and have them added. Nothing leaves the phone unless the user chooses it. A bank message carries an account number and often a balance, so the screen says what is being shared before it is sent.

**The screen is read only.** It reports the problem, it does not fix it. When a later release adds the bank, those messages are read again on their own and the payments appear in the user's history.

## 12. Lending

> Screens: [Lending · list](screens/Lending · list@1x.png), [Lending · lend detail](screens/Lending · lend detail@1x.png), [Lending · lend detail (closed)](screens/Lending · lend detail (closed)@1x.png), [Lending · new cash lend](screens/Lending · new cash lend@1x.png), [Lending · edit lend](screens/Lending · edit lend@1x.png), [Lending · record repayment](screens/Lending · record repayment (part)@1x.png)

Money lent to a person is not money spent. It has left the account, so every figure that counts debits counts it, and a month in which the user lent a friend five thousand rupees reads as a month in which they spent it.

Section 8.2 already answers half of that. The Lend category is `excluded_from_totals`, so a payment stops counting the moment it is categorised. What it does not answer is the other half: how much is still out there, who has it, and whether any of it has come back. Nothing in the app can say, and the only record the user has is their own memory — which is the problem the app exists to solve for spending and does not yet solve for lending.

**A lend is a transaction.** There is no second kind of record and no second ledger. A lend is an ordinary debit that happens to sit in a category that tracks repayment, and a repayment is an ordinary credit that happens to point at one. Everything already built keeps working on both: they appear in the transaction list, carry a location, can be searched, filtered, edited and deleted. The Lending page is a view over the transactions table, not a store of its own.

This matters more than it sounds. A `lends` table holding its own amount, person and date would be a second copy of facts the transactions table already holds, and Section 10.3 records what copies of a rule do — they drift, and the drift reaches the user as two answers to one question. The same argument applies to data. Where this section needs a fact that a transaction already carries, it reads it from the transaction.

### 12.1 What Makes a Transaction a Lend

A transaction is a lend when all of the following are true:

- It is a **debit**.
- Its **resolved category** has `tracks_repayment` set. Section 10.3 defines resolved: the transaction's own category when the user set one, the payee's otherwise, and none at all when the user cleared it.
- Its currency is **INR**.
- It is not deleted, not excluded, and not a self-transfer.

That is the whole rule. It introduces no new state — a lend is recognised, not created — and two behaviours the feature needs fall out of it rather than being built.

**Categorising a payment as Lend makes it a lend.** Nothing in a bank message distinguishes lending a friend money from paying them, so no rule will ever find one, and Section 5.4 already says the Lend category is only ever chosen. The user opens the payment, picks Lend, and it appears on the Lending page.

**Categorising a payee as Lend makes every payment to them a lend.** Section 8.4 stores a category against the merchant and Section 10.3 resolves through it, so one write reaches every past payment to that payee that has no category of its own, and every future one as it arrives. For a payee the user only ever lends to — which is what a UPI ID belonging to a friend usually is — this is the feature working as intended. It is also the sharpest edge in the section, and Section 12.8 says why.

`tracks_repayment` is a flag on the category rather than a check for the Lend row, for the reason Section 8.2 gives: a built-in category can be renamed, and the user can create their own. Someone who keeps a category per person they lend to gets the same treatment on all of them.

The currency check is the one the spending clause already makes, for the same reason. A card used abroad reports no rupee figure and there is no exchange rate on the device, so a foreign amount added into "left to get back" would be wrong by whatever the rate happens to be.

### 12.2 Recording a Repayment

A repayment is a **credit that points at the lend it repays**. One new column carries the whole relationship:

| Field                   | Type    | Constraints                           | Description                                                                 |
| ----------------------- | ------- | ------------------------------------- | --------------------------------------------------------------------------- |
| `repays_transaction_id` | INTEGER | FK → `transactions(id)`, NULL allowed | The lend this credit pays back. NULL for every credit that is not a repayment |

with `idx_tx_repays` on it, because the lend detail screen and the "left to get back" figure both read every repayment for a lend.

A self-reference on the transactions table rather than a join table, because a repayment belongs to exactly one lend. A join table would allow a repayment to be split across two lends, which is a case the user cannot express and the screens cannot show.

**There is no Repayment category.** The pill the detail screen shows against a repayment is derived from the link being set, not stored. A category would be a second place the same fact lives, and it would also be wrong: a credit is never spending, so putting it in a category changes nothing and invites it into pickers where it means nothing.

**Partial repayments are the normal case, not an exception.** What is left on a lend is the amount lent minus the sum of the credits pointing at it, floored at zero. Nothing stores "amount repaid" — it is that sum, every time it is needed. A stored running total would be a copy of the credits and would drift the first time one was deleted.

### 12.3 Closing a Lend

`repaid_at` on the lend already exists and already means "the money came back". It keeps that meaning and becomes the mark that the lend is **closed**: set to the moment the repayments first covered the amount, cleared if they stop covering it.

It is stored rather than derived, which is the one place this section accepts a copy, and the reason is Section 10's spending clause. `IS_SPENDING` tests `repaid_at IS NULL` and is used in fourteen queries; making closure a derived figure would push a correlated sum into all fourteen. So the column stays, and the invariant — `repaid_at` is set exactly when the linked credits cover the amount — is held by making one module the only writer of both sides, with a test asserting the two can never disagree.

The existing switch on the payment detail screen, **"Did this money come back?"**, keeps working and keeps its meaning. Turning it on with no repayments recorded closes the lend without saying how the money arrived, which is the right answer for cash handed back in person and for every lend already marked that way before this feature existed.

For the Lend category specifically, **closing a lend changes no spending figure**, because `excluded_from_totals` had already taken it out of them. What changes is the Lending page. A user-made category that tracks repayment without being excluded from totals behaves differently: there, closing genuinely removes the payment from spending, which is what `IS_SPENDING` has always done.

### 12.4 Matching a Repayment Automatically

When the friend sends the money back by UPI, the credit arrives as an ordinary bank message and the app should attach it to the lend without being asked.

**The match is on the payee, not on the UPI ID.** This is a correction to the obvious design and the evidence is in the data the app has already collected. UPI IDs are present on only a handful of payees, and on none of the credits at all — bank credit messages name the sender far more often than they give a UPI handle. A rule keyed on the UPI ID would therefore almost never fire. Section 8.4's `identity_key` is already the right key: it *prefers* the UPI ID and falls back to the normalised name, so matching on `merchant_id` uses the handle whenever the bank gives one and the name when it does not, with no second notion of identity anywhere in the app.

A credit is a candidate repayment when all of the following are true:

- It has a **merchant**, and that merchant has at least one **open lend**.
- It occurred **after** the lend.
- It is **INR**, not deleted, not a transfer, and not already matched as a reversal under Section 4.1.
- The merchant is not one of the user's own accounts (`is_self`).

There is deliberately **no upper time limit**. A reversal arrives within days and Section 4.3 wants a window around it for that reason; a lend can sit for a year, and a window would silently stop matching exactly the lends the user most wants help remembering.

**Which lend it pays.** A person can have several lends open at once — the list screen shows three for one person — and the credit attaches to exactly one of them, because `repays_transaction_id` holds one id. It is chosen in this order:

1. An open lend whose **remaining amount is exactly the credit**. Paying back a round, exact figure is how a repayment usually arrives, and an exact match is the strongest signal available. If several match exactly, the oldest wins.
2. Otherwise the **oldest open lend** from that payee. Oldest first is what a person means when they pay back a debt.

**A surplus is shown, not spread.** If the credit is larger than the lend it attaches to, that lend closes and the extra is reported on it as more than was owed. It does not flow into the payee's next open lend. Spreading one credit across two lends would mean one credit row belonging to two lends, which this schema deliberately cannot say — see Section 12.2 — and the alternative that could say it, a table of part-allocations, buys that one case at the price of a second place where the amounts live. The user settles it in one action instead: detach the credit, and record what belongs to each lend against each lend.

**The match runs in both directions.** The historical import reads messages newest first, so during an import the repayment is seen before the lend it repays. When a credit is created the app looks back for open lends from that payee; when a lend is created — or when a payment *becomes* a lend through categorisation — the app looks forward for unattached credits from that payee that arrived after it. Section 4.1 does the same thing for the same reason.

**Nothing is hidden and nothing is final.** A matched credit stays visible as a transaction of its own, the lend detail screen lists it under the lend, and a single action detaches it. Detaching returns it to being an ordinary credit and reopens the lend if it had closed.

### 12.5 Manual Lends and Manual Repayments

Both forms write ordinary manual transactions through the path Section 8.1 already describes for manual entry, with a cash account from Section 8.3.

**New lend · cash.** Cash only, and the screen says so: a UPI lend already exists as a payment, and letting the user type it in again would produce a duplicate the deduplication in Section 3 cannot catch, because a manual entry gets a fresh key every time. The form takes who it was lent to, the amount, the date and an optional note, and writes a debit in the Lend category against the cash account. Who it was lent to resolves to a merchant the same way every other manual entry does, so a cash lend to a person the user also pays by UPI lands on the same payee row — and a later UPI repayment from them matches it.

**Record repayment.** Opened from the lend, pre-filled with the amount still outstanding, and clamped so it can never exceed it. It writes a credit against the cash account with `repays_transaction_id` set, so the money arriving is recorded as a transaction like any other. The screen states the consequence before it is taken: either what will still be left, or that the lend will close.

### 12.6 The Lending Page

A third destination in the title menu of Section 3's navigation, beside Home and Transactions.

**The header figure is the sum of what is left across every open lend**, with a count of the open lends and of the distinct people behind them. It is not a figure that appears anywhere else in the app, and deliberately so: it is not spending and must never be added to spending.

**Open lends first, each showing** the person, the note, when it was lent and how long ago, the amount still to come back, the amount originally lent, and a bar of how much has been repaid. They are ordered by most recently lent. **Closed lends follow**, collapsed into a quieter section, because a lend that is settled is a record rather than something to act on.

**The lend detail screen** shows the same figures above the list of transactions that make it up — the lend itself and every repayment matched to it, each with its date and how it arrived. A closed lend states when it closed and what closed it.

### 12.7 Editing and Deleting

**Editing the lend edits the transaction.** The amount, the date and the note are the transaction's own fields, so the edit screen writes to the transaction and the Lending page re-reads. The person can be edited on a cash lend; on one that came from a bank message the payee is parse evidence and is not rewritten here, the same restriction Section 8.1 already places on parsed rows.

**Editing the amount below what has already come back** closes the lend and shows nothing left. It never shows a negative figure. The screen says what will happen before it is saved: repayments already received stay as they are.

**Recategorising a lend away from a repayment-tracking category** stops it being a lend — unless the user has already acted on it, by attaching a repayment or by marking it paid back, in which case it stays. This is the reason the payment detail screen already keeps its switch visible on a payment marked as repaid: a flag the user can no longer see is a flag they can no longer undo, and a repayment filed under a lend that has vanished belongs to nothing.

**Deleting a lend detaches its repayments.** They become ordinary credits again rather than pointing at a deleted row. Deletes are soft, so the link could be kept — but a repayment shown under a lend the user has deleted is a record of something the app claims not to have.

### 12.8 What Is Not Covered

- **Categorising a payee as Lend rewrites history, and that is the intended behaviour.** Setting Lend against a payee the user has paid twelve times turns all twelve into open lends at once, each asking to be paid back. For a friend who is only ever lent money this is the feature; for a shop whose name happens to collide, it is twelve wrong entries. The category is applied to the payee from the payment detail screen, which already tells the user how many payments will follow a payee-level category before they agree to it, and that count is the warning. Confirming the number specifically for a repayment-tracking category is a later change.
- **Two people with the same name become one person.** Section 8.4 keys a payee by UPI ID when there is one and by normalised name otherwise, and in practice almost every payee is keyed by name. Two different friends with the same first name therefore share a payee row, their lends pool together, and a repayment from one can close a lend to the other. This is already true of categories, but money owed is where it will be noticed. Nothing in a bank message can separate them; letting the user split a payee is the fix, and it is a later change.
- **A credit that is not a repayment can close a lend.** The match has no way to know why money arrived. A friend with an open lend who sends money for a shared dinner will have it applied to the lend. Everything about it is visible and one action undoes it, and no spending figure moves either way — but the Lending page will be wrong until the user looks. Requiring confirmation before applying is the alternative, and it trades this for lends that silently stay open because a prompt went unanswered.
- **Most credits cannot be matched at all.** Two thirds of the credits already imported carry no identifiable payee, because many bank credit messages name neither a sender nor a handle. Those can never match automatically, however the rule is written. For the user this means repayments that arrive by UPI sometimes still have to be recorded by hand, and the Lending page's job is to make that obvious rather than to pretend it caught everything.
- **A lend to a payee the app could not identify at all stays unmatched forever.** A payment with no merchant can still be categorised as Lend and still appears on the Lending page, but no credit can ever attach to it automatically. It can only be closed by hand.
- **One transfer cannot pay off two lends by itself.** A person with two open lends who sends a single amount covering both has it applied to one of them, with the remainder reported as a surplus rather than moved to the other. Splitting it is two actions by hand: detach, then record a repayment against each lend. Storing part-allocations would handle it automatically and is a later change if it turns out to happen often.
- **Nothing is tracked in the other direction.** Money the user borrows is not modelled. A credit cannot be marked as a borrowing and there is no "what I owe" figure.
- **No reminders.** The app has no way to tell the user a lend has been open for three months. It has no internet permission and sends nothing, so any reminder would be a local notification, and that is a later change.
- **Interest, instalments and dates owed are not modelled.** A lend is an amount and what has come back against it. Anything more is a loan, which is a different product.
