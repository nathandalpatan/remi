import { renderClaimPdf, type Batch, type Receipt } from '@remi/core';
import { File, Paths } from 'expo-file-system';
import type { ImagePickerAsset } from 'expo-image-picker';
import * as Sharing from 'expo-sharing';

// shortcut: one in-memory NZD claim, until storage and a currency picker exist.
export const HOME_CURRENCY = 'NZD';

export function newBatch(): Batch {
  const createdAt = new Date().toISOString();
  return { id: createdAt, name: `Expenses ${createdAt.slice(0, 10)}`, createdAt, homeCurrency: HOME_CURRENCY };
}

export function receiptFromPhoto(photo: ImagePickerAsset, batchId: string): Receipt {
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

/** Builds the claim PDF from the receipts' photos, saves it to the cache and opens the share sheet. */
export async function exportAndShare(batch: Batch, receipts: Receipt[]): Promise<void> {
  const pdf = await renderClaimPdf({ batch, receipts, loadImage: (uri) => new File(uri).bytes() });
  const file = new File(Paths.cache, `${batch.name}.pdf`);
  file.create({ overwrite: true });
  await file.write(pdf);
  await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
}
