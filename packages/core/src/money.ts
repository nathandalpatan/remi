const AMOUNT_RE = /^(-)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;
// NumberFormat accepts arbitrary three-letter codes, and Hermes may lack supportedValuesOf.
const CURRENCY_CODES = new Set(`
AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD
CAD CDF CHF CLP CNY COP CRC CUC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD
GNF GTQ GYD HKD HNL HRK HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT
LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD
OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SLL SOS SRD SSP STN SVC
SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VES VND VUV WST XAF XCD XCG XDR XOF XPF
XSU YER ZAR ZMW ZWG ZWL`.trim().split(/\s+/));

/** ISO 4217 minor-unit precision from the runtime's currency metadata. */
export function currencyMinorDigits(currency: string): number {
  const code = currency.toUpperCase();
  if (!CURRENCY_CODES.has(code)) throw new RangeError(`Unsupported currency: ${currency}`);
  const supported = Intl.supportedValuesOf?.('currency');
  if (supported && !supported.includes(code)) throw new RangeError(`Unsupported currency: ${currency}`);
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency: code })
    .resolvedOptions().maximumFractionDigits;
  if (digits === undefined || digits < 0 || digits > 4) throw new RangeError(`Unsupported currency precision: ${currency}`);
  return digits;
}

/** Parses an amount to the currency's integer minor unit without floating point. */
export function parseAmountToMinorUnits(input: string, currency: string): number | null {
  const digits = currencyMinorDigits(currency);
  const match = /^(-)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/.exec(input.replace(/[\s$]/g, ''));
  if (!match) return null;
  const fraction = match[3] ?? '';
  if (fraction.length > digits || (digits === 0 && fraction)) return null;
  const scale = 10 ** digits;
  const amount = Number(match[2]!.replace(/,/g, '')) * scale + Number(fraction.padEnd(digits, '0'));
  if (!Number.isSafeInteger(amount)) return null;
  return match[1] ? -amount : amount;
}

export function formatMinorUnits(amount: number, currency: string): string {
  assertCents(amount);
  const digits = currencyMinorDigits(currency);
  const scale = 10 ** digits;
  const whole = Math.floor(Math.abs(amount) / scale).toLocaleString('en-US');
  const fraction = digits ? `.${String(Math.abs(amount) % scale).padStart(digits, '0')}` : '';
  return `${amount < 0 ? '-' : ''}${whole}${fraction}`;
}

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
