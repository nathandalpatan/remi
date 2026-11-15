import {
  PDFDocument,
  StandardFonts,
  clip,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import { drawCover } from './cover.js';
import { packColumns, validateColumnLayout, type ColumnCount, type ColumnLayout } from './column-layout.js';
import { A4_PORTRAIT, type PageSpec, type Tile } from './layout.js';
import { GREY, LIGHT_GREY, PT_PER_MM, fitText, toWinAnsi } from './pdf-text.js';
import { summarizeClaim, type ReceiptIssue } from './totals.js';
import type { Batch, DuplicateDecision, Receipt } from './types.js';

export type ExportConfig =
  | { mode: 'image_only'; receiptIds: string[]; originalIds?: string[]; columnCount?: ColumnCount;
      originalBreaks?: Record<string, { imageRevision: number; fractions: number[] }> }
  | { mode: 'reimbursement'; includeSummary: boolean; listExcluded: boolean };

export interface RenderOptions {
  batch: Batch;
  /** In claim order; receipt N in this array is "#N" everywhere. */
  receipts: Receipt[];
  /** Reads a receipt photo (PNG or JPEG). On React Native, read the file at `uri`. */
  loadImage: (uri: string) => Promise<Uint8Array>;
  page?: PageSpec;
  /** Resolved A4 receipt placements used by the editor. */
  layout?: ColumnLayout;
  config?: ExportConfig;
  duplicateDecisions?: DuplicateDecision[];
}

export class ExportBlockedError extends Error {
  constructor(readonly issues: ReceiptIssue[]) {
    super(`Cannot export: ${issues.length} receipt issue(s) must be resolved first`);
    this.name = 'ExportBlockedError';
  }
}

/** Builds either export mode from one validated, content-safe receipt layout. */
export async function renderReceiptPdf(options: RenderOptions): Promise<Uint8Array> {
  const { batch, receipts, loadImage } = options;
  const spec = options.layout?.spec ?? options.page ?? A4_PORTRAIT;
  const config = options.config ?? { mode: 'reimbursement', includeSummary: true, listExcluded: false };
  const summary = summarizeClaim(receipts, batch.homeCurrency, options.duplicateDecisions);
  if (config.mode === 'reimbursement' && !summary.isFinal) throw new ExportBlockedError(summary.issues);
  const selected = config.mode === 'reimbursement'
    ? receipts.filter((receipt) => receipt.claimIncluded !== false)
    : selectReceipts(receipts, config.receiptIds);
  if (!selected.length) throw new RangeError('Choose at least one receipt to export');
  const receiptNumbers = new Map(receipts.map((receipt, index) => [receipt.id, index + 1]));
  const selectedById = new Map(selected.map((receipt) => [receipt.id, receipt]));

  const items = selected.map((r) => ({
    id: r.id, widthPx: r.image.widthPx, heightPx: r.image.heightPx,
    lines: r.ocrLines, breaks: r.breakFractions,
  }));
  const layout = options.layout
    ? projectLayout(options.layout, selected)
    : packColumns(items, config.mode === 'image_only' ? config.columnCount ?? 2 : 2, undefined, false, spec);
  validateColumnLayout(layout, items);
  layout.tiles = layout.tiles.map((tile) => ({ ...tile, number: receiptNumbers.get(tile.receiptId)! }));

  const doc = await PDFDocument.create();
  doc.setTitle(batch.name);
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };

  if (config.mode === 'reimbursement' && config.includeSummary) {
    drawCover(doc, spec, fonts, batch, summary, config.listExcluded);
  } else if (config.mode === 'reimbursement') {
    drawWarnings(doc, spec, fonts, selected, receiptNumbers);
  }

  // Embed once per receipt; split receipts reuse the same image object.
  const images = new Map<string, PDFImage>();
  const pages = Array.from({ length: layout.pageCount }, () =>
    doc.addPage([spec.widthMm * PT_PER_MM, spec.heightMm * PT_PER_MM]),
  );
  for (const tile of layout.tiles) {
    const receipt = selectedById.get(tile.receiptId)!;
    const image = images.get(receipt.id) ?? (await embedImage(doc, await loadImage(receipt.image.uri)));
    images.set(receipt.id, image);
    drawTile(pages[tile.pageIndex]!, spec, fonts.bold, tile, receipt, image);
  }

  return doc.save();
}

/** Compatibility entry point for existing claim callers. */
export function renderClaimPdf(options: RenderOptions): Promise<Uint8Array> {
  return renderReceiptPdf({ ...options, config: options.config ??
    { mode: 'reimbursement', includeSummary: true, listExcluded: false } });
}

function selectReceipts(receipts: Receipt[], ids: string[]): Receipt[] {
  const selected = new Set(ids);
  if (selected.size !== ids.length || receipts.filter((receipt) => selected.has(receipt.id)).length !== selected.size) {
    throw new RangeError('Selected receipts must have unique IDs present in the document');
  }
  return receipts.filter((receipt) => selected.has(receipt.id));
}

