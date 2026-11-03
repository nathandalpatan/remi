import { describe, expect, it } from 'vitest';
import { extractFields } from '../src/index.js';

const NZ_RECEIPT = `
COUNTDOWN METRO
123 Queen Street, Auckland
GST No: 123-456-789
TAX INVOICE
03/04/2026 14:22
Milk 2L            4.35
Bread              3.50
SUBTOTAL          7.85
TOTAL (incl GST)  $7.85
GST included       1.02
EFTPOS             7.85
`;

describe('extractFields', () => {
  it('reads an NZ supermarket receipt', () => {
    const fields = extractFields(NZ_RECEIPT);
    expect(fields.totalCents).toEqual({ value: 785, confidence: 'high' });
    expect(fields.gstCents).toEqual({ value: 102, confidence: 'high' });
    expect(fields.date).toEqual({ value: '2026-04-03', confidence: 'low' });
    expect(fields.merchant).toEqual({ value: 'COUNTDOWN METRO', confidence: 'low' });
  });

  it('prefers "amount due" over a plain total, and ignores savings and subtotals', () => {
    const fields = extractFields(`Subtotal 100.00\nTotal savings 5.00\nTotal 95.00\nAmount due 90.00`);
    expect(fields.totalCents?.value).toBe(9000);
  });

  it('breaks keyword ties by the larger figure', () => {
    const fields = extractFields(`Total includes GST of $3.00\nTOTAL 23.00`);
    expect(fields.totalCents?.value).toBe(2300);
    expect(fields.gstCents?.value).toBe(300);
  });

  it('handles thousands separators', () => {
    expect(extractFields('Grand Total $1,234.50').totalCents?.value).toBe(123450);
  });

  it('falls back to the largest non-tender amount with low confidence', () => {
    const fields = extractFields(`Coffee 4.50\nMuffin 5.00\nCash 20.00\nChange 10.50`);
    expect(fields.totalCents).toEqual({ value: 500, confidence: 'low' });
  });

  it('returns nulls when nothing is found', () => {
    expect(extractFields('')).toEqual({ totalCents: null, gstCents: null, date: null, merchant: null });
  });

  describe('dates', () => {
    it.each([
      ['2026-10-01', '2026-10-01', 'high'],
      ['25/12/2026', '2026-12-25', 'high'],
      ['25.12.26', '2026-12-25', 'high'],
      ['1 Oct 2026', '2026-10-01', 'high'],
      ['01 October, 2026', '2026-10-01', 'high'],
    ])('parses %s', (text, value, confidence) =>
      expect(extractFields(text).date).toEqual({ value, confidence }),
    );

    it('honours month-first when asked', () =>
      expect(extractFields('12/25/2026', { dayFirst: false }).date?.value).toBe('2026-12-25'));

    it('skips impossible dates', () => expect(extractFields('31/02/2026').date).toBeNull());
  });
});
