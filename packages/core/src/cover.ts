import type { PDFDocument, PDFPage } from 'pdf-lib';
import type { PageSpec } from './layout.js';
import { formatMinorUnits } from './money.js';
import { PT_PER_MM, fitText, toWinAnsi, type Fonts } from './pdf-text.js';
import { receiptAmountMinorUnits, type ClaimSummary } from './totals.js';
import type { Batch, Receipt } from './types.js';

/** Financial summary for the included claim, with optional excluded details. */
export function drawCover(
  doc: PDFDocument,
  spec: PageSpec,
  fonts: Fonts,
  batch: Batch,
  summary: ClaimSummary,
  listExcluded = false,
): void {
  const width = spec.widthMm * PT_PER_MM;
  const height = spec.heightMm * PT_PER_MM;
  const margin = Math.max(spec.marginMm, 15) * PT_PER_MM;
  const lineHeight = 17;
  let page!: PDFPage;
  let y!: number;
  const newPage = () => {
    page = doc.addPage([width, height]);
    y = height - margin;
  };
  const line = (value: string, bold = false, indent = 0) => {
    const font = bold ? fonts.bold : fonts.regular;
    const size = bold ? 10 : 9;
    const available = width - 2 * margin - indent;
    const words = toWinAnsi(value).split(/\s+/);
    let row = '';
    const draw = (text: string) => {
      if (y < margin + lineHeight) newPage();
      page.drawText(fitText(font, size, text, available),
        { x: margin + indent, y, font, size });
      y -= lineHeight;
    };
    for (const word of words) {
      const next = row ? `${row} ${word}` : word;
      if (row && font.widthOfTextAtSize(next, size) > available) {
        draw(row);
        row = word;
      } else row = next;
    }
    if (row) draw(row);
  };
  const receiptAmount = (receipt: Receipt) => {
    const amount = receiptAmountMinorUnits(receipt);
    return amount === null || !receipt.currency ? 'Amount unavailable' :
      `${formatMinorUnits(amount, receipt.currency)} ${receipt.currency}`;
  };

  newPage();
  page.drawText(fitText(fonts.bold, 18, toWinAnsi(batch.name), width - 2 * margin),
    { x: margin, y, font: fonts.bold, size: 18 });
  y -= 26;
  line(`Created ${batch.createdAt.slice(0, 10)}  |  ${summary.lines.filter(({ receipt }) => receipt.claimIncluded !== false).length} included receipt(s)`);
  y -= 10;
  line('Included receipts', true);
  for (const { number, receipt } of summary.lines) {
    if (receipt.claimIncluded === false) continue;
    line(`#${number}  ${receipt.date ?? 'Date unknown'}  ${receipt.merchant ?? 'Merchant unknown'}  ${receiptAmount(receipt)}`);
    if (receipt.integrity && receipt.integrity.state !== 'ready') {
      line(`Image integrity warning: ${receipt.integrity.issues.join(', ') || receipt.integrity.state}. Acknowledged for inclusion.`, false, 12);
    }
  }
  y -= 10;
  line('Confirmed claim totals by currency', true);
  for (const [currency, amount] of Object.entries(summary.confirmedByCurrency).sort(([a], [b]) => a.localeCompare(b))) {
    line(`${currency}  ${formatMinorUnits(amount, currency)}`);
  }
  if (listExcluded && summary.excluded.length) {
    y -= 10;
    line('Excluded from this claim', true);
    for (const receipt of summary.excluded) {
      const number = summary.lines.find((item) => item.receipt.id === receipt.id)!.number;
      line(`#${number}  ${receipt.date ?? 'Date unknown'}  ${receipt.merchant ?? 'Merchant unknown'}  ${receiptAmount(receipt)}`);
    }
  }
}
