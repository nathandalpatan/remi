import { describe, expect, it } from 'vitest';
import {
  centsToDecimal,
  convertCents,
  currencyMinorDigits,
  formatCents,
  formatMinorUnits,
  gstFromInclusive,
  parseAmountToCents,
  parseAmountToMinorUnits,
} from '../src/index.js';

describe('parseAmountToCents', () => {
  it.each([
    ['12.50', 1250],
    ['$12', 1200],
    ['1,234.5', 123450],
    ['-3.40', -340],
    ['$ 0.07', 7],
  ])('parses %s', (input, cents) => expect(parseAmountToCents(input)).toBe(cents));

  it.each(['', 'abc', '12.345', '1,23.00'])('rejects %j', (input) =>
    expect(parseAmountToCents(input)).toBeNull(),
  );

  it('avoids float error that 0.1 + 0.2 style parsing would introduce', () => {
    expect(parseAmountToCents('4.35')).toBe(435); // 4.35 * 100 === 434.99999999999994
  });
});

describe('formatting', () => {
  it('formats cents', () => {
    expect(centsToDecimal(123456)).toBe('1234.56');
    expect(formatCents(123456789)).toBe('1,234,567.89');
    expect(formatCents(-5)).toBe('-0.05');
  });

  it('rejects non-integer cents', () => expect(() => centsToDecimal(1.5)).toThrow(RangeError));
});

describe('currency minor units', () => {
  it('rejects OCR words even when supportedValuesOf is unavailable', () => {
    const original = Object.getOwnPropertyDescriptor(Intl, 'supportedValuesOf');
    Object.defineProperty(Intl, 'supportedValuesOf', { configurable: true, value: undefined });
    try {
      for (const word of ['MAN', 'MAH', 'QTY', 'WWW']) {
        expect(() => currencyMinorDigits(word)).toThrow(RangeError);
      }
      expect(currencyMinorDigits('NZD')).toBe(2);
    } finally {
      if (original) Object.defineProperty(Intl, 'supportedValuesOf', original);
      else Reflect.deleteProperty(Intl, 'supportedValuesOf');
    }
  });

  it('uses ISO precision for two-, zero-, and three-decimal currencies', () => {
    expect(currencyMinorDigits('NZD')).toBe(2);
    expect(currencyMinorDigits('JPY')).toBe(0);
    expect(currencyMinorDigits('KWD')).toBe(3);
    expect(parseAmountToMinorUnits('35.00', 'NZD')).toBe(3500);
    expect(parseAmountToMinorUnits('1,234', 'JPY')).toBe(1234);
    expect(parseAmountToMinorUnits('12.345', 'KWD')).toBe(12345);
    expect(formatMinorUnits(12345, 'KWD')).toBe('12.345');
    expect(formatMinorUnits(1234, 'JPY')).toBe('1,234');
  });

  it('rejects amounts with too many decimals or unsafe integer precision', () => {
    expect(parseAmountToMinorUnits('1.25', 'JPY')).toBeNull();
    expect(parseAmountToMinorUnits('1.2345', 'KWD')).toBeNull();
    expect(parseAmountToMinorUnits('999999999999999999', 'NZD')).toBeNull();
  });
});

describe('convertCents', () => {
  it('rounds once to the nearest cent', () => expect(convertCents(1000, 1.08765)).toBe(1088));
  it('rejects a bad rate', () => expect(() => convertCents(1000, 0)).toThrow(RangeError));
});

describe('gstFromInclusive', () => {
  it('takes 3/23 of an NZ total', () => {
    expect(gstFromInclusive(11500)).toBe(1500);
    expect(gstFromInclusive(1250)).toBe(163);
  });
});
