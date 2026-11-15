import type { Receipt } from './types.js';

export type DuplicateSeverity = 'strong' | 'possible' | 'weak';
export type DuplicateReason = 'identical-source' | 'transaction-id' | 'matching-fields' | 'similar-text';

export interface DuplicateCandidate {
  left: Receipt;
  right: Receipt;
  severity: DuplicateSeverity;
  reasons: DuplicateReason[];
}

function normalize(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function textTokens(value: string | undefined): Set<string> {
  return new Set((value ?? '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
}

function textSimilarity(left: Set<string>, right: Set<string>): number {
  if (left.size < 8 || right.size < 8) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

function sameTransactionId(left: Receipt, right: Receipt): boolean {
  const a = normalize(left.transactionId);
  const b = normalize(right.transactionId);
  return a.length >= 6 && a === b && !!normalize(left.merchant) &&
    normalize(left.merchant) === normalize(right.merchant);
}

function matchingFields(left: Receipt, right: Receipt): boolean {
  const merchant = normalize(left.merchant);
  const leftAmount = left.amountMinorUnits !== undefined ? left.amountMinorUnits : left.amountCents;
  const rightAmount = right.amountMinorUnits !== undefined ? right.amountMinorUnits : right.amountCents;
  return !!merchant && merchant === normalize(right.merchant) && !!left.date && left.date === right.date &&
    leftAmount !== null && leftAmount !== undefined && leftAmount === rightAmount &&
    !!left.currency && left.currency === right.currency;
}

/** Pairwise duplicate evidence. Similarity alone never proves transaction identity. */
export function findDuplicates(receipts: Receipt[]): DuplicateCandidate[] {
  const result: DuplicateCandidate[] = [];
  const tokens = receipts.map((receipt) => textTokens(receipt.ocrText));
  for (let i = 0; i < receipts.length; i++) for (let j = i + 1; j < receipts.length; j++) {
    const a = receipts[i]!;
    const b = receipts[j]!;
    if (a.id === b.id) continue;
    const reasons: DuplicateReason[] = [];
    let severity: DuplicateSeverity | null = null;
    if (a.sourceSha256 && a.sourceSha256 === b.sourceSha256) {
      reasons.push('identical-source');
      severity = 'strong';
    }
    if (sameTransactionId(a, b)) {
      reasons.push('transaction-id');
      severity = 'strong';
    }
    if (matchingFields(a, b)) {
      reasons.push('matching-fields');
      severity ??= 'possible';
    }
    if (textSimilarity(tokens[i]!, tokens[j]!) >= 0.8) {
      reasons.push('similar-text');
      severity ??= 'weak';
    }
    if (severity) result.push(a.id < b.id
      ? { left: a, right: b, severity, reasons }
      : { left: b, right: a, severity, reasons });
  }
  return result.sort((a, b) => a.left.id.localeCompare(b.left.id) || a.right.id.localeCompare(b.right.id));
}
