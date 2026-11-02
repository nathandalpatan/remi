import { describe, expect, it } from 'vitest';
import { findDuplicates, summarizeClaim } from '../src/index.js';
import { makeReceipt } from './fixtures.js';

describe('summarizeClaim', () => {
  it('totals home and converted foreign receipts', () => {
    const summary = summarizeClaim(
      [
        makeReceipt({ id: 'a', amountCents: 1250, gstCents: 163 }),
        makeReceipt({
          id: 'b',
          amountCents: 2000,
          currency: 'AUD',
          gstCents: 182,
          fx: { rate: 1.1, rateDate: '2026-10-01' },
        }),
      ],
      'NZD',
    );
    expect(summary.totalCents).toBe(1250 + 2200);
    expect(summary.gstCents).toBe(163); // Australian GST is not NZ GST
    expect(summary.lines.map((l) => [l.number, l.homeAmountCents])).toEqual([
      [1, 1250],
      [2, 2200],
    ]);
    expect(summary.issues).toEqual([]);
  });

  it('reports what blocks the claim', () => {
    const summary = summarizeClaim(
      [
        makeReceipt({ id: 'a', confirmed: false }),
        makeReceipt({ id: 'b', amountCents: null }),
        makeReceipt({ id: 'c', currency: 'USD', fx: null }),
      ],
      'NZD',
    );
    expect(summary.issues).toEqual([
      { receiptId: 'a', number: 1, kind: 'unconfirmed' },
      { receiptId: 'b', number: 2, kind: 'missing-amount' },
      { receiptId: 'c', number: 3, kind: 'missing-exchange-rate' },
    ]);
    expect(summary.totalCents).toBe(1250);
  });
});

describe('findDuplicates', () => {
  it('groups receipts with the same merchant, date, amount and currency', () => {
    const groups = findDuplicates([
      makeReceipt({ id: 'a', merchant: 'ACME Ltd.' }),
      makeReceipt({ id: 'b', merchant: 'acme ltd' }),
      makeReceipt({ id: 'c', merchant: 'ACME Ltd', amountCents: 999 }),
      makeReceipt({ id: 'd', merchant: null }),
      makeReceipt({ id: 'e', merchant: 'ACME Ltd', currency: 'AUD' }),
    ]);
    expect(groups.map((g) => g.map((r) => r.id))).toEqual([['a', 'b']]);
  });
});
