/**
 * Packs receipt photos onto as few pages as possible without shrinking them below a
 * legible width.
 *
 * Receipts are tall, narrow strips, so the page is divided into equal-width columns
 * and every receipt is printed at the column width. That keeps text at a consistent,
 * readable size and turns the 2D problem into 1D bin packing: each column is a bin
 * of fixed height, and each receipt is an item whose height follows from its aspect
 * ratio. A receipt taller than a column is cut into equal parts.
 *
 * Bins are filled with first-fit decreasing: place the tallest pieces first, each in
 * the first column with room. It is simple, fast, and uses at most 11/9 of the
 * optimal number of columns (plus a small constant).
 */

const MM_PER_INCH = 25.4;
// Parts of a split receipt are sized to exactly fill a column; float error must not
// push them into the next one.
const EPSILON_MM = 1e-6;

export interface PageSpec {
  widthMm: number;
  heightMm: number;
  marginMm: number;
  /** Space between columns and between receipts in a column. */
  gapMm: number;
  /** Narrowest a receipt may be printed. ~60 mm keeps till-roll text readable. */
  minColumnWidthMm: number;
  /** Space above each receipt for its number, which maps it to the cover page row. */
  labelHeightMm: number;
}

export const A4_PORTRAIT: PageSpec = {
  widthMm: 210,
  heightMm: 297,
  marginMm: 10,
  gapMm: 5,
  minColumnWidthMm: 60,
  labelHeightMm: 5,
};

export interface LayoutItem {
  id: string;
  widthPx: number;
  heightPx: number;
}

/** One placed piece of a receipt. Coordinates are in mm from the page's top-left. */
export interface Tile {
  receiptId: string;
  /** 1-based position in the input; printed on the page and on the cover sheet. */
  number: number;
  /** 1-based part index; `partCount` > 1 means the receipt was split. */
  part: number;
  partCount: number;
  pageIndex: number;
  xMm: number;
  yMm: number;
  widthMm: number;
  /** Includes the label. */
  heightMm: number;
  imageHeightMm: number;
  /** Vertical slice of the source photo shown in this tile, as fractions 0..1 from the top. */
  sourceTop: number;
  sourceBottom: number;
  /** Below ~150 the print will look soft; worth warning the user at capture time. */
  effectiveDpi: number;
}

export interface Layout {
  spec: PageSpec;
  columnsPerPage: number;
  columnWidthMm: number;
  pageCount: number;
  tiles: Tile[];
}

type Piece = Omit<Tile, 'pageIndex' | 'xMm' | 'yMm' | 'widthMm'>;

interface Column {
  usedMm: number;
  pieces: Piece[];
}

export function packReceipts(items: LayoutItem[], spec: PageSpec = A4_PORTRAIT): Layout {
  const usableWidth = spec.widthMm - 2 * spec.marginMm;
  const usableHeight = spec.heightMm - 2 * spec.marginMm;
  const maxImageHeight = usableHeight - spec.labelHeightMm;
  const columnsPerPage = Math.floor(
    (usableWidth + spec.gapMm) / (spec.minColumnWidthMm + spec.gapMm),
  );
  if (columnsPerPage < 1 || maxImageHeight <= 0) {
    throw new RangeError('Page is too small for the minimum column width');
  }
  // Widen columns to use the leftover width: bigger print, same number of columns.
  const columnWidthMm = (usableWidth - spec.gapMm * (columnsPerPage - 1)) / columnsPerPage;

  const pieces = items.flatMap((item, index) =>
    splitIntoPieces(item, index + 1, columnWidthMm, maxImageHeight, spec.labelHeightMm),
  );

  const byHeightDesc = [...pieces].sort(
    (a, b) => b.heightMm - a.heightMm || a.number - b.number || a.part - b.part,
  );
  const columns: Column[] = [];
  for (const piece of byHeightDesc) {
    let column = columns.find(
      (c) => c.usedMm + spec.gapMm + piece.heightMm <= usableHeight + EPSILON_MM,
    );
    if (!column) {
      // Starting at -gap means the first piece in a column adds no gap above it.
      column = { usedMm: -spec.gapMm, pieces: [] };
      columns.push(column);
    }
    column.usedMm += spec.gapMm + piece.heightMm;
    column.pieces.push(piece);
  }

  const tiles = columns.flatMap((column, columnIndex) => {
    // Within a column, show receipts in number order so the page reads naturally.
    column.pieces.sort((a, b) => a.number - b.number || a.part - b.part);
    const xMm = spec.marginMm + (columnIndex % columnsPerPage) * (columnWidthMm + spec.gapMm);
    const pageIndex = Math.floor(columnIndex / columnsPerPage);
    let yMm = spec.marginMm;
    return column.pieces.map((piece): Tile => {
      const tile = { ...piece, pageIndex, xMm, yMm, widthMm: columnWidthMm };
      yMm += piece.heightMm + spec.gapMm;
      return tile;
    });
  });

  return {
    spec,
    columnsPerPage,
    columnWidthMm,
    pageCount: Math.ceil(columns.length / columnsPerPage),
    tiles,
  };
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
  // Equal parts look better than one full column followed by a stub.
  const partHeight = imageHeight / partCount;
  const effectiveDpi = item.widthPx / (widthMm / MM_PER_INCH);
  return Array.from({ length: partCount }, (_, i) => ({
    receiptId: item.id,
    number,
    part: i + 1,
    partCount,
    heightMm: labelHeight + partHeight,
    imageHeightMm: partHeight,
    sourceTop: i / partCount,
    sourceBottom: (i + 1) / partCount,
    effectiveDpi,
  }));
}
