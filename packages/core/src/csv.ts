import { centsToDecimal, currencyMinorDigits, formatMinorUnits } from './money.js';
import { receiptAmountMinorUnits, summarizeClaim } from './totals.js';
import type { CurrencyCode, DuplicateDecision, Receipt } from './types.js';

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

/** One row per draft receipt; only eligible included receipts have a claim amount. RFC 4180. */
export function toCsv(receipts: Receipt[], homeCurrency: CurrencyCode,
  duplicateDecisions: DuplicateDecision[] = []): string {
  const rows = summarizeClaim(receipts, homeCurrency, duplicateDecisions).lines.map(({ number, receipt, homeAmountCents, eligible }) => {
    const digits = receipt.currency ? recognizedMinorDigits(receipt.currency) : null;
    const amount = digits === null ? null : receiptAmountMinorUnits(receipt);
    return [
      String(number),
      receipt.date ?? '',
      text(receipt.merchant),
      text(receipt.category),
      amount !== null && receipt.currency ? formatMinorUnits(amount, receipt.currency).replace(/,/g, '') : '',
      receipt.currency ?? '',
      receipt.fx ? String(receipt.fx.rate) : '',
      receipt.fx?.rateDate ?? '',
      money(eligible ? homeAmountCents : null),
      homeCurrency,
      digits === 2 && receipt.gstCents !== null && receipt.currency
        ? formatMinorUnits(receipt.gstCents, receipt.currency).replace(/,/g, '') : '',
      text(receipt.notes),
      eligible ? 'yes' : 'no',
    ];
  });
  return [HEADER, ...rows].map((row) => row.map(quote).join(',')).join('\r\n') + '\r\n';
}

function money(cents: number | null): string {
  return cents === null ? '' : centsToDecimal(cents);
}

function recognizedMinorDigits(currency: CurrencyCode): number | null {
  try { return currencyMinorDigits(currency); }
  catch { return null; }
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
