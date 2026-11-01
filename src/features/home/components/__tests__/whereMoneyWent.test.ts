/**
 * Laying out the bubbles on Home: how big each one is drawn, and how
 * heavily it is filled.
 */

import type { Slice } from '../../../../core/analytics/breakdown';
import { bubbleText, place } from '../WhereMoneyWent';

const WIDTH = 320;

function slice(label: string, total: number): Slice {
  return { key: label, label, color: 'green', icon: null, total, share: 0 };
}

/**
 * The shape the card actually hands over: the slices it is showing, largest
 * first, with the gathered `N more` appended after them. That last one is
 * the sum of everything that did not fit, so it is routinely bigger than
 * the ones it follows — the list is sorted apart from its final entry.
 */
const withGathered: Slice[] = [
  slice('Unknown payee', 5_254_00),
  slice('V Prasad', 3_216_00),
  slice('STGEORGE AUTO SPARES', 3_180_00),
  slice('DIVYA RAO', 3_003_00),
  slice('Chai', 1_573_00),
  slice('Bus', 1_300_00),
  slice('18 more', 4_069_00),
];

describe('how heavily each bubble is filled', () => {
  it('never asks for a fill the colour cannot be drawn at', () => {
    // A negative weight clamps the fill to transparent, which drew the
    // labels with no circle behind them. It happened because the smallest
    // slice was read off the end of the list, and the gathered `N more` is
    // on the end without being the smallest.
    for (const { weight } of place(withGathered, WIDTH).placed) {
      expect(weight).toBeGreaterThanOrEqual(0);
      expect(weight).toBeLessThanOrEqual(1);
    }
  });

  it('gives the full weight to the biggest slice, wherever it sits', () => {
    const { placed } = place(withGathered, WIDTH);
    const heaviest = placed.find((entry) => entry.slice.label === 'Unknown payee')!;
    expect(heaviest.weight).toBeCloseTo(1);
  });

  it('gives the least to the smallest, wherever it sits', () => {
    const { placed } = place(withGathered, WIDTH);
    const lightest = placed.find((entry) => entry.slice.label === 'Bus')!;
    expect(lightest.weight).toBeCloseTo(0);
  });

  it('spreads the rest in order of what was spent', () => {
    const { placed } = place(withGathered, WIDTH);
    const by = (label: string) =>
      placed.find((entry) => entry.slice.label === label)!;

    expect(by('18 more').weight).toBeGreaterThan(by('V Prasad').weight);
    expect(by('V Prasad').weight).toBeGreaterThan(by('Chai').weight);
  });

  it('copes with every slice being the same size', () => {
    const even = [slice('a', 100), slice('b', 100), slice('c', 100)];
    for (const { weight } of place(even, WIDTH).placed) {
      expect(weight).toBe(1);
    }
  });
});

describe('how big each bubble is drawn', () => {
  it('sizes by area, so four times the money is twice across', () => {
    const { placed } = place([slice('big', 400), slice('small', 100)], WIDTH);
    const big = placed.find((entry) => entry.slice.label === 'big')!;
    const small = placed.find((entry) => entry.slice.label === 'small')!;

    expect(big.size / small.size).toBeCloseTo(2);
  });

  it('finds the biggest slice even when it is not first', () => {
    const { placed } = place([slice('small', 100), slice('big', 400)], WIDTH);
    const big = placed.find((entry) => entry.slice.label === 'big')!;
    const small = placed.find((entry) => entry.slice.label === 'small')!;

    expect(big.size).toBeGreaterThan(small.size);
    expect(big.size / small.size).toBeCloseTo(2);
  });

  it('keeps a tiny slice big enough to put a figure in', () => {
    // A true-to-area circle for a 1% slice would be a dot.
    const { placed } = place([slice('big', 10_000), slice('crumb', 1)], WIDTH);
    const big = placed.find((entry) => entry.slice.label === 'big')!;
    const crumb = placed.find((entry) => entry.slice.label === 'crumb')!;

    expect(crumb.size / big.size).toBeCloseTo(0.42);
  });

  it('draws every circle inside the width it was given', () => {
    const { placed, height } = place(withGathered, WIDTH);

    for (const entry of placed) {
      expect(entry.left).toBeGreaterThanOrEqual(-0.01);
      expect(entry.left + entry.size).toBeLessThanOrEqual(WIDTH + 0.01);
      expect(entry.top).toBeGreaterThanOrEqual(-0.01);
      expect(entry.top + entry.size).toBeLessThanOrEqual(height + 0.01);
    }
  });

  it('has nothing to lay out before the row has been measured', () => {
    expect(place(withGathered, 0)).toEqual({ placed: [], height: 0 });
  });

  it('has nothing to lay out for a period with no spending', () => {
    expect(place([], WIDTH)).toEqual({ placed: [], height: 0 });
    expect(place([slice('nil', 0)], WIDTH)).toEqual({ placed: [], height: 0 });
  });
});

describe('what text a bubble can hold', () => {
  const LAKH = '\u20b91,00,000';
  const text = (size: number, amount = LAKH) => bubbleText(size, amount);

  /** The width a line of text actually has, which is not the diameter. */
  const textWidth = (size: number) => size - text(size).pad * 2;

  /** Roughly how wide `label` is at `fontSize`, by the same estimate. */
  const widthOf = (label: string, fontSize: number) => label.length * fontSize * 0.55;

  it('keeps the text inside the circle, not inside its bounding box', () => {
    // Text is centred, so it runs through the middle of the circle where
    // the width is the inscribed square — about seven tenths of the
    // diameter, not the nine tenths the padding used to leave.
    expect(textWidth(100)).toBeCloseTo(70.7, 0);
    expect(textWidth(100)).toBeLessThan(100);
  });

  it('gives a long name enough rows that it is cut rather than lost', () => {
    const big = text(168);
    expect(big.named).toBe(true);
    expect(big.rows).toBeGreaterThanOrEqual(1);
  });

  it('still names a bubble that can only hold a word of it', () => {
    // `STGEORGE AUTO SPARES` on a circle this size: the rows it gets are
    // what the ellipsis then works within. Dropping the name outright
    // would leave a bare figure where a readable fragment would do.
    const small = text(70);
    expect(small.named).toBe(true);
    expect(small.rows).toBeGreaterThanOrEqual(1);
  });

  it('drops the name when nothing legible would be left of it', () => {
    expect(text(40).named).toBe(false);
    expect(text(56).named).toBe(false);
  });

  it('always leaves room to draw at least one row', () => {
    for (let size = 30; size <= 200; size += 1) {
      expect(text(size).rows).toBeGreaterThanOrEqual(1);
    }
  });

  it('never leaves the figure wider than the circle it sits in', () => {
    // The longest figure the app draws: a lakh with separators.
    for (let size = 56; size <= 200; size += 2) {
      const { amountSize } = text(size);
      expect(widthOf(LAKH, amountSize)).toBeLessThanOrEqual(textWidth(size) + 0.5);
    }
  });

  it('leaves a short figure at full size, and only shrinks a long one', () => {
    // A bubble that would have been forced down to fit six figures should
    // not pay for them when it is only showing three.
    expect(text(80, '\u20b9199').amountSize).toBeGreaterThan(
      text(80, LAKH).amountSize,
    );
  });

  it('pads symmetrically, so the text stays centred', () => {
    const { pad } = text(123);
    expect(pad).toBeGreaterThan(0);
    expect(123 - pad * 2).toBeCloseTo(123 * 0.707, 5);
  });
});
