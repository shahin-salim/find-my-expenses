/**
 * The bubble cluster on Home: circles that touch and never overlap.
 */

import { packCircles, type PackedCircle } from '../bubblePack';

/** How far apart two circles are, minus how far apart they must be. */
function clearance(a: PackedCircle<unknown>, b: PackedCircle<unknown>): number {
  return Math.hypot(a.x - b.x, a.y - b.y) - (a.r + b.r);
}

const radii = (values: number[]) => packCircles(values, (value) => value);

describe('packing the bubbles', () => {
  it('places nothing from nothing', () => {
    expect(packCircles([], () => 10)).toEqual({ circles: [], width: 0, height: 0 });
  });

  it('keeps one circle at its own size', () => {
    const pack = radii([40]);
    expect(pack.width).toBe(80);
    expect(pack.height).toBe(80);
  });

  it('never lets two circles overlap', () => {
    const pack = radii([50, 46, 33, 32, 24, 22, 21]);

    for (let i = 0; i < pack.circles.length; i += 1) {
      for (let j = i + 1; j < pack.circles.length; j += 1) {
        // Touching is the point; a millimetre of overlap is a drawing bug
        // that reads as one bubble eating another.
        expect(clearance(pack.circles[i]!, pack.circles[j]!)).toBeGreaterThan(-0.01);
      }
    }
  });

  it('leaves every circle resting against at least one other', () => {
    const pack = radii([50, 46, 33, 32, 24, 22, 21]);

    for (const circle of pack.circles) {
      const touches = pack.circles.some(
        (other) => other !== circle && clearance(circle, other) < 0.01,
      );
      expect(touches).toBe(true);
    }
  });

  describe('with a gap asked for', () => {
    const GAP = 6;
    const packed = () => packCircles([50, 46, 33, 32, 24, 22, 21], (r) => r, GAP);

    it('keeps the circles the size they were asked to be', () => {
      // The gap is made by padding while placing and then forgetting the
      // padding. A caller that asked for a radius of 50 draws 50.
      expect(packed().circles.map((circle) => circle.r)).toEqual([
        50, 46, 33, 32, 24, 22, 21,
      ]);
    });

    it('leaves at least that much air between every pair', () => {
      const pack = packed();
      for (let i = 0; i < pack.circles.length; i += 1) {
        for (let j = i + 1; j < pack.circles.length; j += 1) {
          expect(clearance(pack.circles[i]!, pack.circles[j]!)).toBeGreaterThan(
            GAP - 0.01,
          );
        }
      }
    });

    it('still has every circle resting against a neighbour', () => {
      const pack = packed();
      for (const circle of pack.circles) {
        const rests = pack.circles.some(
          (other) => other !== circle && clearance(circle, other) < GAP + 0.01,
        );
        expect(rests).toBe(true);
      }
    });

    it('reports a box that still holds every circle', () => {
      const pack = packed();
      for (const circle of pack.circles) {
        expect(circle.x - circle.r).toBeGreaterThanOrEqual(-0.01);
        expect(circle.y - circle.r).toBeGreaterThanOrEqual(-0.01);
        expect(circle.x + circle.r).toBeLessThanOrEqual(pack.width + 0.01);
        expect(circle.y + circle.r).toBeLessThanOrEqual(pack.height + 0.01);
      }
    });
  });

  it('fits every circle inside the box it reports', () => {
    const pack = radii([50, 46, 33, 32, 24, 22, 21]);

    for (const circle of pack.circles) {
      expect(circle.x - circle.r).toBeGreaterThanOrEqual(-0.01);
      expect(circle.y - circle.r).toBeGreaterThanOrEqual(-0.01);
      expect(circle.x + circle.r).toBeLessThanOrEqual(pack.width + 0.01);
      expect(circle.y + circle.r).toBeLessThanOrEqual(pack.height + 0.01);
    }
  });

  it('packs tightly enough to read as one cluster', () => {
    // Seven circles laid end to end would be seven diameters across. A
    // cluster has to be a great deal less than that, or it is a row with
    // gaps in it and the layout has not earned the arithmetic.
    const pack = radii([50, 46, 33, 32, 24, 22, 21]);
    expect(pack.width).toBeLessThan(5 * 50);
    expect(pack.height).toBeLessThan(5 * 50);
  });

  it('is the same arrangement every time it is asked', () => {
    // A layout that settles differently on each render would move under the
    // finger between a press starting and ending.
    const first = radii([50, 46, 33, 32, 24, 22, 21]);
    const second = radii([50, 46, 33, 32, 24, 22, 21]);
    expect(second).toEqual(first);
  });

  it('skips a circle with no size rather than stacking it at the origin', () => {
    const pack = radii([40, 0, 20]);
    expect(pack.circles).toHaveLength(2);
  });

  it('carries the item through, so the caller can tell them apart', () => {
    const slices = [{ key: 'food' }, { key: 'rent' }];
    const pack = packCircles(slices, () => 20);
    expect(pack.circles.map((circle) => circle.item.key)).toEqual(['food', 'rent']);
  });
});
