import { renderReceiptPdf, type Batch, type ColumnLayout, type DuplicateDecision, type ExportConfig, type Receipt } from '@remi/core';
import { File, Paths } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Sharing from 'expo-sharing';
import { recognizeReceipt } from '../modules/remi-scan/src';

export const HOME_CURRENCY = 'NZD';

export function newBatch(): Batch {
  const createdAt = new Date().toISOString();
  return { id: createdAt, name: `Expenses ${createdAt.slice(0, 10)}`, createdAt, homeCurrency: HOME_CURRENCY };
}

export function receiptFromPhoto(photo: { uri: string; width: number; height: number }, batchId: string): Receipt {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    batchId,
    image: { uri: photo.uri, widthPx: photo.width, heightPx: photo.height },
    merchant: null,
    date: null,
    category: null,
    amountCents: null,
    currency: HOME_CURRENCY,
    gstCents: null,
    fx: null,
    notes: '',
    confirmed: false,
  };
}

export async function renderPdf(batch: Batch, receipts: Receipt[], layout?: ColumnLayout,
  config?: ExportConfig, duplicateDecisions?: DuplicateDecision[]): Promise<Uint8Array> {
  const originalIds = new Set(config?.mode === 'image_only'
    ? (config.originalIds ?? []).filter((id) => config.receiptIds.includes(id)) : []);
  const originalBreaks = config?.mode === 'image_only' ? config.originalBreaks : undefined;
  const prepared: Receipt[] = [];
  for (const receipt of receipts) {
    if (!originalIds.has(receipt.id)) { prepared.push(receipt); continue; }
    const normalized = await ImageManipulator.manipulateAsync(receipt.image.uri, [], {
      compress: 1,
      format: /\.png(?:\?|$)/i.test(receipt.image.uri)
        ? ImageManipulator.SaveFormat.PNG : ImageManipulator.SaveFormat.JPEG,
    });
    const image = { uri: normalized.uri, widthPx: normalized.width, heightPx: normalized.height };
    try {
      const recognition = await recognizeReceipt(image.uri);
      prepared.push({ ...receipt, image, ocrLines: recognition.lines.map(({ top, bottom }) => ({ top, bottom })),
        breakFractions: originalBreaks?.[receipt.id]?.imageRevision === (receipt.imageRevision ?? 0)
          ? originalBreaks[receipt.id]!.fractions : undefined });
    } catch {
      prepared.push({ ...receipt, image, ocrLines: undefined,
        breakFractions: originalBreaks?.[receipt.id]?.imageRevision === (receipt.imageRevision ?? 0)
          ? originalBreaks[receipt.id]!.fractions : undefined });
    }
  }
  return renderReceiptPdf({ batch, receipts: prepared, config, duplicateDecisions,
    loadImage: (uri) => new File(uri).bytes(), ...(layout && !originalIds.size ? { layout } : {}) });
}

export async function sharePdf(uri: string): Promise<void> {
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
}

export async function previewPdf(batch: Batch, receipts: Receipt[], layout: ColumnLayout | undefined, revision: number,
  config?: ExportConfig, duplicateDecisions?: DuplicateDecision[]): Promise<void> {
  const file = new File(Paths.cache, `remi-preview-${batch.id}-${revision}.pdf`);
  await file.write(await renderPdf(batch, receipts, layout, config, duplicateDecisions));
  if (await file.canPreview({ mimeType: 'application/pdf' })) await file.preview({ title: batch.name, mimeType: 'application/pdf' });
  else await sharePdf(file.uri);
}
