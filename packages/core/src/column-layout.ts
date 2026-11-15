import { A4_PORTRAIT, type PageSpec, type Tile } from './layout.js';

export type ColumnCount = 1 | 2 | 3;
export type TextLine = { top: number; bottom: number };
export type ColumnItem = {
  id: string;
  widthPx: number;
  heightPx: number;
  lines?: TextLine[] | undefined;
  breaks?: number[] | undefined;
};
export type ColumnTile = Tile & { columnIndex: number };
export type ColumnLayout = {
  version: 1;
  columnCount: ColumnCount;
  spec: PageSpec;
  pageCount: number;
  tiles: ColumnTile[];
  needsBreak: string[];
};

const EPS = 1e-6;
const MM_PER_INCH = 25.4;

export function columnWidthMm(columns: ColumnCount, spec: PageSpec = A4_PORTRAIT): number {
  const width = (spec.widthMm - 2 * spec.marginMm - (columns - 1) * spec.gapMm) / columns;
  if (width + EPS < spec.minReceiptWidthMm) throw new RangeError('Columns are narrower than the readable receipt width');
  return width;
}

export function maxSourceSpan(item: ColumnItem, columns: ColumnCount, spec: PageSpec = A4_PORTRAIT): number {
  if (!(item.widthPx > 0 && item.heightPx > 0)) throw new RangeError(`Receipt ${item.id} has an invalid image size`);
  return ((spec.heightMm - 2 * spec.marginMm - spec.labelHeightMm) * item.widthPx) /
    (columnWidthMm(columns, spec) * item.heightPx);
}

function safeBreak(value: number, lines: TextLine[]): boolean {
  return Number.isFinite(value) && value > EPS && value < 1 - EPS &&
    lines.every((line) => value <= line.top - EPS || value >= line.bottom + EPS);
}

function segments(item: ColumnItem, columns: ColumnCount, spec: PageSpec): number[] | null {
  const span = maxSourceSpan(item, columns, spec);
  const lines = (item.lines ?? []).filter((line) =>
    Number.isFinite(line.top) && Number.isFinite(line.bottom) && line.top >= 0 && line.bottom <= 1 && line.top < line.bottom,
  ).sort((a, b) => a.top - b.top);
  if (item.breaks?.length) {
    const boundaries = [0, ...item.breaks, 1];
    if (boundaries.some((end, i) => i > 0 && (end - boundaries[i - 1]! > span + EPS || end <= boundaries[i - 1]! + EPS)) ||
      item.breaks.some((value) => !safeBreak(value, lines))) return null;
    return boundaries;
  }
  if (span >= 1 - EPS) return [0, 1];
  if (!lines.length) return null;
  const candidates: number[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const gap = lines[i + 1]!.top - lines[i]!.bottom;
    if (gap >= 0.004) candidates.push((lines[i]!.bottom + lines[i + 1]!.top) / 2);
  }
  const result = [0];
  while (1 - result[result.length - 1]! > span + EPS) {
    const start = result[result.length - 1]!;
    const next = candidates.filter((value) => value > start + EPS && value <= start + span + EPS).at(-1);
    if (next === undefined) return null;
    result.push(next);
  }
  return [...result, 1];
}

type Piece = Omit<ColumnTile, 'pageIndex' | 'columnIndex' | 'xMm' | 'yMm' | 'pinned'>;

function makePieces(item: ColumnItem, number: number, columns: ColumnCount, spec: PageSpec): Piece[] | null {
  const bounds = segments(item, columns, spec);
  if (!bounds) return null;
  const widthMm = columnWidthMm(columns, spec);
  return bounds.slice(1).map((bottom, index) => {
    const top = bounds[index]!;
    const imageHeightMm = widthMm * item.heightPx / item.widthPx * (bottom - top);
    return {
      receiptId: item.id, number, part: index + 1, partCount: bounds.length - 1,
      widthMm, heightMm: spec.labelHeightMm + imageHeightMm, imageHeightMm,
      sourceTop: top, sourceBottom: bottom,
      effectiveDpi: item.widthPx / (widthMm / MM_PER_INCH),
    };
  });
}

function key(tile: Pick<ColumnTile, 'receiptId' | 'part'>): string { return `${tile.receiptId}:${tile.part}`; }

