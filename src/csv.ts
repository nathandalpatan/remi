import { centsToDecimal } from './money.js';
import { summarizeClaim } from './totals.js';
import type { CurrencyCode, Receipt } from './types.js';

const HEADER = [
  'number',
  'date',
  'merchant',
  'category',
  'amount',
  'currency',
  'fx_rate',
  'fx_rate_date',
  'home_amount',
  'home_currency',
  'gst',
  'notes',
  'confirmed',
];

/** One row per receipt, numbered to match the PDF. RFC 4180 (CRLF line endings). */
export function toCsv(receipts: Receipt[], homeCurrency: CurrencyCode): string {
  const rows = summarizeClaim(receipts, homeCurrency).lines.map(({ number, receipt, homeAmountCents }) => [
    String(number),
    receipt.date ?? '',
    text(receipt.merchant),
    text(receipt.category),
    money(receipt.amountCents),
    receipt.currency,
    receipt.fx ? String(receipt.fx.rate) : '',
    receipt.fx?.rateDate ?? '',
    money(homeAmountCents),
    homeCurrency,
    money(receipt.gstCents),
    text(receipt.notes),
    receipt.confirmed ? 'yes' : 'no',
  ]);
  return [HEADER, ...rows].map((row) => row.map(quote).join(',')).join('\r\n') + '\r\n';
}

function money(cents: number | null): string {
  return cents === null ? '' : centsToDecimal(cents);
}

/**
 * Free text typed by the user or read by OCR. A cell starting with = + - @ is run as a
 * formula by Excel and Sheets, so it is prefixed with an apostrophe (CSV injection).
 */
function text(value: string | null): string {
  if (!value) return '';
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function quote(cell: string): string {
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}
