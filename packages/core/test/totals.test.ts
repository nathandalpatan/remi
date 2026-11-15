import { describe, expect, it } from 'vitest';
import { findDuplicates, revalidateFinancialEvidence, summarizeClaim } from '../src/index.js';
import { makeReceipt } from './fixtures.js';

const verified = { status: 'verified' as const, evidence: { source: 'user' as const, imageRevision: 0 } };

describe('summarizeClaim', () => {
  it('groups eligible totals by currency without converting foreign amounts', () => {
    const summary = summarizeClaim([
      makeReceipt({ id: 'nz', amountCents: 3500 }),
      makeReceipt({ id: 'au', amountCents: 8000, currency: 'AUD', fx: { rate: 1.1, rateDate: '2026-10-01' } }),
      makeReceipt({ id: 'us', amountCents: 12000, currency: 'USD' }),
    ], 'NZD');
    expect(summary.confirmedByCurrency).toEqual({ NZD: 3500, AUD: 8000, USD: 12000 });
    expect(summary.provisionalByCurrency).toEqual({});
    expect(summary.isFinal).toBe(true);
  });

  it('does not treat legacy two-decimal GST as JPY or KWD minor units', () => {
    const summary = summarizeClaim([
      makeReceipt({ id: 'nz', currency: 'NZD', gstCents: 163 }),
      makeReceipt({ id: 'jp', currency: 'JPY', amountCents: null, amountMinorUnits: 1000, gstCents: 1000 }),
      makeReceipt({ id: 'kw', currency: 'KWD', amountCents: null, amountMinorUnits: 1234, gstCents: 1000 }),
    ], 'NZD');
    expect(summary.confirmedByCurrency).toEqual({ NZD: 1250, JPY: 1000, KWD: 1234 });
    expect(summary.gstByCurrency).toEqual({ NZD: 163 });
  });

  it('shows an eligible subtotal but blocks an included unverified amount', () => {
    const summary = summarizeClaim([
      makeReceipt({ id: 'good' }),
      makeReceipt({ id: 'pending', financialVerification: {
        amount: { status: 'provisional' }, currency: verified,
      } }),
    ], 'NZD');
    expect(summary.confirmedByCurrency).toEqual({ NZD: 1250 });
    expect(summary.provisionalByCurrency).toEqual({ NZD: 1250 });
    expect(summary.issues).toContainEqual({ receiptId: 'pending', number: 2, kind: 'amount-unverified' });
    expect(summary.isFinal).toBe(false);
  });

  it('requires currency verification even for a legacy confirmed amount', () => {
    const summary = summarizeClaim([makeReceipt({ id: 'legacy', financialVerification: {
      amount: verified, currency: { status: 'unverified' },
    } })], 'NZD');
    expect(summary.confirmedByCurrency).toEqual({});
    expect(summary.issues).toContainEqual({ receiptId: 'legacy', number: 1, kind: 'currency-unverified' });
  });

  it('blocks malformed legacy currency values with or without an amount', () => {
    const summary = summarizeClaim([
      makeReceipt({ id: 'missing', currency: 'QTY', amountCents: null }),
      makeReceipt({ id: 'legacy', currency: 'QTY', amountCents: 1250 }),
    ], 'NZD');
    expect(summary.confirmedByCurrency).toEqual({});
    expect(summary.isFinal).toBe(false);
    expect(summary.issues).toContainEqual({ receiptId: 'missing', number: 1, kind: 'invalid-currency' });
    expect(summary.issues).toContainEqual({ receiptId: 'legacy', number: 2, kind: 'invalid-currency' });
  });

  it('keeps excluded amounts out of totals and blocks incomplete images until current acknowledgment', () => {
    const blocked = makeReceipt({ id: 'blocked', integrity: {
      state: 'incomplete', issues: ['bottom-clipped'], imageRevision: 0, assessmentRevision: 2,
    } });
    const excluded = makeReceipt({ id: 'excluded', claimIncluded: false });
    const summary = summarizeClaim([blocked, excluded], 'NZD');
    expect(summary.confirmedByCurrency).toEqual({});
    expect(summary.excluded.map((receipt) => receipt.id)).toEqual(['excluded']);
    expect(summary.issues).toEqual([{ receiptId: 'blocked', number: 1, kind: 'integrity-unreviewed' }]);
    blocked.integrity!.acknowledged = { imageRevision: 0, assessmentRevision: 2, issues: ['bottom-clipped'] };
    expect(summarizeClaim([blocked, excluded], 'NZD').confirmedByCurrency).toEqual({ NZD: 1250 });
    blocked.imageRevision = 1;
    expect(summarizeClaim([blocked, excluded], 'NZD').isFinal).toBe(false);
  });

  it('blocks only unresolved strong duplicate pairs and does not clear a third receipt', () => {
    const a = makeReceipt({ id: 'a', sourceSha256: 'same' });
    const b = makeReceipt({ id: 'b', sourceSha256: 'same' });
    const c = makeReceipt({ id: 'c', sourceSha256: 'same' });
    const decisions = [{ leftId: 'a', rightId: 'b', leftImageRevision: 0, rightImageRevision: 0,
      resolution: 'keep_both' as const }];
    const summary = summarizeClaim([a, b, c], 'NZD', decisions);
    expect(summary.issues.filter((issue) => issue.kind === 'strong-duplicate').map((issue) => issue.receiptId))
      .toEqual(['a', 'b', 'c']);
    expect(summary.isFinal).toBe(false);
    expect(summarizeClaim([a, b], 'NZD', decisions).isFinal).toBe(true);
    b.imageRevision = 1;
    b.financialVerification = { amount: { status: 'verified', evidence: { source: 'user', imageRevision: 1 } },
      currency: { status: 'verified', evidence: { source: 'user', imageRevision: 1 } } };
    b.integrity = { state: 'ready', issues: [], imageRevision: 1, assessmentRevision: 2 };
    expect(summarizeClaim([a, b], 'NZD', decisions).issues.some((issue) => issue.kind === 'strong-duplicate')).toBe(true);
  });

  it('warns on possible duplicates without blocking the final claim', () => {
    const receipts = [makeReceipt({ id: 'a' }), makeReceipt({ id: 'b' })];
    expect(findDuplicates(receipts)[0]?.severity).toBe('possible');
    expect(summarizeClaim(receipts, 'NZD').isFinal).toBe(true);
  });
});

