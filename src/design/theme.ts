/**
 * Colours, type and spacing taken from the screens in `screens/`.
 *
 * Section 8.2: "Colour is stored as a palette token, not a hex value. The app
 * supports light and dark themes, so a fixed hex value that reads well on one
 * background will not on the other." Category colours therefore resolve
 * through `categoryPalette` here rather than being stored anywhere.
 */

export type ColorToken =
  | 'green' | 'blue' | 'violet' | 'amber'
  | 'orange' | 'red' | 'navy' | 'mint' | 'grey'
  // Added with the health, fuel and insurance categories: nine tokens for
  // eleven categories would have put two of the same colour side by side
  // in the bubble chart, which is where colour is doing the most work.
  | 'teal' | 'brown' | 'pink' | 'lime' | 'indigo' | 'plum' | 'slate'
  // Added with EMI, which arrived into a palette where all sixteen tokens
  // were already spoken for. A seventeenth category reusing one would have
  // drawn two identical slices in the breakdown, where colour is the only
  // thing telling them apart at a glance.
  | 'sky'
  // Added for Lend, which used to be `plum` — and `plum` sat 48 units from
  // `pink` on a scale where every other neighbouring pair is over 100. On
  // the notification, where People and Lend are drawn side by side, they
  // read as one colour twice. Yellow was the only part of the wheel this
  // palette had left.
  //
  // Muted rather than bright. Picked for distance alone it came out at
  // saturation 0.73 and luma 214, against a palette that runs 0.03-0.67 and
  // 136-190 — so it was the one colour on the card shouting. Pulled back
  // into the house range it is still 91 from its nearest neighbour there,
  // which is nearly twice the gap that caused the trouble.
  | 'lemon';

export interface CategoryColor {
  /** The dot, the chip border, the bar. */
  solid: string;
  /** Chip and avatar backgrounds. */
  soft: string;
  /** Text sitting on `soft`. */
  onSoft: string;
}

export interface Theme {
  dark: boolean;
  color: {
    /** The warm bone the whole app sits on. */
    background: string;
    surface: string;
    surfaceMuted: string;
    border: string;
    borderStrong: string;

    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    textInverse: string;

    /** The deep green of the primary buttons. */
    primary: string;
    primaryPressed: string;
    onPrimary: string;
    primaryText: string;

    /** The near-black of a selected filter chip. */
    selected: string;
    onSelected: string;

    danger: string;
    dangerSoft: string;
    /** The warm red of an "up 95%" comparison. */
    up: string;
    down: string;

    overlay: string;
    skeleton: string;
  };
  category: Record<ColorToken, CategoryColor>;
  space: (steps: number) => number;
  radius: { sm: number; md: number; lg: number; xl: number; pill: number };
  type: {
    display: TextStyleLike;
    title: TextStyleLike;
    heading: TextStyleLike;
    subheading: TextStyleLike;
    body: TextStyleLike;
    bodyStrong: TextStyleLike;
    label: TextStyleLike;
    caption: TextStyleLike;
    amount: TextStyleLike;
  };
}

interface TextStyleLike {
  fontSize: number;
  lineHeight: number;
  fontWeight: '400' | '500' | '600' | '700' | '800';
  letterSpacing?: number;
}

const BASE_UNIT = 4;
const space = (steps: number) => steps * BASE_UNIT;

const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 };

const type: Theme['type'] = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: '800', letterSpacing: -0.6 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -0.4 },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: '700', letterSpacing: -0.2 },
  subheading: { fontSize: 17, lineHeight: 23, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  caption: { fontSize: 12, lineHeight: 17, fontWeight: '500' },
  amount: { fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.4 },
};

export const lightTheme: Theme = {
  dark: false,
  color: {
    background: '#F4F2EC',
    surface: '#FFFFFF',
    surfaceMuted: '#EFEDE6',
    border: '#E7E3D9',
    borderStrong: '#D6D1C4',

    textPrimary: '#15181A',
    textSecondary: '#6B6F72',
    textMuted: '#9A9C9A',
    textInverse: '#FFFFFF',

    primary: '#0E6A50',
    primaryPressed: '#0B5541',
    onPrimary: '#FFFFFF',
    primaryText: '#0E6A50',

    selected: '#14191C',
    onSelected: '#FFFFFF',

    danger: '#C0392B',
    dangerSoft: '#FDECEA',
    up: '#C2410C',
    down: '#0E6A50',

    overlay: 'rgba(20, 25, 28, 0.45)',
    skeleton: '#E7E3D9',
  },
  category: {
    green: { solid: '#0F7A5A', soft: '#DCEFE6', onSoft: '#0B5541' },
    blue: { solid: '#3B6FD4', soft: '#DEE7FA', onSoft: '#27497F' },
    violet: { solid: '#9B51E0', soft: '#EADEFA', onSoft: '#5F2E8C' },
    amber: { solid: '#E0A32B', soft: '#FAEFD6', onSoft: '#8A6212' },
    orange: { solid: '#D97316', soft: '#FBE6D4', onSoft: '#8A470D' },
    red: { solid: '#CE3B2F', soft: '#FADEDB', onSoft: '#8C241B' },
    navy: { solid: '#1E3A5F', soft: '#DCE3EC', onSoft: '#16293F' },
    mint: { solid: '#6FC2A0', soft: '#DFF1E9', onSoft: '#2E6B55' },
    grey: { solid: '#A8A49C', soft: '#E9E6DF', onSoft: '#60615E' },
    teal: { solid: '#1F8A8A', soft: '#D8EDED', onSoft: '#145E5E' },
    brown: { solid: '#8A5A3C', soft: '#EFE2D8', onSoft: '#5E3A24' },
    pink: { solid: '#C2457E', soft: '#F8DCE9', onSoft: '#872C57' },
    lime: { solid: '#6E8B1F', soft: '#E8EFD2', onSoft: '#4A5E14' },
    indigo: { solid: '#5B4BC4', soft: '#E2DEF8', onSoft: '#3A2E8A' },
    plum: { solid: '#8E3B5E', soft: '#F3DCE6', onSoft: '#632641' },
    slate: { solid: '#4F6B7A', soft: '#DFE7EB', onSoft: '#33464F' },
    sky: { solid: '#2E86C8', soft: '#D9EAF7', onSoft: '#1C5B88' },
    lemon: { solid: '#6F6118', soft: '#EDEAD7', onSoft: '#4A4010' },
  },
  space,
  radius,
  type,
};

