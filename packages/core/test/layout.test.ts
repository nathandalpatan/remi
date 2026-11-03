import { describe, expect, it } from 'vitest';
import { A4_PORTRAIT, guessPrintWidthMm, packReceipts, type Layout, type Tile } from '../src/index.js';

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
    expect(tile.widthMm).toBeGreaterThanOrEqual(spec.minReceiptWidthMm);
    expect(tile.xMm).toBeGreaterThanOrEqual(spec.marginMm - 1e-6);
    expect(tile.yMm).toBeGreaterThanOrEqual(spec.marginMm - 1e-6);
    expect(tile.xMm + tile.widthMm).toBeLessThanOrEqual(spec.widthMm - spec.marginMm + 1e-6);
    expect(tile.yMm + tile.heightMm).toBeLessThanOrEqual(spec.heightMm - spec.marginMm + 1e-6);
    expect(tile.pageIndex).toBeLessThan(layout.pageCount);
  }
  layout.tiles.forEach((a, i) =>
    layout.tiles.slice(i + 1).forEach((b) => expect(overlaps(a, b)).toBe(false)),
  );
}

describe('guessPrintWidthMm', () => {
  it('prints tall strips as 80 mm till slips and page-shaped photos at full width', () => {
    expect(guessPrintWidthMm(600, 1800)).toBe(80);
    expect(guessPrintWidthMm(1000, 1414)).toBe(190); // A4 invoice
    expect(guessPrintWidthMm(1400, 1000)).toBe(190); // landscape
  });

  it('never goes below the minimum width', () => {
    expect(guessPrintWidthMm(600, 1800, { ...A4_PORTRAIT, minReceiptWidthMm: 90 })).toBe(90);
  });
});

describe('packReceipts', () => {
  it('places till slips side by side', () => {
    // 600x1200 px -> 80 mm wide, 160 mm image + 5 mm label.
    const layout = packReceipts([
      { id: 'a', widthPx: 600, heightPx: 1200 },
      { id: 'b', widthPx: 600, heightPx: 1200 },
    ]);
    expect(layout.pageCount).toBe(1);
    expect(layout.tiles.map((t) => [t.xMm, t.yMm, t.widthMm])).toEqual([
      [10, 10, 80],
      [95, 10, 80],
    ]);
    expectValid(layout);
  });

  it('mixes a full-width invoice with slips on one page', () => {
    // Invoice: 190 x (190 * 0.5) = 95 mm image. Slips fill the space below it.
    const layout = packReceipts([
      { id: 'invoice', widthPx: 2000, heightPx: 1000 },
      { id: 'slip1', widthPx: 600, heightPx: 1200 },
      { id: 'slip2', widthPx: 600, heightPx: 1200 },
    ]);
    expect(layout.pageCount).toBe(1);
    const invoice = layout.tiles.find((t) => t.receiptId === 'invoice')!;
    expect(invoice.widthMm).toBe(190);
    expect(invoice.yMm).toBe(10);
    expectValid(layout);
  });

  it('uses the width the user chose, kept within the page', () => {
    const layout = packReceipts([
      { id: 'a', widthPx: 1000, heightPx: 1000, widthMm: 100 },
      { id: 'b', widthPx: 1000, heightPx: 1000, widthMm: 500 },
      { id: 'c', widthPx: 1000, heightPx: 1000, widthMm: 10 },
    ]);
    const widthOf = (id: string) => layout.tiles.find((t) => t.receiptId === id)!.widthMm;
    expect([widthOf('a'), widthOf('b'), widthOf('c')]).toEqual([100, 190, 60]);
    expectValid(layout);
  });

  it('splits a receipt taller than a page into equal parts', () => {
    // 600x6000 px -> 80 mm wide, 800 mm image; max image height 272 mm -> 3 parts.
    const layout = packReceipts([{ id: 'long', widthPx: 600, heightPx: 6000 }]);
    expect(layout.tiles.map((t) => [t.part, t.partCount])).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    expect(layout.tiles[0]!.imageHeightMm).toBeCloseTo(800 / 3);
    expect(layout.tiles.map((t) => t.sourceTop)).toEqual([0, 1 / 3, 2 / 3]);
    // Two 80 mm parts fit side by side in 190 mm; the third starts a page.
    expect(layout.pageCount).toBe(2);
    expectValid(layout);
  });

  it('keeps pinned tiles where the user put them and packs the rest around them', () => {
    const layout = packReceipts([
      { id: 'a', widthPx: 600, heightPx: 1200 },
      { id: 'b', widthPx: 600, heightPx: 1200, placements: [{ part: 1, pageIndex: 0, xMm: 120, yMm: 100 }] },
    ]);
    const [a, b] = layout.tiles;
    expect(b).toMatchObject({ xMm: 120, yMm: 100, pinned: true });
    expect(a!.pinned).toBe(false);
    expectValid(layout);
  });

  it('packs a pinned tile automatically when its placement no longer fits', () => {
    const pin = { part: 1, pageIndex: 0, xMm: 10, yMm: 10 };
    const layout = packReceipts([
      { id: 'a', widthPx: 600, heightPx: 1200, placements: [pin] },
      { id: 'b', widthPx: 600, heightPx: 1200, placements: [pin] }, // clashes with a
      { id: 'c', widthPx: 600, heightPx: 1200, placements: [{ ...pin, xMm: 150 }] }, // off the page
    ]);
    expect(layout.tiles.map((t) => t.pinned)).toEqual([true, false, false]);
    expectValid(layout);
  });

  it('drops pages left empty by pins', () => {
    const layout = packReceipts([
      { id: 'a', widthPx: 600, heightPx: 1200, placements: [{ part: 1, pageIndex: 1_000_000, xMm: 10, yMm: 10 }] },
    ]);
    expect(layout.pageCount).toBe(1);
    expect(layout.tiles[0]).toMatchObject({ pageIndex: 0, pinned: true });
  });

  it('never overlaps or overflows across many mixed receipts', () => {
    let seed = 42;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const items = Array.from({ length: 40 }, (_, i) => ({
      id: `r${i}`,
      widthPx: 500 + Math.floor(random() * 1500),
      heightPx: 300 + Math.floor(random() * 4000),
    }));
    const layout = packReceipts(items);
    expectValid(layout);
    expect(new Set(layout.tiles.map((t) => t.receiptId)).size).toBe(40);
  });

  it('reports effective print DPI', () => {
    // 80 mm = 3.15 in, so 945 px wide is ~300 DPI.
    const [tile] = packReceipts([{ id: 'r', widthPx: 945, heightPx: 1890 }]).tiles;
    expect(tile!.effectiveDpi).toBeCloseTo(300, 0);
  });

  it('rejects an invalid image size and an impossible page', () => {
    expect(() => packReceipts([{ id: 'r', widthPx: 0, heightPx: 10 }])).toThrow(RangeError);
    expect(() => packReceipts([], { ...A4_PORTRAIT, minReceiptWidthMm: 300 })).toThrow(RangeError);
  });
});
