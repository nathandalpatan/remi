import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedReceipt } from './documents';

const native = vi.hoisted(() => ({
  describeReceiptSource: vi.fn(), detectReceipt: vi.fn(), processImage: vi.fn(), recognizeReceipt: vi.fn(), hashReceiptSource: vi.fn(),
}));
vi.mock('../modules/remi-scan/src', () => native);

import { originalToWorkingTransform, processQueuedImage } from './scanPipeline';

const source = {
  id: 'r', batchId: 'b', image: { uri: 'source.jpg', widthPx: 1000, heightPx: 1500 },
  originalFile: 'r-original.jpg', filter: 'original', processingStatus: 'processing', ocrText: '',
  captureSource: 'gallery', imageRevision: 0, jobRevision: 1, merchant: null, date: null,
  category: null, amountCents: null, amountMinorUnits: null, currency: null, gstCents: null,
  fx: null, notes: '', confirmed: false,
} satisfies SavedReceipt;

const corners = [0.1, 0.1, 0.9, 0.1, 0.9, 0.9, 0.1, 0.9] as const;

beforeEach(() => {
  vi.resetAllMocks();
  native.describeReceiptSource.mockResolvedValue({ rawWidth: 1000, rawHeight: 1500, orientation: 1 });
  native.hashReceiptSource.mockResolvedValue('a'.repeat(64));
  native.detectReceipt.mockResolvedValue({ corners, rawCorners: corners, score: 0.9,
    edgeContact: false, visualLossRisk: 0.1, issues: [] });
  native.processImage.mockResolvedValue({ uri: 'crop.jpg', width: 800, height: 1200,
    sourceToOutput: [1, 0, 0, 0, 1, 0, 0, 0, 1] });
});

