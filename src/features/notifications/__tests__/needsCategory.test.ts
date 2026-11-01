/**
 * The "what was this payment for" notification: who gets asked, and what the
 * card says.
 */

import { findCategoryBySystemKey } from '../../../core/db/dao/categories';
import { getCashAccount } from '../../../core/db/dao/accounts';
import { updateProfile } from '../../../core/db/dao/profile';
import {
  setExcluded,
  setTransactionCategory,
  softDelete,
} from '../../../core/db/dao/transactions';
import { initializeDatabase } from '../../../core/db/database';
import { openNodeDatabase } from '../../../core/db/nodeSqlite';
import type { SqlDatabase } from '../../../core/db/types';
import type { CategoryNotifier, PromptOption } from '../../../core/platform/categoryPrompt';
import { createManualTransaction, type ManualEntry } from '../../../core/transactions/manual';
import {
  QUICK_CATEGORY_KEYS,
  askAboutPayments,
  promptFor,
  quickCategories,
  solidPalette,
} from '../needsCategory';

const NOW = new Date(2026, 9, 24, 11, 5, 0).getTime();

function freshDb(): SqlDatabase {
  const db = initializeDatabase(openNodeDatabase(':memory:'));
  updateProfile(db, { notifications_enabled: 1 }, NOW);
  return db;
}

function entry(overrides: Partial<ManualEntry> = {}): ManualEntry {
  return {
    amount: 20_000,
    transactionType: 'DEBIT',
    recipientName: 'Unknown QR',
    upiId: null,
    categoryId: null,
    accountId: null,
    occurredAt: NOW,
    note: null,
    ...overrides,
  };
}

/**
 * How far apart two colours look, weighted the way an eye resolves them:
 * green best, blue worst. Only the scale matters, not the unit.
 */
function apart(a: string, b: string): number {
  const channel = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16);
  const dr = channel(a, 1) - channel(b, 1);
  const dg = channel(a, 3) - channel(b, 3);
  const db = channel(a, 5) - channel(b, 5);
  return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);
}

/** Rec. 601 luma, for comparing two weights of the same colour. */
function brightness(hex: string): number {
  const channel = (at: number) => parseInt(hex.slice(at, at + 2), 16);
  return 0.299 * channel(1) + 0.587 * channel(3) + 0.114 * channel(5);
}

/** Records what was posted instead of posting it. */
function fakeNotifier(enabled = true) {
  const shown: Array<{ id: number; title: string; body: string; options: PromptOption[] }> = [];
  const dismissed: number[] = [];
  const notifier: CategoryNotifier = {
    enabled: async () => enabled,
    show: (id, title, body, options) => shown.push({ id, title, body, options }),
    dismiss: (id) => dismissed.push(id),
  };
  return { notifier, shown, dismissed };
}

