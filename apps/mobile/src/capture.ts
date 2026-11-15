import { CameraView } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';

export const MAX_GALLERY_RECEIPTS = 50;

export async function pickGalleryReceipts(): Promise<string[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: MAX_GALLERY_RECEIPTS,
    orderedSelection: true,
    quality: 1,
  });
  if (result.canceled) return [];
  return result.assets.slice(0, MAX_GALLERY_RECEIPTS).map((asset) => asset.uri);
}

export async function scanQuickReceipts(): Promise<string[]> {
  if (!CameraView.isDocumentScannerAvailable) {
    throw new Error('Quick Scan is unavailable on this device. Use Remi Camera or import photos.');
  }
  return (await CameraView.scanDocumentAsync())?.pages ?? [];
}
