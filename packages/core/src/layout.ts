/**
 * Packs receipt photos of different widths onto as few pages as possible.
 *
 * Each receipt prints at its own width: one the user chose, or a guess from the
 * photo's shape (a tall strip is a till slip, anything else is page-shaped). Its
 * height follows from its aspect ratio; a receipt taller than a page is cut into
 * equal parts instead of being shrunk.
 *
 * Tiles the user has dragged into place are placed first and stay put. The rest are
 * packed largest first, each into the top-most, then left-most free spot on the first
 * page with room (see free-space.ts).
 */
import { collides, findFreeSpot, isInside, type Bounds, type Rect } from './free-space.js';

const MM_PER_INCH = 25.4;
/** Photos at least this many times taller than wide are treated as till-roll slips. */
const TILL_SLIP_MIN_ASPECT = 1.6;
/** Common till roll width; 57 mm rolls print at the minimum width instead. */
const TILL_SLIP_WIDTH_MM = 80;

export interface PageSpec {
  widthMm: number;
  heightMm: number;
  marginMm: number;
  /** Space kept between receipts. */
  gapMm: number;
  /** Narrowest a receipt may be printed. ~60 mm keeps till-roll text readable. */
  minReceiptWidthMm: number;
  /** Space above each receipt for its number, which maps it to the cover page row. */
  labelHeightMm: number;
}

export const A4_PORTRAIT: PageSpec = {
  widthMm: 210,
  heightMm: 297,
  marginMm: 10,
  gapMm: 5,
  minReceiptWidthMm: 60,
  labelHeightMm: 5,
};

/** Where the user dragged one tile; `xMm`/`yMm` are its top-left corner, label included. */
export interface TilePlacement {
  part: number;
  pageIndex: number;
  xMm: number;
  yMm: number;
}

export interface LayoutItem {
  id: string;
  widthPx: number;
  heightPx: number;
  /** Print width chosen by the user; absent or null means guess from the shape. */
  widthMm?: number | null;
  placements?: TilePlacement[];
}

/** One placed piece of a receipt. Coordinates are in mm from the page's top-left. */
export interface Tile extends Rect {
  receiptId: string;
  /** 1-based position in the input; printed on the page and on the cover sheet. */
  number: number;
  /** 1-based part index; `partCount` > 1 means the receipt was split. */
  part: number;
  partCount: number;
  pageIndex: number;
  /** `heightMm` includes the label; this is the photo slice alone. */
  imageHeightMm: number;
  /** Vertical slice of the source photo shown in this tile, as fractions 0..1 from the top. */
  sourceTop: number;
  sourceBottom: number;
  /** Below ~150 the print will look soft; worth warning the user at capture time. */
  effectiveDpi: number;
  /** True when the tile sits where the user dragged it. */
  pinned: boolean;
}

export interface Layout {
  spec: PageSpec;
  pageCount: number;
  tiles: Tile[];
}

type Piece = Omit<Tile, 'pageIndex' | 'xMm' | 'yMm' | 'pinned'>;

export function printableBounds(spec: PageSpec): Bounds {
  return {
    left: spec.marginMm,
    top: spec.marginMm,
    right: spec.widthMm - spec.marginMm,
    bottom: spec.heightMm - spec.marginMm,
  };
}

/** The width a receipt prints at before the user resizes it. */
export function guessPrintWidthMm(widthPx: number, heightPx: number, spec: PageSpec = A4_PORTRAIT): number {
  const usableWidth = spec.widthMm - 2 * spec.marginMm;
  const guess = heightPx / widthPx >= TILL_SLIP_MIN_ASPECT ? TILL_SLIP_WIDTH_MM : usableWidth;
  return Math.min(Math.max(guess, spec.minReceiptWidthMm), usableWidth);
}

export function packReceipts(items: LayoutItem[], spec: PageSpec = A4_PORTRAIT): Layout {
  const bounds = printableBounds(spec);
  const usableWidth = bounds.right - bounds.left;
  const maxImageHeight = bounds.bottom - bounds.top - spec.labelHeightMm;
  if (spec.minReceiptWidthMm > usableWidth || maxImageHeight <= 0) {
    throw new RangeError('Page is too small for the minimum receipt width');
  }

  const pages: Tile[][] = [];
  const place = (piece: Piece, pageIndex: number, xMm: number, yMm: number, pinned: boolean) => {
    (pages[pageIndex] ??= []).push({ ...piece, pageIndex, xMm, yMm, pinned });
  };

  const unplaced: Piece[] = [];
  items.forEach((item, index) => {
    const widthMm = Math.min(
      Math.max(item.widthMm ?? guessPrintWidthMm(item.widthPx, item.heightPx, spec), spec.minReceiptWidthMm),
      usableWidth,
    );
    for (const piece of splitIntoPieces(item, index + 1, widthMm, maxImageHeight, spec.labelHeightMm)) {
      const pin = item.placements?.find((p) => p.part === piece.part);
      if (pin && canPin(piece, pin, pages, bounds, spec.gapMm)) {
        place(piece, pin.pageIndex, pin.xMm, pin.yMm, true);
      } else {
        unplaced.push(piece);
      }
    }
  });

  const largestFirst = unplaced.sort(
    (a, b) => b.heightMm * b.widthMm - a.heightMm * a.widthMm || a.number - b.number || a.part - b.part,
  );
  for (const piece of largestFirst) {
    let pageIndex = 0;
    for (; ; pageIndex++) {
      const spot = findFreeSpot(bounds, pages[pageIndex] ?? [], piece.widthMm, piece.heightMm, spec.gapMm);
      if (spot) {
        place(piece, pageIndex, spot.xMm, spot.yMm, false);
        break;
      }
    }
  }

  // Pins can leave pages empty (e.g. earlier receipts deleted); drop them so the PDF has no blank pages.
  const used = pages.filter((page) => page.length > 0);
  return {
    spec,
    pageCount: used.length,
    tiles: used.flatMap((page, pageIndex) =>
      page.map((tile) => ({ ...tile, pageIndex })).sort((a, b) => a.number - b.number || a.part - b.part),
    ),
  };
}

function canPin(piece: Piece, pin: TilePlacement, pages: Tile[][], bounds: Bounds, gapMm: number): boolean {
  if (!Number.isInteger(pin.pageIndex) || pin.pageIndex < 0) return false;
  const rect = { xMm: pin.xMm, yMm: pin.yMm, widthMm: piece.widthMm, heightMm: piece.heightMm };
  return isInside(rect, bounds) && !(pages[pin.pageIndex] ?? []).some((t) => collides(rect, t, gapMm));
}

function splitIntoPieces(
  item: LayoutItem,
  number: number,
  widthMm: number,
  maxImageHeight: number,
  labelHeight: number,
): Piece[] {
  if (!(item.widthPx > 0 && item.heightPx > 0)) {
    throw new RangeError(`Receipt ${item.id} has an invalid image size`);
  }
  const imageHeight = (widthMm * item.heightPx) / item.widthPx;
  const partCount = Math.ceil(imageHeight / maxImageHeight);
  // Equal parts look better than one full page followed by a stub.
  const partHeight = imageHeight / partCount;
  const effectiveDpi = item.widthPx / (widthMm / MM_PER_INCH);
  return Array.from({ length: partCount }, (_, i) => ({
    receiptId: item.id,
    number,
    part: i + 1,
    partCount,
    widthMm,
    heightMm: labelHeight + partHeight,
    imageHeightMm: partHeight,
    sourceTop: i / partCount,
    sourceBottom: (i + 1) / partCount,
    effectiveDpi,
  }));
}
