import { currencyMinorDigits, extractFieldCandidates, extractFields, formatMinorUnits, parseAmountToCents, parseAmountToMinorUnits, revalidateFinancialEvidence, summarizeClaim, type ColumnCount, type ExportConfig, type Receipt } from '@remi/core';
import { CameraView } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Alert, Image, Platform, Pressable, SafeAreaView, ScrollView, StatusBar as NativeStatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { detectCorners, processImage, recognizeReceipt, type Corners } from './modules/remi-scan/src';
import { HOME_CURRENCY, previewPdf, receiptFromPhoto, renderPdf, sharePdf } from './src/claim';
import { cancelQueuedReceipt, claimNextReceipt, cleanupFiles, completeReceiptProcessing, createDocument, deleteDocument, exportUri, failReceiptProcessing, getDocument, listDocuments, newId, originalUri, queueReceipt, recoverDocuments, retryReceiptProcessing, saveExport, saveReceipt, updateDocument, type SavedDocument, type SavedReceipt, type ScanFilter } from './src/documents';
import { ScanPreview, type PendingScan } from './src/ScanPreview';
import { BreakEditor } from './src/BreakEditor';
import { DocumentEditor } from './src/DocumentEditor';
import { DocumentHome } from './src/DocumentHome';
import { AddReceipts } from './src/AddReceipts';
import { RemiCamera } from './src/RemiCamera';
import { pickGalleryReceipts, scanQuickReceipts } from './src/capture';
import { processQueuedImage } from './src/scanPipeline';
import { ExportScreen } from './src/ExportScreen';
import { theme } from './src/theme';
import type { ColumnLayout } from '@remi/core';

type WorkingScan = PendingScan & {
  sourceUri: string;
  replaceId?: string;
  preserveFields?: boolean;
  initialProcessedUri?: string;
  integrity?: SavedReceipt['integrity'];
  imageProcessing?: SavedReceipt['imageProcessing'];
};

function gstUsesCents(currency: string | null): boolean {
  if (!currency) return false;
  try { return currencyMinorDigits(currency) === 2; }
  catch { return false; }
}