describe('processQueuedImage', () => {
  it('falls back to the source when cropping loses recognized text', async () => {
    native.recognizeReceipt.mockImplementation(async (uri: string) => uri === 'source.jpg'
      ? { text: 'MERCHANT DATE TOTAL BARCODE PAYMENT FOOTER', lines: [] }
      : { text: 'MERCHANT DATE TOTAL', lines: [] });
    const result = await processQueuedImage(source, { uri: 'source.jpg', width: 1000, height: 1500 });
    expect(result.processedUri).toBe('source.jpg');
    expect(result.updates.integrity?.issues).toContain('visible_text_loss_risk');
    expect(result.updates.image?.widthPx).toBe(1000);
  });

  it('keeps a geometrically safe crop when OCR wording changes, but requests review', async () => {
    const words = ['MERCHANT', 'DATE', 'TOTAL', 'BARCODE', 'PAYMENT', 'FOOTER'];
    native.recognizeReceipt.mockImplementation(async (uri: string) => uri === 'source.jpg'
      ? { text: words.join(' '), lines: words.map((text, index) => ({
        text, left: 0.2, right: 0.7, top: 0.2 + index * 0.1, bottom: 0.24 + index * 0.1,
      })) }
      : { text: 'MERCHANT DATE TOTAL', lines: [] });
    const result = await processQueuedImage(source, { uri: 'source.jpg', width: 1000, height: 1500 });
    expect(result.processedUri).toBe('crop.jpg');
    expect(result.updates.integrity?.issues).toContain('ocr_disagreement_after_crop');
    expect(result.updates.integrity?.state).toBe('needs_review');
    expect(result.updates.imageProcessing?.corners).toEqual(corners);
  });

  it('falls back when a source text box crosses the candidate crop', async () => {
    const words = ['MERCHANT', 'DATE', 'TOTAL', 'BARCODE', 'PAYMENT', 'FOOTER'];
    native.recognizeReceipt.mockImplementation(async (uri: string) => uri === 'source.jpg'
      ? { text: words.join(' '), lines: words.map((text, index) => ({
        text, left: 0.2, right: 0.7, top: index === 5 ? 0.89 : 0.2 + index * 0.1,
        bottom: index === 5 ? 0.93 : 0.24 + index * 0.1,
      })) }
      : { text: 'MERCHANT DATE TOTAL', lines: [] });
    const result = await processQueuedImage(source, { uri: 'source.jpg', width: 1000, height: 1500 });
    expect(result.processedUri).toBe('source.jpg');
    expect(result.updates.integrity?.issues).toContain('visible_text_loss_risk');
  });

  it('falls back when source OCR cannot locate all text boxes', async () => {
    native.recognizeReceipt.mockImplementation(async (uri: string) => uri === 'source.jpg'
      ? { text: 'MERCHANT DATE TOTAL BARCODE PAYMENT FOOTER', lines: [
        { text: 'MERCHANT', top: 0.2, bottom: 0.25, right: 0.7 },
      ] }
      : { text: 'MERCHANT DATE TOTAL', lines: [] });
    const result = await processQueuedImage(source, { uri: 'source.jpg', width: 1000, height: 1500 });
    expect(result.processedUri).toBe('source.jpg');
    expect(result.updates.integrity?.issues).toContain('visible_text_loss_risk');
  });

  it('does not crop when source OCR fails before validation', async () => {
    native.recognizeReceipt.mockRejectedValueOnce(new Error('source OCR failed'))
      .mockResolvedValue({ text: 'SHOP TOTAL 12.34', lines: [] });
    const result = await processQueuedImage(source, { uri: 'source.jpg', width: 1000, height: 1500 });
    expect(native.processImage).not.toHaveBeenCalled();
    expect(result.processedUri).toBe('source.jpg');
    expect(result.updates.integrity?.issues).toContain('crop_validation_unavailable');
    expect(result.updates.imageProcessing?.corners).toBeNull();
  });

  it('falls back to source OCR when cropped image OCR fails with little text', async () => {
    native.recognizeReceipt.mockImplementation(async (uri: string) => {
      if (uri === 'crop.jpg') throw new Error('processed OCR failed');
      return { text: 'TOTAL 12.34', lines: [] };
    });
    const result = await processQueuedImage(source, { uri: 'source.jpg', width: 1000, height: 1500 });
    expect(result.processedUri).toBe('source.jpg');
    expect(result.updates.ocrText).toBe('TOTAL 12.34');
    expect(result.updates.integrity?.issues).toContain('processed_ocr_failed');
    expect(result.updates.imageProcessing?.corners).toBeNull();
  });

  it('falls back when cropped image OCR returns no text from a readable source', async () => {
    native.recognizeReceipt.mockImplementation(async (uri: string) => uri === 'crop.jpg'
      ? { text: '', lines: [] }
      : { text: 'TOTAL 12.34', lines: [] });
    const result = await processQueuedImage(source, { uri: 'source.jpg', width: 1000, height: 1500 });
    expect(result.processedUri).toBe('source.jpg');
    expect(result.updates.ocrText).toBe('TOTAL 12.34');
    expect(result.updates.integrity?.issues).toContain('visible_text_loss_risk');
  });

  it('avoids an automatic crop when visual content may be lost', async () => {
    native.detectReceipt.mockResolvedValue({ corners, rawCorners: corners, score: 0.9,
      edgeContact: false, visualLossRisk: 0.8, issues: ['visual_features_near_crop'] });
    native.recognizeReceipt.mockResolvedValue({ text: 'TOTAL 12.34', lines: [] });
    const result = await processQueuedImage(source, { uri: 'source.jpg', width: 1000, height: 1500 });
    expect(native.processImage).not.toHaveBeenCalled();
    expect(result.processedUri).toBe('source.jpg');
    expect(result.updates.integrity?.state).toBe('needs_review');
  });

  it('does not call an OS-scanned page complete without source boundary evidence', async () => {
    native.recognizeReceipt.mockResolvedValue({ text: 'SHOP TOTAL 12.34', lines: [] });
    const result = await processQueuedImage({ ...source, captureSource: 'system_scanner',
      originalPhotoAvailable: false }, { uri: 'source.jpg', width: 1000, height: 1500 });
    expect(native.detectReceipt).not.toHaveBeenCalled();
    expect(result.updates.integrity?.state).toBe('needs_review');
    expect(result.updates.integrity?.issues).toContain('source_integrity_unassessed');
  });

  it('falls back and requests review for low-confidence boundaries', async () => {
    native.detectReceipt.mockResolvedValue({ corners, rawCorners: corners, score: 0.5,
      edgeContact: false, visualLossRisk: 0.1, issues: [] });
    native.recognizeReceipt.mockResolvedValue({ text: 'SHOP TOTAL 12.34', lines: [] });
    const result = await processQueuedImage(source, { uri: 'source.jpg', width: 1000, height: 1500 });
    expect(native.processImage).not.toHaveBeenCalled();
    expect(result.updates.integrity?.issues).toContain('low_boundary_confidence');
  });

  it('maps a uniformly resized working image to the immutable source', async () => {
    native.recognizeReceipt.mockResolvedValue({ text: 'SHOP TOTAL 12.34', lines: [] });
    const result = await processQueuedImage(source, { uri: 'normalized.jpg', width: 800, height: 1200 });
    expect(result.updates.imageProcessing?.originalWidth).toBe(1000);
    expect(result.updates.imageProcessing?.originalHeight).toBe(1500);
    expect(result.updates.imageProcessing?.originalToWorking).toEqual([0.8, 0, 0, 0, 0.8, 0, 0, 0, 1]);
    expect(result.updates.integrity?.issues).not.toContain('source_coordinate_mapping_unavailable');
  });

  it('leaves the mapping unavailable when dimensions disagree with EXIF orientation', async () => {
    native.describeReceiptSource.mockResolvedValue({ rawWidth: 1000, rawHeight: 1500, orientation: 6 });
    native.recognizeReceipt.mockResolvedValue({ text: 'SHOP TOTAL 12.34', lines: [] });
    const result = await processQueuedImage(source, { uri: 'normalized.jpg', width: 800, height: 1200 });
    expect(result.updates.imageProcessing?.originalToWorking).toBeUndefined();
  });

  it('keeps the source image when automatic crop processing fails', async () => {
    native.processImage.mockRejectedValue(new Error('native crop failed'));
    native.recognizeReceipt.mockResolvedValue({ text: 'SHOP TOTAL 12.34', lines: [] });
    const result = await processQueuedImage(source, { uri: 'source.jpg', width: 1000, height: 1500 });
    expect(result.processedUri).toBe('source.jpg');
    expect(result.updates.integrity?.issues).toContain('crop_processing_failed');
    expect(result.updates.imageProcessing?.corners).toBeNull();
  });
});