function projectLayout(layout: ColumnLayout, selected: Receipt[]): ColumnLayout {
  const selectedIds = new Set(selected.map((receipt) => receipt.id));
  const numbers = new Map(selected.map((receipt, index) => [receipt.id, index + 1]));
  const tiles = layout.tiles.filter((tile) => selectedIds.has(tile.receiptId));
  const pages = [...new Set(tiles.map((tile) => tile.pageIndex))].sort((a, b) => a - b);
  const pageMap = new Map(pages.map((page, index) => [page, index]));
  return {
    ...layout,
    tiles: tiles.map((tile) => ({ ...tile, number: numbers.get(tile.receiptId)!, pageIndex: pageMap.get(tile.pageIndex)! })),
    pageCount: pages.length,
    needsBreak: layout.needsBreak.filter((id) => selectedIds.has(id)),
  };
}

function drawWarnings(doc: PDFDocument, spec: PageSpec, fonts: { regular: PDFFont; bold: PDFFont }, receipts: Receipt[],
  numbers: Map<string, number>): void {
  const warnings = receipts.flatMap((receipt) => receipt.integrity && receipt.integrity.state !== 'ready'
    ? [`#${numbers.get(receipt.id)} ${receipt.merchant ?? 'Receipt'}: ${receipt.integrity.issues.join(', ') || receipt.integrity.state}`]
    : []);
  if (!warnings.length) return;
  let page = doc.addPage([spec.widthMm * PT_PER_MM, spec.heightMm * PT_PER_MM]);
  const margin = spec.marginMm * PT_PER_MM;
  let y = spec.heightMm * PT_PER_MM - margin;
  page.drawText('Image integrity warnings', { x: margin, y, font: fonts.bold, size: 14 });
  y -= 25;
  for (const warning of warnings) {
    const available = spec.widthMm * PT_PER_MM - 2 * margin;
    let row = '';
    for (const word of toWinAnsi(warning).split(/\s+/)) {
      const next = row ? `${row} ${word}` : word;
      if (row && fonts.regular.widthOfTextAtSize(next, 9) > available) {
        if (y < margin + 16) {
          page = doc.addPage([spec.widthMm * PT_PER_MM, spec.heightMm * PT_PER_MM]);
          y = spec.heightMm * PT_PER_MM - margin;
        }
        page.drawText(fitText(fonts.regular, 9, row, available), { x: margin, y, font: fonts.regular, size: 9 });
        y -= 16;
        row = word;
      } else row = next;
    }
    if (row) {
      if (y < margin + 16) {
        page = doc.addPage([spec.widthMm * PT_PER_MM, spec.heightMm * PT_PER_MM]);
        y = spec.heightMm * PT_PER_MM - margin;
      }
      page.drawText(fitText(fonts.regular, 9, row, available), { x: margin, y, font: fonts.regular, size: 9 });
      y -= 16;
    }
  }
}

function drawTile(
  page: PDFPage,
  spec: PageSpec,
  font: PDFFont,
  tile: Tile,
  receipt: Receipt,
  image: PDFImage,
): void {
  const pageHeight = spec.heightMm * PT_PER_MM;
  const x = tile.xMm * PT_PER_MM;
  const width = tile.widthMm * PT_PER_MM;
  const labelHeight = spec.labelHeightMm * PT_PER_MM;
  // Layout measures from the top; PDF measures from the bottom.
  const tileTop = pageHeight - tile.yMm * PT_PER_MM;
  const imageTop = tileTop - labelHeight;
  const sliceHeight = tile.imageHeightMm * PT_PER_MM;
  const sliceBottom = imageTop - sliceHeight;

  const part = tile.partCount > 1 ? ` (${tile.part}/${tile.partCount})` : '';
  const label = fitText(
    font,
    8,
    toWinAnsi(`#${tile.number}${part}  ${receipt.integrity && receipt.integrity.state !== 'ready' ? '[IMAGE WARNING] ' : ''}${receipt.merchant ?? ''}`.trim()),
    width,
  );
  page.drawText(label, { x, y: imageTop + 3, font, size: 8, color: GREY });

  // Draw the whole photo, positioned so the wanted slice lands in the tile, and clip
  // everything else away. This avoids decoding and cropping the image ourselves.
  const fullHeight = sliceHeight / (tile.sourceBottom - tile.sourceTop);
  page.pushOperators(pushGraphicsState(), rectangle(x, sliceBottom, width, sliceHeight), clip(), endPath());
  page.drawImage(image, { x, y: imageTop - fullHeight * (1 - tile.sourceTop), width, height: fullHeight });
  page.pushOperators(popGraphicsState());

  page.drawRectangle({
    x,
    y: sliceBottom,
    width,
    height: sliceHeight,
    borderColor: LIGHT_GREY,
    borderWidth: 0.5,
  });
}

async function embedImage(doc: PDFDocument, bytes: Uint8Array): Promise<PDFImage> {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return doc.embedPng(bytes);
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return doc.embedJpg(bytes);
  throw new Error('Unsupported image format: expected PNG or JPEG');
}