function groupsFor(columns: ColumnCount, count: number): ColumnTile[][][] {
  return Array.from({ length: count }, () => Array.from({ length: columns }, () => []));
}

function fit(groups: ColumnTile[][][], piece: Piece, columns: ColumnCount, spec: PageSpec): { page: number; column: number } {
  const capacity = spec.heightMm - 2 * spec.marginMm;
  let bestPage = -1;
  let bestColumn = -1;
  let bestRemaining = Infinity;
  groups.forEach((page, pageIndex) => page.forEach((column, columnIndex) => {
    const used = column.reduce((height, tile) => height + tile.heightMm, 0) + Math.max(0, column.length - 1) * spec.gapMm;
    const remaining = capacity - used - (column.length ? spec.gapMm : 0) - piece.heightMm;
    if (remaining >= -EPS && (remaining < bestRemaining - EPS ||
      (Math.abs(remaining - bestRemaining) <= EPS && pageIndex < bestPage))) {
      bestPage = pageIndex;
      bestColumn = columnIndex;
      bestRemaining = remaining;
    }
  }));
  if (bestPage >= 0) return { page: bestPage, column: bestColumn };
  groups.push(Array.from({ length: columns }, () => []));
  return { page: groups.length - 1, column: 0 };
}

function finish(groups: ColumnTile[][][], columns: ColumnCount, spec: PageSpec, needsBreak: string[]): ColumnLayout {
  const used = groups.filter((page) => page.some((column) => column.length));
  const width = columnWidthMm(columns, spec);
  const tiles = used.flatMap((page, pageIndex) => page.flatMap((column, columnIndex) => {
    let yMm = spec.marginMm;
    return column.map((tile) => {
      const placed = { ...tile, pageIndex, columnIndex,
        xMm: spec.marginMm + columnIndex * (width + spec.gapMm), yMm };
      yMm += tile.heightMm + spec.gapMm;
      return placed;
    });
  }));
  return { version: 1, columnCount: columns, spec, pageCount: used.length, tiles, needsBreak };
}

export function packColumns(
  items: ColumnItem[], columns: ColumnCount = 2, previous?: ColumnLayout,
  optimise = false, spec: PageSpec = A4_PORTRAIT,
): ColumnLayout {
  columnWidthMm(columns, spec);
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new RangeError('Receipt IDs must be unique');
  const needsBreak: string[] = [];
  const pieces = items.flatMap((item, index) => {
    const parts = makePieces(item, index + 1, columns, spec);
    if (!parts) { needsBreak.push(item.id); return []; }
    return parts;
  });
  const old = !optimise && previous?.columnCount === columns ? previous : null;
  const groups = groupsFor(columns, old?.pageCount ?? 0);
  const pending = new Map(pieces.map((piece) => [key(piece), piece]));
  if (old) for (const tile of old.tiles) {
    const piece = pending.get(key(tile));
    if (!piece || tile.pageIndex >= groups.length || tile.columnIndex >= columns ||
      Math.abs(tile.heightMm - piece.heightMm) > EPS ||
      Math.abs(tile.sourceTop - piece.sourceTop) > EPS || Math.abs(tile.sourceBottom - piece.sourceBottom) > EPS) continue;
    groups[tile.pageIndex]![tile.columnIndex]!.push({ ...tile, ...piece });
    pending.delete(key(tile));
  }
  const queue = [...pending.values()];
  if (optimise) queue.sort((a, b) => b.heightMm - a.heightMm || a.number - b.number || a.part - b.part);
  for (const piece of queue) {
    const target = fit(groups, piece, columns, spec);
    groups[target.page]![target.column]!.push({ ...piece, pageIndex: target.page, columnIndex: target.column,
      xMm: 0, yMm: 0, pinned: false });
  }
  return finish(groups, columns, spec, needsBreak);
}

