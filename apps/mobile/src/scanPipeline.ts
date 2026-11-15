import { currencyMinorDigits, extractFieldCandidates, extractFields } from '@remi/core';
import { describeReceiptSource, detectReceipt, hashReceiptSource, processImage, recognizeReceipt, type Corners, type Detection, type RecognizedReceipt, type SourceDescription } from '../modules/remi-scan/src';
import type { SavedReceipt } from './documents';

type WorkingImage = { uri: string; width: number; height: number };

/** Pixel-boundary coordinates in the encoded source to pixel-boundary coordinates in the upright working image. */
export function originalToWorkingTransform(source: SourceDescription, working: WorkingImage, sameFile: boolean): number[] | undefined {
  const { rawWidth: width, rawHeight: height, orientation } = source;
  if (![width, height, working.width, working.height].every((value) => Number.isFinite(value) && value > 0)) return undefined;
  if (sameFile) {
    return width === working.width && height === working.height
      ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : undefined;
  }
  const swapped = orientation >= 5 && orientation <= 8;
  const scaleX = working.width / (swapped ? height : width);
  const scaleY = working.height / (swapped ? width : height);
  if (scaleX > 1.001 || scaleY > 1.001 || Math.abs(scaleX - scaleY) > Math.max(scaleX, scaleY) * 0.005) return undefined;
  const oriented = {
    1: [1, 0, 0, 0, 1, 0],
    2: [-1, 0, width, 0, 1, 0],
    3: [-1, 0, width, 0, -1, height],
    4: [1, 0, 0, 0, -1, height],
    5: [0, 1, 0, 1, 0, 0],
    6: [0, -1, height, 1, 0, 0],
    7: [0, -1, height, -1, 0, width],
    8: [0, 1, 0, -1, 0, width],
  }[orientation];
  return oriented ? [oriented[0]! * scaleX, oriented[1]! * scaleX, oriented[2]! * scaleX,
    oriented[3]! * scaleY, oriented[4]! * scaleY, oriented[5]! * scaleY, 0, 0, 1] : undefined;
}

function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
}

function lostText(source: RecognizedReceipt, processed: RecognizedReceipt): boolean {
  const before = tokens(source.text);
  if (before.size < 4) return false;
  const after = tokens(processed.text);
  let missing = 0;
  for (const token of before) if (!after.has(token)) missing += 1;
  return missing / before.size > 0.2;
}

function sourceTextSafelyInsideCrop(source: RecognizedReceipt, crop: Corners): boolean {
  const sourceTokens = tokens(source.text);
  const boxedTokens = new Set<string>();
  if (!source.lines.length) return false;
  const vertices = [0, 1, 2, 3].map((index) => [crop[index * 2]!, crop[index * 2 + 1]!] as const);
  const winding = Math.sign(vertices.reduce((sum, [x, y], index) => {
    const [nextX, nextY] = vertices[(index + 1) % 4]!;
    return sum + x * nextY - nextX * y;
  }, 0));
  if (!winding) return false;
  const safelyInside = (x: number, y: number) => vertices.every(([ax, ay], index) => {
    const [bx, by] = vertices[(index + 1) % 4]!;
    const edgeLength = Math.hypot(bx - ax, by - ay);
    return edgeLength > 0 && winding * ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / edgeLength >= 0.01;
  });
  for (const line of source.lines) {
    const { left, top, right, bottom, text } = line;
    if (left === undefined || right === undefined || !text?.trim() ||
      ![left, top, right, bottom].every((value) => Number.isFinite(value) && value >= 0 && value <= 1) ||
      left >= right || top >= bottom ||
      !safelyInside(left, top) || !safelyInside(right, top) ||
      !safelyInside(right, bottom) || !safelyInside(left, bottom)) return false;
    for (const token of tokens(text)) boxedTokens.add(token);
  }
  return [...sourceTokens].every((token) => boxedTokens.has(token));
}

function assess(detection: Detection | null, source: SavedReceipt, issues: string[]): SavedReceipt['integrity'] {
  if (source.captureSource === 'system_scanner') issues.push('source_integrity_unassessed');
  if (source.captureSource !== 'system_scanner' && !detection?.corners) issues.push('boundary_not_found');
  if (detection?.corners && detection.score < 0.7) issues.push('low_boundary_confidence');
  if (detection?.edgeContact) issues.push('image_edge_contact');
  if ((detection?.visualLossRisk ?? 0) >= 0.7) issues.push('visual_content_loss_risk');
  if (detection?.issues.length) issues.push(...detection.issues);
  const unique = [...new Set(issues)];
  const state = unique.includes('image_edge_contact') ? 'incomplete'
    : unique.some((issue) => issue.includes('obstruct')) ? 'obstructed'
      : unique.some((issue) => issue.includes('blur') || issue.includes('glare')) ? 'unreadable'
        : unique.length ? 'needs_review' : 'ready';
  return { state, issues: unique, imageRevision: source.imageRevision ?? 0,
    assessmentRevision: (source.integrity?.assessmentRevision ?? 0) + 1 };
}

