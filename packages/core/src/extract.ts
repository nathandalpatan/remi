/**
 * Pulls claim fields out of raw OCR text (from ML Kit / Apple Vision on device, or any
 * cloud OCR). These are heuristics, so every result carries a confidence and the app
 * must show them as editable fields for the user to confirm.
 */

import { parseAmountToCents } from './money.js';

export type Confidence = 'high' | 'low';

export interface Extracted<T> {
  value: T;
  confidence: Confidence;
}

export interface ExtractedFields {
  totalCents: Extracted<number> | null;
  gstCents: Extracted<number> | null;
  /** YYYY-MM-DD */
  date: Extracted<string> | null;
  merchant: Extracted<string> | null;
}

export interface ExtractOptions {
  /** NZ, AU and UK write 03/04/2026 as 3 April. Set false for US-style receipts. */
  dayFirst?: boolean;
}

// An amount always has exactly two decimals; that excludes phone, GST and card numbers.
const MONEY_RE = /(?<![\d.,])-?\$?\s?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}(?![\d.])/g;

const TOTAL_KEYWORDS: ReadonlyArray<readonly [RegExp, number]> = [
  [/\b(amount|balance|total)\s+due\b/i, 3],
  [/\bgrand\s+total\b/i, 3],
  [/\btotal\b/i, 2],
];
// "Total includes GST $2.65" is how Australian receipts state the GST, not the total.
const NOT_TOTAL_RE =
  /\bsub[\s-]?total\b|\btotal\s+(savings?|discounts?|items?|qty|quantity|gst|tax)\b|\bincludes\s+gst\b/i;
const TENDER_RE = /\b(cash|change|tendered|rounding)\b/i;
const GST_RE = /\bgst\b/i;
// "GST FREE ITEMS 4.00" (AU) is the GST-free amount, and "GST No" is the NZ tax number.
const NOT_GST_RE = /\bgst\s*(no|number|reg|#)|\bgst[\s-]*(free|exempt)\b/i;
const MERCHANT_NOISE_RE =
  /tax\s+invoice|receipt|welcome|thank|gst|\b(customer|merchant)\s+copy\b|www\.|@|\d{3,}/i;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// "1 Oct 2026", "01 October, 2026", "02-Nov-2026" and EFTPOS-style "02NOV26".
// The year must not be followed by ".dd", or "2 Mayo 12.50" would read as a date.
const TEXTUAL_DATE_RE = new RegExp(
  String.raw`\b(\d{1,2})[\s-]*(${MONTHS.join('|')})[a-z]*\.?,?[\s-]*(\d{4}|\d{2})(?!\d|\.\d)`,
  'i',
);

export function extractFields(ocrText: string, options: ExtractOptions = {}): ExtractedFields {
  const lines = ocrText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const totalCents = extractTotal(lines);
  return {
    totalCents,
    gstCents: extractGst(lines, totalCents?.value ?? null),
    date: extractDate(lines, options.dayFirst ?? true),
    merchant: extractMerchant(lines),
  };
}

function amountsIn(line: string): number[] {
  return [...line.matchAll(MONEY_RE)]
    .map((match) => parseAmountToCents(match[0]))
    .filter((cents): cents is number => cents !== null);
}

function extractTotal(lines: string[]): Extracted<number> | null {
  let best: { rank: number; cents: number } | null = null;
  for (const line of lines) {
    if (NOT_TOTAL_RE.test(line)) continue;
    const rank = TOTAL_KEYWORDS.find(([re]) => re.test(line))?.[1];
    // The total is usually the last figure on its line ("TOTAL 2 items 23.00").
    const cents = amountsIn(line).at(-1);
    if (rank === undefined || cents === undefined) continue;
    // On a tie the larger figure wins: "Total incl GST of 3.00" must not beat "TOTAL 23.00".
    if (!best || rank > best.rank || (rank === best.rank && cents > best.cents)) {
      best = { rank, cents };
    }
  }
  if (best) return { value: best.cents, confidence: 'high' };

  // No total keyword (OCR may have mangled it): the largest non-tender figure is a guess.
  const amounts = lines.filter((line) => !TENDER_RE.test(line)).flatMap(amountsIn);
  return amounts.length > 0 ? { value: Math.max(...amounts), confidence: 'low' } : null;
}

function extractGst(lines: string[], totalCents: number | null): Extracted<number> | null {
  // "TOTAL incl GST 23.00" mentions GST but the figure is the total, so only accept
  // amounts strictly below the total and take the smallest. Zero is a real answer:
  // an all-GST-free Australian docket prints "GST 0.00".
  const candidates = lines
    .filter((line) => GST_RE.test(line) && !NOT_GST_RE.test(line))
    .flatMap(amountsIn)
    .filter((cents) => cents >= 0 && (totalCents === null || cents < totalCents));
  if (candidates.length === 0) return null;
  return { value: Math.min(...candidates), confidence: 'high' };
}

function extractDate(lines: string[], dayFirst: boolean): Extracted<string> | null {
  for (const line of lines) {
    const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(line);
    if (iso) {
      const date = toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
      if (date) return { value: date, confidence: 'high' };
    }

    const textual = TEXTUAL_DATE_RE.exec(line);
    if (textual) {
      const month = MONTHS.indexOf(textual[2]!.toLowerCase()) + 1;
      const date = toIsoDate(toYear(textual[3]!), month, Number(textual[1]));
      if (date) return { value: date, confidence: 'high' };
    }

    const numeric = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/.exec(line);
    if (numeric) {
      const [a, b] = [Number(numeric[1]), Number(numeric[2])];
      const year = toYear(numeric[3]!);
      const [day, month] = dayFirst ? [a, b] : [b, a];
      const date = toIsoDate(year, month, day);
      // 03/04 could be either order; only a day above 12 settles it.
      if (date) return { value: date, confidence: a > 12 || b > 12 ? 'high' : 'low' };
    }
  }
  return null;
}

function extractMerchant(lines: string[]): Extracted<string> | null {
  // The store name is normally printed at the top, but OCR can't tell a logo line
  // from an address, so this is always a low-confidence suggestion.
  const line = lines
    .slice(0, 5)
    .find((l) => (l.match(/\p{L}/gu)?.length ?? 0) >= 2 && !MERCHANT_NOISE_RE.test(l));
  return line ? { value: line, confidence: 'low' } : null;
}

function toYear(digits: string): number {
  return digits.length === 2 ? 2000 + Number(digits) : Number(digits);
}

function toIsoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return valid ? date.toISOString().slice(0, 10) : null;
}
