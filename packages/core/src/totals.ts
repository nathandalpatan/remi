import { currencyMinorDigits } from './money.js';
import { findDuplicates } from './duplicates.js';
import type { CurrencyCode, DuplicateDecision, FinancialField, FinancialFieldVerification, FinancialVerification, Receipt } from './types.js';

export type IssueKind = 'processing' | 'missing-amount' | 'amount-unverified' | 'missing-currency' |
  'currency-unverified' | 'invalid-currency' | 'integrity-unreviewed' | 'strong-duplicate';

export interface ReceiptIssue {
  receiptId: string;
  number: number;
  kind: IssueKind;
}

export interface SummaryLine {
  number: number;
  receipt: Receipt;
  amountMinorUnits: number | null;
  eligible: boolean;
  /** Legacy CSV adapter; never converts a foreign currency. */
  homeAmountCents: number | null;
}

export interface ClaimSummary {
  homeCurrency: CurrencyCode;
  lines: SummaryLine[];
  confirmedByCurrency: Record<string, number>;
  provisionalByCurrency: Record<string, number>;
  gstByCurrency: Record<string, number>;
  excluded: Receipt[];
  issues: ReceiptIssue[];
  isFinal: boolean;
}

export function receiptAmountMinorUnits(receipt: Receipt): number | null {
  if (receipt.amountMinorUnits !== undefined) return receipt.amountMinorUnits;
  if (!receipt.currency || receipt.amountCents === null || !Number.isSafeInteger(receipt.amountCents)) return null;
  try { return currencyMinorDigits(receipt.currency) === 2 ? receipt.amountCents : null; }
  catch { return null; }
}

/** Carry confirmation to a new image revision only when its evidence remains consistent. */
export function revalidateFinancialEvidence(
  previous: Receipt, next: Receipt, change: 'crop' | 'rotation' | 'enhancement' | 'replacement',
): FinancialVerification {
  const old = previous.financialVerification;
  const candidates = next.financialVerification?.candidates ?? [];
  const revision = next.imageRevision ?? 0;
  const sameSource = !!previous.sourceSha256 && previous.sourceSha256 === next.sourceSha256;
  const sameTransaction = !!previous.transactionId && previous.transactionId === next.transactionId &&
    !!previous.merchant && previous.merchant === next.merchant && previous.date === next.date;
  const identityConsistent = change === 'replacement' ? sameSource || sameTransaction : sameSource;
  const valueOf = (receipt: Receipt, field: FinancialField): string | number | null => {
    if (field === 'amount') return receiptAmountMinorUnits(receipt);
    return field === 'currency' ? receipt.currency : field === 'merchant' ? receipt.merchant :
      field === 'date' ? receipt.date : receipt.gstCents;
  };
  const revalidate = (field: FinancialField): FinancialFieldVerification => {
    const previousField = old?.[field];
    const value = valueOf(next, field);
    const matches = candidates.some((candidate) => candidate.field === field && candidate.value === value &&
      candidate.confidence !== 'low' && candidate.evidence.imageRevision === revision);
    const conflicts = candidates.some((candidate) => candidate.field === field && candidate.value !== value &&
      candidate.confidence !== 'low' && candidate.evidence.imageRevision === revision);
    const sameValue = value !== null && value === valueOf(previous, field);
    const retained = previousField?.status === 'verified' && identityConsistent && sameValue && !conflicts &&
      (change === 'rotation' || change === 'enhancement' || matches);
    return retained
      ? { status: 'verified', evidence: { source: 'user', imageRevision: revision } }
      : { status: value === null ? 'unverified' : 'provisional',
          ...(matches ? { evidence: { source: 'ocr' as const, imageRevision: revision } } : {}) };
  };
  return { amount: revalidate('amount'), currency: revalidate('currency'),
    merchant: revalidate('merchant'), date: revalidate('date'), gst: revalidate('gst'), candidates };
}

/** Kept for legacy callers; foreign values are never converted. */
export function homeAmountCents(receipt: Receipt, homeCurrency: CurrencyCode): number | null {
  return receipt.currency === homeCurrency && currencyMinorDigits(homeCurrency) === 2
    ? receiptAmountMinorUnits(receipt) : null;
}

function verified(field: FinancialFieldVerification | undefined, imageRevision: number): boolean {
  return field?.status === 'verified' && field.evidence?.imageRevision === imageRevision;
}

