import { beforeEach, describe, expect, it, vi } from 'vitest';
import { moveColumnTile } from '@remi/core';

const memory = vi.hoisted(() => ({ rows: new Map<string, string>(), files: new Map<string, Uint8Array>(), failNextUpdate: false }));

vi.mock('expo-file-system', () => {
  class Directory {
    uri: string;
    constructor(parent: { uri: string }, name: string) { this.uri = `${parent.uri}/${name}`; }
    create() {}
    list() { return [...memory.files.keys()].filter((path) => path.startsWith(`${this.uri}/`)).map((path) => new File(path)); }
  }
  class File {
    uri: string;
    constructor(parent: string | { uri: string }, name?: string) { this.uri = name ? `${typeof parent === 'string' ? parent : parent.uri}/${name}` : typeof parent === 'string' ? parent : parent.uri; }
    get name() { return this.uri.split('/').pop()!; }
    get exists() { return memory.files.has(this.uri); }
    async copy(target: File) { const bytes = memory.files.get(this.uri); if (!bytes) throw new Error('Missing source'); memory.files.set(target.uri, bytes); }
    create() { memory.files.set(this.uri, new Uint8Array()); }
    async write(bytes: Uint8Array) { memory.files.set(this.uri, bytes); }
    delete() { memory.files.delete(this.uri); }
  }
  return { Directory, File, Paths: { document: { uri: 'doc' } } };
});

vi.mock('expo-sqlite', () => ({
  openDatabaseAsync: async () => ({
    execAsync: async () => {},
    getFirstAsync: async (_sql: string, id: string) => memory.rows.has(id) ? { data: memory.rows.get(id) } : null,
    getAllAsync: async () => [...memory.rows.values()].map((data) => ({ data })),
    runAsync: async (sql: string, ...args: string[]) => {
      if (sql.startsWith('UPDATE') && memory.failNextUpdate) {
        memory.failNextUpdate = false;
        return { changes: 0 };
      }
      if (sql.startsWith('INSERT')) memory.rows.set(args[0], args[1]);
      else if (sql.startsWith('UPDATE')) memory.rows.set(args[1], args[0]);
      else if (sql.startsWith('DELETE')) memory.rows.delete(args[0]);
      return { changes: 1 };
    },
  }),
}));

vi.mock('./claim', () => ({ HOME_CURRENCY: 'NZD' }));

import { cancelQueuedReceipt, claimNextReceipt, cleanupFiles, completeReceiptProcessing, createDocument, deleteDocument, failReceiptProcessing, getDocument, listDocuments, queueReceipt, recoverDocuments, retryReceiptProcessing, saveExport, saveReceipt, updateDocument, type SavedReceipt } from './documents';

beforeEach(() => { memory.rows.clear(); memory.files.clear(); memory.failNextUpdate = false; });