/** One on-device path for gallery, Remi Camera, and Quick Scan sources. */
export async function processQueuedImage(source: SavedReceipt, working: WorkingImage): Promise<{
  processedUri: string;
  updates: Partial<SavedReceipt>;
}> {
  const issues: string[] = [];
  let description: SourceDescription | undefined;
  try { description = await describeReceiptSource(source.image.uri); }
  catch { /* The source is preserved even when orientation metadata cannot be read. */ }
  const originalToWorking = description && originalToWorkingTransform(description, working, working.uri === source.image.uri);
  let detection: Detection | null = null;
  if (source.captureSource !== 'system_scanner') {
    try { detection = await detectReceipt(working.uri); }
    catch { issues.push('boundary_detection_failed'); }
  }
  const crop: Corners | null = detection?.corners && detection.score >= 0.7 &&
    !detection.edgeContact && detection.visualLossRisk !== undefined &&
    detection.visualLossRisk < 0.7 && !detection.issues.length
    ? detection.corners : null;
  if (detection?.corners && detection.visualLossRisk === undefined) issues.push('visual_crop_validation_unavailable');
  let sourceOcr: RecognizedReceipt | null = null;
  let processed = { uri: working.uri, width: working.width, height: working.height } as
    Awaited<ReturnType<typeof processImage>>;
  if (crop) {
    try { sourceOcr = await recognizeReceipt(working.uri); }
    catch { issues.push('source_ocr_failed', 'crop_validation_unavailable'); }
  }
  if (crop && sourceOcr) {
    try { processed = await processImage(working.uri, crop, 'colour', 0); }
    catch { issues.push('crop_processing_failed'); }
  }
  let recognition: RecognizedReceipt;
  try { recognition = await recognizeReceipt(processed.uri); }
  catch {
    if (processed.uri !== working.uri && sourceOcr) {
      issues.push('processed_ocr_failed');
      processed = { uri: working.uri, width: working.width, height: working.height };
      recognition = sourceOcr;
    } else {
      recognition = { text: '', lines: [] };
      issues.push('ocr_failed');
    }
  }
  if (processed.uri !== working.uri && sourceOcr?.text.trim() && !recognition.text.trim()) {
    issues.push('visible_text_loss_risk');
    processed = { uri: working.uri, width: working.width, height: working.height };
    recognition = sourceOcr;
  }
  if (processed.uri !== working.uri && sourceOcr && lostText(sourceOcr, recognition)) {
    if (crop && sourceTextSafelyInsideCrop(sourceOcr, crop)) {
      issues.push('ocr_disagreement_after_crop');
    } else {
      issues.push('visible_text_loss_risk');
      processed = { uri: working.uri, width: working.width, height: working.height };
      recognition = sourceOcr;
    }
  }
  if (!recognition.text.trim()) issues.push('no_text_recognized');
  const fields = extractFields(recognition.text);
  const currency = fields.currency?.value ?? null;
  let amountMinorUnits: number | null = null;
  if (currency && fields.totalCents) {
    try { if (currencyMinorDigits(currency) === 2) amountMinorUnits = fields.totalCents.value; }
    catch { issues.push('unsupported_currency'); }
  }
  const imageRevision = source.imageRevision ?? 0;
  const candidates = extractFieldCandidates(recognition.text, imageRevision);
  let sourceSha256: string | undefined;
  try { sourceSha256 = await hashReceiptSource(source.image.uri); }
  catch { issues.push('source_hash_failed'); }
  return {
    processedUri: processed.uri,
    updates: {
      image: { uri: processed.uri, widthPx: processed.width, heightPx: processed.height },
      sourceSha256,
      ocrText: recognition.text,
      ocrLines: recognition.lines,
      merchant: fields.merchant?.value ?? null,
      date: fields.date?.value ?? null,
      amountCents: fields.totalCents?.value ?? null,
      amountMinorUnits,
      currency,
      gstCents: fields.gstCents?.value ?? null,
      financialVerification: {
        amount: { status: amountMinorUnits === null ? 'unverified' : 'provisional' },
        currency: { status: currency === null ? 'unverified' : 'provisional' },
        candidates,
      },
      integrity: assess(detection, source, issues),
      imageProcessing: {
        corners: processed.uri !== working.uri ? crop : null,
        rawCorners: detection?.rawCorners ?? null,
        originalWidth: description?.rawWidth ?? source.image.widthPx,
        originalHeight: description?.rawHeight ?? source.image.heightPx,
        originalToWorking,
        sourceWidth: working.width,
        sourceHeight: working.height,
        outputWidth: processed.width,
        outputHeight: processed.height,
        sourceToOutput: 'sourceToOutput' in processed ? processed.sourceToOutput : undefined,
        rotation: 0,
        filter: processed.uri !== working.uri ? 'colour' : 'original',
        selectedImage: 'processed',
      },
    },
  };
}
