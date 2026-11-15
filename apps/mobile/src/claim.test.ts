import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  render: vi.fn(), manipulate: vi.fn(), recognize: vi.fn(),
}));
vi.mock('@remi/core', () => ({ renderReceiptPdf: mocks.render }));
vi.mock('expo-image-manipulator', () => ({
  manipulateAsync: mocks.manipulate,
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
}));
vi.mock('../modules/remi-scan/src', () => ({ recognizeReceipt: mocks.recognize }));
vi.mock('expo-file-system', () => ({ File: class {}, Paths: { cache: 'cache' } }));
vi.mock('expo-sharing', () => ({ shareAsync: vi.fn() }));

import { renderPdf } from './claim';
import type { Batch, Receipt } from '@remi/core';

const batch: Batch = { id: 'b', name: 'Claim', createdAt: '2026-11-14', homeCurrency: 'NZD' };
const receipt = {
  id: 'r', batchId: 'b', image: { uri: 'source.heic', widthPx: 1000, heightPx: 1500 },
  merchant: null, date: null, category: null, amountCents: null, currency: null,
  gstCents: null, fx: null, notes: '', confirmed: false,
} satisfies Receipt;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.render.mockResolvedValue(new Uint8Array([1]));
  mocks.manipulate.mockResolvedValue({ uri: 'upright.jpg', width: 1200, height: 800 });
  mocks.recognize.mockResolvedValue({ text: 'TOTAL', lines: [{ top: 0.2, bottom: 0.3 }] });
});

describe('renderPdf source selection', () => {
  it('normalizes a selected source locally and uses its actual orientation and OCR boxes', async () => {
    await renderPdf(batch, [receipt], undefined,
      { mode: 'image_only', receiptIds: ['r'], originalIds: ['r'] });
    expect(mocks.manipulate).toHaveBeenCalledWith('source.heic', [],
      { compress: 1, format: 'jpeg' });
    expect(mocks.recognize).toHaveBeenCalledWith('upright.jpg');
    const options = mocks.render.mock.calls[0]![0];
    expect(options.receipts[0].image).toEqual({ uri: 'upright.jpg', widthPx: 1200, heightPx: 800 });
    expect(options.receipts[0].ocrLines).toEqual([{ top: 0.2, bottom: 0.3 }]);
    expect(options.layout).toBeUndefined();
  });

  it('applies source-only manual breaks for the current image revision', async () => {
    await renderPdf(batch, [{ ...receipt, imageRevision: 3 }], undefined,
      { mode: 'image_only', receiptIds: ['r'], originalIds: ['r'],
        originalBreaks: { r: { imageRevision: 3, fractions: [0.25, 0.5, 0.75] } } });
    expect(mocks.render.mock.calls[0]![0].receipts[0].breakFractions).toEqual([0.25, 0.5, 0.75]);
    vi.clearAllMocks();
    mocks.render.mockResolvedValue(new Uint8Array([1]));
    mocks.manipulate.mockResolvedValue({ uri: 'upright.jpg', width: 1200, height: 800 });
    mocks.recognize.mockResolvedValue({ text: 'TOTAL', lines: [] });
    await renderPdf(batch, [{ ...receipt, imageRevision: 4 }], undefined,
      { mode: 'image_only', receiptIds: ['r'], originalIds: ['r'],
        originalBreaks: { r: { imageRevision: 3, fractions: [0.25] } } });
    expect(mocks.render.mock.calls[0]![0].receipts[0].breakFractions).toBeUndefined();
  });

  it('keeps the saved processed image and layout when no source is selected', async () => {
    const layout = { version: 1, columnCount: 2, spec: {}, pageCount: 0, tiles: [], needsBreak: [] } as const;
    await renderPdf(batch, [{ ...receipt, image: { ...receipt.image, uri: 'processed.jpg' } }],
      layout as never, { mode: 'image_only', receiptIds: ['r'] });
    expect(mocks.manipulate).not.toHaveBeenCalled();
    expect(mocks.render.mock.calls[0]![0].layout).toBe(layout);
  });
});
