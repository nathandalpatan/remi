import { PDFDocument, PDFPage } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';
import { ExportBlockedError, moveColumnTile, packColumns, renderClaimPdf, renderReceiptPdf, toCsv, type Batch } from '../src/index.js';
import { makeReceipt, solidPng } from './fixtures.js';

const batch: Batch = { id: 'b1', name: 'October travel', createdAt: '2026-11-01T09:00:00Z', homeCurrency: 'NZD' };

describe('renderClaimPdf', () => {
  it('writes a cover page followed by the packed pages', async () => {
    const receipts = Array.from({ length: 7 }, (_, i) =>
      makeReceipt({
        id: `r${i}`,
        merchant: i === 0 ? 'Kōhanga Café — Wellington' : `Store ${i}`,
        image: { uri: `r${i}`, widthPx: 120, heightPx: 180 },
      }),
    );
    const images = new Map(receipts.map((r, i) => [r.image.uri, solidPng(r.image.widthPx, r.image.heightPx, [i * 30, 100, 200])]));
    const bytes = await renderClaimPdf({ batch, receipts, loadImage: async (uri) => images.get(uri)! });

    const pdf = await PDFDocument.load(bytes);
    const expectedPages = packColumns(receipts.map((r) => ({ id: r.id, widthPx: r.image.widthPx, heightPx: r.image.heightPx }))).pageCount;
    expect(pdf.getPageCount()).toBe(1 + expectedPages);
    expect(pdf.getTitle()).toBe('October travel');
  });

  it('refuses to export while receipts have issues', async () => {
    const receipts = [makeReceipt({ financialVerification: {
      amount: { status: 'provisional' },
      currency: { status: 'verified', evidence: { source: 'user', imageRevision: 0 } },
    } })];
    await expect(renderClaimPdf({ batch, receipts, loadImage: async () => new Uint8Array() })).rejects.toBeInstanceOf(
      ExportBlockedError,
    );
  });

  it('rejects unsupported image formats', async () => {
    await expect(
      renderClaimPdf({ batch, receipts: [makeReceipt({ image: { uri: 'r', widthPx: 120, heightPx: 180 } })], loadImage: async () => new Uint8Array([1, 2, 3]) }),
    ).rejects.toThrow(/Unsupported image format/);
  });

  it('draws images at the editor placements and keeps the claim cover', async () => {
    const receipts = [makeReceipt({ id: 'a', image: { uri: 'a', widthPx: 120, heightPx: 180 } }),
      makeReceipt({ id: 'b', image: { uri: 'b', widthPx: 120, heightPx: 180 } })];
    const original = packColumns(receipts.map((receipt) => ({ id: receipt.id, widthPx: receipt.image.widthPx, heightPx: receipt.image.heightPx })));
    const layout = moveColumnTile(original, 'b', 1, { pageIndex: 1, columnIndex: 1, index: 0 });
    const draw = vi.spyOn(PDFPage.prototype, 'drawImage');
    try {
      const bytes = await renderClaimPdf({ batch, receipts, layout, loadImage: async () => solidPng(120, 180, [20, 30, 40]) });
      const pdf = await PDFDocument.load(bytes);
      expect(pdf.getPageCount()).toBe(1 + layout.pageCount);
      expect(draw).toHaveBeenCalledTimes(layout.tiles.length);
      layout.tiles.forEach((tile, index) => {
        const options = draw.mock.calls[index]![1];
        const points = 72 / 25.4;
        const fullHeight = tile.imageHeightMm * points / (tile.sourceBottom - tile.sourceTop);
        expect(options!.x).toBeCloseTo(tile.xMm * points);
        expect(options!.width).toBeCloseTo(tile.widthMm * points);
        expect(options!.y).toBeCloseTo((layout.spec.heightMm - tile.yMm - layout.spec.labelHeightMm) * points - fullHeight * (1 - tile.sourceTop));
        expect(options!.height).toBeCloseTo(fullHeight);
      });
    } finally { draw.mockRestore(); }
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
    expect(lines[2]).toBe('2,2026-10-01,Cafe Uno,Meals,50.00,USD,1.7,2026-10-02,,NZD,,,yes');
    expect(lines[3]).toBe('');
  });

  it('does not label excluded or stale evidence as confirmed claim amounts', () => {
    const csv = toCsv([
      makeReceipt({ id: 'excluded', claimIncluded: false }),
      makeReceipt({ id: 'stale', imageRevision: 1 }),
    ], 'NZD');
    const lines = csv.split('\r\n');
    expect(lines[1]).toBe('1,2026-10-01,Cafe Uno,Meals,12.50,NZD,,,,NZD,1.63,,no');
    expect(lines[2]).toBe('2,2026-10-01,Cafe Uno,Meals,12.50,NZD,,,,NZD,1.63,,no');
  });

  it('leaves GST blank for currencies whose minor units are not cents', () => {
    const csv = toCsv([
      makeReceipt({ id: 'jp', currency: 'JPY', amountCents: null, amountMinorUnits: 1000, gstCents: 1000 }),
      makeReceipt({ id: 'kw', currency: 'KWD', amountCents: null, amountMinorUnits: 1234, gstCents: 1000 }),
      makeReceipt({ id: 'nz', currency: 'NZD', gstCents: 163 }),
    ], 'NZD');
    const [, jpy, kwd, nzd] = csv.trim().split('\r\n');
    expect(jpy?.split(',')[10]).toBe('');
    expect(kwd?.split(',')[10]).toBe('');
    expect(nzd?.split(',')[10]).toBe('1.63');
  });

  it('leaves GST and claim amounts blank for invalid legacy currency codes', () => {
    const csv = toCsv([
      makeReceipt({ id: 'missing', currency: 'QTY', amountCents: null, gstCents: 163 }),
      makeReceipt({ id: 'legacy', currency: 'QTY', amountCents: 1250, gstCents: 163 }),
      makeReceipt({ id: 'minor', currency: 'QTY', amountCents: null, amountMinorUnits: 1250, gstCents: 163 }),
    ], 'NZD');
    const [, missing, legacy, minor] = csv.trim().split('\r\n');
    for (const row of [missing, legacy, minor]) {
      const columns = row?.split(',');
      expect(columns?.[4]).toBe('');
      expect(columns?.[8]).toBe('');
      expect(columns?.[10]).toBe('');
      expect(columns?.[12]).toBe('no');
    }
  });
});

