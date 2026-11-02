import {
  PDFDocument,
  StandardFonts,
  clip,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import { A4_PORTRAIT, packReceipts, type PageSpec, type Tile } from './layout.js';
import { formatCents } from './money.js';
import { summarizeClaim, type ClaimSummary, type ReceiptIssue } from './totals.js';
import type { Batch, Receipt } from './types.js';

const PT_PER_MM = 72 / 25.4;
const GREY = rgb(0.45, 0.45, 0.45);
const LIGHT_GREY = rgb(0.8, 0.8, 0.8);

export interface RenderOptions {
  batch: Batch;
  /** In claim order; receipt N in this array is "#N" everywhere. */
  receipts: Receipt[];
  /** Reads a receipt photo (PNG or JPEG). On React Native, read the file at `uri`. */
  loadImage: (uri: string) => Promise<Uint8Array>;
  page?: PageSpec;
}

export class ExportBlockedError extends Error {
  constructor(readonly issues: ReceiptIssue[]) {
    super(`Cannot export: ${issues.length} receipt issue(s) must be resolved first`);
    this.name = 'ExportBlockedError';
  }
}

/**
 * Builds the claim PDF: a cover sheet listing every receipt with the grand total,
 * followed by the packed receipt pages. Refuses to export while any receipt is
 * unconfirmed or can't be totalled, because a wrong total on a reimbursement claim
 * is worse than no PDF.
 */
export async function renderClaimPdf(options: RenderOptions): Promise<Uint8Array> {
  const { batch, receipts, loadImage, page: spec = A4_PORTRAIT } = options;
  const summary = summarizeClaim(receipts, batch.homeCurrency);
  if (summary.issues.length > 0) throw new ExportBlockedError(summary.issues);

  const layout = packReceipts(
    receipts.map((r) => ({
      id: r.id,
      widthPx: r.image.widthPx,
      heightPx: r.image.heightPx,
      widthMm: r.printWidthMm ?? null,
      placements: r.placements ?? [],
    })),
    spec,
  );

  const doc = await PDFDocument.create();
  doc.setTitle(batch.name);
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };

  drawCover(doc, spec, fonts, batch, summary);

  // Embed once per receipt; split receipts reuse the same image object.
  const images = new Map<string, PDFImage>();
  const pages = Array.from({ length: layout.pageCount }, () =>
    doc.addPage([spec.widthMm * PT_PER_MM, spec.heightMm * PT_PER_MM]),
  );
  for (const tile of layout.tiles) {
    const receipt = receipts[tile.number - 1]!;
    const image = images.get(receipt.id) ?? (await embedImage(doc, await loadImage(receipt.image.uri)));
    images.set(receipt.id, image);
    drawTile(pages[tile.pageIndex]!, spec, fonts.bold, tile, receipt, image);
  }

  return doc.save();
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

function drawCover(
  doc: PDFDocument,
  spec: PageSpec,
  fonts: Fonts,
  batch: Batch,
  summary: ClaimSummary,
): void {
  const pageWidth = spec.widthMm * PT_PER_MM;
  const pageHeight = spec.heightMm * PT_PER_MM;
  const margin = Math.max(spec.marginMm, 15) * PT_PER_MM;
  const usable = pageWidth - 2 * margin;
  const rowHeight = 16;
  const size = 9;
  const cellPadding = 4;
  const home = summary.homeCurrency;

  // Column widths as fractions of the usable width; amounts are right-aligned.
  const columns = [
    { title: '#', share: 0.05, align: 'left' },
    { title: 'Date', share: 0.13, align: 'left' },
    { title: 'Merchant', share: 0.3, align: 'left' },
    { title: 'Category', share: 0.2, align: 'left' },
    { title: 'Amount', share: 0.17, align: 'right' },
    { title: home, share: 0.15, align: 'right' },
  ] as const;

  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const text = (s: string, x: number, font: PDFFont, fontSize: number, color = rgb(0, 0, 0)) =>
    page.drawText(toWinAnsi(s), { x, y, font, size: fontSize, color });

  text(batch.name, margin, fonts.bold, 18);
  y -= 22;
  text(
    `Created ${batch.createdAt.slice(0, 10)} · ${summary.lines.length} receipt(s) · totals in ${home}`,
    margin,
    fonts.regular,
    10,
    GREY,
  );
  y -= 28;

  const drawRow = (cells: string[], font: PDFFont) => {
    let x = margin;
    columns.forEach((column, i) => {
      const width = column.share * usable;
      const cell = fitText(font, size, toWinAnsi(cells[i] ?? ''), width - cellPadding);
      const cellX =
        column.align === 'right' ? x + width - font.widthOfTextAtSize(cell, size) : x;
      page.drawText(cell, { x: cellX, y, font, size });
      x += width;
    });
    y -= rowHeight;
  };
  const drawHeader = () => {
    drawRow(columns.map((c) => c.title), fonts.bold);
    page.drawLine({
      start: { x: margin, y: y + rowHeight - 4 },
      end: { x: margin + usable, y: y + rowHeight - 4 },
      thickness: 0.5,
      color: LIGHT_GREY,
    });
  };

  drawHeader();
  // Leave room at the bottom for the totals block.
  const footerSpace = 3 * rowHeight;
  for (const { number, receipt, homeAmountCents } of summary.lines) {
    if (y - footerSpace < margin) {
      page = doc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
      drawHeader();
    }
    const amount = formatCents(receipt.amountCents!);
    drawRow(
      [
        String(number),
        receipt.date ?? '',
        receipt.merchant ?? '',
        receipt.category ?? '',
        receipt.currency === home ? amount : `${amount} ${receipt.currency}`,
        formatCents(homeAmountCents!),
      ],
      fonts.regular,
    );
  }

  y -= 6;
  page.drawLine({
    start: { x: margin, y: y + rowHeight },
    end: { x: margin + usable, y: y + rowHeight },
    thickness: 1,
  });
  const drawTotalLine = (label: string, cents: number, font: PDFFont) => {
    const value = `${formatCents(cents)} ${home}`;
    page.drawText(label, { x: margin, y, font, size: 11 });
    page.drawText(value, { x: margin + usable - font.widthOfTextAtSize(value, 11), y, font, size: 11 });
    y -= rowHeight + 2;
  };
  drawTotalLine('Total', summary.totalCents, fonts.bold);
  drawTotalLine('GST included', summary.gstCents, fonts.regular);
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
    toWinAnsi(`#${tile.number}${part}  ${receipt.merchant ?? ''}`.trim()),
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

/**
 * The built-in PDF fonts only cover WinAnsi (Latin-1 plus a few symbols) and throw on
 * anything else. Strip accents ("Kōhanga" -> "Kohanga") and replace what's left, so a
 * merchant name can never break the export. Embed a TTF instead if you need full Unicode.
 */
function toWinAnsi(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[^\x20-\x7e\xa0-\xff€…–—‘’“”•·]/g, '?');
}

function fitText(font: PDFFont, size: number, text: string, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let end = text.length;
  while (end > 0 && font.widthOfTextAtSize(`${text.slice(0, end)}…`, size) > maxWidth) end--;
  return `${text.slice(0, end).trimEnd()}…`;
}
