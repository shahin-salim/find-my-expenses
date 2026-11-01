/**
 * Section 5.4: "These categories are created when the app is installed."
 *
 * `system_key` is what the rules file points at. Section 8.2: "Built-in rules
 * map a merchant to a key such as `food`. If the rules referenced the name
 * instead, renaming the category would break them."
 */

export interface DefaultCategory {
  systemKey: string;
  name: string;
  icon: string;
  color: string;
  sortOrder: number;
  /**
   * Fixed costs recur at a size that drowns out everyday spending, so Home
   * offers to leave them out. Not the same as `excludedFromTotals`, which
   * takes a category out of spending altogether.
   */
  isFixedCost?: boolean;
  /**
   * Money that has moved but has not been spent, such as an investment. It
   * leaves the spending figures altogether, unlike `isFixedCost`, which only
   * takes it out of the everyday view.
   */
  excludedFromTotals?: boolean;
  /**
   * The payment screen asks whether the money came back, and stops counting
   * it once the user says it has. Only Lend ships with this set: it is the
   * one default category where the money leaving is expected to return.
   */
  tracksRepayment?: boolean;
}

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { systemKey: 'food', name: 'Food & Dining', icon: 'bowl', color: 'green', sortOrder: 1 },
  { systemKey: 'groceries', name: 'Groceries', icon: 'basket', color: 'violet', sortOrder: 2 },
  { systemKey: 'transport', name: 'Transport', icon: 'bus', color: 'blue', sortOrder: 3 },
  { systemKey: 'shopping', name: 'Shopping', icon: 'bag', color: 'amber', sortOrder: 4 },
  { systemKey: 'bills', name: 'Bills & Utilities', icon: 'bolt', color: 'mint', sortOrder: 5, isFixedCost: true },
  { systemKey: 'rent', name: 'Rent', icon: 'home', color: 'orange', sortOrder: 6, isFixedCost: true },
  /**
   * Added after reading a year of real payments against section 5.4's list.
   *
   * Health sat in `others` with the pharmacies, and the local chemists and
   * diagnostic labs people actually pay matched no rule at all. Fuel sat in
   * `transport` behind the national brands, so the neighbourhood pumps that
   * most fuel spending goes through were uncategorised. Insurance sat in
   * `transfers`, which is wrong twice over: a premium is money spent, not
   * money moved between the user's own accounts, and `transfers` is a fixed
   * cost, so every premium was being hidden from everyday spending.
   */
  { systemKey: 'health', name: 'Health & Medical', icon: 'cross', color: 'red', sortOrder: 7 },
  { systemKey: 'fuel', name: 'Fuel', icon: 'fuel', color: 'brown', sortOrder: 8 },
  // A premium recurs at a size that drowns out everyday spending, which is
  // what `isFixedCost` is for — unlike `transfers`, it is still spending.
  { systemKey: 'insurance', name: 'Insurance', icon: 'shield', color: 'teal', sortOrder: 9, isFixedCost: true },

  /**
   * A loan instalment: the one recurring payment that is neither a bill nor
   * a transfer, and was landing in whichever of the two the user picked.
   *
   * `isFixedCost`, alongside rent and insurance, because that is exactly
   * what it is — a fixed sum on a fixed date that drowns out everyday
   * spending. Not `excludedFromTotals`: an instalment has genuinely left,
   * unlike money moved into an investment, which is still the user's.
   *
   * No rule finds it. A lender's name reaches the phone as whatever the
   * bank's message calls it, and an instalment debited by mandate often
   * names nobody at all, so the category is chosen once per payee and
   * section 8.4 remembers it from there.
   */
  { systemKey: 'emi', name: 'EMI', icon: 'calendar', color: 'sky', sortOrder: 10, isFixedCost: true },

  /**
   * Most of what a person pays by UPI goes to other people, and no brand
   * list will ever contain them. The honorific rules catch the ones written
   * `Mr`, `Mrs` or `Ms`; the rest are a tap away, and section 8.4 remembers
   * the payee once it is chosen.
   */
  { systemKey: 'people', name: 'People', icon: 'person', color: 'pink', sortOrder: 11 },

  /**
   * Section 5.4 files the brokers under `transfers`, which is the same
   * mistake insurance was: a transfer is money between the user's own
   * accounts, and a broker is not one of them.
   *
   * `excludedFromTotals` rather than `isFixedCost`, because money put into
   * an investment has not been spent — it is the user's money still, in a
   * different place. That is exactly what the category screen offers it for:
   * "For money you move, like investments or savings."
   */
  { systemKey: 'investment', name: 'Investment', icon: 'briefcase', color: 'lime', sortOrder: 12, excludedFromTotals: true },

  // Section 5.4 lists BookMyShow, PVR and INOX under `others`, alongside the
  // pharmacies and the tutors. Three unrelated things in one bucket is what
  // `others` becomes when it is used as a place to put the leftovers.
  { systemKey: 'entertainment', name: 'Entertainment', icon: 'star', color: 'indigo', sortOrder: 13 },

  /**
   * Money handed to someone on the understanding that it comes back.
   *
   * `excludedFromTotals`, for the same reason as an investment and in the
   * same words the payment screen already uses for it — "money you'll get
   * back". It has left the account but it has not been spent, and counting
   * it would make a month where the user lent a friend five thousand rupees
   * look like a month where they spent it.
   *
   * No rule can find this one. Nothing in a bank message distinguishes
   * lending a friend money from paying them, so it is only ever chosen —
   * and once chosen, section 8.4 remembers the payee.
   */
  // Servicing, spares and repairs. Fuel is its own category and stays
  // there: one is what the bike costs to keep, the other is what it costs
  // to use, and they move independently.
  { systemKey: 'bike', name: 'Bike', icon: 'bike', color: 'slate', sortOrder: 14 },

  { systemKey: 'lend', name: 'Lend', icon: 'lend', color: 'lemon', sortOrder: 15, excludedFromTotals: true, tracksRepayment: true },

  { systemKey: 'transfers', name: 'Transfers', icon: 'swap', color: 'navy', sortOrder: 16, isFixedCost: true },
  // Section 5.4: "Others is a real category that the user can choose. It is
  // not the same as a transaction that has no category yet, which is shown
  // separately as needing a category."
  { systemKey: 'others', name: 'Others', icon: 'dots', color: 'grey', sortOrder: 17 },
];

/**
 * Every icon a category can have, which is what the picker offers.
 *
 * It has to contain the icons the built-in categories ship with, not only
 * the shapes the design drew for a new one. Leave `bowl` out and opening
 * Food & Dining shows nothing selected, and any tap replaces an icon the
 * user never meant to change.
 */
export const ICON_CHOICES = [
  // The shapes the design offers for a new category
  'circle', 'triangle', 'square', 'pin',
  'star', 'bell', 'plus', 'briefcase',
  // What the built-in categories use
  'bowl', 'basket', 'bus', 'bag',
  'bolt', 'home', 'swap', 'dots',
  // Added with the categories that came after the first release
  'cross', 'fuel', 'shield', 'person',
  'lend', 'bike', 'calendar',
] as const;

/** The colour swatches offered on the category-create screen. */
export const COLOR_CHOICES = [
  'green', 'blue', 'violet', 'amber',
  'orange', 'red', 'navy', 'grey',
  'teal', 'brown', 'mint', 'pink', 'lime', 'indigo', 'plum', 'slate', 'sky',
  'lemon',
] as const;
