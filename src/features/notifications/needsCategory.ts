/**
 * `screens/Notification · payment needs a category@1x.png`: a payment the
 * rules could not place, asked about while the user still knows the answer.
 *
 * Section 5.3 files what it recognises, and on a year of real messages that
 * leaves most person-to-person payments and every unbranded local shop with
 * no category at all. Those can be sorted later inside the app, and in
 * practice they are not: by the evening a ₹200 payment to a QR code is one
 * of forty identical rows and nobody remembers which was the chemist.
 *
 * So the question is asked at the only moment it is cheap to answer — a
 * minute after the payment, from the lock screen, in one tap.
 */

import { Appearance, type ColorSchemeName } from 'react-native';
import { formatRupees } from '../../core/analytics/spending';
import { maskedDigits, shortBankName } from '../../design/accountLabel';
import { listCategories } from '../../core/db/dao/categories';
import { getProfile } from '../../core/db/dao/profile';
import type { SqlDatabase } from '../../core/db/types';
import type { CategoryNotifier, PromptOption } from '../../core/platform/categoryPrompt';
import { getTransactionDetail } from '../../core/transactions/manual';

/**
 * The six offered, by the key section 8.2 gives them rather than by name, so
 * a renamed category still appears and appears renamed.
 *
 * Chosen against what actually goes uncategorised. `food`, `groceries` and
 * `transport` are where the keyword pass misses — a local shop whose name
 * says nothing about what it sells. `people` and `lend` are the two answers
 * to a payment to a person, which is most of the remainder and which no rule
 * will ever tell apart: nothing in a bank message distinguishes paying a
 * friend from lending to them. `others` is the way out for a payment that is
 * none of these and is not worth opening the app over.
 *
 * Six because that is what fits across a phone. Everything else is a tap on
 * the notification itself, which opens the app.
 */
export const QUICK_CATEGORY_KEYS = [
  'food',
  'groceries',
  'transport',
  'people',
  'lend',
  'others',
] as const;

/**
 * The categories to offer, in order, skipping any the user has archived.
 *
 * `scheme` is the system's light or dark, which is what the shade will be
 * drawn in. It is a parameter so the choice can be tested without a phone.
 */
export function quickCategories(
  db: SqlDatabase,
  scheme: ColorSchemeName = Appearance.getColorScheme() ?? 'light',
): PromptOption[] {
  const solid = solidPalette(scheme);
  const byKey = new Map(
    listCategories(db)
      .filter((category) => category.is_archived === 0)
      .map((category) => [category.system_key, category]),
  );
  return QUICK_CATEGORY_KEYS.flatMap((key) => {
    const category = byKey.get(key);
    return category
      ? [{
          categoryId: category.id,
          label: shortLabel(category.name),
          color: solid[category.color] ?? solid.grey!,
        }]
      : [];
  });
}

/**
 * `Food & Dining` under a button a sixth of a phone wide is `Food & \u2026`,
 * which is the ellipsis doing the work the name was supposed to.
 *
 * Cutting at the ampersand gives `Food`, `Bills`, `Health` — which is what
 * the design labels them and what anyone would call them out loud. The full
 * name is still what the category is called everywhere the screen has room
 * for it, and a user's own rename is shortened the same way rather than
 * being replaced by a word they did not choose.
 */
function shortLabel(name: string): string {
  return name.split(' & ')[0]!.trim();
}

/**
 * The palette's `solid` values, copied rather than imported, and kept in both
 * weights.
 *
 * Which one is right depends on what the mark is being drawn against, and
 * that is the system notification shade — not the app. So the choice follows
 * `Appearance`, the system setting, rather than the user's own theme
 * preference in section 8.5: someone running the app in Light on a phone set
 * to Dark still gets a dark shade, and the deep green that reads well on
 * white disappears into it.
 */
const SOLID_LIGHT: Record<string, string> = {
  green: '#0F7A5A',
  blue: '#3B6FD4',
  violet: '#9B51E0',
  amber: '#E0A32B',
  orange: '#D97316',
  red: '#CE3B2F',
  navy: '#1E3A5F',
  mint: '#6FC2A0',
  grey: '#A8A49C',
  teal: '#1F8A8A',
  brown: '#8A5A3C',
  pink: '#C2457E',
  lime: '#6E8B1F',
  indigo: '#5B4BC4',
  plum: '#8E3B5E',
  slate: '#4F6B7A',
  sky: '#2E86C8',
  lemon: '#6F6118',
};

