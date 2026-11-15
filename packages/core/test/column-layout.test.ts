import { describe, expect, it } from 'vitest';
import { columnWidthMm, layoutScore, maxSourceSpan, moveColumnTile, packColumns, validateColumnLayout, type ColumnItem } from '../src/index.js';

const slip = (id: string, heightMm: number): ColumnItem => ({
  id, widthPx: 1000, heightPx: Math.round((heightMm - 5) * 1000 / columnWidthMm(2)),
});

describe('column packing', () => {
  it('backfills an earlier page without moving existing receipts', () => {
    const first = [slip('a', 200), slip('b', 180), slip('c', 180)];
    const before = packColumns(first);
    expect(before.pageCount).toBe(2);
    const after = packColumns([...first, slip('d', 70)], 2, before);
    expect(after.tiles.find((tile) => tile.receiptId === 'd')).toMatchObject({ pageIndex: 0, columnIndex: 0 });
    for (const tile of before.tiles) {
      expect(after.tiles.find((next) => next.receiptId === tile.receiptId)).toMatchObject({
        pageIndex: tile.pageIndex, columnIndex: tile.columnIndex, xMm: tile.xMm, yMm: tile.yMm,
      });
    }
    validateColumnLayout(after, [...first, slip('d', 70)]);
  });

  it('supports one to three columns without overlap and removes empty pages', () => {
    const items = Array.from({ length: 7 }, (_, i) => slip(`r${i}`, 115));
    for (const columns of [1, 2, 3] as const) {
      const layout = packColumns(items, columns);
      expect(layout.tiles).toHaveLength(items.length);
      expect(new Set(layout.tiles.map((tile) => `${tile.pageIndex}:${tile.columnIndex}:${tile.yMm}`)).size).toBe(items.length);
      validateColumnLayout(layout, items);
    }
    const layout = packColumns(items);
    const reduced = packColumns(items.slice(0, 1), 2, layout);
    expect(reduced.pageCount).toBe(1);
    validateColumnLayout(reduced, items.slice(0, 1));
  });

  it('improves a manually spread document only after an explicit repack', () => {
    const items = [slip('a', 120), slip('b', 120), slip('c', 120)];
    const compact = packColumns(items);
    const spread = moveColumnTile(compact, 'a', 1, { pageIndex: compact.pageCount, columnIndex: 0, index: 0 });
    expect(spread.pageCount).toBeGreaterThan(compact.pageCount);
    expect(layoutScore(compact)[0]).toBeLessThan(layoutScore(spread)[0]);
    validateColumnLayout(spread, items);
  });

  it('uses OCR gaps for continuation and refuses unsafe or missing breaks', () => {
    const long: ColumnItem = { id: 'long', widthPx: 600, heightPx: 6000 };
    expect(maxSourceSpan(long, 2)).toBeLessThan(1);
    expect(packColumns([long]).needsBreak).toEqual(['long']);
    const lines = Array.from({ length: 30 }, (_, i) => ({ top: i / 30 + 0.003, bottom: i / 30 + 0.022 }));
    const automatic = packColumns([{ ...long, lines }]);
    expect(automatic.needsBreak).toEqual([]);
    expect(automatic.tiles.length).toBeGreaterThan(1);
    validateColumnLayout(automatic, [{ ...long, lines }]);
    const manual = packColumns([{ ...long, breaks: [0.25, 0.5, 0.75] }]);
    expect(manual.needsBreak).toEqual([]);
    expect(packColumns([{ ...long, lines, breaks: [0.01, 0.5, 0.75] }]).needsBreak).toEqual(['long']);
  });

  it('moves between pages and rejects overlapping or incomplete saved layouts', () => {
    const items = [slip('a', 120), slip('b', 120)];
    const original = packColumns(items);
    const moved = moveColumnTile(original, 'b', 1, { pageIndex: 1, columnIndex: 1, index: 0 });
    expect(moved.tiles.find((tile) => tile.receiptId === 'b')).toMatchObject({ pageIndex: 1, columnIndex: 1 });
    validateColumnLayout(moved, items);
    const overlap = { ...moved, tiles: moved.tiles.map((tile) => tile.receiptId === 'b' ? { ...tile, pageIndex: 0, columnIndex: 0, xMm: 10, yMm: 10 } : tile) };
    expect(() => validateColumnLayout(overlap, items)).toThrow();
    expect(() => validateColumnLayout({ ...moved, tiles: moved.tiles.slice(1) }, items)).toThrow();
  });

  it('spills a displaced receipt into a valid column after a crowded drop', () => {
    const items = [slip('a', 200), slip('b', 180), slip('c', 180), slip('d', 70)];
    const layout = packColumns(items);
    const moved = moveColumnTile(layout, 'c', 1, { pageIndex: 0, columnIndex: 0, index: 0 });
    expect(moved.tiles).toHaveLength(items.length);
    validateColumnLayout(moved, items);
  });

  it('keeps a larger mixed document valid through packing and optimisation', () => {
    let seed = 19;
    const random = () => (seed = seed * 16807 % 2147483647) / 2147483647;
    const items = Array.from({ length: 60 }, (_, i) => slip(`r${i}`, 35 + Math.floor(random() * 180)));
    const packed = packColumns(items, 3);
    const optimised = packColumns(items, 3, undefined, true);
    validateColumnLayout(packed, items);
    validateColumnLayout(optimised, items);
    expect(optimised.pageCount).toBeLessThanOrEqual(packed.pageCount);
  });
});
