import { describe, expect, it } from 'vitest';
import { extractFieldCandidates, extractFields } from '../src/index.js';

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

  it('pairs a right-column amount with its inclusive total label', () => {
    const text = 'Total excluding tax 67.82\nGST 10.18\nota1 including tax\n78.00';
    const ocrLines = [
      { text: 'Total excluding tax 67.82', left: 0.34, right: 0.47, top: 0.449, bottom: 0.456 },
      { text: 'GST 10.18', left: 0.34, right: 0.48, top: 0.458, bottom: 0.464 },
      { text: 'ota1 including tax', left: 0.34, right: 0.448, top: 0.465, bottom: 0.472 },
      { text: '78.00', left: 0.524, right: 0.553, top: 0.467, bottom: 0.472 },
    ];
    expect(extractFields(text, { ocrLines }).totalCents).toEqual({ value: 7800, confidence: 'medium' });
    expect(extractFieldCandidates(text, 4, { ocrLines }).find((item) => item.field === 'amount'))
      .toMatchObject({ value: 7800, evidence: { lineIndexes: [2, 3], imageRevision: 4 } });
  });

  it('prefers the right-column total over tax and rounding amounts on the same row', () => {
    const text = 'Total (incl GST of $220.30)\n1,688.99\n0.00';
    const ocrLines = [
      { text: 'Total (incl GST of $220.30)', left: 0.357, right: 0.552, top: 0.503, bottom: 0.522 },
      { text: '1,688.99', left: 0.578, right: 0.632, top: 0.501, bottom: 0.514 },
      { text: '0.00', left: 0.607, right: 0.634, top: 0.514, bottom: 0.525 },
    ];
    expect(extractFields(text, { ocrLines }).totalCents?.value).toBe(168899);
    expect(extractFields(text).totalCents?.value).toBe(22030);
  });

  it('does not pair unrelated amounts without overlapping OCR boxes', () => {
    const text = 'TOTAL\nItem 40.00';
    const ocrLines = [
      { text: 'TOTAL', left: 0.2, right: 0.4, top: 0.4, bottom: 0.42 },
      { text: '40.00', left: 0.6, right: 0.7, top: 0.6, bottom: 0.62 },
    ];
    expect(extractFields(text, { ocrLines }).totalCents?.value).toBe(4000);
    expect(extractFields(text, { ocrLines }).totalCents?.confidence).toBe('low');
  });

  it('does not mistake an included-GST detail for the payable total', () => {
    const text = 'TOTAL 135.18\nTotal includes GST of\n17.63';
    const ocrLines = [
      { text: 'TOTAL 135.18', left: 0.03, right: 0.18, top: 0.29, bottom: 0.30 },
      { text: 'Total includes GST of', left: 0.04, right: 0.47, top: 0.43, bottom: 0.44 },
      { text: '17.63', left: 0.79, right: 0.85, top: 0.43, bottom: 0.44 },
    ];
    expect(extractFields(text, { ocrLines }).totalCents?.value).toBe(13518);
  });

  it('handles thousands separators', () => {
    expect(extractFields('Grand Total $1,234.50').totalCents?.value).toBe(123450);
  });

  it('falls back to the largest non-tender amount with low confidence', () => {
    const fields = extractFields(`Coffee 4.50\nMuffin 5.00\nCash 20.00\nChange 10.50`);
    expect(fields.totalCents).toEqual({ value: 500, confidence: 'low' });
  });

  it('returns nulls when nothing is found', () => {
    expect(extractFields('')).toEqual({ totalCents: null, gstCents: null, date: null, merchant: null, currency: null });
  });

  it('does not infer currency from a dollar symbol alone', () => {
    expect(extractFields('TOTAL $35.00').currency).toBeNull();
    expect(extractFields('TOTAL NZD 35.00').currency).toEqual({ value: 'NZD', confidence: 'high' });
  });

  it('requires currency context rather than treating receipt words as currency', () => {
    expect(extractFields('QTY 2\nWWW SHOP\nTRY OUR RANGE\nTOTAL $35.00').currency).toBeNull();
    expect(extractFields('PAID 35.00 USD').currency).toEqual({ value: 'USD', confidence: 'high' });
    expect(extractFields('Currency: aud\nTOTAL $35.00').currency).toEqual({ value: 'AUD', confidence: 'high' });
  });

  it('retains evidence line indexes for review', () => {
    const candidates = extractFieldCandidates('SHOP\nTOTAL NZD 35.00', 2);
    expect(candidates.find((item) => item.field === 'amount')).toMatchObject({
      value: 3500, evidence: { imageRevision: 2, lineIndexes: [1] },
    });
  });

  it('suggests the merchant named in a shopping footer when the header is unclear', () => {
    const text = 'Product\nQTY\nTOTAL $18.40\nThanks for shopping at Northside Hardware.';
    expect(extractFields(text).merchant).toEqual({ value: 'Northside Hardware', confidence: 'medium' });
    expect(extractFieldCandidates(text, 3).find((candidate) => candidate.field === 'merchant'))
      .toMatchObject({ evidence: { imageRevision: 3, lineIndexes: [3] } });
  });

  it('keeps a repeated merchant ahead of a shopping footer', () => {
    const text = 'Bluebird Market\nTAX INVOICE\nBluebird Market\nThanks for shopping at Rewards Club';
    expect(extractFields(text).merchant).toEqual({ value: 'Bluebird Market', confidence: 'medium' });
  });

  it('does not treat an unnamed shopping footer as a merchant', () => {
    expect(extractFields('TAX INVOICE\nThanks for shopping at 123').merchant).toBeNull();
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
