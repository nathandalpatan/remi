import { describe, expect, it } from 'vitest';
import { extractFields, gstFromInclusive } from '../src/index.js';

// Synthetic receipts modelled on Australian formats. The ABN is made up but passes the
// ABR checksum, so it looks real to the extractor without belonging to a business.

describe('Australian receipts', () => {
  it('reads printed GST on a mixed docket instead of assuming 1/11 of the total', () => {
    // Milk is GST-free, so GST is 2.65 rather than 33.00 / 11 = 3.00.
    const fields = extractFields(`
WOOLWORTHS
Tax Invoice
ABN 51 824 753 556
Milk 2L               3.10
*Tea Bags 100pk       6.00
*Coffee Beans 1kg    23.90
SUBTOTAL             33.00
TOTAL                33.00
Total includes GST    $2.65
* indicates taxable item
Total Savings         $1.50
Everyday Rewards points earned 33
EFTPOS                33.00
02/11/2026 14:22
`);
    expect(fields.totalCents).toEqual({ value: 3300, confidence: 'high' });
    expect(fields.gstCents).toEqual({ value: 265, confidence: 'high' });
    expect(fields.date).toEqual({ value: '2026-11-02', confidence: 'low' });
    expect(fields.merchant?.value).toBe('WOOLWORTHS');
  });

  it('takes the rounded total on a cash docket, not the tendered or change amounts', () => {
    const fields = extractFields(`COLES\nSUBTOTAL 23.47\nROUNDING -0.02\nTOTAL 23.45\nCASH 50.00\nCHANGE 26.55`);
    expect(fields.totalCents?.value).toBe(2345);
  });

  it('does not mistake "Total includes GST" for the total', () => {
    const fields = extractFields(`
The Daily Grind Cafe
Flat White            5.50
Sunday surcharge 15%  0.83
Total includes GST   $0.58
EFTPOS               $6.33
`);
    // No plain TOTAL line, so the amount charged is a low-confidence guess.
    expect(fields.totalCents).toEqual({ value: 633, confidence: 'low' });
    expect(fields.gstCents?.value).toBe(58);
    expect(fields.merchant?.value).toBe('The Daily Grind Cafe');
  });

  it('reads a Tyro EFTPOS slip with a tip', () => {
    const fields = extractFields(`
CUSTOMER COPY
Harbour Bistro
17 Feb 2024 at 06:40 PM
Purchase AUD $112.00
Tip AUD $10.00
TOTAL AUD $122.00
APPROVED 00
`);
    expect(fields.totalCents?.value).toBe(12200);
    expect(fields.date).toEqual({ value: '2024-02-17', confidence: 'high' });
    expect(fields.merchant?.value).toBe('Harbour Bistro');
  });

  it('reads a servo docket with a compact date and a cents-per-litre price', () => {
    const fields = extractFields(`
BP
02NOV26 18:40
Unleaded 91 45.23L @ 189.9c/L
Fuel 85.89
TOTAL 85.89
GST 7.81
`);
    expect(fields.totalCents?.value).toBe(8589);
    expect(fields.gstCents?.value).toBe(781);
    expect(fields.date).toEqual({ value: '2026-11-02', confidence: 'high' });
    expect(fields.merchant?.value).toBe('BP');
  });

  it('reports zero GST on an all GST-free docket and ignores the GST-free subtotal', () => {
    const fields = extractFields(`ALDI\nBananas 1kg 4.00\nGST FREE ITEMS 4.00\nGST 0.00\nTOTAL 4.00`);
    expect(fields.gstCents).toEqual({ value: 0, confidence: 'high' });
  });

  it('leaves GST unknown when the receipt does not print it', () => {
    expect(extractFields(`ALDI\nGST-free total 4.00\nTOTAL 4.00`).gstCents).toBeNull();
  });

  describe('dates', () => {
    it.each([
      ['02-Nov-2026', '2026-11-02'],
      ['02NOV26 18:40', '2026-11-02'],
      ['2 Nov 26', '2026-11-02'],
    ])('parses %s', (text, value) => expect(extractFields(text).date?.value).toBe(value));

    it('does not read a menu item followed by a price as a date', () => {
      expect(extractFields('2 Mayo 12.50').date).toBeNull();
    });
  });
});

describe('gstFromInclusive with the Australian 10% rate', () => {
  it('takes 1/11 of the total', () => {
    expect(gstFromInclusive(3300, 1000)).toBe(300);
    expect(gstFromInclusive(5000, 1000)).toBe(455); // 454.5 rounds up
  });
});
