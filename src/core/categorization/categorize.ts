/**
 * Section 5.2, matching a merchant name to a category.
 *
 * "Matching is done on the merchant or recipient name taken from the message...
 * Longer names are checked before shorter ones, so `swiggy instamart` is
 * matched before `swiggy`, and the two can point to different categories."
 *
 * That is the first of two passes. The second exists because most of what a
 * person pays by UPI is not a brand: it is the shop at the end of the road,
 * whose name no rules file will ever list. Those names very often say what
 * they are — a cafe is called a cafe, a chemist is called medicals — so the
 * second pass matches the word rather than the name. Brands are still checked
 * first, because `Amazon Fresh` has to beat `fresh`.
 */

import { normalizeMerchantName } from '../sms/normalize';
import rulesFile from './rules.json';

interface CompiledRule {
  /** The normalized rule name, e.g. `swiggy instamart`. */
  needle: string;
  systemKey: string;
  matcher: RegExp;
}

interface CompiledKeyword {
  /** The normalized keyword, split on spaces: `['cool', 'bar']`. */
  words: string[];
  systemKey: string;
}

const file = rulesFile as {
  rules: Record<string, string>;
  keywords: Record<string, string>;
};

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Built once. Sorted longest first, which is the whole reason
 * `swiggy instamart` lands in Groceries and `swiggy` in Food & Dining.
 */
const COMPILED: CompiledRule[] = Object.entries(file.rules)
  .map(([name, systemKey]) => {
    const needle = normalizeMerchantName(name);
    return {
      needle,
      systemKey,
      // Word-bounded, so `ola` does not match inside `chocolate`.
      matcher: new RegExp(`(?:^|\\s)${escapeForRegExp(needle)}(?:\\s|$)`),
    };
  })
  .filter((rule) => rule.needle.length > 0)
  .sort((a, b) => b.needle.length - a.needle.length);

/** Longest first for the same reason: `farm fresh` has to beat `fresh`. */
const KEYWORDS: CompiledKeyword[] = Object.entries(file.keywords)
  .map(([keyword, systemKey]) => ({
    words: normalizeMerchantName(keyword).split(' ').filter(Boolean),
    systemKey,
  }))
  .filter((keyword) => keyword.words.length > 0)
  .sort((a, b) => b.words.join(' ').length - a.words.join(' ').length);

/**
 * How short a truncated word may be before it stops being evidence.
 *
 * A keyword standing on its own has only itself to go on, so it needs four
 * letters: `rest` is enough of `restaurant` to mean something, `re` is not.
 * One whose earlier words have already matched is anchored by them — nothing
 * else reaches `super ma` having already matched `super` — so two will do,
 * and that is what catches `DURGA SWAMI SUPER MA`.
 */
const BARE_FRAGMENT_MIN = 4;
const ANCHORED_FRAGMENT_MIN = 2;

/**
 * Whether `keyword` sits in `words` starting at `at`.
 *
 * Every word but the last must match outright. The last may be cut short,
 * but only when it is also the last word of the name: the bank truncates a
 * long name to fit its message and can therefore only ever cut the final
 * word. That restriction is doing real work — it is what separates
 * `NISARGA GARDEN RESTA`, which is a restaurant, from `Smart Kottayam`,
 * which is not a mart, and `Labham Shoppy`, which is not a lab.
 */
function matchesAt(words: string[], at: number, keyword: string[]): boolean {
  for (let index = 0; index < keyword.length - 1; index += 1) {
    if (words[at + index] !== keyword[index]) {
      return false;
    }
  }

  const tail = keyword[keyword.length - 1]!;
  const word = words[at + keyword.length - 1]!;
  if (word === tail) {
    return true;
  }
  if (at + keyword.length !== words.length) {
    return false;
  }
  const minimum = keyword.length > 1 ? ANCHORED_FRAGMENT_MIN : BARE_FRAGMENT_MIN;
  return word.length >= minimum && tail.startsWith(word);
}

function keywordMatches(words: string[], keyword: string[]): boolean {
  for (let at = 0; at + keyword.length <= words.length; at += 1) {
    if (matchesAt(words, at, keyword)) {
      return true;
    }
  }
  return false;
}

/**
 * The system key of the category a merchant name falls into, or null.
 *
 * "If the name is not found, or the message carried only a UPI ID with no
 * name, the merchant is created without a category. The transaction then shows
 * as needing a category, and the user chooses one."
 */
export function categoryKeyForMerchantName(name: string | null): string | null {
  if (!name) {
    return null;
  }
  const normalized = normalizeMerchantName(name);
  if (!normalized) {
    return null;
  }

  for (const rule of COMPILED) {
    if (rule.matcher.test(normalized)) {
      return rule.systemKey;
    }
  }

  const words = normalized.split(' ');
  for (const keyword of KEYWORDS) {
    if (keywordMatches(words, keyword.words)) {
      return keyword.systemKey;
    }
  }

  return null;
}

/** Exposed for the test that proves the longest-first ordering holds. */
export const RULE_COUNT = COMPILED.length;
export const KEYWORD_COUNT = KEYWORDS.length;