describe('the categories it offers', () => {
  it('includes lending, which no rule can ever find', () => {
    const db = freshDb();
    const keys = quickCategories(db).map((option) => option.label);
    expect(keys).toContain('Lend');
  });

  it('keeps the order it was written in', () => {
    const db = freshDb();
    expect(quickCategories(db)).toHaveLength(QUICK_CATEGORY_KEYS.length);
    expect(quickCategories(db).map((option) => option.label)).toEqual([
      'Food', 'Groceries', 'Transport', 'People', 'Lend', 'Others',
    ]);
  });

  it('cuts a long name at the ampersand rather than letting it truncate', () => {
    const db = freshDb();
    // `Food & Dining` under a button a sixth of a phone wide is `Food & …`.
    expect(quickCategories(db)[0]!.label).toBe('Food');
  });

  it('follows a rename, because it looks categories up by key', () => {
    const db = freshDb();
    const food = findCategoryBySystemKey(db, 'food')!;
    db.execute(`UPDATE categories SET name = 'Eating out' WHERE id = ?`, [food.id]);

    expect(quickCategories(db)[0]!.label).toBe('Eating out');
  });

  it('leaves out one the user has archived', () => {
    const db = freshDb();
    // `archiveCategory` refuses a built-in, so the flag is set directly:
    // what matters is that an archived row is never offered, however it
    // came to be archived.
    const before = quickCategories(db).length;
    const lend = findCategoryBySystemKey(db, 'lend')!;
    db.execute(`UPDATE categories SET is_archived = 1 WHERE id = ?`, [lend.id]);

    const after = quickCategories(db);
    expect(after).toHaveLength(before - 1);
    expect(after.map((option) => option.label)).not.toContain('Lend');
  });

  it('carries a colour the shade can draw in either theme', () => {
    const db = freshDb();
    for (const scheme of ['light', 'dark'] as const) {
      for (const option of quickCategories(db, scheme)) {
        expect(option.color).toMatch(/^#[0-9A-F]{6}$/i);
      }
    }
  });

  it('takes its weight from the shade, not from the app', () => {
    const db = freshDb();
    // The deep green that reads on white disappears into a dark shade, and
    // the pale one that reads on black washes out on white. They have to
    // differ, and the dark one has to be the lighter of the two.
    const onLight = quickCategories(db, 'light')[0]!.color;
    const onDark = quickCategories(db, 'dark')[0]!.color;

    expect(onDark).not.toBe(onLight);
    expect(brightness(onDark)).toBeGreaterThan(brightness(onLight));
  });

  it('gives every pill on the card a colour of its own', () => {
    const db = freshDb();

    // People and Lend used to be pink and plum, 48 apart on this scale
    // where every other pair on the card is over 100. Side by side on a
    // notification they read as one colour drawn twice.
    for (const scheme of ['light', 'dark'] as const) {
      const colors = quickCategories(db, scheme).map((option) => option.color);
      for (let i = 0; i < colors.length; i += 1) {
        for (let j = i + 1; j < colors.length; j += 1) {
          expect(apart(colors[i]!, colors[j]!)).toBeGreaterThan(80);
        }
      }
    }
  });

  it('has a weight for every colour a category can be', () => {
    // A token with no entry would fall back to grey, so a category the user
    // restyled would quietly lose its colour in the shade.
    const light = solidPalette('light');
    const dark = solidPalette('dark');
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
    for (const token of Object.keys(light)) {
      expect(dark[token]).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });
});

describe('which payments are asked about', () => {
  it('asks about one nothing could categorise', () => {
    const db = freshDb();
    const id = createManualTransaction(db, entry(), NOW).id;

    expect(promptFor(db, id)).not.toBeNull();
  });

  it('says nothing when the payment already has a category', () => {
    const db = freshDb();
    const id = createManualTransaction(db, entry(), NOW).id;
    setTransactionCategory(db, id, findCategoryBySystemKey(db, 'food')!.id);

    expect(promptFor(db, id)).toBeNull();
  });

  it('says nothing when the payee carries one, section 10.3', () => {
    const db = freshDb();
    const food = findCategoryBySystemKey(db, 'food')!;
    // A payee whose category the payment inherits is already answered.
    const id = createManualTransaction(
      db,
      entry({ recipientName: 'Chai Point', categoryId: food.id }),
      NOW,
    ).id;

    expect(promptFor(db, id)).toBeNull();
  });

  it('never asks about money coming in', () => {
    const db = freshDb();
    const id = createManualTransaction(
      db,
      entry({ transactionType: 'CREDIT', recipientName: 'Refund' }),
      NOW,
    ).id;

    expect(promptFor(db, id)).toBeNull();
  });

  it('never asks about a deleted or excluded payment', () => {
    const db = freshDb();
    const deleted = createManualTransaction(db, entry({ recipientName: 'A' }), NOW).id;
    const excluded = createManualTransaction(db, entry({ recipientName: 'B' }), NOW).id;
    softDelete(db, deleted, NOW);
    setExcluded(db, excluded, true, NOW);

    expect(promptFor(db, deleted)).toBeNull();
    expect(promptFor(db, excluded)).toBeNull();
  });
});

describe('what the card says', () => {
  it('says what was paid and who to, in that order', () => {
    const db = freshDb();
    const id = createManualTransaction(db, entry({ amount: 20_000 }), NOW).id;

    // `₹200 to Unknown QR`. The direction is in the word rather than in a
    // minus sign — plainer, and one less thing to decode at a glance.
    expect(promptFor(db, id)!.title).toBe('₹200 to Unknown QR');
  });

  it('names the account and then asks the question', () => {
    const db = freshDb();
    const cash = getCashAccount(db)!;
    const id = createManualTransaction(db, entry({ accountId: cash.id }), NOW).id;

    expect(promptFor(db, id)!.body).toContain('What was this for?');
  });

  it('shortens the bank the way every other screen does', () => {
    const db = freshDb();
    const id = createManualTransaction(db, entry(), NOW).id;
    db.execute(
      `INSERT INTO accounts (bank_name, bank_key, last_four, account_type,
                             created_at, updated_at)
       VALUES ('ICICI Bank', 'icici', '903', 'BANK', ?, ?)`,
      [NOW, NOW],
    );
    const { rows } = db.execute<{ id: number }>(
      `SELECT id FROM accounts WHERE bank_key = 'icici'`,
    );
    db.execute(`UPDATE transactions SET account_id = ? WHERE id = ?`, [
      rows[0]!.id,
      id,
    ]);

    // `ICICI • • 903`, not `ICICI Bank • • 903`: the digits are what
    // identify the account and must never be what gets truncated.
    expect(promptFor(db, id)!.body).toBe('ICICI • • 903 · What was this for?');
  });

  it('has something to call a payment that named nobody', () => {
    const db = freshDb();
    const id = createManualTransaction(db, entry(), NOW).id;
    // What a message the parser could read an amount but no payee out of
    // leaves behind: no merchant, and so no UPI ID either.
    db.execute(
      `UPDATE transactions SET merchant_id = NULL, recipient_name = NULL
        WHERE id = ?`,
      [id],
    );

    expect(promptFor(db, id)!.title).toBe('₹200 to an unnamed payee');
  });

  it('still asks even when there is no account to name', () => {
    const db = freshDb();
    const id = createManualTransaction(db, entry(), NOW).id;
    db.execute(`UPDATE transactions SET account_id = NULL WHERE id = ?`, [id]);

    expect(promptFor(db, id)!.body).toBe('What was this for?');
  });
});

describe('posting them', () => {
  it('posts one per payment that needs it', async () => {
    const db = freshDb();
    const needs = createManualTransaction(db, entry({ recipientName: 'A' }), NOW).id;
    const filed = createManualTransaction(db, entry({ recipientName: 'B' }), NOW).id;
    setTransactionCategory(db, filed, findCategoryBySystemKey(db, 'food')!.id);

    const { notifier, shown } = fakeNotifier();
    expect(await askAboutPayments(db, [needs, filed], notifier)).toBe(1);
    expect(shown.map((card) => card.id)).toEqual([needs]);
  });

  it('stops at three, so a day offline is not forty cards', async () => {
    const db = freshDb();
    const ids = Array.from(
      { length: 8 },
      (_, index) =>
        createManualTransaction(db, entry({ recipientName: `Shop ${index}` }), NOW).id,
    );

    const { notifier, shown } = fakeNotifier();
    expect(await askAboutPayments(db, ids, notifier)).toBe(3);
    // The newest, which are the ones still worth asking about.
    expect(shown.map((card) => card.id)).toEqual(ids.slice(-3));
  });

  it('says nothing when the user turned notifications off, section 8.5', async () => {
    const db = freshDb();
    updateProfile(db, { notifications_enabled: 0 }, NOW);
    const id = createManualTransaction(db, entry(), NOW).id;

    const { notifier, shown } = fakeNotifier();
    expect(await askAboutPayments(db, [id], notifier)).toBe(0);
    expect(shown).toHaveLength(0);
  });

  it('says nothing when the system has them off, which is a separate switch', async () => {
    const db = freshDb();
    const id = createManualTransaction(db, entry(), NOW).id;

    const { notifier, shown } = fakeNotifier(false);
    expect(await askAboutPayments(db, [id], notifier)).toBe(0);
    expect(shown).toHaveLength(0);
  });

  it('does nothing at all when the scan created nothing', async () => {
    const db = freshDb();
    const { notifier, shown } = fakeNotifier();

    expect(await askAboutPayments(db, [], notifier)).toBe(0);
    expect(shown).toHaveLength(0);
  });
});