export default function App() {
  const [documents, setDocuments] = useState<SavedDocument[]>([]);
  const [active, setActive] = useState<SavedDocument | null>(null);
  const [scan, setScan] = useState<WorkingScan | null>(null);
  const [scanPages, setScanPages] = useState<string[]>([]);
  const [editing, setEditing] = useState<SavedReceipt | null>(null);
  const [breaking, setBreaking] = useState<{ receipt: SavedReceipt; columns: ColumnCount } | null>(null);
  const [amountText, setAmountText] = useState('');
  const [gstText, setGstText] = useState('');
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'failed'>('saved');
  const [retry, setRetry] = useState<(() => void) | null>(null);
  const [busy, setBusy] = useState(false);
  const [addMenu, setAddMenu] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const pendingWrites = useRef(0);
  const scanLock = useRef(false);
  const queueLock = useRef(false);
  const queueRequested = useRef(false);

  useEffect(() => {
    recoverDocuments().then(listDocuments).then((saved) => {
      setDocuments(saved);
      void runQueue();
    }).catch((error) => {
      setSaveState('failed');
      Alert.alert('Could not open documents', String(error));
    });
  }, []);

  async function refresh(id?: string, openDocument = false) {
    setDocuments(await listDocuments());
    if (id) {
      const saved = await getDocument(id);
      setActive((current) => {
        if (!openDocument && current?.batch.id !== id) return current;
        if (saved && current?.batch.id === id && saved.revision < current.revision) return current;
        return saved;
      });
    }
  }

  async function commit(change: (doc: SavedDocument) => SavedDocument): Promise<SavedDocument | null> {
    if (!active) return null;
    const id = active.batch.id;
    pendingWrites.current += 1;
    setSaveState('saving');
    try {
      const saved = await updateDocument(id, change);
      setActive((current) => current?.batch.id === id && current.revision <= saved.revision ? saved : current);
      setRetry(null);
      return saved;
    } catch (error) {
      setSaveState('failed');
      setRetry(() => () => { void commit(change); });
      Alert.alert('Save failed', String(error));
      return null;
    } finally {
      pendingWrites.current -= 1;
      if (pendingWrites.current === 0) setSaveState((state) => state === 'failed' ? state : 'saved');
    }
  }

  async function create(): Promise<SavedDocument | null> {
    setBusy(true);
    try {
      const doc = await createDocument();
      await refresh(doc.batch.id, true);
      return doc;
    } catch (error) { Alert.alert('Could not create document', String(error)); return null; }
    finally { setBusy(false); }
  }

  async function createAndAdd(source: 'camera' | 'gallery') {
    const doc = await create();
    if (doc) setAddMenu(true);
  }

  async function queueImages(uris: string[], captureSource: 'remi_camera' | 'gallery' | 'system_scanner') {
    if (!active || !uris.length) return;
    const documentId = active.batch.id;
    setAddMenu(false);
    setCameraOpen(false);
    let added = 0;
    let failed = 0;
    try {
      for (const uri of uris) {
        try {
          const size = await new Promise<{ width: number; height: number }>((resolve, reject) =>
            Image.getSize(uri, (width, height) => resolve({ width, height }), reject));
          const receipt = receiptFromPhoto({ uri, ...size }, documentId) as SavedReceipt;
          const extension = uri.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1]?.toLowerCase();
          Object.assign(receipt, {
            originalFile: `${receipt.id}-r0-original.${extension && ['jpg', 'jpeg', 'png', 'heic', 'heif'].includes(extension) ? extension : 'jpg'}`,
            processedFile: undefined, filter: 'original', processingStatus: 'queued', ocrText: '',
            imageRevision: 0, jobRevision: 0, captureSource,
            originalPhotoAvailable: captureSource !== 'system_scanner',
            amountMinorUnits: null, currency: null,
          });
          await queueReceipt(documentId, receipt, uri);
          added += 1;
          await refresh(documentId);
          void runQueue();
        } catch { failed += 1; }
      }
      if (failed) Alert.alert('Some receipts could not be added', `${added} saved, ${failed} failed. Try the failed photos again.`);
    } catch (error) { Alert.alert('Could not add receipts', String(error)); }
  }

  async function runQueue() {
    if (queueLock.current) { queueRequested.current = true; return; }
    queueLock.current = true;
    try {
      while (true) {
        const pending = (await listDocuments()).flatMap((doc) =>
          doc.receipts.filter((receipt) => receipt.processingStatus === 'queued')
            .map((receipt) => ({ documentId: doc.batch.id, receipt })))[0];
        if (!pending) break;
        const job = await claimNextReceipt(pending.documentId, pending.receipt.id);
        if (!job) continue;
        await refresh(pending.documentId);
        try {
          const source = originalUri(job);
          const working = job.captureSource === 'system_scanner'
            ? await new Promise<{ uri: string; width: number; height: number }>((resolve, reject) =>
              Image.getSize(source, (width, height) => resolve({ uri: source, width, height }), reject))
            : await galleryWorkingImage(source);
          const result = await processQueuedImage(job, working);
          await completeReceiptProcessing(pending.documentId, job.id, job.imageRevision ?? 0,
            job.jobRevision ?? 0, result.processedUri, result.updates);
        } catch (error) {
          await failReceiptProcessing(pending.documentId, job.id, job.imageRevision ?? 0, job.jobRevision ?? 0);
        }
        await refresh(pending.documentId);
      }
    } catch (error) { Alert.alert('Receipt processing paused', String(error)); }
    finally {
      queueLock.current = false;
      if (queueRequested.current) { queueRequested.current = false; void runQueue(); }
    }
  }

  async function retryReceipt(id: string) {
    if (!active) return;
    try { await retryReceiptProcessing(active.batch.id, id); await refresh(active.batch.id); void runQueue(); }
    catch (error) { Alert.alert('Could not retry receipt', String(error)); }
  }

  async function cancelReceipt(id: string) {
    if (!active) return;
    const receipt = active.receipts.find((item) => item.id === id);
    if (receipt?.processingStatus !== 'queued') { removeReceipt(id); return; }
    try { await cancelQueuedReceipt(active.batch.id, id); await refresh(active.batch.id); }
    catch (error) { Alert.alert('Could not cancel receipt', String(error)); }
  }

  function acknowledgeIntegrity(id: string) {
    const receipt = active?.receipts.find((item) => item.id === id);
    const integrity = receipt?.integrity;
    if (!integrity || integrity.state === 'ready') return;
    Alert.alert('Include with image warning?', integrity.issues.join(', ') || integrity.state, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Acknowledge', onPress: () => { void commit((doc) => ({ ...doc, receipts: doc.receipts.map((item) =>
        item.id === id && item.imageRevision === integrity.imageRevision && item.integrity?.assessmentRevision === integrity.assessmentRevision
          ? { ...item, integrity: { ...item.integrity, acknowledged: {
            imageRevision: integrity.imageRevision, assessmentRevision: integrity.assessmentRevision,
            issues: [...integrity.issues] } } } : item) })); } },
    ]);
  }

  function confirmHigh(ids: string[]) {
    void commit((doc) => ({ ...doc, receipts: doc.receipts.map((receipt) => {
      if (!ids.includes(receipt.id) || receipt.processingStatus !== 'ready') return receipt;
      const imageRevision = receipt.imageRevision ?? 0;
      const candidates = receipt.financialVerification?.candidates ?? [];
      const amountHigh = candidates.some((candidate) => candidate.field === 'amount' && candidate.confidence === 'high' &&
        candidate.evidence.imageRevision === imageRevision && candidate.value === receipt.amountMinorUnits);
      if (!amountHigh) return receipt;
      return { ...receipt, financialVerification: { ...receipt.financialVerification!,
        amount: { status: 'verified' as const, evidence: { source: 'user' as const, imageRevision } },
        currency: receipt.financialVerification!.currency } };
    }) }));
  }

  function keepBoth(leftId: string, rightId: string) {
    void commit((doc) => {
      const [left, right] = [leftId, rightId].sort();
      const leftReceipt = doc.receipts.find((item) => item.id === left);
      const rightReceipt = doc.receipts.find((item) => item.id === right);
      if (!leftReceipt || !rightReceipt) return doc;
      return { ...doc, duplicateDecisions: [...(doc.duplicateDecisions ?? []).filter((decision) =>
        decision.leftId !== left || decision.rightId !== right), {
        leftId: left, rightId: right, leftImageRevision: leftReceipt.imageRevision ?? 0,
        rightImageRevision: rightReceipt.imageRevision ?? 0, resolution: 'keep_both' as const,
      }] };
    });
  }

  function open(doc: SavedDocument) {
    setActive(doc);
    setSaveState('saved');
  }

  async function back() {
    await listDocuments();
    setEditing(null);
    setBreaking(null);
    setScan(null);
    setScanPages([]);
    setActive(null);
    await refresh();
  }

  async function galleryWorkingImage(uri: string) {
    const size = await new Promise<{ width: number; height: number }>((resolve, reject) => Image.getSize(uri, (width, height) => resolve({ width, height }), reject));
    const actions: ImageManipulator.Action[] = Math.max(size.width, size.height) > 3000
      ? [{ resize: size.width >= size.height ? { width: 3000 } : { height: 3000 } }]
      : [];
    return ImageManipulator.manipulateAsync(uri, actions, { compress: 1, format: ImageManipulator.SaveFormat.JPEG });
  }

  async function preparePage(uri: string, source: 'camera' | 'gallery', replaceId?: string) {
    if (!active) throw new Error('Open a document before scanning');
    const originalSize = await new Promise<{ width: number; height: number }>((resolve, reject) =>
      Image.getSize(uri, (width, height) => resolve({ width, height }), reject));
    const working = source === 'gallery' ? await galleryWorkingImage(uri) : null;
    const sourceUri = working?.uri ?? uri;
    const sourceSize = working ?? originalSize;
    const base = receiptFromPhoto({ uri, width: originalSize.width, height: originalSize.height }, active.batch.id) as SavedReceipt;
    Object.assign(base, { originalFile: 'pending.jpg', filter: 'original', processingStatus: 'processing', ocrText: '',
      captureSource: source === 'camera' ? 'system_scanner' : 'gallery', imageRevision: 0, jobRevision: 0 });
    const result = await processQueuedImage(base, { uri: sourceUri, width: sourceSize.width, height: sourceSize.height });
    const processed = result.updates.image!;
    const captureSource = source === 'camera' ? 'system_scanner' : 'gallery';
    setScan({ id: newId(), originalUri: uri, sourceUri, processedUri: result.processedUri,
      initialProcessedUri: result.processedUri, integrity: result.updates.integrity,
      imageProcessing: result.updates.imageProcessing, captureSource,
      originalPhotoAvailable: captureSource !== 'system_scanner',
      width: processed.widthPx, height: processed.heightPx, sourceWidth: sourceSize.width, sourceHeight: sourceSize.height,
      corners: result.updates.imageProcessing?.corners as Corners | null ?? null,
      filter: result.updates.imageProcessing?.filter ?? 'original', rotation: 0,
      ocrText: result.updates.ocrText ?? '', ocrLines: result.updates.ocrLines ?? [],
      sourceSha256: result.updates.sourceSha256, source, replaceId });
  }

  async function addImage(source: 'camera' | 'gallery', replaceId?: string, target = active) {
    if (!target || busy) return;
    setBusy(true);
    try {
      if (source === 'camera') {
        const result = await CameraView.scanDocumentAsync();
        if (result?.pages.length) {
          setScanPages(result.pages.slice(1));
          await preparePage(result.pages[0], 'camera', replaceId);
        } else if (!CameraView.isDocumentScannerAvailable) {
          Alert.alert('Scanner unavailable', 'Choose a photo from the gallery on this device.');
        }
      } else {
        const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
        if (!result.canceled && result.assets[0]) await preparePage(result.assets[0].uri, 'gallery', replaceId);
      }
    } catch (error) { Alert.alert('Scan failed', String(error)); }
    finally { setBusy(false); }
  }

  async function reprocess(filter: ScanFilter, rotation: number, corners: Corners | null) {
    if (!scan) return;
    setBusy(true);
    try {
      const output = await processImage(scan.sourceUri, corners, filter, rotation);
      let recognition = { text: '', lines: [] as { top: number; bottom: number }[] };
      try { recognition = await recognizeReceipt(output.uri); }
      catch (error) { Alert.alert('Text recognition failed', `Enter the receipt details manually. ${String(error)}`); }
      setScan({ ...scan, processedUri: output.uri, width: output.width, height: output.height,
        corners, filter, rotation, ocrText: recognition.text, ocrLines: recognition.lines,
        integrity: undefined,
        imageProcessing: { corners, sourceWidth: scan.sourceWidth, sourceHeight: scan.sourceHeight,
          originalWidth: scan.imageProcessing?.originalWidth,
          originalHeight: scan.imageProcessing?.originalHeight,
          originalToWorking: scan.imageProcessing?.originalToWorking,
          outputWidth: output.width, outputHeight: output.height, sourceToOutput: output.sourceToOutput,
          rotation, filter, selectedImage: 'processed' } });
    } catch (error) { Alert.alert('Could not process image', String(error)); }
    finally { setBusy(false); }
  }

  async function confirmScan() {
    if (!active || !scan || busy || scanLock.current) return;
    if (scan.preserveFields && scan.processedUri === scan.initialProcessedUri) { setScan(null); return; }
    scanLock.current = true;
    setBusy(true);
    setSaveState('saving');
    try {
      const originalExtension = scan.originalUri.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1]?.toLowerCase();
      const originalFile = `${scan.id}-original.${originalExtension && ['jpg', 'jpeg', 'png', 'heic', 'heif'].includes(originalExtension) ? originalExtension : 'jpg'}`;
      const processedFile = `${scan.id}-processed.jpg`;
      const fields = extractFields(scan.ocrText);
      const previous = scan.replaceId ? active.receipts.find((item) => item.id === scan.replaceId) : undefined;
      const imageRevision = previous ? (previous.imageRevision ?? 0) + 1 : 0;
      const receipt = previous
        ? { ...previous, image: { uri: scan.processedUri, widthPx: scan.width, heightPx: scan.height } }
        : receiptFromPhoto({ uri: scan.processedUri, width: scan.width, height: scan.height }, active.batch.id) as SavedReceipt;
      receipt.id = scan.replaceId ?? scan.id;
      try {
        const thumb = await ImageManipulator.manipulateAsync(scan.processedUri,
          scan.width > 400 ? [{ resize: { width: 400 } }] : [],
          { compress: 0.78, format: ImageManipulator.SaveFormat.JPEG });
        receipt.thumbnailFile = `${scan.id}-thumb.jpg`;
        receipt.thumbnailUri = thumb.uri;
      } catch (error) { Alert.alert('Thumbnail unavailable', 'The full image will be used in the editor.'); }
      const currency = fields.currency?.value ?? null;
      let amountMinorUnits: number | null = null;
      try { if (currency && currencyMinorDigits(currency) === 2) amountMinorUnits = fields.totalCents?.value ?? null; }
      catch { /* The currency remains unresolved until review. */ }
      const integrity = scan.integrity
        ? { ...scan.integrity, imageRevision, assessmentRevision: (previous?.integrity?.assessmentRevision ?? 0) + 1,
          acknowledged: undefined }
        : { state: 'needs_review' as const, issues: ['image_changed'], imageRevision,
          assessmentRevision: (previous?.integrity?.assessmentRevision ?? 0) + 1 };
      Object.assign(receipt, {
        originalFile, processedFile, filter: scan.filter, processingStatus: 'ready', ocrText: scan.ocrText,
        sourceSha256: scan.sourceSha256 ?? (scan.preserveFields ? previous?.sourceSha256 : undefined),
        captureSource: scan.captureSource, originalPhotoAvailable: scan.originalPhotoAvailable,
        ocrLines: scan.ocrLines, imageRevision, integrity,
        imageProcessing: scan.imageProcessing ?? { corners: scan.corners, sourceWidth: scan.sourceWidth, sourceHeight: scan.sourceHeight,
          outputWidth: scan.width, outputHeight: scan.height, rotation: scan.rotation, filter: scan.filter,
          selectedImage: 'processed' },
        ...(!scan.preserveFields ? {
          merchant: fields.merchant?.value ?? null, date: fields.date?.value ?? null,
          amountCents: fields.totalCents?.value ?? null, amountMinorUnits,
          currency, gstCents: fields.gstCents?.value ?? null, transactionId: null, confirmed: false,
          financialVerification: { amount: { status: amountMinorUnits === null ? 'unverified' : 'provisional' },
            currency: { status: currency === null ? 'unverified' : 'provisional' },
            candidates: extractFieldCandidates(scan.ocrText, imageRevision) },
        } : {}),
      });
      if (previous) {
        const before = previous.imageProcessing;
        const change = !scan.preserveFields ? 'replacement'
          : scan.corners?.join(',') !== before?.corners?.join(',') ? 'crop'
          : scan.rotation !== (before?.rotation ?? 0) ? 'rotation' : 'enhancement';
        receipt.financialVerification = revalidateFinancialEvidence(previous, {
          ...receipt, financialVerification: { ...receipt.financialVerification!,
            candidates: extractFieldCandidates(scan.ocrText, imageRevision) } }, change);
        receipt.confirmed = receipt.financialVerification.amount.status === 'verified' &&
          receipt.financialVerification.currency.status === 'verified';
      }
      const saved = await saveReceipt(active.batch.id, receipt, scan.originalUri, scan.processedUri, scan.replaceId, false,
        previous ? { imageRevision: previous.imageRevision ?? 0, jobRevision: previous.jobRevision ?? 0 } : undefined);
      setActive((current) => current?.batch.id === saved.batch.id && current.revision <= saved.revision ? saved : current);
      setSaveState('saved');
      cleanupFiles().catch((error) => Alert.alert('Cleanup failed', String(error)));
      if (scanPages.length) {
        const [next, ...rest] = scanPages;
        setScanPages(rest);
        await preparePage(next, 'camera');
      } else setScan(null);
    } catch (error) {
      setSaveState('failed');
      Alert.alert('Receipt was not saved', String(error));
    } finally { setBusy(false); scanLock.current = false; }
  }

  function deleteActive() {
    if (!active) return;
    const id = active.batch.id;
    Alert.alert('Delete document?', 'Its receipts and PDF versions will be deleted.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { void deleteDocument(id).then(back).catch(async (error) => { await back(); Alert.alert('Storage cleanup failed', String(error)); }); } },
    ]);
  }

  async function exportDocument(config: ExportConfig) {
    if (!active || busy) return;
    setBusy(true);
    try {
      const useOriginal = config.mode === 'image_only' ? new Set(config.originalIds ?? []) : new Set<string>();
      const receipts = active.receipts.map((receipt) => useOriginal.has(receipt.id)
        ? { ...receipt, image: { uri: originalUri(receipt),
          widthPx: receipt.imageProcessing?.sourceWidth ?? receipt.image.widthPx,
          heightPx: receipt.imageProcessing?.sourceHeight ?? receipt.image.heightPx },
          ocrLines: undefined, breakFractions: undefined } : receipt);
      const pdf = await renderPdf(active.batch, receipts, useOriginal.size ? undefined : active.layout,
        config, active.duplicateDecisions);
      const item = await saveExport(active.batch.id, active.revision, pdf);
      await refresh(active.batch.id);
      await sharePdf(exportUri(item));
    } catch (error) { Alert.alert('Export failed', String(error)); }
    finally { setBusy(false); }
  }

  async function previewDocument(config: ExportConfig) {
    if (!active || busy) return;
    setBusy(true);
    try {
      const useOriginal = config.mode === 'image_only' ? new Set(config.originalIds ?? []) : new Set<string>();
      const receipts = active.receipts.map((receipt) => useOriginal.has(receipt.id)
        ? { ...receipt, image: { uri: originalUri(receipt),
          widthPx: receipt.imageProcessing?.sourceWidth ?? receipt.image.widthPx,
          heightPx: receipt.imageProcessing?.sourceHeight ?? receipt.image.heightPx },
          ocrLines: undefined, breakFractions: undefined } : receipt);
      await previewPdf(active.batch, receipts, useOriginal.size ? undefined : active.layout,
        active.revision, config, active.duplicateDecisions);
    }
    catch (error) { Alert.alert('Preview failed', String(error)); }
    finally { setBusy(false); }
  }

  async function saveLayout(layout: ColumnLayout): Promise<boolean> {
    return !!(await commit((doc) => ({ ...doc, layout })));
  }

  function removeReceipt(id: string) {
    Alert.alert('Remove receipt?', 'The receipt will be removed from this document.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => {
        void commit((doc) => ({ ...doc, receipts: doc.receipts.filter((receipt) => receipt.id !== id) }))
          .then((saved) => { if (saved) void cleanupFiles().catch((error) => Alert.alert('Cleanup failed', String(error))); });
      } },
    ]);
  }

  function removeMany(ids: string[]) {
    Alert.alert('Delete receipts?', `${ids.length} receipt(s) will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        void commit((doc) => ({ ...doc, receipts: doc.receipts.filter((receipt) => !ids.includes(receipt.id)) }))
          .then((saved) => { if (saved) void cleanupFiles().catch((error) => Alert.alert('Cleanup failed', String(error))); });
      } },
    ]);
  }

  function reorderReceipts(ids: string[]) {
    void commit((doc) => ({ ...doc, receipts: ids.map((id) => doc.receipts.find((item) => item.id === id)!).filter(Boolean) }));
  }

  function editReceipt(receipt: SavedReceipt) {
    setEditing(receipt);
    setAmountText(receipt.amountMinorUnits !== null && receipt.amountMinorUnits !== undefined && receipt.currency
      ? formatMinorUnits(receipt.amountMinorUnits, receipt.currency)
      : receipt.amountCents === null ? '' : String(receipt.amountCents / 100));
    setGstText(receipt.gstCents === null || !gstUsesCents(receipt.currency)
      ? '' : String(receipt.gstCents / 100));
  }

  async function editScan(target = editing) {
    if (!target || busy) return;
    setBusy(true);
    try {
      const uri = originalUri(target);
      const working = await galleryWorkingImage(uri);
      setScan({ id: newId(), replaceId: target.id, preserveFields: true, originalUri: uri, sourceUri: working.uri,
        processedUri: target.image.uri, initialProcessedUri: target.image.uri,
        sourceSha256: target.sourceSha256, captureSource: target.captureSource,
        originalPhotoAvailable: target.originalPhotoAvailable, imageProcessing: target.imageProcessing,
        width: target.image.widthPx, height: target.image.heightPx, sourceWidth: working.width, sourceHeight: working.height,
        corners: target.imageProcessing?.corners?.length === 8 ? target.imageProcessing.corners as Corners : null,
        filter: target.filter, rotation: target.imageProcessing?.rotation ?? 0, ocrText: target.ocrText, ocrLines: target.ocrLines ?? [], source: 'gallery' });
      setEditing(null);
    } catch (error) { Alert.alert('Could not edit scan', String(error)); }
    finally { setBusy(false); }
  }

  function editFields(fields: Partial<Receipt>) {
    if (!editing) return;
    const id = editing.id;
    const applyFields = (receipt: SavedReceipt): SavedReceipt => {
      const financial = receipt.financialVerification ?? { amount: { status: 'unverified' as const }, currency: { status: 'unverified' as const } };
      return { ...receipt, ...fields, confirmed: false, financialVerification: {
        ...financial,
        amount: 'amountMinorUnits' in fields ? { status: fields.amountMinorUnits === null ? 'unverified' : 'provisional' } : financial.amount,
        currency: 'currency' in fields ? { status: fields.currency ? 'provisional' : 'unverified' } : financial.currency,
      } };
    };
    setEditing(applyFields(editing));
    void commit((doc) => ({ ...doc, receipts: doc.receipts.map((receipt) => receipt.id === id ? applyFields(receipt) : receipt) }));
  }

  const summary = active ? summarizeClaim(active.receipts, HOME_CURRENCY) : null;
  const dateValid = !editing?.date || /^\d{4}-\d{2}-\d{2}$/.test(editing.date) && !Number.isNaN(Date.parse(editing.date)) && new Date(editing.date).toISOString().slice(0, 10) === editing.date;
  let currencyValid = false;
  try { currencyValid = !!editing?.currency && Number.isInteger(currencyMinorDigits(editing.currency)); }
  catch { currencyValid = false; }
  const gstSupported = gstUsesCents(editing?.currency ?? null);
  const canConfirmReceipt = !!editing && editing.amountMinorUnits !== null && editing.amountMinorUnits !== undefined && currencyValid &&
    (!gstSupported || gstText === '' || editing.gstCents !== null) && dateValid && saveState === 'saved';
  const canExport = !!active?.receipts.length && saveState === 'saved' && !busy;
  return <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaView style={[styles.screen, Platform.OS === 'android' && { paddingTop: NativeStatusBar.currentHeight ?? 24 }, scan && { backgroundColor: '#1d1c25' }]}>
    {cameraOpen ? <RemiCamera onDone={(uris) => queueImages(uris, 'remi_camera')} onCancel={() => setCameraOpen(false)} />
    : addMenu && active ? <AddReceipts onCamera={() => { setAddMenu(false); setCameraOpen(true); }}
      onGallery={() => { void pickGalleryReceipts().then((uris) => queueImages(uris, 'gallery')).catch((error) => Alert.alert('Gallery unavailable', String(error))); }}
      onQuickScan={() => { void scanQuickReceipts().then((uris) => queueImages(uris, 'system_scanner')).catch((error) => Alert.alert('Quick Scan unavailable', String(error))); }}
      onCancel={() => setAddMenu(false)} />
    : exportOpen && active ? <ExportScreen document={active} busy={busy} onBack={() => setExportOpen(false)}
      onPreview={(config) => { void previewDocument(config); }} onExport={(config) => { void exportDocument(config); }}
      onReview={(receipt) => { setExportOpen(false); editReceipt(receipt); }}
      onInclude={(id, included) => { void commit((doc) => ({ ...doc, receipts: doc.receipts.map((receipt) =>
        receipt.id === id ? { ...receipt, claimIncluded: included } : receipt) })); }} />
    : scan ? <ScanPreview scan={scan} busy={busy} onProcess={(filter, rotation, corners) => { void reprocess(filter, rotation, corners); }} onConfirm={() => { void confirmScan(); }} onCancel={() => { setScan(null); setScanPages([]); }} onReplace={() => { const source = scan.source; const replaceId = scan.replaceId; setScan(null); setScanPages([]); void addImage(source, replaceId); }} />
    : breaking && active ? <BreakEditor receipt={breaking.receipt} columns={breaking.columns} onCancel={() => setBreaking(null)} onSave={(breaks) => {
      const id = breaking.receipt.id;
      void commit((doc) => ({ ...doc, receipts: doc.receipts.map((receipt) => receipt.id === id ? { ...receipt, breakFractions: breaks } : receipt) })).then((saved) => { if (saved) setBreaking(null); });
    }} />
    : editing ? <ScrollView contentContainerStyle={styles.content}>
      <Pressable onPress={() => setEditing(null)}><Text style={styles.link}>← Document</Text></Pressable>
      <Text style={styles.title}>Receipt details</Text>
      <Text style={styles.hint}>{saveState === 'saving' ? 'Saving…' : saveState === 'failed' ? 'Save failed' : 'Saved'}</Text>
      {retry && <Pressable onPress={retry}><Text style={styles.link}>Retry save</Text></Pressable>}
      <Image source={{ uri: editing.image.uri }} resizeMode="contain" style={styles.detailImage} />
      <Text style={styles.label}>Merchant</Text><TextInput value={editing.merchant ?? ''} onChangeText={(value) => editFields({ merchant: value || null })} style={styles.input} />
      <Text style={styles.label}>Date (YYYY-MM-DD)</Text><TextInput value={editing.date ?? ''} onChangeText={(value) => editFields({ date: value || null })} style={styles.input} />
      {!dateValid && <Text style={styles.danger}>Enter a valid date as YYYY-MM-DD.</Text>}
      <Text style={styles.label}>Currency (ISO code)</Text><TextInput value={editing.currency ?? ''} autoCapitalize="characters"
        onChangeText={(value) => { const currency = value.trim().toUpperCase() || null; let amountMinorUnits: number | null = null;
          try { if (currency) amountMinorUnits = parseAmountToMinorUnits(amountText, currency); } catch { /* Keep unresolved until corrected. */ }
          setGstText(gstUsesCents(currency) && editing.gstCents !== null ? String(editing.gstCents / 100) : '');
          editFields({ currency, amountMinorUnits }); }} style={styles.input} />
      {!currencyValid && <Text style={styles.danger}>Choose a valid currency code before confirming.</Text>}
      <Text style={styles.label}>Amount ({editing.currency ?? 'currency needed'})</Text><TextInput value={amountText} keyboardType="decimal-pad"
        onChangeText={(value) => { setAmountText(value); let amountMinorUnits: number | null = null;
          try { if (editing.currency) amountMinorUnits = parseAmountToMinorUnits(value, editing.currency); } catch { /* Currency is still unresolved. */ }
          editFields({ amountCents: parseAmountToCents(value), amountMinorUnits }); }} style={styles.input} />
      <Text style={styles.label}>GST ({editing.currency ?? 'currency needed'})</Text>
      {gstSupported ? <TextInput value={gstText} keyboardType="decimal-pad" onChangeText={(value) => { setGstText(value); editFields({ gstCents: value ? parseAmountToCents(value) : null }); }} style={styles.input} />
        : <Text style={styles.hint}>GST entry is available only for currencies with two decimal places. {editing.gstCents !== null
          ? 'A previously stored GST value is excluded from totals and exports until you select a two-decimal currency.' : ''}</Text>}
      {gstSupported && gstText !== '' && editing.gstCents === null && <Text style={styles.danger}>Enter a valid GST amount or leave it empty.</Text>}
      <Text style={styles.label}>Category</Text><TextInput value={editing.category ?? ''} onChangeText={(value) => editFields({ category: value || null })} style={styles.input} />
      <Text style={styles.label}>Notes</Text><TextInput value={editing.notes} multiline onChangeText={(value) => editFields({ notes: value })} style={styles.input} />
      <View style={styles.actions}><Pressable onPress={() => { void editScan(); }}><Text style={styles.link}>Edit scan</Text></Pressable>
      <Pressable onPress={() => { const id = editing.id; setEditing(null); void addImage('gallery', id); }}><Text style={styles.link}>Replace photo</Text></Pressable></View>
      <Pressable disabled={!canConfirmReceipt} onPress={() => { const id = editing.id; const imageRevision = editing.imageRevision ?? 0;
        const confirmed = (receipt: SavedReceipt): SavedReceipt => ({ ...receipt, confirmed: true,
          financialVerification: { ...receipt.financialVerification!,
            amount: { status: 'verified', evidence: { source: 'user', imageRevision } },
            currency: { status: 'verified', evidence: { source: 'user', imageRevision } } } });
        void commit((doc) => ({ ...doc, receipts: doc.receipts.map((receipt) => receipt.id === id ? confirmed(receipt) : receipt) }));
        setEditing(confirmed(editing)); }}><Text style={[styles.primary, !canConfirmReceipt && styles.disabled]}>Confirm amount and currency</Text></Pressable>
      <Text style={styles.hint}>Compare every field with the image. Retake if financial text is hidden.</Text>
    </ScrollView>
    : active ? <DocumentEditor document={active} busy={busy} saveState={saveState} onBack={() => { void back(); }}
      onTitle={(title) => { void commit((doc) => ({ ...doc, batch: { ...doc.batch, name: title } })); }}
      onScan={() => setAddMenu(true)} onImport={() => setAddMenu(true)}
      onEdit={editReceipt} onReplace={(receipt) => { void addImage('gallery', receipt.id); }} onRotate={(receipt) => { void editScan(receipt); }}
      onReviewImage={(receipt) => { void editScan(receipt); }} onRetryReceipt={(id) => { void retryReceipt(id); }}
      onCancelReceipt={(id) => { void cancelReceipt(id); }} onSetClaimIncluded={(id, included) => { void commit((doc) => ({ ...doc, receipts: doc.receipts.map((receipt) =>
        receipt.id === id ? { ...receipt, claimIncluded: included } : receipt) })); }}
      onAcknowledgeIntegrity={acknowledgeIntegrity} onConfirmHighConfidence={confirmHigh} onKeepBoth={keepBoth}
      onBreak={(receipt, columns) => setBreaking({ receipt, columns })} onDelete={removeReceipt} onDeleteMany={removeMany} onReorder={reorderReceipts} onDeleteDocument={deleteActive} onLayout={saveLayout}
      onPreview={() => setExportOpen(true)} onExport={() => setExportOpen(true)}
      onShare={(uri) => { void sharePdf(uri).catch((error) => Alert.alert('Could not share PDF', String(error))); }} onRetry={retry ?? undefined} exportUri={exportUri} canExport={canExport} />
    : <DocumentHome documents={documents} busy={busy} onCreate={() => { void create(); }}
      onScan={() => { void createAndAdd('camera'); }} onImport={() => { void createAndAdd('gallery'); }}
      onOpen={open} onShare={(uri) => { void sharePdf(uri).catch((error) => Alert.alert('Could not share PDF', String(error))); }} exportUri={exportUri} />}
    <StatusBar style={scan ? 'light' : 'dark'} />
  </SafeAreaView></GestureHandlerRootView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.canvas },
  content: { flexGrow: 1, gap: 12, paddingHorizontal: 16, paddingBottom: 24, backgroundColor: theme.canvas },
  title: { fontSize: 24, fontWeight: '700', color: theme.ink },
  hint: { color: theme.muted, fontSize: 13 },
  label: { fontWeight: '600' },
  input: { borderWidth: 1, borderColor: theme.border, borderRadius: 9, padding: 10, fontSize: 16, backgroundColor: theme.white, color: theme.ink },
  actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  link: { color: theme.violetDark, paddingVertical: 8 },
  primary: { color: 'white', backgroundColor: theme.violet, padding: 11, borderRadius: 10, fontWeight: '700', textAlign: 'center' },
  danger: { color: theme.danger, paddingVertical: 8 },
  disabled: { opacity: 0.4 },
  detailImage: { width: '100%', height: 320, backgroundColor: '#f1f1f1' },
});