describe('originalToWorkingTransform', () => {
  const point = (matrix: number[], x: number, y: number) => [
    matrix[0]! * x + matrix[1]! * y + matrix[2]!,
    matrix[3]! * x + matrix[4]! * y + matrix[5]!,
  ];

  it.each([
    [1, [0, 0], [200, 0], [0, 150]],
    [2, [200, 0], [0, 0], [200, 150]],
    [3, [200, 150], [0, 150], [200, 0]],
    [4, [0, 150], [200, 150], [0, 0]],
    [5, [0, 0], [0, 200], [150, 0]],
    [6, [150, 0], [150, 200], [0, 0]],
    [7, [150, 200], [150, 0], [0, 200]],
    [8, [0, 200], [0, 0], [150, 200]],
  ])('maps EXIF orientation %i including mirrored axes', (orientation, origin, topRight, bottomLeft) => {
    const swapped = orientation >= 5;
    const matrix = originalToWorkingTransform({ rawWidth: 400, rawHeight: 300, orientation },
      { uri: 'working.jpg', width: swapped ? 150 : 200, height: swapped ? 200 : 150 }, false);
    expect(matrix).toBeDefined();
    expect(point(matrix!, 0, 0)).toEqual(origin);
    expect(point(matrix!, 400, 0)).toEqual(topRight);
    expect(point(matrix!, 0, 300)).toEqual(bottomLeft);
  });

  it('does not infer a mapping for unsupported orientation or nonuniform resize', () => {
    expect(originalToWorkingTransform({ rawWidth: 400, rawHeight: 300, orientation: 0 },
      { uri: 'working.jpg', width: 200, height: 150 }, false)).toBeUndefined();
    expect(originalToWorkingTransform({ rawWidth: 400, rawHeight: 300, orientation: 1 },
      { uri: 'working.jpg', width: 200, height: 140 }, false)).toBeUndefined();
  });
});