export const darkTheme: Theme = {
  dark: true,
  color: {
    background: '#121311',
    surface: '#1C1E1C',
    surfaceMuted: '#242724',
    border: '#2E322E',
    borderStrong: '#3C413C',

    textPrimary: '#F2F1EC',
    textSecondary: '#A3A7A4',
    textMuted: '#787C79',
    textInverse: '#15181A',

    primary: '#1E8D6C',
    primaryPressed: '#17735A',
    onPrimary: '#FFFFFF',
    primaryText: '#4FBF96',

    selected: '#F2F1EC',
    onSelected: '#15181A',

    danger: '#E8685A',
    dangerSoft: '#3A211E',
    up: '#F08A4B',
    down: '#4FBF96',

    overlay: 'rgba(0, 0, 0, 0.6)',
    skeleton: '#2E322E',
  },
  category: {
    green: { solid: '#3FAD86', soft: '#1B342B', onSoft: '#8FD9BD' },
    blue: { solid: '#6B8FD6', soft: '#1C2740', onSoft: '#A9C3F4' },
    violet: { solid: '#B57BEC', soft: '#2B1D3C', onSoft: '#D2B0F6' },
    amber: { solid: '#E8BB5C', soft: '#362C17', onSoft: '#F2D799' },
    orange: { solid: '#E8914C', soft: '#372315', onSoft: '#F3BC8E' },
    red: { solid: '#E06A5E', soft: '#3A201D', onSoft: '#F0A79E' },
    navy: { solid: '#6E8CB5', soft: '#1D2531', onSoft: '#A9BBD3' },
    mint: { solid: '#7FCFAF', soft: '#1C332B', onSoft: '#B2E3CD' },
    grey: { solid: '#8E918D', soft: '#2A2D2A', onSoft: '#B9BCB8' },
    teal: { solid: '#49AFAF', soft: '#17302F', onSoft: '#97DADA' },
    brown: { solid: '#B5805E', soft: '#2F221A', onSoft: '#DDBBA2' },
    pink: { solid: '#DE7BA8', soft: '#38202C', onSoft: '#F0B3CE' },
    lime: { solid: '#9CBF4A', soft: '#262E15', onSoft: '#C8DD93' },
    indigo: { solid: '#8A7BE0', soft: '#211D3A', onSoft: '#BDB4F0' },
    plum: { solid: '#C4719A', soft: '#33202A', onSoft: '#E6AFC7' },
    slate: { solid: '#7E9AAA', soft: '#1D272E', onSoft: '#B4C8D3' },
    sky: { solid: '#63A9E0', soft: '#182937', onSoft: '#A5CDEE' },
    lemon: { solid: '#B8AA72', soft: '#2F2C1E', onSoft: '#DCD3AC' },
  },
  space,
  radius,
  type,
};

/** Falls back to grey for a token that is not in the palette. */
export function categoryColor(theme: Theme, token: string): CategoryColor {
  return theme.category[token as ColorToken] ?? theme.category.grey;
}

/**
 * The same colour, see-through.
 *
 * Every colour in the palette is written `#RRGGBB`, so the alpha can simply
 * be appended. Used where a fill has to carry a category's identity without
 * carrying its full weight — a bubble the size of a thumb in the solid
 * colour is a block of paint, and the same colour at a fifth of it is a
 * surface the text on top can be read against.
 */
export function withAlpha(hex: string, alpha: number): string {
  const clamped = Math.max(0, Math.min(1, alpha));
  const byte = Math.round(clamped * 255).toString(16).padStart(2, '0');
  return `${hex}${byte}`;
}

function channels(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/**
 * Ink that can be read on a see-through fill of `hex` over `behind`.
 *
 * Needed because the two themes put the same token on opposite sides of the
 * line. In the light theme `green.solid` is a deep forest green that wants
 * white on it; in the dark theme it is a pale mint that wants near-black.
 * Alpha then moves it again — a fill at a fifth of its weight lands close to
 * the surface under it whichever theme that is.
 *
 * So the colour is actually composited and its brightness measured, rather
 * than guessed from the token name or from `theme.dark`.
 */
export function readableInk(
  theme: Theme,
  hex: string,
  alpha: number,
  behind: string = theme.color.surface,
): string {
  const [r, g, b] = channels(hex);
  const [br, bg, bb] = channels(behind);
  const mix = (top: number, bottom: number) => alpha * top + (1 - alpha) * bottom;
  // Rec. 601 luma, which is the cheap one and is what every contrast rule of
  // thumb for body text is written against.
  const luma =
    0.299 * mix(r, br) + 0.587 * mix(g, bg) + 0.114 * mix(b, bb);
  return luma > 150 ? '#15181A' : '#FFFFFF';
}
