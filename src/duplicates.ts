import type { Receipt } from './types.js';

/**
 * Groups receipts that look like the same purchase: same merchant, date, amount and
 * currency. Pass existing receipts plus new ones to catch a receipt claimed twice
 * across batches. Receipts missing any of those fields can't be compared and are skipped.
 */
export function findDuplicates(receipts: Receipt[]): Receipt[][] {
  const groups = new Map<string, Receipt[]>();
  for (const receipt of receipts) {
    const key = duplicateKey(receipt);
    if (key === null) continue;
    const group = groups.get(key);
    if (group) group.push(receipt);
    else groups.set(key, [receipt]);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

function duplicateKey(receipt: Receipt): string | null {
  if (!receipt.merchant || !receipt.date || receipt.amountCents === null) return null;
  // OCR and manual entry disagree on case, spacing and punctuation ("ACME Ltd." vs "Acme Ltd").
  const merchant = receipt.merchant.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  if (!merchant) return null;
  return [merchant, receipt.date, receipt.amountCents, receipt.currency].join('|');
}