function hasCurrentIntegrity(receipt: Receipt): boolean {
  const integrity = receipt.integrity;
  if (!integrity || integrity.imageRevision !== (receipt.imageRevision ?? 0)) return false;
  if (integrity.state === 'ready') return true;
  const acknowledgment = integrity.acknowledged;
  return !!acknowledgment && acknowledgment.imageRevision === integrity.imageRevision &&
    acknowledgment.assessmentRevision === integrity.assessmentRevision &&
    integrity.issues.every((issue) => acknowledgment.issues.includes(issue));
}

function add(map: Record<string, number>, currency: string, amount: number): void {
  map[currency] = (map[currency] ?? 0) + amount;
  if (!Number.isSafeInteger(map[currency])) throw new RangeError(`Total exceeds integer precision for ${currency}`);
}

function resolvedStrongPair(left: Receipt, right: Receipt, decisions: DuplicateDecision[]): boolean {
  return decisions.some((decision) => decision.resolution === 'keep_both' &&
    decision.leftId === left.id && decision.rightId === right.id &&
    decision.leftImageRevision === (left.imageRevision ?? 0) &&
    decision.rightImageRevision === (right.imageRevision ?? 0));
}

/** Summaries never convert currencies or count an ineligible receipt as confirmed. */
export function summarizeClaim(
  receipts: Receipt[], homeCurrency: CurrencyCode,
  duplicateDecisions: DuplicateDecision[] = [],
): ClaimSummary {
  const issues: ReceiptIssue[] = [];
  const confirmedByCurrency: Record<string, number> = {};
  const provisionalByCurrency: Record<string, number> = {};
  const gstByCurrency: Record<string, number> = {};
  const excluded = receipts.filter((receipt) => receipt.claimIncluded === false);
  const included = receipts.filter((receipt) => receipt.claimIncluded !== false);
  const strongConflict = new Set<string>();
  for (const candidate of findDuplicates(included)) {
    if (candidate.severity !== 'strong' || resolvedStrongPair(candidate.left, candidate.right, duplicateDecisions)) continue;
    strongConflict.add(candidate.left.id);
    strongConflict.add(candidate.right.id);
  }

  const lines = receipts.map((receipt, index): SummaryLine => {
    const number = index + 1;
    const amount = receiptAmountMinorUnits(receipt);
    if (receipt.claimIncluded === false) return {
      number, receipt, amountMinorUnits: amount, eligible: false,
      homeAmountCents: homeAmountCents(receipt, homeCurrency),
    };
    const issue = (kind: IssueKind) => issues.push({ receiptId: receipt.id, number, kind });
    const imageRevision = receipt.imageRevision ?? 0;
    if (receipt.processingStatus !== 'ready') issue('processing');
    if (amount === null || !Number.isSafeInteger(amount)) issue('missing-amount');
    else if (!verified(receipt.financialVerification?.amount, imageRevision)) issue('amount-unverified');
    if (!receipt.currency) issue('missing-currency');
    else {
      try { currencyMinorDigits(receipt.currency); }
      catch { issue('invalid-currency'); }
      if (!verified(receipt.financialVerification?.currency, imageRevision)) issue('currency-unverified');
    }
    if (!hasCurrentIntegrity(receipt)) issue('integrity-unreviewed');
    if (strongConflict.has(receipt.id)) issue('strong-duplicate');
    const eligible = !issues.some((item) => item.receiptId === receipt.id);
    if (amount !== null && Number.isSafeInteger(amount) && receipt.currency) {
      if (eligible) {
        add(confirmedByCurrency, receipt.currency, amount);
        if (receipt.gstCents !== null && currencyMinorDigits(receipt.currency) === 2) {
          add(gstByCurrency, receipt.currency, receipt.gstCents);
        }
      } else if (!issues.some((item) => item.receiptId === receipt.id && item.kind === 'invalid-currency')) {
        add(provisionalByCurrency, receipt.currency, amount);
      }
    }
    return {
      number, receipt, amountMinorUnits: amount, eligible,
      homeAmountCents: homeAmountCents(receipt, homeCurrency),
    };
  });
  return { homeCurrency, lines, confirmedByCurrency, provisionalByCurrency,
    gstByCurrency, excluded, issues, isFinal: issues.length === 0 && included.length > 0 };
}
