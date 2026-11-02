import { collides } from './free-space.js';
import { printableBounds, type Layout, type TilePlacement } from './layout.js';

export type DropResult = { ok: true; placement: TilePlacement } | { ok: false; reason: 'overlap' };

/**
 * Checks where a dragged tile can be dropped. The drop is pulled back inside the
 * margins, and refused if it would overlap or crowd another pinned tile, so the app
 * can snap the tile back. `pageIndex` may equal `layout.pageCount` to start a new page.
 *
 * On success, save `placement` in the receipt's `placements` (replacing the entry for
 * the same part) and pack again; the other unpinned receipts flow around it.
 */
export function dropTile(
  layout: Layout,
  receiptId: string,
  part: number,
  target: { pageIndex: number; xMm: number; yMm: number },
): DropResult {
  const tile = layout.tiles.find((t) => t.receiptId === receiptId && t.part === part);
  if (!tile) throw new RangeError(`No tile for receipt ${receiptId} part ${part}`);
  if (!Number.isInteger(target.pageIndex) || target.pageIndex < 0 || target.pageIndex > layout.pageCount) {
    throw new RangeError(`Page ${target.pageIndex} does not exist`);
  }

  const bounds = printableBounds(layout.spec);
  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
  const rect = {
    xMm: clamp(target.xMm, bounds.left, bounds.right - tile.widthMm),
    yMm: clamp(target.yMm, bounds.top, bounds.bottom - tile.heightMm),
    widthMm: tile.widthMm,
    heightMm: tile.heightMm,
  };
  // Only pinned tiles block: unpinned ones are repacked around the drop.
  const blocked = layout.tiles.some(
    (other) =>
      other !== tile &&
      other.pinned &&
      other.pageIndex === target.pageIndex &&
      collides(rect, other, layout.spec.gapMm),
  );
  if (blocked) return { ok: false, reason: 'overlap' };
  return { ok: true, placement: { part, pageIndex: target.pageIndex, xMm: rect.xMm, yMm: rect.yMm } };
}
