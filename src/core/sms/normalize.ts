/**
 * Text normalization applied before any pattern is run.
 *
 * Section 2.4 notes that SBI's credit card messages are written in Unicode
 * look-alike letters, so a pattern looking for the plain word matches nothing
 * and the whole message is unreadable. Folding those back to ASCII is what
 * makes one pattern work for both spellings.
 */

/** Mathematical alphanumeric blocks: U+1D400–U+1D7FF. */
function foldMathematicalAlphanumeric(codePoint: number): string | null {
  if (codePoint < 0x1d400 || codePoint > 0x1d7ff) {
    return null;
  }
  // Each block is 26 uppercase then 26 lowercase, with holes for letters that
  // already exist elsewhere in Unicode. Those holes are patched below.
  const HOLES: Record<number, string> = {
    0x1d455: 'h', 0x1d49d: 'B', 0x1d4a0: 'E', 0x1d4a1: 'F', 0x1d4a3: 'H',
    0x1d4a4: 'I', 0x1d4a7: 'L', 0x1d4a8: 'M', 0x1d4ad: 'R', 0x1d4ba: 'e',
    0x1d4bc: 'g', 0x1d4c4: 'o', 0x1d506: 'C', 0x1d50b: 'H', 0x1d50c: 'I',
    0x1d515: 'R', 0x1d51d: 'Z', 0x1d53a: 'C', 0x1d53f: 'H', 0x1d545: 'N',
    0x1d547: 'P', 0x1d548: 'Q', 0x1d549: 'R', 0x1d551: 'Z',
  };
  if (HOLES[codePoint]) {
    return HOLES[codePoint];
  }

  // Digit blocks sit at the end: U+1D7CE onwards, five runs of ten.
  if (codePoint >= 0x1d7ce) {
    return String.fromCharCode(0x30 + ((codePoint - 0x1d7ce) % 10));
  }

  const offset = (codePoint - 0x1d400) % 52;
  return offset < 26
    ? String.fromCharCode(0x41 + offset)
    : String.fromCharCode(0x61 + (offset - 26));
}

/** Cyrillic and Greek letters that are visually identical to Latin ones. */
const HOMOGLYPHS: Record<string, string> = {
  // Cyrillic
  'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O',
  'Р': 'P', 'С': 'C', 'Т': 'T', 'У': 'Y', 'Х': 'X', 'Ѕ': 'S', 'І': 'I',
  'Ј': 'J', 'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x',
  'у': 'y', 'і': 'i', 'ј': 'j', 'ѕ': 's',
  // Greek
  'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Ι': 'I', 'Κ': 'K',
  'Μ': 'M', 'Ν': 'N', 'Ο': 'O', 'Ρ': 'P', 'Τ': 'T', 'Υ': 'Y', 'Χ': 'X',
  'ο': 'o', 'ν': 'v',
  // Fullwidth digits and punctuation that turn up in forwarded messages
  '．': '.', '：': ':', '／': '/', '－': '-',
};

/** Currency and separator characters that vary between handsets. */
const PUNCTUATION: Record<string, string> = {
  ' ': ' ', // non-breaking space
  ' ': ' ', // thin space
  ' ': ' ', // narrow no-break space
  '–': '-', // en dash
  '—': '-', // em dash
  '‘': "'", '’': "'",
  '“': '"', '”': '"',
};

/**
 * Folds look-alike characters back to ASCII and collapses whitespace.
 * The rupee sign is deliberately left alone; the amount patterns look for it.
 */
export function foldLookalikes(input: string): string {
  let out = '';
  for (const char of input) {
    const codePoint = char.codePointAt(0)!;

    const mathematical = foldMathematicalAlphanumeric(codePoint);
    if (mathematical !== null) {
      out += mathematical;
      continue;
    }

    // Fullwidth Latin: U+FF21–U+FF5A, and fullwidth digits U+FF10–U+FF19.
    if (codePoint >= 0xff10 && codePoint <= 0xff19) {
      out += String.fromCharCode(0x30 + (codePoint - 0xff10));
      continue;
    }
    if (codePoint >= 0xff21 && codePoint <= 0xff5a) {
      out += String.fromCharCode(codePoint - 0xfee0);
      continue;
    }

    out += HOMOGLYPHS[char] ?? PUNCTUATION[char] ?? char;
  }
  return out;
}

/** Fold look-alikes, normalize whitespace, and trim. Never lowercases. */
export function normalizeMessageBody(body: string): string {
  return foldLookalikes(body).replace(/\s+/g, ' ').trim();
}

const TRAILING_NOISE = [
  'private limited', 'pvt limited', 'private ltd', 'pvt ltd', 'pvt', 'limited',
  'ltd', 'llp', 'inc', 'india', 'technologies', 'technology', 'tech',
  'solutions', 'services', 'enterprises', 'retail', 'payment', 'payments',
  'online', 'digital',
];

/**
 * Section 5.2: lowercase the name, remove punctuation, and strip trailing
 * words such as private limited, India, technologies or payment. Used both to
 * match the categorization rules and as a merchant identity when no UPI ID is
 * present.
 */
export function normalizeMerchantName(name: string): string {
  let out = foldLookalikes(name)
    .toLowerCase()
    .replace(/[^a-z0-9\s&]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Strip repeatedly: "Swiggy India Pvt Ltd" has three of them stacked.
  let changed = true;
  while (changed) {
    changed = false;
    for (const noise of TRAILING_NOISE) {
      if (out.endsWith(' ' + noise)) {
        out = out.slice(0, -(noise.length + 1)).trim();
        changed = true;
      }
    }
  }
  return out;
}