export function moveColumnTile(
  layout: ColumnLayout, receiptId: string, part: number,
  target: { pageIndex: number; columnIndex: number; index: number },
): ColumnLayout {
  if (!Number.isInteger(target.pageIndex) || target.pageIndex < 0 || target.pageIndex > layout.pageCount ||
      !Number.isInteger(target.columnIndex) || target.columnIndex < 0 || target.columnIndex >= layout.columnCount ||
      !Number.isInteger(target.index) || target.index < 0) throw new RangeError('Invalid destination');
  const groups = groupsFor(layout.columnCount, Math.max(layout.pageCount, target.pageIndex + 1));
  for (const tile of layout.tiles) groups[tile.pageIndex]![tile.columnIndex]!.push(tile);
  for (const page of groups) for (const column of page) column.sort((a, b) => a.yMm - b.yMm);
  const source = groups.flatMap((page) => page).find((column) => column.some((tile) => tile.receiptId === receiptId && tile.part === part));
  if (!source) throw new RangeError('Receipt tile does not exist');
  const index = source.findIndex((tile) => tile.receiptId === receiptId && tile.part === part);
  const [tile] = source.splice(index, 1);
  const destination = groups[target.pageIndex]![target.columnIndex]!;
  destination.splice(Math.min(target.index, destination.length), 0, { ...tile!, pinned: true });
  const overflow: ColumnTile[] = [];
  const capacity = layout.spec.heightMm - 2 * layout.spec.marginMm;
  for (const page of groups) for (const column of page) {
    while (column.reduce((sum, item) => sum + item.heightMm, 0) + Math.max(0, column.length - 1) * layout.spec.gapMm > capacity + EPS) {
      overflow.unshift(column.pop()!);
    }
  }
  for (const item of overflow) {
    const place = fit(groups, item, layout.columnCount, layout.spec);
    groups[place.page]![place.column]!.push(item);
  }
  return finish(groups, layout.columnCount, layout.spec, layout.needsBreak);
}

export function layoutScore(layout: ColumnLayout): [number, number] {
  const usedLast = layout.tiles.filter((tile) => tile.pageIndex === layout.pageCount - 1)
    .reduce((sum, tile) => sum + tile.heightMm, 0);
  return [layout.pageCount, usedLast];
}

export function validateColumnLayout(layout: ColumnLayout, items: ColumnItem[]): void {
  const expected = packColumns(items, layout.columnCount, undefined, true, layout.spec);
  if (layout.needsBreak.length || expected.needsBreak.length) throw new RangeError('A receipt needs a safe page break');
  if (layout.tiles.length !== expected.tiles.length || layout.pageCount < 0) throw new RangeError('Layout is incomplete');
  const required = new Map(expected.tiles.map((tile) => [key(tile), tile]));
  const occupied = new Map<string, ColumnTile[]>();
  const width = columnWidthMm(layout.columnCount, layout.spec);
  for (const tile of layout.tiles) {
    const item = required.get(key(tile));
    if (!item || tile.pageIndex < 0 || tile.pageIndex >= layout.pageCount || tile.columnIndex < 0 ||
      tile.columnIndex >= layout.columnCount || Math.abs(tile.widthMm - width) > EPS ||
      tile.number !== item.number || tile.partCount !== item.partCount ||
      Math.abs(tile.heightMm - item.heightMm) > EPS || Math.abs(tile.imageHeightMm - item.imageHeightMm) > EPS ||
      Math.abs(tile.sourceTop - item.sourceTop) > EPS ||
      Math.abs(tile.sourceBottom - item.sourceBottom) > EPS ||
      Math.abs(tile.xMm - (layout.spec.marginMm + tile.columnIndex * (width + layout.spec.gapMm))) > EPS ||
      tile.yMm < layout.spec.marginMm - EPS || tile.yMm + tile.heightMm > layout.spec.heightMm - layout.spec.marginMm + EPS) {
      throw new RangeError('Layout has an invalid placement');
    }
    required.delete(key(tile));
    const list = occupied.get(`${tile.pageIndex}:${tile.columnIndex}`) ?? [];
    if (list.some((other) => tile.yMm < other.yMm + other.heightMm + layout.spec.gapMm - EPS &&
      other.yMm < tile.yMm + tile.heightMm + layout.spec.gapMm - EPS)) throw new RangeError('Layout has overlapping receipts');
    list.push(tile);
    occupied.set(`${tile.pageIndex}:${tile.columnIndex}`, list);
  }
  if (required.size || Array.from({ length: layout.pageCount }, (_, page) =>
    layout.tiles.some((tile) => tile.pageIndex === page)).includes(false)) throw new RangeError('Layout has an empty page');
}