describe('findDuplicates', () => {
  it('marks matching transaction fields possible and exact photos strong', () => {
    const [possible] = findDuplicates([
      makeReceipt({ id: 'a', merchant: 'ACME Ltd.' }),
      makeReceipt({ id: 'b', merchant: 'acme ltd' }),
    ]);
    expect(possible?.severity).toBe('possible');
    const [strong] = findDuplicates([
      makeReceipt({ id: 'a', sourceSha256: 'same' }),
      makeReceipt({ id: 'b', sourceSha256: 'same' }),
    ]);
    expect(strong?.severity).toBe('strong');
    expect(strong?.reasons).toContain('identical-source');
  });

  it('treats a specific shared transaction ID and merchant as strong', () => {
    const [candidate] = findDuplicates([
      makeReceipt({ id: 'a', transactionId: 'TXN-1234567' }),
      makeReceipt({ id: 'b', transactionId: 'TXN1234567', amountCents: 2000 }),
    ]);
    expect(candidate?.severity).toBe('strong');
  });

  it('keeps OCR similarity alone weak', () => {
    const text = 'one two three four five six seven eight nine ten eleven twelve';
    const [candidate] = findDuplicates([
      makeReceipt({ id: 'a', amountCents: 100, ocrText: text }),
      makeReceipt({ id: 'b', amountCents: 200, ocrText: text }),
    ]);
    expect(candidate?.severity).toBe('weak');
  });
});

describe('revalidateFinancialEvidence', () => {
  it('keeps verified values after rotation of the same source unless new evidence conflicts', () => {
    const previous = makeReceipt({ sourceSha256: 'same' });
    const next = makeReceipt({ sourceSha256: 'same', imageRevision: 1 });
    expect(revalidateFinancialEvidence(previous, next, 'rotation').amount.status).toBe('verified');
    next.financialVerification = { amount: { status: 'provisional' }, currency: { status: 'provisional' },
      candidates: [{ field: 'amount', value: 999, confidence: 'high',
        evidence: { source: 'ocr', imageRevision: 1 } }] };
    expect(revalidateFinancialEvidence(previous, next, 'rotation').amount.status).toBe('provisional');
  });

  it('requires evidence after a crop and resets a different replacement', () => {
    const previous = makeReceipt({ sourceSha256: 'old' });
    const cropped = makeReceipt({ sourceSha256: 'old', imageRevision: 1,
      financialVerification: { amount: { status: 'provisional' }, currency: { status: 'provisional' },
        candidates: [{ field: 'amount', value: 1250, confidence: 'high',
          evidence: { source: 'ocr', imageRevision: 1 } }] } });
    expect(revalidateFinancialEvidence(previous, cropped, 'crop').amount.status).toBe('verified');
    expect(revalidateFinancialEvidence(previous, cropped, 'crop').currency.status).toBe('provisional');
    const different = makeReceipt({ sourceSha256: 'new', imageRevision: 1 });
    expect(revalidateFinancialEvidence(previous, different, 'replacement').amount.status).toBe('provisional');
  });
});
