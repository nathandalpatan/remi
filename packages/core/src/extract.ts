/**
 * Pulls claim fields out of raw OCR text (from ML Kit / Apple Vision on device, or any
 * cloud OCR). These are heuristics, so every result carries a confidence and the app
 * must show them as editable fields for the user to confirm.
 */

import { currencyMinorDigits, parseAmountToCents } from './money.js';
import type { FinancialCandidate, FinancialField } from './types.js';

export type Confidence = 'high' | 'medium' | 'low';

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
  currency: Extracted<string> | null;
}

export interface ExtractOptions {
  /** NZ, AU and UK write 03/04/2026 as 3 April. Set false for US-style receipts. */
  dayFirst?: boolean;
  ocrLines?: Array<{ text?: string; left?: number; right?: number; top: number; bottom: number }>;
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
  const totalCents = extractTotal(lines, options.ocrLines);
  return {
    totalCents,
    gstCents: extractGst(lines, totalCents?.value ?? null),
    date: extractDate(lines, options.dayFirst ?? true),
    merchant: extractMerchant(lines),
    currency: extractCurrency(lines),
  };
}

/** Field suggestions retain the OCR line that supports each value. */
export function extractFieldCandidates(ocrText: string, imageRevision: number, options: ExtractOptions = {}): FinancialCandidate[] {
  const lines = ocrText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const extracted = extractFields(ocrText, options);
  const spatialTotal = findSpatialTotal(options.ocrLines);
  const values: [FinancialField, Extracted<string | number> | null][] = [
    ['amount', extracted.totalCents], ['gst', extracted.gstCents], ['date', extracted.date],
    ['merchant', extracted.merchant], ['currency', extracted.currency],
  ];
  return values.flatMap(([field, candidate]) => {
    if (!candidate) return [];
    const lineIndex = lines.findIndex((line) => field === 'amount'
      ? !NOT_TOTAL_RE.test(line) && TOTAL_KEYWORDS.some(([label]) => label.test(line)) &&
        amountsIn(line).includes(candidate.value as number)
      : field === 'date' ? extractDate([line], true)?.value === candidate.value
      : field === 'gst' ? GST_RE.test(line) && amountsIn(line).includes(candidate.value as number)
      : line.toLowerCase().includes(String(candidate.value).toLowerCase()));
    const lineIndexes = field === 'amount' && spatialTotal?.cents === candidate.value
      ? spatialTotal.lineIndexes : lineIndex >= 0 ? [lineIndex] : undefined;
    return [{ field, value: candidate.value, confidence: candidate.confidence,
      evidence: { source: 'ocr' as const, imageRevision,
        ...(lineIndexes ? { lineIndexes } : {}) } }];
  });
}

function amountsIn(line: string): number[] {
  return [...line.matchAll(MONEY_RE)]
    .map((match) => parseAmountToCents(match[0]))
    .filter((cents): cents is number => cents !== null);
}

function findSpatialTotal(ocrLines: ExtractOptions['ocrLines']): { cents: number; lineIndexes: number[] } | null {
  if (!ocrLines?.length) return null;
  let best: { cents: number; lineIndexes: number[]; rank: number; top: number } | null = null;
  for (const [labelIndex, label] of ocrLines.entries()) {
    const text = label.text?.trim() ?? '';
    if (!text || /\b(?:sub[\s-]?total|exclud(?:ing|es?)\s+(?:tax|gst)|savings?|discounts?|items?|qty|quantity)\b/i.test(text)) continue;
    if (/\b(?:includes?|incl)\s+gst\s+of\b/i.test(text) && !amountsIn(text).length) continue;
    const inclusive = /\b(?:total|ota[1l])\b.*\b(?:incl(?:uding|udes?)?|includes?)\s*(?:tax|gst)\b/i.test(text);
    const rank = inclusive || /\bamount\s+due\b/i.test(text) ? 3 : 0;
    if (!rank || label.left === undefined || label.right === undefined ||
      ![label.left, label.right, label.top, label.bottom].every(Number.isFinite) ||
      label.left >= label.right || label.top >= label.bottom) continue;
    for (const [amountIndex, amount] of ocrLines.entries()) {
      if (amountIndex === labelIndex || amount.left === undefined || amount.right === undefined ||
        ![amount.left, amount.right, amount.top, amount.bottom].every(Number.isFinite) ||
        amount.left < label.right || amount.left >= amount.right || amount.top >= amount.bottom) continue;
      const overlap = Math.min(label.bottom, amount.bottom) - Math.max(label.top, amount.top);
      if (overlap <= 0) continue;
      const cents = amountsIn(amount.text ?? '').at(-1);
      if (cents === undefined) continue;
      if (!best || rank > best.rank || rank === best.rank &&
        (label.top > best.top || label.top === best.top && cents > best.cents)) {
        best = { cents, lineIndexes: [labelIndex, amountIndex], rank, top: label.top };
      }
    }
  }
  return best;
}

function extractTotal(lines: string[], ocrLines?: ExtractOptions['ocrLines']): Extracted<number> | null {
  const spatial = findSpatialTotal(ocrLines);
  if (spatial) return { value: spatial.cents, confidence: 'medium' };
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
  const candidates = lines.filter((line, index) => (index < 5 || index >= lines.length - 5) &&
      (line.match(/\p{L}/gu)?.length ?? 0) >= 2 && !amountsIn(line).length &&
      !/\d{1,2}[A-Z]{3}\d{2}/i.test(line) && !MERCHANT_NOISE_RE.test(line) &&
      !/\b(payment|sale|purchase|card|terminal|eftpos|visa|mastercard)\b/i.test(line));
  const repeated = candidates.find((candidate) => candidates.filter((other) =>
    other.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') ===
    candidate.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')).length > 1);
  if (repeated) return { value: repeated, confidence: 'medium' };
  const shoppingAt = lines.map((line) => /\bthanks?\s+for\s+shopping\s+at\s+(.+)/i.exec(line)?.[1]
    ?.replace(/[.!?]+$/, '').trim()).find((name) => name && (name.match(/\p{L}/gu)?.length ?? 0) >= 2);
  return shoppingAt ? { value: shoppingAt, confidence: 'medium' }
    : candidates[0] ? { value: candidates[0], confidence: 'low' } : null;
}

function extractCurrency(lines: string[]): Extracted<string> | null {
  for (const line of lines) {
    const labelled = /\b(?:currency|curr)\s*[:=]?\s*([A-Z]{3})\b/i.exec(line);
    if (labelled) {
      const code = labelled[1]!.toUpperCase();
      try { currencyMinorDigits(code); return { value: code, confidence: 'high' }; }
      catch { /* OCR may have read a non-currency word. */ }
    }
    const amounts = [...line.matchAll(MONEY_RE)];
    for (const match of line.matchAll(/\b[A-Z]{3}\b/g)) {
      const code = match[0];
      try { currencyMinorDigits(code); }
      catch { continue; }
      const codeStart = match.index;
      const codeEnd = codeStart + code.length;
      if (!amounts.some((amount) => {
        const amountStart = amount.index;
        const amountEnd = amountStart + amount[0].length;
        const between = codeEnd <= amountStart ? line.slice(codeEnd, amountStart)
          : amountEnd <= codeStart ? line.slice(amountEnd, codeStart) : null;
        return between !== null && /^[\s:$-]{0,4}$/.test(between);
      })) continue;
      return { value: code, confidence: /\b(total|amount|paid)\b/i.test(line) ? 'high' : 'medium' };
    }
  }
  return null;
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
