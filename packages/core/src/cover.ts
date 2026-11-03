import { rgb, type PDFDocument, type PDFFont } from 'pdf-lib';
import type { PageSpec } from './layout.js';
import { formatCents } from './money.js';
import { GREY, LIGHT_GREY, PT_PER_MM, fitText, toWinAnsi, type Fonts } from './pdf-text.js';
import type { ClaimSummary } from './totals.js';
import type { Batch } from './types.js';

/** The first page(s): one row per receipt, then the claim total and GST. */
export function drawCover(
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
