const AMOUNT_RE = /^(-)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

/** Parses "1,234.5", "$12", "-3.40" into integer cents without going through a float. */
export function parseAmountToCents(input: string): number | null {
  const match = AMOUNT_RE.exec(input.replace(/[\s$]/g, ''));
  if (!match) return null;
  const [, sign, whole = '0', fraction = ''] = match;
  const cents = Number(whole.replace(/,/g, '')) * 100 + Number(fraction.padEnd(2, '0'));
  return sign ? -cents : cents;
}

/** 123456 -> "1234.56". Machine-readable, used for CSV. */
export function centsToDecimal(cents: number): string {
  assertCents(cents);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** 123456 -> "1,234.56". Human-readable, used in the PDF. */
export function formatCents(cents: number): string {
  return centsToDecimal(cents).replace(/\B(?=(\d{3})+\.)/g, ',');
}

/** Converts a foreign amount into home-currency cents, rounding once at the end. */
export function convertCents(amountCents: number, rate: number): number {
  assertCents(amountCents);
  if (!(rate > 0) || !Number.isFinite(rate)) throw new RangeError(`Invalid exchange rate: ${rate}`);
  return Math.round(amountCents * rate);
}

/**
 * GST contained in a GST-inclusive price. NZ GST is 15%, i.e. 3/23 of the total.
 * The rate is in basis points so the arithmetic stays in integers.
 */
export function gstFromInclusive(totalCents: number, rateBasisPoints = 1500): number {
  assertCents(totalCents);
  return Math.round((totalCents * rateBasisPoints) / (10_000 + rateBasisPoints));
}

function assertCents(cents: number): void {
  if (!Number.isSafeInteger(cents)) throw new RangeError(`Expected integer cents, got ${cents}`);
}
