import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { ExportBlockedError, packReceipts, renderClaimPdf, toCsv, type Batch } from '../src/index.js';
import { makeReceipt, solidPng } from './fixtures.js';

const batch: Batch = { id: 'b1', name: 'October travel', createdAt: '2026-11-01T09:00:00Z', homeCurrency: 'NZD' };

describe('renderClaimPdf', () => {
  it('writes a cover page followed by the packed pages', async () => {
    const receipts = Array.from({ length: 7 }, (_, i) =>
      makeReceipt({
        id: `r${i}`,
        merchant: i === 0 ? 'Kōhanga Café — Wellington' : `Store ${i}`,
        image: { uri: `r${i}`, widthPx: 120, heightPx: 120 * (2 + i) },
      }),
    );
    const images = new Map(receipts.map((r, i) => [r.image.uri, solidPng(r.image.widthPx, r.image.heightPx, [i * 30, 100, 200])]));
    const bytes = await renderClaimPdf({ batch, receipts, loadImage: async (uri) => images.get(uri)! });

    const pdf = await PDFDocument.load(bytes);
    const expectedPages = packReceipts(receipts.map((r) => ({ id: r.id, ...r.image }))).pageCount;
    expect(pdf.getPageCount()).toBe(1 + expectedPages);
    expect(pdf.getTitle()).toBe('October travel');
  });

  it('refuses to export while receipts have issues', async () => {
    const receipts = [makeReceipt({ confirmed: false })];
    await expect(renderClaimPdf({ batch, receipts, loadImage: async () => new Uint8Array() })).rejects.toBeInstanceOf(
      ExportBlockedError,
    );
  });

  it('rejects unsupported image formats', async () => {
    await expect(
      renderClaimPdf({ batch, receipts: [makeReceipt()], loadImage: async () => new Uint8Array([1, 2, 3]) }),
    ).rejects.toThrow(/Unsupported image format/);
  });
});

describe('toCsv', () => {
  it('writes one escaped row per receipt', () => {
    const csv = toCsv(
      [
        makeReceipt({ merchant: 'Smith, Jones & "Co"', notes: '=HYPERLINK("x")' }),
        makeReceipt({ id: 'r2', amountCents: 5000, currency: 'USD', gstCents: null, fx: { rate: 1.7, rateDate: '2026-10-02' } }),
      ],
      'NZD',
    );
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(
      'number,date,merchant,category,amount,currency,fx_rate,fx_rate_date,home_amount,home_currency,gst,notes,confirmed',
    );
    expect(lines[1]).toBe(
      '1,2026-10-01,"Smith, Jones & ""Co""",Meals,12.50,NZD,,,12.50,NZD,1.63,"\'=HYPERLINK(""x"")",yes',
    );
    expect(lines[2]).toBe('2,2026-10-01,Cafe Uno,Meals,50.00,USD,1.7,2026-10-02,85.00,NZD,,,yes');
    expect(lines[3]).toBe('');
  });
});
