/** Rectangle geometry for placing receipts on a page. All values are mm from the page's top-left. */

// Tiles are sized to fill space exactly; float error must not turn a fit into a clash.
const EPSILON_MM = 1e-6;

export interface Rect {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

/** The printable area of a page. */
export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function isInside(rect: Rect, bounds: Bounds): boolean {
  return (
    rect.xMm >= bounds.left - EPSILON_MM &&
    rect.yMm >= bounds.top - EPSILON_MM &&
    rect.xMm + rect.widthMm <= bounds.right + EPSILON_MM &&
    rect.yMm + rect.heightMm <= bounds.bottom + EPSILON_MM
  );
}

/** True when the rectangles overlap or are closer than `gapMm`. */
export function collides(a: Rect, b: Rect, gapMm: number): boolean {
  const reach = gapMm - EPSILON_MM;
  return (
    a.xMm < b.xMm + b.widthMm + reach &&
    b.xMm < a.xMm + a.widthMm + reach &&
    a.yMm < b.yMm + b.heightMm + reach &&
    b.yMm < a.yMm + a.heightMm + reach
  );
}

/**
 * Finds the top-most, then left-most position for a rectangle that keeps `gapMm` from
 * every occupied one. Candidates are the page's top-left corner and the right and
 * bottom edges of occupied rectangles ("bottom-left fill"), which is enough to pack
 * tightly without searching every millimetre.
 */
export function findFreeSpot(
  bounds: Bounds,
  occupied: Rect[],
  widthMm: number,
  heightMm: number,
  gapMm: number,
): { xMm: number; yMm: number } | null {
  const xs = [bounds.left, ...occupied.map((r) => r.xMm + r.widthMm + gapMm)].sort((a, b) => a - b);
  const ys = [bounds.top, ...occupied.map((r) => r.yMm + r.heightMm + gapMm)].sort((a, b) => a - b);
  for (const yMm of ys) {
    for (const xMm of xs) {
      const rect = { xMm, yMm, widthMm, heightMm };
      if (isInside(rect, bounds) && !occupied.some((r) => collides(rect, r, gapMm))) {
        return { xMm, yMm };
      }
    }
  }
  return null;
}