describe('local documents', () => {
  function queuedReceipt(id: string, batchId: string, uri: string): SavedReceipt {
    return {
      id, batchId, image: { uri, widthPx: 600, heightPx: 1000 },
      originalFile: `${id}-original.jpg`, filter: 'original', processingStatus: 'queued', ocrText: '',
      merchant: null, date: null, category: null, amountCents: null, currency: null,
      gstCents: null, fx: null, notes: '', confirmed: false,
    };
  }

  it('keeps empty drafts and ordered receipts across reads without duplicating a retried add', async () => {
    const doc = await createDocument();
    expect((await getDocument(doc.batch.id))?.receipts).toEqual([]);
    memory.files.set('camera/receipt.jpg', new Uint8Array([1, 2, 3]));
    const processed = 'doc/receipts/receipt-processed.jpg';
    const receipt = {
      id: 'receipt', batchId: doc.batch.id, image: { uri: processed, widthPx: 100, heightPx: 200 },
      originalFile: 'receipt-original.jpg', processedFile: 'receipt-processed.jpg', filter: 'colour',
      processingStatus: 'ready', ocrText: '', merchant: null, date: null, category: null,
      amountCents: 123, currency: 'NZD', gstCents: null, fx: null, notes: '', confirmed: false,
    } as SavedReceipt;
    for (let attempt = 0; attempt < 2; attempt++) await saveReceipt(doc.batch.id, receipt, 'camera/receipt.jpg', 'camera/receipt.jpg');
    const saved = await getDocument(doc.batch.id);
    expect(saved?.receipts).toHaveLength(1);
    expect(saved?.receipts[0].image.uri).toBe(processed);
    expect(memory.files.has('doc/receipts/receipt-original.jpg')).toBe(true);
  });

  it('retains shared files until the last document reference is deleted', async () => {
    const first = await createDocument();
    const second = await createDocument();
    memory.files.set('doc/receipts/shared.jpg', new Uint8Array([1]));
    for (const doc of [first, second]) await updateDocument(doc.batch.id, (current) => ({ ...current, receipts: [{
      id: doc.batch.id, batchId: doc.batch.id, originalFile: 'shared.jpg', processedFile: 'shared.jpg',
      image: { uri: 'doc/receipts/shared.jpg', widthPx: 1, heightPx: 1 }, filter: 'original', processingStatus: 'ready', ocrText: '',
      merchant: null, date: null, category: null, amountCents: null, currency: 'NZD', gstCents: null, fx: null, notes: '', confirmed: false,
    }] }));
    await deleteDocument(first.batch.id);
    expect(memory.files.has('doc/receipts/shared.jpg')).toBe(true);
    await deleteDocument(second.batch.id);
    expect(memory.files.has('doc/receipts/shared.jpg')).toBe(false);
  });

  it('keeps prior PDF versions and rejects an export of a changed revision', async () => {
    const doc = await createDocument();
    const first = await saveExport(doc.batch.id, 0, new Uint8Array([1]));
    const changed = await updateDocument(doc.batch.id, (current) => ({ ...current, batch: { ...current.batch, name: 'Edited' } }));
    await expect(saveExport(doc.batch.id, 0, new Uint8Array([2]))).rejects.toThrow('changed during export');
    const second = await saveExport(doc.batch.id, changed.revision, new Uint8Array([3]));
    expect((await getDocument(doc.batch.id))?.exports.map((item) => item.id)).toEqual([first.id, second.id]);
    expect(memory.files.has(`doc/exports/${first.file}`)).toBe(true);
  });

  it('removes unreferenced files left by interrupted processing', async () => {
    memory.files.set('doc/receipts/orphan.jpg', new Uint8Array([1]));
    await recoverDocuments();
    await cleanupFiles();
    expect(memory.files.has('doc/receipts/orphan.jpg')).toBe(false);
    expect(await listDocuments()).toEqual([]);
  });

  it('does not create a receipt when the processed image copy fails', async () => {
    const doc = await createDocument();
    memory.files.set('camera/original.jpg', new Uint8Array([1]));
    const receipt = {
      id: 'failed', batchId: doc.batch.id, originalFile: 'failed-original.jpg', processedFile: 'failed-processed.jpg',
      image: { uri: 'camera/missing.jpg', widthPx: 1, heightPx: 1 }, filter: 'original', processingStatus: 'ready', ocrText: '',
      merchant: null, date: null, category: null, amountCents: null, currency: 'NZD', gstCents: null, fx: null, notes: '', confirmed: false,
    } as SavedReceipt;
    await expect(saveReceipt(doc.batch.id, receipt, 'camera/original.jpg', 'camera/missing.jpg')).rejects.toThrow('Missing source');
    expect((await getDocument(doc.batch.id))?.receipts).toEqual([]);
    await recoverDocuments();
    expect(memory.files.has('doc/receipts/failed-original.jpg')).toBe(false);
  });

  it('persists every resolved placement and restores a moved receipt exactly', async () => {
    const doc = await createDocument();
    memory.files.set('camera/a.jpg', new Uint8Array([1]));
    memory.files.set('camera/b.jpg', new Uint8Array([2]));
    for (const id of ['a', 'b']) await saveReceipt(doc.batch.id, {
      id, batchId: doc.batch.id, image: { uri: `camera/${id}.jpg`, widthPx: 600, heightPx: 1000 },
      originalFile: `${id}-original.jpg`, processedFile: `${id}-processed.jpg`, filter: 'colour',
      processingStatus: 'ready', ocrText: '', merchant: null, date: null, category: null,
      amountCents: 100, currency: 'NZD', gstCents: null, fx: null, notes: '', confirmed: false,
    }, `camera/${id}.jpg`, `camera/${id}.jpg`);
    const saved = (await getDocument(doc.batch.id))!;
    const moved = moveColumnTile(saved.layout, 'b', 1, { pageIndex: 1, columnIndex: 1, index: 0 });
    await updateDocument(doc.batch.id, (current) => ({ ...current, layout: moved }));
    expect((await getDocument(doc.batch.id))?.layout).toEqual(moved);
    expect((await listDocuments())[0]?.layout.tiles).toEqual(moved.tiles);
  });

  it('migrates an older saved document into a valid layout without changing its revision', async () => {
    const doc = await createDocument();
    const older = { ...doc, receipts: [{
      id: 'legacy', batchId: doc.batch.id, image: { uri: 'legacy.jpg', widthPx: 600, heightPx: 1000 },
      originalFile: 'legacy.jpg', processedFile: 'legacy.jpg', filter: 'colour' as const,
      processingStatus: 'ready' as const, ocrText: '', merchant: null, date: null, category: null,
      amountCents: 100, currency: 'NZD', gstCents: null, fx: null, notes: '', confirmed: false,
      placements: [{ part: 1, pageIndex: 0, xMm: 115, yMm: 10 }],
    }] } as Partial<typeof doc>;
    delete older.layout;
    memory.files.set('doc/receipts/legacy.jpg', new Uint8Array([1]));
    memory.rows.set(doc.batch.id, JSON.stringify(older));
    await recoverDocuments();
    const saved = await getDocument(doc.batch.id);
    expect(saved?.layout.columnCount).toBe(2);
    expect(saved?.layout.tiles[0]?.columnIndex).toBe(1);
    expect(saved?.revision).toBe(doc.revision);
    expect(JSON.parse(memory.rows.get(doc.batch.id)!).layout.version).toBe(1);
  });

  it('keeps an editor thumbnail separate from the processed export image', async () => {
    const doc = await createDocument();
    memory.files.set('camera/full.jpg', new Uint8Array([1, 2, 3]));
    memory.files.set('camera/thumb.jpg', new Uint8Array([4]));
    await saveReceipt(doc.batch.id, {
      id: 'r', batchId: doc.batch.id, image: { uri: 'camera/full.jpg', widthPx: 600, heightPx: 1000 },
      originalFile: 'r-original.jpg', processedFile: 'r-processed.jpg', thumbnailFile: 'r-thumb.jpg', thumbnailUri: 'camera/thumb.jpg',
      filter: 'colour', processingStatus: 'ready', ocrText: '', merchant: null, date: null, category: null,
      amountCents: 100, currency: 'NZD', gstCents: null, fx: null, notes: '', confirmed: false,
    }, 'camera/full.jpg', 'camera/full.jpg');
    const saved = (await getDocument(doc.batch.id))!.receipts[0]!;
    expect(saved.image.uri).toBe('doc/receipts/r-processed.jpg');
    expect(saved.thumbnailUri).toBe('doc/receipts/r-thumb.jpg');
    expect(memory.files.get(saved.thumbnailUri!)).toEqual(new Uint8Array([4]));
    await deleteDocument(doc.batch.id);
    expect(memory.files.has(saved.thumbnailUri!)).toBe(false);
  });

  it('keeps legacy typed amounts provisional regardless of the ambiguous confirmed flag', async () => {
    const doc = await createDocument();
    const first = { ...queuedReceipt('first', doc.batch.id, 'old/first.jpg'),
      originalFile: 'first.jpg', processedFile: 'first.jpg', processingStatus: 'ready' as const,
      amountCents: 1200, currency: 'NZD', confirmed: true };
    const second = { ...queuedReceipt('second', doc.batch.id, 'old/second.jpg'),
      originalFile: 'second.jpg', processedFile: 'second.jpg', processingStatus: 'ready' as const,
      amountCents: 900, currency: 'NZD', confirmed: false };
    memory.files.set('doc/receipts/first.jpg', new Uint8Array([1]));
    memory.files.set('doc/receipts/second.jpg', new Uint8Array([2]));
    memory.rows.set(doc.batch.id, JSON.stringify({ ...doc, receipts: [first, second], duplicateDecisions: undefined }));
    await recoverDocuments();
    const migrated = (await getDocument(doc.batch.id))!;
    expect(migrated.receipts.map((receipt) => receipt.id)).toEqual(['first', 'second']);
    expect(migrated.receipts[0]?.amountMinorUnits).toBe(1200);
    expect(migrated.receipts[0]?.financialVerification?.amount.status).toBe('provisional');
    expect(migrated.receipts[0]?.financialVerification?.currency.status).toBe('unverified');
    expect(migrated.receipts[1]?.financialVerification?.amount.status).toBe('provisional');
    expect(migrated.receipts[1]?.financialVerification?.currency.status).toBe('unverified');
    expect(migrated.receipts[0]?.integrity?.state).toBe('needs_review');
    const stored = memory.rows.get(doc.batch.id);
    await recoverDocuments();
    expect(memory.rows.get(doc.batch.id)).toBe(stored);
  });

  it('persists source before processing and resumes a claimed job exactly once after restart', async () => {
    const doc = await createDocument();
    memory.files.set('camera/source.jpg', new Uint8Array([1]));
    await queueReceipt(doc.batch.id, queuedReceipt('r', doc.batch.id, 'camera/source.jpg'), 'camera/source.jpg');
    const queued = (await getDocument(doc.batch.id))!.receipts[0]!;
    expect(queued.processingStatus).toBe('queued');
    expect(queued.image.uri).toBe('doc/receipts/r-original.jpg');
    expect(memory.files.has(queued.image.uri)).toBe(true);
    const firstJob = (await claimNextReceipt(doc.batch.id, 'r'))!;
    expect(firstJob.jobRevision).toBe(1);
    await recoverDocuments();
    expect((await getDocument(doc.batch.id))!.receipts[0]?.processingStatus).toBe('queued');
    const secondJob = (await claimNextReceipt(doc.batch.id, 'r'))!;
    expect(secondJob.jobRevision).toBe(2);
    memory.files.set('camera/processed.jpg', new Uint8Array([2]));
    const processed = { image: { uri: 'camera/processed.jpg', widthPx: 500, heightPx: 900 }, ocrText: 'TOTAL 1.00' };
    expect(await completeReceiptProcessing(doc.batch.id, 'r', 0, 1, 'camera/processed.jpg', processed)).toBeNull();
    await completeReceiptProcessing(doc.batch.id, 'r', 0, 2, 'camera/processed.jpg', processed);
    const saved = (await getDocument(doc.batch.id))!.receipts;
    expect(saved).toHaveLength(1);
    expect(saved[0]?.processingStatus).toBe('ready');
    expect(saved[0]?.image.uri).toBe('doc/receipts/r-r0-j2-processed.jpg');
    expect(memory.files.has('doc/receipts/r-original.jpg')).toBe(true);
  });

  it('does not resurrect a processing receipt removed while its job is running', async () => {
    const doc = await createDocument();
    memory.files.set('camera/source.jpg', new Uint8Array([1]));
    await queueReceipt(doc.batch.id, queuedReceipt('r', doc.batch.id, 'camera/source.jpg'), 'camera/source.jpg');
    const claimed = (await claimNextReceipt(doc.batch.id, 'r'))!;
    await cancelQueuedReceipt(doc.batch.id, 'r');
    memory.files.set('camera/processed.jpg', new Uint8Array([2]));
    expect(await completeReceiptProcessing(doc.batch.id, 'r', 0, claimed.jobRevision!,
      'camera/processed.jpg', { image: { uri: 'camera/processed.jpg', widthPx: 500, heightPx: 900 } })).toBeNull();
    expect((await getDocument(doc.batch.id))?.receipts).toEqual([]);
    expect(memory.files.has('doc/receipts/r-original.jpg')).toBe(false);
    expect(memory.files.has('doc/receipts/r-r0-j1-processed.jpg')).toBe(false);
  });

  it('removes a staged source if its queued record was not saved', async () => {
    const doc = await createDocument();
    memory.files.set('camera/source.jpg', new Uint8Array([1]));
    memory.failNextUpdate = true;
    await expect(queueReceipt(doc.batch.id, queuedReceipt('r', doc.batch.id, 'camera/source.jpg'),
      'camera/source.jpg')).rejects.toThrow('Document was not saved');
    expect(memory.files.has('doc/receipts/r-original.jpg')).toBe(false);
    expect((await getDocument(doc.batch.id))?.receipts).toEqual([]);
  });

  it('retries one failed receipt without reprocessing a successful receipt', async () => {
    const doc = await createDocument();
    for (const id of ['failed', 'ready']) {
      const uri = `camera/${id}.jpg`;
      memory.files.set(uri, new Uint8Array([1]));
      await queueReceipt(doc.batch.id, queuedReceipt(id, doc.batch.id, uri), uri);
    }
    const failed = (await claimNextReceipt(doc.batch.id, 'failed'))!;
    await failReceiptProcessing(doc.batch.id, 'failed', 0, failed.jobRevision!);
    const ready = (await claimNextReceipt(doc.batch.id, 'ready'))!;
    memory.files.set('camera/processed.jpg', new Uint8Array([2]));
    await completeReceiptProcessing(doc.batch.id, 'ready', 0, ready.jobRevision!, 'camera/processed.jpg',
      { image: { uri: 'camera/processed.jpg', widthPx: 500, heightPx: 900 } });
    await retryReceiptProcessing(doc.batch.id, 'failed');
    const saved = (await getDocument(doc.batch.id))!.receipts;
    expect(saved.map((receipt) => [receipt.id, receipt.processingStatus])).toEqual([
      ['failed', 'queued'], ['ready', 'ready'],
    ]);
    expect(await claimNextReceipt(doc.batch.id, 'ready')).toBeNull();
  });

  it('keeps old evidence if replacement fails, then invalidates verification on successful replacement', async () => {
    const doc = await createDocument();
    memory.files.set('camera/old.jpg', new Uint8Array([1]));
    await saveReceipt(doc.batch.id, {
      ...queuedReceipt('r', doc.batch.id, 'camera/old.jpg'),
      processedFile: 'r-old-processed.jpg', processingStatus: 'ready',
      amountCents: 2500, currency: 'NZD', confirmed: true,
    }, 'camera/old.jpg', 'camera/old.jpg');
    await updateDocument(doc.batch.id, (current) => ({ ...current, receipts: current.receipts.map((receipt) => ({
      ...receipt, integrity: { state: 'incomplete', issues: ['bottom_missing'], imageRevision: 0,
        assessmentRevision: 1, acknowledged: { imageRevision: 0, assessmentRevision: 1, issues: ['bottom_missing'] } },
    })) }));
    const replacement = {
      ...queuedReceipt('r', doc.batch.id, 'camera/new.jpg'),
      originalFile: 'r-new-original.jpg', processedFile: 'r-new-processed.jpg', processingStatus: 'ready' as const,
    };
    memory.files.set('camera/new.jpg', new Uint8Array([2]));
    await expect(saveReceipt(doc.batch.id, replacement, 'camera/new.jpg', 'camera/missing.jpg', 'r', true))
      .rejects.toThrow('Missing source');
    const before = (await getDocument(doc.batch.id))!.receipts[0]!;
    expect(before.originalFile).toBe('r-original.jpg');
    expect(before.financialVerification?.amount.status).toBe('provisional');
    expect(before.integrity?.acknowledged).toBeDefined();
    await saveReceipt(doc.batch.id, replacement, 'camera/new.jpg', 'camera/new.jpg', 'r', true);
    const after = (await getDocument(doc.batch.id))!.receipts[0]!;
    expect(after.id).toBe('r');
    expect(after.imageRevision).toBe(1);
    expect(after.financialVerification?.amount.status).toBe('unverified');
    expect(after.financialVerification?.currency.status).toBe('unverified');
    expect(after.integrity?.acknowledged).toBeUndefined();
    expect(after.integrity?.state).toBe('needs_review');
    expect(after.integrity?.assessmentRevision).toBe(2);
    expect(after.amountCents).toBe(2500); // retained for comparison, not claim verification
    await cleanupFiles();
    expect(memory.files.has('doc/receipts/r-original.jpg')).toBe(false);
    expect(memory.files.has('doc/receipts/r-new-original.jpg')).toBe(true);
  });

  it('rejects a replacement prepared from an outdated image revision without copying its files', async () => {
    const doc = await createDocument();
    memory.files.set('camera/old.jpg', new Uint8Array([1]));
    memory.files.set('camera/new.jpg', new Uint8Array([2]));
    await saveReceipt(doc.batch.id, {
      ...queuedReceipt('r', doc.batch.id, 'camera/old.jpg'),
      processedFile: 'r-old-processed.jpg', processingStatus: 'ready',
    }, 'camera/old.jpg', 'camera/old.jpg');
    const old = (await getDocument(doc.batch.id))!.receipts[0]!;
    const replacement = {
      ...old, originalFile: 'r-new-original.jpg', processedFile: 'r-new-processed.jpg',
      image: { ...old.image, uri: 'camera/new.jpg' },
    };
    await updateDocument(doc.batch.id, (current) => ({ ...current, receipts: current.receipts.map((receipt) =>
      receipt.id === 'r' ? { ...receipt, imageRevision: 1, jobRevision: 1 } : receipt) }));
    await expect(saveReceipt(doc.batch.id, replacement, 'camera/new.jpg', 'camera/new.jpg', 'r', false,
      { imageRevision: old.imageRevision ?? 0, jobRevision: old.jobRevision ?? 0 }))
      .rejects.toThrow('Receipt changed');
    expect(memory.files.has('doc/receipts/r-new-original.jpg')).toBe(false);
    expect((await getDocument(doc.batch.id))!.receipts[0]?.imageRevision).toBe(1);
  });

  it('keeps a fresh replacement integrity assessment without carrying its acknowledgment', async () => {
    const doc = await createDocument();
    memory.files.set('camera/old.jpg', new Uint8Array([1]));
    memory.files.set('camera/new.jpg', new Uint8Array([2]));
    await saveReceipt(doc.batch.id, {
      ...queuedReceipt('r', doc.batch.id, 'camera/old.jpg'),
      processedFile: 'r-old-processed.jpg', processingStatus: 'ready',
    }, 'camera/old.jpg', 'camera/old.jpg');
    const old = (await getDocument(doc.batch.id))!.receipts[0]!;
    await saveReceipt(doc.batch.id, {
      ...old, originalFile: 'r-new-original.jpg', processedFile: 'r-new-processed.jpg',
      image: { ...old.image, uri: 'camera/new.jpg' },
      integrity: { state: 'incomplete', issues: ['image_edge_contact'], imageRevision: 1,
        assessmentRevision: 1, acknowledged: { imageRevision: 1, assessmentRevision: 1,
          issues: ['image_edge_contact'] } },
    }, 'camera/new.jpg', 'camera/new.jpg', 'r', false,
    { imageRevision: old.imageRevision ?? 0, jobRevision: old.jobRevision ?? 0 });
    const current = (await getDocument(doc.batch.id))!.receipts[0]!;
    expect(current.integrity).toMatchObject({ state: 'incomplete', issues: ['image_edge_contact'],
      imageRevision: 1, assessmentRevision: 1 });
    expect(current.integrity?.acknowledged).toBeUndefined();
  });
});
