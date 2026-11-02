import { describe, expect, it } from 'vitest';
import { A4_PORTRAIT, packReceipts, type Layout, type Tile } from '../src/index.js';

function overlaps(a: Tile, b: Tile): boolean {
  return (
    a.pageIndex === b.pageIndex &&
    a.xMm < b.xMm + b.widthMm &&
    b.xMm < a.xMm + a.widthMm &&
    a.yMm < b.yMm + b.heightMm &&
    b.yMm < a.yMm + a.heightMm
  );
}

function expectValid(layout: Layout): void {
  const { spec } = layout;
  for (const tile of layout.tiles) {
    expect(tile.widthMm).toBeGreaterThanOrEqual(spec.minColumnWidthMm);
    expect(tile.xMm).toBeGreaterThanOrEqual(spec.marginMm);
    expect(tile.yMm).toBeGreaterThanOrEqual(spec.marginMm);
    expect(tile.xMm + tile.widthMm).toBeLessThanOrEqual(spec.widthMm - spec.marginMm + 1e-6);
    expect(tile.yMm + tile.heightMm).toBeLessThanOrEqual(spec.heightMm - spec.marginMm + 1e-6);
    expect(tile.pageIndex).toBeLessThan(layout.pageCount);
  }
  layout.tiles.forEach((a, i) =>
    layout.tiles.slice(i + 1).forEach((b) => expect(overlaps(a, b)).toBe(false)),
  );
}

describe('packReceipts', () => {
  it('fits three 60 mm columns on A4 with 10 mm margins and 5 mm gaps', () => {
    const layout = packReceipts([], A4_PORTRAIT);
    expect(layout.columnsPerPage).toBe(3);
    expect(layout.columnWidthMm).toBe(60);
    expect(layout.pageCount).toBe(0);
  });

  it('widens columns to use leftover page width', () => {
    const layout = packReceipts([], { ...A4_PORTRAIT, minColumnWidthMm: 55 });
    expect(layout.columnsPerPage).toBe(3);
    expect(layout.columnWidthMm).toBe(60);
  });

  it('stacks short receipts in one column before opening another', () => {
    // 600x600 px at 60 mm wide -> 60 mm image + 5 mm label = 65 mm; four fit in 277 mm.
    const items = Array.from({ length: 4 }, (_, i) => ({ id: `r${i}`, widthPx: 600, heightPx: 600 }));
    const layout = packReceipts(items);
    expect(new Set(layout.tiles.map((t) => t.xMm)).size).toBe(1);
    expect(layout.tiles.map((t) => t.number)).toEqual([1, 2, 3, 4]);
    expectValid(layout);
  });

  it('fills gaps in earlier columns with smaller receipts (first-fit decreasing)', () => {
    const items = [
      { id: 'tall1', widthPx: 600, heightPx: 2000 }, // 205 mm tile
      { id: 'tall2', widthPx: 600, heightPx: 2000 },
      { id: 'tall3', widthPx: 600, heightPx: 2000 },
      { id: 'short', widthPx: 600, heightPx: 500 }, // 55 mm tile: fits under a tall one
    ];
    const layout = packReceipts(items);
    expect(layout.pageCount).toBe(1);
    expectValid(layout);
  });

  it('splits a receipt taller than a column into equal parts', () => {
    // 600x6000 px -> 600 mm image, max image height 272 mm -> 3 parts of 200 mm.
    const layout = packReceipts([{ id: 'long', widthPx: 600, heightPx: 6000 }]);
    expect(layout.tiles).toHaveLength(3);
    expect(layout.tiles.map((t) => [t.part, t.partCount])).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    expect(layout.tiles[0]!.imageHeightMm).toBeCloseTo(200);
    expect(layout.tiles.map((t) => t.sourceTop)).toEqual([0, 1 / 3, 2 / 3]);
    expectValid(layout);
  });

  it('never overlaps or overflows across many mixed receipts', () => {
    let seed = 42;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const items = Array.from({ length: 40 }, (_, i) => ({
      id: `r${i}`,
      widthPx: 500 + Math.floor(random() * 400),
      heightPx: 300 + Math.floor(random() * 4000),
    }));
    const layout = packReceipts(items);
    expectValid(layout);
    expect(new Set(layout.tiles.map((t) => t.receiptId)).size).toBe(40);
  });

  it('reports effective print DPI', () => {
    const [tile] = packReceipts([{ id: 'r', widthPx: 709, heightPx: 709 }]).tiles;
    expect(tile!.effectiveDpi).toBeCloseTo(300, 0);
  });

  it('rejects an invalid image size and an impossible page', () => {
    expect(() => packReceipts([{ id: 'r', widthPx: 0, heightPx: 10 }])).toThrow(RangeError);
    expect(() => packReceipts([], { ...A4_PORTRAIT, minColumnWidthMm: 300 })).toThrow(RangeError);
  });
});