const SOLID_DARK: Record<string, string> = {
  green: '#3FAD86',
  blue: '#6B8FD6',
  violet: '#B57BEC',
  amber: '#E8BB5C',
  orange: '#E8914C',
  red: '#E06A5E',
  navy: '#6E8CB5',
  mint: '#7FCFAF',
  grey: '#8E918D',
  teal: '#49AFAF',
  brown: '#B5805E',
  pink: '#DE7BA8',
  lime: '#9CBF4A',
  indigo: '#8A7BE0',
  plum: '#C4719A',
  slate: '#7E9AAA',
  sky: '#63A9E0',
  lemon: '#B8AA72',
};

/** Which weight a shade of `scheme` wants. */
export function solidPalette(scheme: ColorSchemeName): Record<string, string> {
  return scheme === 'dark' ? SOLID_DARK : SOLID_LIGHT;
}

export interface Prompt {
  transactionId: number;
  title: string;
  body: string;
  options: PromptOption[];
}

/**
 * The prompt a payment deserves, or null when it deserves none.
 *
 * Only money going out, only in rupees, and only when nothing has given it a
 * category — section 10.3's rule, so a payment that inherits one from its
 * payee counts as answered and is left alone. A credit is not asked about at
 * all: money arriving is not a spend to file.
 */
export function promptFor(
  db: SqlDatabase,
  transactionId: number,
  scheme: ColorSchemeName = Appearance.getColorScheme() ?? 'light',
): Prompt | null {
  const detail = getTransactionDetail(db, transactionId);
  if (
    detail === null ||
    detail.transaction_type !== 'DEBIT' ||
    detail.currency !== 'INR' ||
    detail.is_deleted === 1 ||
    detail.is_transfer === 1 ||
    detail.is_excluded === 1 ||
    detail.resolved_category_id !== null
  ) {
    return null;
  }

  const options = quickCategories(db, scheme);
  if (options.length === 0) {
    return null;
  }

  // No UPI ID in this chain, though it was written that way first: a
  // payment either has a merchant, whose `display_name` is NOT NULL and so
  // always wins, or it has none — and then there is no UPI ID either,
  // because that is a column on the merchant. The fallback could not fire.
  const payee =
    detail.merchant_name ?? detail.recipient_name ?? 'an unnamed payee';

  const account =
    detail.bank_name === null
      ? null
      : detail.last_four
      ? `${shortBankName(detail.bank_name)} ${maskedDigits(detail.last_four)}`
      : shortBankName(detail.bank_name);

  return {
    transactionId,
    // `₹1 to Divya Rao`, as the mockup phrases it. The direction is
    // in the word rather than in a minus sign, which is both plainer and
    // one less thing to decode at a glance.
    title: `${formatRupees(detail.amount)} to ${payee}`,
    // The time is gone from here: the shade already stamps the card with
    // it, right next to the app's name. What goes in its place is the
    // question the card exists to ask.
    body: [account, 'What was this for?']
      .filter((part): part is string => Boolean(part))
      .join(' · '),
    options,
  };
}

/**
 * How many prompts one scan may post.
 *
 * A catch-up that has been offline for a day can create a dozen payments at
 * once, and a dozen notifications arriving together is not a prompt, it is a
 * mess that gets cleared without being read. The newest few are the ones the
 * user has any chance of remembering anyway.
 */
const MAX_PER_SCAN = 3;

/**
 * Asks about the payments in `transactionIds` that need it.
 *
 * Silent unless the user has notifications on in both places they can be
 * turned off — section 8.5's own flag, and the system's. Returns how many
 * were posted, which is what the log reports.
 */
export async function askAboutPayments(
  db: SqlDatabase,
  transactionIds: number[],
  notifier: CategoryNotifier,
): Promise<number> {
  if (transactionIds.length === 0 || getProfile(db).notifications_enabled !== 1) {
    return 0;
  }
  if (!(await notifier.enabled())) {
    return 0;
  }

  const prompts = transactionIds
    .map((id) => promptFor(db, id))
    .filter((prompt): prompt is Prompt => prompt !== null)
    .slice(-MAX_PER_SCAN);

  for (const prompt of prompts) {
    notifier.show(prompt.transactionId, prompt.title, prompt.body, prompt.options);
  }
  return prompts.length;
}
