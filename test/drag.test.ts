import { describe, expect, it } from 'vitest';
import { dropTile, packReceipts } from '../src/index.js';

const slip = (id: string, extra = {}) => ({ id, widthPx: 600, heightPx: 1200, ...extra }); // 80 x 165 mm tile

describe('dropTile', () => {
  it('returns placements for every receipt after a drop on a free spot', () => {
    const layout = packReceipts([slip('a'), slip('b')]);
    expect(dropTile(layout, 'a', 1, { pageIndex: 0, xMm: 50, yMm: 100 })).toEqual({
      ok: true,
      placements: { a: [{ part: 1, pageIndex: 0, xMm: 50, yMm: 100 }], b: [] },
    });
  });

  it('pulls a drop back inside the margins', () => {
    const layout = packReceipts([slip('a')]);
    const result = dropTile(layout, 'a', 1, { pageIndex: 0, xMm: 500, yMm: -20 });
    expect(result).toEqual({ ok: true, placements: { a: [{ part: 1, pageIndex: 0, xMm: 120, yMm: 10 }] } });
  });

  it('lands next to a pin whose saved page was renumbered', () => {
    // A was saved on page index 2; page index 1 emptied out, so A shows on index 1.
    const items = [slip('C'), slip('A', { placements: [{ part: 1, pageIndex: 2, xMm: 10, yMm: 10 }] })];
    const result = dropTile(packReceipts(items), 'C', 1, { pageIndex: 1, xMm: 110, yMm: 10 });
    if (!result.ok) throw new Error('drop refused');
    const repacked = packReceipts(items.map((item) => ({ ...item, placements: result.placements[item.id]! })));
    expect(repacked.tiles.map((t) => [t.receiptId, t.pageIndex])).toEqual([
      ['C', 0],
      ['A', 0],
    ]);
  });

  it('refuses to drop onto a pinned tile but ignores unpinned ones', () => {
    const layout = packReceipts([
      slip('a', { placements: [{ part: 1, pageIndex: 0, xMm: 10, yMm: 10 }] }),
      slip('b'),
    ]);
    expect(dropTile(layout, 'b', 1, { pageIndex: 0, xMm: 50, yMm: 50 })).toEqual({ ok: false, reason: 'overlap' });

    const unpinned = packReceipts([slip('a'), slip('b')]);
    expect(dropTile(unpinned, 'b', 1, { pageIndex: 0, xMm: 10, yMm: 10 }).ok).toBe(true);
  });

  it('round-trips: packing with the returned placement keeps the tile there', () => {
    const layout = packReceipts([slip('a'), slip('b')]);
    const result = dropTile(layout, 'b', 1, { pageIndex: 1, xMm: 60, yMm: 40 });
    if (!result.ok) throw new Error('drop refused');
    const repacked = packReceipts([slip('a'), slip('b', { placements: result.placements['b']! })]);
    expect(repacked.tiles.find((t) => t.receiptId === 'b')).toMatchObject({ pageIndex: 1, xMm: 60, yMm: 40, pinned: true });
  });

  it('rejects unknown tiles and pages', () => {
    const layout = packReceipts([slip('a')]);
    expect(() => dropTile(layout, 'zz', 1, { pageIndex: 0, xMm: 0, yMm: 0 })).toThrow(RangeError);
    expect(() => dropTile(layout, 'a', 1, { pageIndex: 5, xMm: 0, yMm: 0 })).toThrow(RangeError);
  });
});