describe('export configurations', () => {
  const photo = { uri: 'photo', widthPx: 120, heightPx: 180 };

  it('exports image-only evidence without financial verification', async () => {
    const receipt = makeReceipt({ image: photo, amountCents: null, amountMinorUnits: null, currency: null,
      financialVerification: { amount: { status: 'unverified' }, currency: { status: 'unverified' } } });
    const bytes = await renderReceiptPdf({ batch, receipts: [receipt], config: { mode: 'image_only', receiptIds: [receipt.id] },
      loadImage: async () => solidPng(120, 180, [10, 20, 30]) });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it('blocks a claim with an included unverified receipt instead of omitting its amount', async () => {
    const receipts = [makeReceipt({ id: 'ready', image: photo }), makeReceipt({ id: 'pending', image: photo,
      financialVerification: { amount: { status: 'provisional' }, currency: { status: 'verified',
        evidence: { source: 'user', imageRevision: 0 } } } })];
    await expect(renderReceiptPdf({ batch, receipts, config: { mode: 'reimbursement', includeSummary: true,
      listExcluded: true }, loadImage: async () => solidPng(120, 180, [10, 20, 30]) }))
      .rejects.toBeInstanceOf(ExportBlockedError);
  });

  it('keeps source receipt numbers on the cover and images after excluding a middle receipt', async () => {
    const image = { uri: 'photo', widthPx: 120, heightPx: 180 };
    const receipts = [makeReceipt({ id: 'first', merchant: 'First', image }),
      makeReceipt({ id: 'excluded', merchant: 'Excluded', claimIncluded: false, image }),
      makeReceipt({ id: 'last', merchant: 'Last', image })];
    const draw = vi.spyOn(PDFPage.prototype, 'drawText');
    try {
      await renderReceiptPdf({ batch, receipts, config: { mode: 'reimbursement', includeSummary: true,
        listExcluded: false }, loadImage: async () => solidPng(120, 180, [10, 20, 30]) });
      const labels = draw.mock.calls.map(([text]) => text);
      expect(labels).toContain('#3 2026-10-01 Last 12.50 NZD');
      expect(labels).toContain('#3 Last');
      expect(labels.some((text) => text.startsWith('#2'))).toBe(false);
    } finally { draw.mockRestore(); }
  });

  it('omits excluded images from reimbursement but permits them in image-only output', async () => {
    const receipts = [makeReceipt({ id: 'included', image: { ...photo, uri: 'included' } }),
      makeReceipt({ id: 'excluded', claimIncluded: false, image: { ...photo, uri: 'excluded' } })];
    const loaded: string[] = [];
    const loadImage = async (uri: string) => { loaded.push(uri); return solidPng(120, 180, [10, 20, 30]); };
    await renderReceiptPdf({ batch, receipts, config: { mode: 'reimbursement', includeSummary: true,
      listExcluded: true }, loadImage });
    expect(loaded).toEqual(['included']);
    loaded.length = 0;
    await renderReceiptPdf({ batch, receipts, config: { mode: 'image_only', receiptIds: ['excluded'] }, loadImage });
    expect(loaded).toEqual(['excluded']);
  });

  it('refuses to split a long receipt without a safe page break', async () => {
    await expect(renderReceiptPdf({ batch, receipts: [makeReceipt({ image: { uri: 'long', widthPx: 120, heightPx: 2400 } })],
      config: { mode: 'image_only', receiptIds: ['r1'] }, loadImage: async () => solidPng(120, 2400, [10, 20, 30]) }))
      .rejects.toThrow(/safe page break/);
  });

  it('exports every part of a long source at user-confirmed blank page breaks', async () => {
    const breaks = Array.from({ length: 9 }, (_, index) => (index + 1) / 10);
    const receipt = makeReceipt({ image: { uri: 'long', widthPx: 120, heightPx: 2400 },
      breakFractions: breaks });
    const layout = packColumns([{ id: receipt.id, widthPx: 120, heightPx: 2400, breaks }]);
    expect(layout.needsBreak).toEqual([]);
    expect(layout.tiles.map((tile) => [tile.sourceTop, tile.sourceBottom])).toEqual(
      Array.from({ length: 10 }, (_, index) => [index / 10, (index + 1) / 10]),
    );
    const draw = vi.spyOn(PDFPage.prototype, 'drawImage');
    try {
      await renderReceiptPdf({ batch, receipts: [receipt],
        config: { mode: 'image_only', receiptIds: [receipt.id] },
        loadImage: async () => solidPng(120, 2400, [10, 20, 30]) });
      expect(draw).toHaveBeenCalledTimes(10);
    } finally { draw.mockRestore(); }
  });

  it('discloses acknowledged image issues even with the financial summary disabled', async () => {
    const drawText = vi.spyOn(PDFPage.prototype, 'drawText');
    const receipt = makeReceipt({ image: photo, integrity: {
      state: 'incomplete', issues: ['bottom_missing'], imageRevision: 0, assessmentRevision: 2,
      acknowledged: { imageRevision: 0, assessmentRevision: 2, issues: ['bottom_missing'] },
    } });
    try {
      const bytes = await renderReceiptPdf({ batch, receipts: [receipt],
        config: { mode: 'reimbursement', includeSummary: false, listExcluded: false },
        loadImage: async () => solidPng(120, 180, [10, 20, 30]) });
      expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
      expect(drawText.mock.calls.some(([value]) => value.includes('bottom_missing'))).toBe(true);
      expect(drawText.mock.calls.some(([value]) => value.includes('IMAGE WARNING'))).toBe(true);
    } finally { drawText.mockRestore(); }
  });

  it('projects a selected image subset without moving its pinned tile', async () => {
    const receipts = [makeReceipt({ id: 'a', image: { ...photo, uri: 'a' } }),
      makeReceipt({ id: 'b', image: { ...photo, uri: 'b' } })];
    const original = packColumns(receipts.map((receipt) => ({ id: receipt.id,
      widthPx: receipt.image.widthPx, heightPx: receipt.image.heightPx })));
    const layout = moveColumnTile(original, 'b', 1, { pageIndex: 1, columnIndex: 1, index: 0 });
    const draw = vi.spyOn(PDFPage.prototype, 'drawImage');
    try {
      const bytes = await renderReceiptPdf({ batch, receipts, layout,
        config: { mode: 'image_only', receiptIds: ['b'] },
        loadImage: async () => solidPng(120, 180, [10, 20, 30]) });
      expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
      expect(draw).toHaveBeenCalledTimes(1);
      expect(draw.mock.calls[0]![1]!.x).toBeCloseTo(layout.tiles.find((tile) => tile.receiptId === 'b')!.xMm * 72 / 25.4);
    } finally { draw.mockRestore(); }
  });

  it('keeps the selected column count when source images require repacking', async () => {
    const draw = vi.spyOn(PDFPage.prototype, 'drawImage');
    try {
      await renderReceiptPdf({ batch, receipts: [makeReceipt({ image: { ...photo, heightPx: 100 } })],
        config: { mode: 'image_only', receiptIds: ['r1'], columnCount: 1 },
        loadImage: async () => solidPng(120, 100, [10, 20, 30]) });
      const expected = packColumns([{ id: 'r1', widthPx: 120, heightPx: 100 }], 1);
      expect(draw.mock.calls[0]![1]!.width).toBeCloseTo(expected.tiles[0]!.widthMm * 72 / 25.4);
    } finally { draw.mockRestore(); }
  });

  it('shows separate currency totals and optional excluded details on the cover', async () => {
    const drawText = vi.spyOn(PDFPage.prototype, 'drawText');
    const receipts = [makeReceipt({ id: 'nzd', image: { ...photo, uri: 'nzd' } }),
      makeReceipt({ id: 'aud', currency: 'AUD', amountCents: 8000, amountMinorUnits: 8000,
        image: { ...photo, uri: 'aud' } }),
      makeReceipt({ id: 'excluded', claimIncluded: false, image: { ...photo, uri: 'excluded' } })];
    try {
      await renderReceiptPdf({ batch, receipts,
        config: { mode: 'reimbursement', includeSummary: true, listExcluded: true },
        loadImage: async () => solidPng(120, 180, [10, 20, 30]) });
      const lines = drawText.mock.calls.map(([value]) => value);
      expect(lines.some((value) => value.includes('NZD 12.50'))).toBe(true);
      expect(lines.some((value) => value.includes('AUD 80.00'))).toBe(true);
      expect(lines.some((value) => value.includes('Excluded from this claim'))).toBe(true);
    } finally { drawText.mockRestore(); }
  });
});
