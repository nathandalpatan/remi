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
import { A4_PORTRAIT, packReceipts, type PageSpec, type Tile } from './layout.js';
import { GREY, LIGHT_GREY, PT_PER_MM, fitText, toWinAnsi } from './pdf-text.js';
import { summarizeClaim, type ReceiptIssue } from './totals.js';
import type { Batch, Receipt } from './types.js';

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
