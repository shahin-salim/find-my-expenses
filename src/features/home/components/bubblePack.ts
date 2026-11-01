/**
 * Arranging the bubbles on Home the way `screens/Home.png` draws them.
 *
 * The mockup is not a row of circles. The big one sits low and left, the
 * next tucks into the space above its shoulder, the small ones fill the gaps
 * underneath, and the whole thing reads as one cluster. A wrapping flex row
 * cannot make that shape: it lines circles up on a baseline and leaves a
 * band of empty card under every small one.
 *
 * So the positions are computed. Each circle after the first is placed a
 * fixed gap from one already on the plan, at whichever of those positions
 * leaves it closest to the middle of what is there so far and clear of
 * everything else. Greedy, deterministic, and with seven circles to place
 * it is a few thousand comparisons — not a physics simulation that settles
 * differently every render.
 */

export interface PackedCircle<T> {
  item: T;
  /** Centre, in whatever units the radii were given in. */
  x: number;
  y: number;
  r: number;
}

export interface Pack<T> {
  circles: Array<PackedCircle<T>>;
  /** The bounding box, with every circle inside it at x,y >= 0. */
  width: number;
  height: number;
}

/**
 * How many tangent points around each placed circle are tried.
 *
 * Every 5 degrees. Coarser leaves visible gaps where a circle could not
 * quite reach the angle that would have closed one; finer costs comparisons
 * and changes nothing you can see at this size.
 */
const ANGLES = 72;

/** Lets a circle rest exactly at its gap from another without counting as overlap. */
const TOUCHING = 0.001;

/**
 * Packs `items` into a cluster, largest first.
 *
 * The order given is the order placed, so callers should pass them biggest
 * first: placing a small circle early strands it in the middle of the
 * cluster, where the mockup has the big one.
 *
 * `gap` is the space left between neighbours, in the same units as the
 * radii. It is done by padding every circle by half of it while deciding
 * where things go, and then forgetting the padding: the circles come back
 * at their true size, so the caller draws what it asked for and the gap
 * falls out of the arithmetic rather than having to be subtracted later.
 */
export function packCircles<T>(
  items: T[],
  radiusOf: (item: T) => number,
  gap: number = 0,
): Pack<T> {
  const placed: Array<PackedCircle<T>> = [];
  const halo = Math.max(0, gap) / 2;
  /** The radius used for deciding where a circle fits, not for drawing it. */
  const reach = (circle: PackedCircle<T>) => circle.r + halo;

  for (const item of items) {
    const r = radiusOf(item);
    if (r <= 0) {
      continue;
    }

    if (placed.length === 0) {
      placed.push({ item, x: 0, y: 0, r });
      continue;
    }
    if (placed.length === 1) {
      // Nothing to be clever about with two: side by side, a gap apart.
      placed.push({ item, x: placed[0]!.x + placed[0]!.r + gap + r, y: 0, r });
      continue;
    }

    // The middle of the cluster so far, weighted by area so the big circles
    // decide where the middle is. Candidates are judged by how close they
    // sit to it, which is what keeps the shape round rather than letting it
    // grow off in whichever direction was tried first.
    let weight = 0;
    let cx = 0;
    let cy = 0;
    for (const circle of placed) {
      const area = circle.r * circle.r;
      weight += area;
      cx += circle.x * area;
      cy += circle.y * area;
    }
    cx /= weight;
    cy /= weight;

    let best: { x: number; y: number; distance: number } | null = null;
    for (const anchor of placed) {
      for (let step = 0; step < ANGLES; step += 1) {
        const angle = (step / ANGLES) * Math.PI * 2;
        const x = anchor.x + Math.cos(angle) * (reach(anchor) + r + halo);
        const y = anchor.y + Math.sin(angle) * (reach(anchor) + r + halo);

        const overlaps = placed.some(
          (circle) =>
            Math.hypot(circle.x - x, circle.y - y) < reach(circle) + r + halo - TOUCHING,
        );
        if (overlaps) {
          continue;
        }

        const distance = Math.hypot(x - cx, y - cy);
        if (best === null || distance < best.distance) {
          best = { x, y, distance };
        }
      }
    }

    // There is always a free tangent point on the outside of the cluster, so
    // this only guards against a degenerate radius.
    placed.push(
      best === null
        ? { item, x: cx, y: cy + r, r }
        : { item, x: best.x, y: best.y, r },
    );
  }

  if (placed.length === 0) {
    return { circles: [], width: 0, height: 0 };
  }

  const minX = Math.min(...placed.map((circle) => circle.x - circle.r));
  const minY = Math.min(...placed.map((circle) => circle.y - circle.r));
  const maxX = Math.max(...placed.map((circle) => circle.x + circle.r));
  const maxY = Math.max(...placed.map((circle) => circle.y + circle.r));

  return {
    circles: placed.map((circle) => ({
      ...circle,
      x: circle.x - minX,
      y: circle.y - minY,
    })),
    width: maxX - minX,
    height: maxY - minY,
  };
}
