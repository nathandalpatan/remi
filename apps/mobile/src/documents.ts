import { columnWidthMm, moveColumnTile, packColumns, validateColumnLayout, type Batch, type ColumnItem, type ColumnLayout, type DuplicateDecision, type Receipt } from '@remi/core';
import { Directory, File, Paths } from 'expo-file-system';
import { openDatabaseAsync } from 'expo-sqlite';
import { HOME_CURRENCY } from './claim';

export type ScanFilter = 'original' | 'colour' | 'bw';
export type SavedReceipt = Receipt & {
  originalFile: string;
  processedFile?: string;
  thumbnailFile?: string;
  thumbnailUri?: string;
  filter: ScanFilter;
  processingStatus: 'queued' | 'processing' | 'ready' | 'failed';
  ocrText: string;
};
export type SavedExport = { id: string; revision: number; file: string; createdAt: string };
export type SavedDocument = {
  batch: Batch;
  receipts: SavedReceipt[];
  exports: SavedExport[];
  revision: number;
  updatedAt: string;
  layout: ColumnLayout;
  duplicateDecisions?: DuplicateDecision[];
};

const receiptDir = new Directory(Paths.document, 'receipts');
const exportDir = new Directory(Paths.document, 'exports');
const db = openDatabaseAsync('remi.db').then(async (connection) => {
  await connection.execAsync('CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
  receiptDir.create({ idempotent: true });
  exportDir.create({ idempotent: true });
  return connection;
});
let writes: Promise<unknown> = Promise.resolve();

export function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function layoutItems(receipts: SavedReceipt[]): ColumnItem[] {
  return receipts.map((receipt) => ({ id: receipt.id, widthPx: receipt.image.widthPx,
    heightPx: receipt.image.heightPx, lines: receipt.ocrLines, breaks: receipt.breakFractions }));
}

function migrateLayout(receipts: SavedReceipt[]): ColumnLayout {
  let layout = packColumns(layoutItems(receipts));
  for (const receipt of receipts) for (const pin of receipt.placements ?? []) {
    if (!Number.isInteger(pin.pageIndex) || !Number.isFinite(pin.xMm) || !Number.isFinite(pin.yMm)) continue;
    const tile = layout.tiles.find((item) => item.receiptId === receipt.id && item.part === pin.part);
    if (!tile) continue;
    const pageIndex = Math.max(0, Math.min(pin.pageIndex, layout.pageCount));
    const columnIndex = Math.max(0, Math.min(layout.columnCount - 1,
      Math.round((pin.xMm - layout.spec.marginMm) / (columnWidthMm(layout.columnCount) + layout.spec.gapMm))));
    const index = layout.tiles.filter((item) => item.pageIndex === pageIndex && item.columnIndex === columnIndex &&
      item.yMm < pin.yMm).length;
    layout = moveColumnTile(layout, receipt.id, pin.part, { pageIndex, columnIndex, index });
  }
  return layout;
}

function minorDigits(currency: string | null): number | null {
  if (!currency) return null;
  try {
    const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
    return Number.isInteger(digits) ? digits ?? null : null;
  } catch { return null; }
}

function migrateReceipt(receipt: SavedReceipt): SavedReceipt {
  const imageRevision = receipt.imageRevision ?? 0;
  const amountMinorUnits = receipt.amountMinorUnits !== undefined ? receipt.amountMinorUnits
    : minorDigits(receipt.currency) === 2 ? receipt.amountCents : null;
  return {
    ...receipt,
    imageRevision,
    jobRevision: receipt.jobRevision ?? 0,
    amountMinorUnits,
    claimIncluded: receipt.claimIncluded ?? true,
    originalPhotoAvailable: receipt.originalPhotoAvailable ?? false,
    processingStatus: receipt.processingStatus ?? (receipt.processedFile ? 'ready' : 'queued'),
    financialVerification: receipt.financialVerification ?? {
      // Legacy typing set confirmed automatically, so it is not evidence of review.
      amount: { status: amountMinorUnits === null ? 'unverified' : 'provisional' },
      // The old editor also defaulted every receipt to NZD.
      currency: { status: 'unverified' },
    },
    integrity: receipt.integrity ?? {
      state: 'needs_review', issues: ['legacy_not_assessed'], imageRevision, assessmentRevision: 0,
    },
  };
}

function migrateDocument(doc: SavedDocument): SavedDocument {
  const receipts = doc.receipts.map(migrateReceipt);
  return {
    ...doc,
    receipts,
    duplicateDecisions: doc.duplicateDecisions ?? [],
    layout: doc.layout?.version === 1 ? doc.layout : migrateLayout(receipts),
  };
}

function hydrate(doc: SavedDocument): SavedDocument {
  const migrated = migrateDocument(doc);
  return {
    ...migrated,
    receipts: migrated.receipts.map((receipt) => {
      const processed = receipt.processedFile ? new File(receiptDir, receipt.processedFile) : null;
      const source = new File(receiptDir, receipt.originalFile);
      const display = receipt.processingStatus === 'ready' && processed?.exists ? processed
        : source.exists ? source : processed ?? source;
      return {
        ...receipt,
        image: { ...receipt.image, uri: display.uri },
        thumbnailUri: receipt.thumbnailFile && new File(receiptDir, receipt.thumbnailFile).exists
          ? new File(receiptDir, receipt.thumbnailFile).uri : undefined,
      };
    }),
  };
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = writes.then(task);
  writes = result.catch(() => undefined);
  return result;
}

export async function listDocuments(): Promise<SavedDocument[]> {
  await writes;
  const rows = await (await db).getAllAsync<{ data: string }>('SELECT data FROM documents');
  return rows.map((row) => hydrate(JSON.parse(row.data) as SavedDocument)).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

export async function getDocument(id: string): Promise<SavedDocument | null> {
  await writes;
  const row = await (await db).getFirstAsync<{ data: string }>('SELECT data FROM documents WHERE id = ?', id);
  return row ? hydrate(JSON.parse(row.data) as SavedDocument) : null;
}

export function createDocument(): Promise<SavedDocument> {
  return enqueue(async () => {
    const createdAt = new Date().toISOString();
    const batch: Batch = { id: newId(), name: `Expenses ${createdAt.slice(0, 10)}`, createdAt, homeCurrency: HOME_CURRENCY };
    const doc: SavedDocument = { batch, receipts: [], exports: [], revision: 0, updatedAt: createdAt, layout: packColumns([]), duplicateDecisions: [] };
    await (await db).runAsync('INSERT INTO documents (id, data) VALUES (?, ?)', batch.id, JSON.stringify(doc));
    return doc;
  });
}

export function updateDocument(id: string, change: (doc: SavedDocument) => SavedDocument): Promise<SavedDocument> {
  return enqueue(async () => {
    const connection = await db;
    const row = await connection.getFirstAsync<{ data: string }>('SELECT data FROM documents WHERE id = ?', id);
    if (!row) throw new Error('Document no longer exists');
    const current = hydrate(JSON.parse(row.data) as SavedDocument);
    const next = change(current);
    if (next.batch.id !== id) throw new Error('Document ID cannot change');
    if (next.layout === current.layout) next.layout = packColumns(layoutItems(next.receipts), current.layout.columnCount, current.layout);
    const receiptIds = new Set(next.receipts.map((receipt) => receipt.id));
    next.duplicateDecisions = (next.duplicateDecisions ?? []).filter((decision) =>
      receiptIds.has(decision.leftId) && receiptIds.has(decision.rightId));
    if (!next.layout.needsBreak.length) validateColumnLayout(next.layout, layoutItems(next.receipts));
    next.updatedAt = new Date().toISOString();
    next.revision = current.revision + 1;
    const result = await connection.runAsync('UPDATE documents SET data = ? WHERE id = ?', JSON.stringify(next), id);
    if (result.changes !== 1) throw new Error('Document was not saved');
    return next;
  });
}

async function copyReceiptImage(uri: string, fileName: string): Promise<string> {
  await db;
  const target = new File(receiptDir, fileName);
  if (target.exists) {
    if (target.uri !== uri) throw new Error(`Receipt image filename already exists: ${fileName}`);
    return target.uri;
  }
  try { await new File(uri).copy(target); }
  catch (error) {
    if (target.exists) target.delete();
    throw error;
  }
  return target.uri;
}

export function saveReceipt(id: string, receipt: SavedReceipt, originalUri: string, processedUri: string, replaceId?: string,
  preserveFields = false, expected?: { imageRevision: number; jobRevision: number }): Promise<SavedDocument> {
  return enqueue(async () => {
    const connection = await db;
    const row = await connection.getFirstAsync<{ data: string }>('SELECT data FROM documents WHERE id = ?', id);
    if (!row) throw new Error('Document no longer exists');
    const doc = hydrate(JSON.parse(row.data) as SavedDocument);
    if (replaceId) {
      const existing = doc.receipts.find((item) => item.id === replaceId);
      if (!existing) throw new Error('Receipt no longer exists');
      if (receipt.processedFile && existing.processedFile === receipt.processedFile) return doc;
      if (expected && ((existing.imageRevision ?? 0) !== expected.imageRevision ||
        (existing.jobRevision ?? 0) !== expected.jobRevision)) throw new Error('Receipt changed; reopen it before replacing');
    } else if (doc.receipts.some((item) => item.id === receipt.id)) return doc;
    const created: string[] = [];
    const copy = async (uri: string, fileName: string) => {
      const existed = new File(receiptDir, fileName).exists;
      const target = await copyReceiptImage(uri, fileName);
      if (!existed) created.push(fileName);
      return target;
    };
    try {
      await copy(originalUri, receipt.originalFile);
      if (!receipt.processedFile) throw new Error('Processed image filename is required');
      receipt.image.uri = await copy(processedUri, receipt.processedFile);
      if (receipt.thumbnailFile && receipt.thumbnailUri) receipt.thumbnailUri = await copy(receipt.thumbnailUri, receipt.thumbnailFile);
      doc.receipts = replaceId ? doc.receipts.map((item) => {
        if (item.id !== replaceId) return item;
        const imageRevision = (item.imageRevision ?? 0) + 1;
        const financial = item.financialVerification;
        const next = preserveFields ? {
          ...item, originalFile: receipt.originalFile, processedFile: receipt.processedFile,
          thumbnailFile: receipt.thumbnailFile, thumbnailUri: receipt.thumbnailUri, image: receipt.image,
          filter: receipt.filter, processingStatus: 'ready' as const, ocrText: receipt.ocrText,
          ocrLines: receipt.ocrLines, breakFractions: undefined, confirmed: false,
          amountMinorUnits: item.amountMinorUnits ?? item.amountCents,
          financialVerification: {
            amount: { status: 'unverified' as const }, currency: { status: 'unverified' as const },
            ...(financial?.merchant && { merchant: { status: 'unverified' as const } }),
            ...(financial?.date && { date: { status: 'unverified' as const } }),
            ...(financial?.gst && { gst: { status: 'unverified' as const } }),
          },
        } : receipt;
        const integrity = receipt.integrity?.imageRevision === imageRevision
          ? { ...receipt.integrity, acknowledged: undefined }
          : { state: 'needs_review' as const, issues: ['image_changed'], imageRevision,
            assessmentRevision: (item.integrity?.assessmentRevision ?? 0) + 1 };
        return migrateReceipt({ ...next, id: item.id, imageRevision, jobRevision: (item.jobRevision ?? 0) + 1,
          integrity });
      }) : [...doc.receipts, migrateReceipt(receipt)];
      doc.layout = packColumns(layoutItems(doc.receipts), doc.layout.columnCount, doc.layout);
      doc.revision += 1;
      doc.updatedAt = new Date().toISOString();
      const result = await connection.runAsync('UPDATE documents SET data = ? WHERE id = ?', JSON.stringify(doc), id);
      if (result.changes !== 1) throw new Error('Document was not saved');
      return doc;
    } catch (error) {
      for (const fileName of created) {
        const file = new File(receiptDir, fileName);
        if (file.exists) file.delete();
      }
      throw error;
    }
  });
}

/** Copies the earliest available source before the queued record becomes visible. */
export function queueReceipt(id: string, receipt: SavedReceipt, sourceUri: string): Promise<SavedDocument> {
  return enqueue(async () => {
    const connection = await db;
    const row = await connection.getFirstAsync<{ data: string }>('SELECT data FROM documents WHERE id = ?', id);
    if (!row) throw new Error('Document no longer exists');
    const doc = hydrate(JSON.parse(row.data) as SavedDocument);
    if (doc.receipts.some((item) => item.id === receipt.id)) return doc;
    const sourceFile = new File(receiptDir, receipt.originalFile);
    const existed = sourceFile.exists;
    try {
      const source = await copyReceiptImage(sourceUri, receipt.originalFile);
      const queued = migrateReceipt({ ...receipt, image: { ...receipt.image, uri: source },
        processedFile: undefined, thumbnailFile: undefined, thumbnailUri: undefined,
        processingStatus: 'queued', imageRevision: receipt.imageRevision ?? 0,
        jobRevision: receipt.jobRevision ?? 0, confirmed: false });
      doc.receipts.push(queued);
      doc.layout = packColumns(layoutItems(doc.receipts), doc.layout.columnCount, doc.layout);
      doc.revision += 1;
      doc.updatedAt = new Date().toISOString();
      const result = await connection.runAsync('UPDATE documents SET data = ? WHERE id = ?', JSON.stringify(doc), id);
      if (result.changes !== 1) throw new Error('Document was not saved');
      return doc;
    } catch (error) {
      if (!existed && sourceFile.exists) sourceFile.delete();
      throw error;
    }
  });
}

export function claimNextReceipt(id: string, receiptId: string): Promise<SavedReceipt | null> {
  return enqueue(async () => {
    const connection = await db;
    const row = await connection.getFirstAsync<{ data: string }>('SELECT data FROM documents WHERE id = ?', id);
    if (!row) return null;
    const doc = hydrate(JSON.parse(row.data) as SavedDocument);
    const receipt = doc.receipts.find((item) => item.id === receiptId);
    if (!receipt || receipt.processingStatus !== 'queued') return null;
    const next = { ...receipt, processingStatus: 'processing' as const, jobRevision: (receipt.jobRevision ?? 0) + 1 };
    doc.receipts = doc.receipts.map((item) => item.id === receiptId ? next : item);
    doc.revision += 1;
    doc.updatedAt = new Date().toISOString();
    const result = await connection.runAsync('UPDATE documents SET data = ? WHERE id = ?', JSON.stringify(doc), id);
    if (result.changes !== 1) throw new Error('Document was not saved');
    return next;
  });
}

function activeJob(receipt: SavedReceipt | undefined, imageRevision: number, jobRevision: number): receipt is SavedReceipt {
  return !!receipt && receipt.processingStatus === 'processing' &&
    receipt.imageRevision === imageRevision && receipt.jobRevision === jobRevision;
}

export function completeReceiptProcessing(id: string, receiptId: string, imageRevision: number,
  jobRevision: number, processedUri: string, updates: Partial<SavedReceipt>): Promise<SavedDocument | null> {
  return enqueue(async () => {
    const connection = await db;
    const row = await connection.getFirstAsync<{ data: string }>('SELECT data FROM documents WHERE id = ?', id);
    if (!row) return null;
    const doc = hydrate(JSON.parse(row.data) as SavedDocument);
    const current = doc.receipts.find((item) => item.id === receiptId);
    if (!activeJob(current, imageRevision, jobRevision)) return null;
    if (!updates.image || !(updates.image.widthPx > 0 && updates.image.heightPx > 0)) {
      throw new Error('Processed receipt dimensions are required');
    }
    const processedFile = `${receiptId}-r${imageRevision}-j${jobRevision}-processed.jpg`;
    const processedTarget = new File(receiptDir, processedFile);
    const existed = processedTarget.exists;
    const thumbnailFile = updates.thumbnailUri ? `${receiptId}-r${imageRevision}-j${jobRevision}-thumb.jpg` : undefined;
    const thumbnailTarget = thumbnailFile ? new File(receiptDir, thumbnailFile) : null;
    const thumbnailExisted = thumbnailTarget?.exists;
    try {
      const processed = await copyReceiptImage(processedUri, processedFile);
      const thumbnailUri = thumbnailFile && updates.thumbnailUri
        ? await copyReceiptImage(updates.thumbnailUri, thumbnailFile) : undefined;
      const next = migrateReceipt({ ...current, ...updates,
        id: current.id, batchId: current.batchId, originalFile: current.originalFile,
        captureSource: current.captureSource, originalPhotoAvailable: current.originalPhotoAvailable,
        sourceSha256: updates.sourceSha256 ?? current.sourceSha256, claimIncluded: current.claimIncluded,
        imageRevision, jobRevision, processedFile, processingStatus: 'ready',
        image: { ...updates.image, uri: processed },
        thumbnailFile, thumbnailUri,
        financialVerification: updates.financialVerification ?? current.financialVerification,
        integrity: updates.integrity ?? { state: 'needs_review', issues: ['not_assessed'], imageRevision, assessmentRevision: 0 },
      });
      doc.receipts = doc.receipts.map((item) => item.id === receiptId ? next : item);
      doc.layout = packColumns(layoutItems(doc.receipts), doc.layout.columnCount, doc.layout);
      doc.revision += 1;
      doc.updatedAt = new Date().toISOString();
      const result = await connection.runAsync('UPDATE documents SET data = ? WHERE id = ?', JSON.stringify(doc), id);
      if (result.changes !== 1) throw new Error('Document was not saved');
      return doc;
    } catch (error) {
      if (!existed && processedTarget.exists) processedTarget.delete();
      if (thumbnailTarget && !thumbnailExisted && thumbnailTarget.exists) thumbnailTarget.delete();
      throw error;
    }
  });
}

export function failReceiptProcessing(id: string, receiptId: string, imageRevision: number,
  jobRevision: number): Promise<SavedDocument | null> {
  return enqueue(async () => {
    const connection = await db;
    const row = await connection.getFirstAsync<{ data: string }>('SELECT data FROM documents WHERE id = ?', id);
    if (!row) return null;
    const doc = hydrate(JSON.parse(row.data) as SavedDocument);
    const current = doc.receipts.find((item) => item.id === receiptId);
    if (!activeJob(current, imageRevision, jobRevision)) return null;
    doc.receipts = doc.receipts.map((item) => item.id === receiptId ? {
      ...item, processingStatus: 'failed' as const,
      integrity: { state: 'processing_failed' as const, issues: ['processing_failed'],
        imageRevision, assessmentRevision: (item.integrity?.assessmentRevision ?? 0) + 1 },
    } : item);
    doc.revision += 1;
    doc.updatedAt = new Date().toISOString();
    const result = await connection.runAsync('UPDATE documents SET data = ? WHERE id = ?', JSON.stringify(doc), id);
    if (result.changes !== 1) throw new Error('Document was not saved');
    return doc;
  });
}

export function retryReceiptProcessing(id: string, receiptId: string): Promise<SavedDocument | null> {
  return enqueue(async () => {
    const connection = await db;
    const row = await connection.getFirstAsync<{ data: string }>('SELECT data FROM documents WHERE id = ?', id);
    if (!row) return null;
    const doc = hydrate(JSON.parse(row.data) as SavedDocument);
    const current = doc.receipts.find((item) => item.id === receiptId);
    if (!current || current.processingStatus !== 'failed' || !new File(receiptDir, current.originalFile).exists) return null;
    doc.receipts = doc.receipts.map((item) => item.id === receiptId ? {
      ...item, processingStatus: 'queued' as const, jobRevision: (item.jobRevision ?? 0) + 1,
    } : item);
    doc.revision += 1;
    doc.updatedAt = new Date().toISOString();
    const result = await connection.runAsync('UPDATE documents SET data = ? WHERE id = ?', JSON.stringify(doc), id);
    if (result.changes !== 1) throw new Error('Document was not saved');
    return doc;
  });
}

export function cancelQueuedReceipt(id: string, receiptId: string): Promise<SavedDocument | null> {
  return enqueue(async () => {
    const connection = await db;
    const row = await connection.getFirstAsync<{ data: string }>('SELECT data FROM documents WHERE id = ?', id);
    if (!row) return null;
    const doc = hydrate(JSON.parse(row.data) as SavedDocument);
    const current = doc.receipts.find((item) => item.id === receiptId);
    if (!current || !['queued', 'processing'].includes(current.processingStatus)) return null;
    doc.receipts = doc.receipts.filter((item) => item.id !== receiptId);
    doc.duplicateDecisions = (doc.duplicateDecisions ?? []).filter((decision) =>
      decision.leftId !== receiptId && decision.rightId !== receiptId);
    doc.layout = packColumns(layoutItems(doc.receipts), doc.layout.columnCount, doc.layout);
    doc.revision += 1;
    doc.updatedAt = new Date().toISOString();
    const result = await connection.runAsync('UPDATE documents SET data = ? WHERE id = ?', JSON.stringify(doc), id);
    if (result.changes !== 1) throw new Error('Document was not saved');
    await cleanupFilesUnsafe();
    return doc;
  });
}

export async function saveExport(id: string, revision: number, pdf: Uint8Array): Promise<SavedExport> {
  return enqueue(async () => {
    const connection = await db;
    const row = await connection.getFirstAsync<{ data: string }>('SELECT data FROM documents WHERE id = ?', id);
    if (!row) throw new Error('Document no longer exists');
    const doc = hydrate(JSON.parse(row.data) as SavedDocument);
    if (doc.revision !== revision) throw new Error('Document changed during export; please export again');
    const item: SavedExport = { id: newId(), revision, file: `${id}-${newId()}.pdf`, createdAt: new Date().toISOString() };
    const file = new File(exportDir, item.file);
    file.create();
    try {
      await file.write(pdf);
      doc.exports.push(item);
      doc.updatedAt = item.createdAt;
      await connection.runAsync('UPDATE documents SET data = ? WHERE id = ?', JSON.stringify(doc), id);
      return item;
    } catch (error) {
      if (file.exists) file.delete();
      throw error;
    }
  });
}

export function exportUri(item: SavedExport): string {
  return new File(exportDir, item.file).uri;
}

export function originalUri(receipt: SavedReceipt): string {
  return new File(receiptDir, receipt.originalFile).uri;
}

export function deleteDocument(id: string): Promise<void> {
  return enqueue(async () => {
    await (await db).runAsync('DELETE FROM documents WHERE id = ?', id);
    await cleanupFilesUnsafe();
  });
}

export function cleanupFiles(): Promise<void> {
  return enqueue(cleanupFilesUnsafe);
}

async function cleanupFilesUnsafe(): Promise<void> {
  const rows = await (await db).getAllAsync<{ data: string }>('SELECT data FROM documents');
  const docs = rows.map((row) => JSON.parse(row.data) as SavedDocument);
  const images = new Set(docs.flatMap((doc) => doc.receipts.flatMap((receipt) => [receipt.originalFile, receipt.processedFile, receipt.thumbnailFile].filter((name): name is string => !!name))));
  const exports = new Set(docs.flatMap((doc) => doc.exports.map((item) => item.file)));
  for (const item of receiptDir.list()) if (item instanceof File && !images.has(item.name)) item.delete();
  for (const item of exportDir.list()) if (item instanceof File && !exports.has(item.name)) item.delete();
}

export async function recoverDocuments(): Promise<void> {
  await enqueue(async () => {
    const connection = await db;
    for (const row of await connection.getAllAsync<{ data: string }>('SELECT data FROM documents')) {
      const stored = JSON.parse(row.data) as SavedDocument;
      const migrated = migrateDocument(stored);
      migrated.receipts = migrated.receipts.map((receipt) => {
        const sourceExists = new File(receiptDir, receipt.originalFile).exists;
        const processedExists = !!receipt.processedFile && new File(receiptDir, receipt.processedFile).exists;
        const processingStatus = !sourceExists || receipt.processingStatus === 'ready' && !processedExists
          ? 'failed' : receipt.processingStatus === 'processing' ? 'queued' : receipt.processingStatus;
        return { ...receipt, processingStatus };
      });
      if (JSON.stringify(migrated) !== JSON.stringify(stored)) {
        const result = await connection.runAsync('UPDATE documents SET data = ? WHERE id = ?',
          JSON.stringify(migrated), migrated.batch.id);
        if (result.changes !== 1) throw new Error('Document migration was not saved');
      }
    }
    await cleanupFilesUnsafe();
  });
}
