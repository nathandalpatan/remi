import { beforeEach, describe, expect, it, vi } from 'vitest';

const picker = vi.hoisted(() => ({ launchImageLibraryAsync: vi.fn() }));
const scanner = vi.hoisted(() => ({ scanDocumentAsync: vi.fn(), available: true }));

vi.mock('expo-image-picker', () => ({ launchImageLibraryAsync: picker.launchImageLibraryAsync }));
vi.mock('expo-camera', () => ({ CameraView: {
  get isDocumentScannerAvailable() { return scanner.available; },
  scanDocumentAsync: scanner.scanDocumentAsync,
} }));

import { MAX_GALLERY_RECEIPTS, pickGalleryReceipts, scanQuickReceipts } from './capture';

beforeEach(() => {
  picker.launchImageLibraryAsync.mockReset();
  scanner.scanDocumentAsync.mockReset();
  scanner.available = true;
});

describe('receipt capture sources', () => {
  it('selects a bounded ordered gallery batch without picker cropping', async () => {
    const assets = Array.from({ length: 51 }, (_, index) => ({ uri: `file:///receipt-${index}.jpg` }));
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets });
    const uris = await pickGalleryReceipts();
    expect(uris).toHaveLength(MAX_GALLERY_RECEIPTS);
    expect(uris[0]).toBe(assets[0]!.uri);
    expect(uris.at(-1)).toBe(assets[49]!.uri);
    expect(picker.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({
      allowsMultipleSelection: true, selectionLimit: 50, orderedSelection: true,
    }));
  });

  it('returns an empty batch on gallery cancellation', async () => {
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: null });
    expect(await pickGalleryReceipts()).toEqual([]);
  });

  it('returns all Quick Scan pages in order', async () => {
    scanner.scanDocumentAsync.mockResolvedValue({ pages: ['file:///one.jpg', 'file:///two.jpg'] });
    expect(await scanQuickReceipts()).toEqual(['file:///one.jpg', 'file:///two.jpg']);
  });

  it('rejects unavailable Quick Scan without opening it', async () => {
    scanner.available = false;
    await expect(scanQuickReceipts()).rejects.toThrow('unavailable');
    expect(scanner.scanDocumentAsync).not.toHaveBeenCalled();
  });
});
