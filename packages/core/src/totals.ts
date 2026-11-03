import { convertCents } from './money.js';
import type { CurrencyCode, Receipt } from './types.js';

export type IssueKind = 'unconfirmed' | 'missing-amount' | 'missing-exchange-rate';

export interface ReceiptIssue {
  receiptId: string;
  number: number;
  kind: IssueKind;
}

export interface SummaryLine {
  /** 1-based, same numbering as the layout and the PDF. */
  number: number;
  receipt: Receipt;
  homeAmountCents: number | null;
}

export interface ClaimSummary {
  homeCurrency: CurrencyCode;
  lines: SummaryLine[];
  /** Sum of every line that has a home amount. Only trustworthy when `issues` is empty. */
  totalCents: number;
  /** GST on home-currency receipts. Overseas tax can't be claimed back as GST. */
  gstCents: number;
  issues: ReceiptIssue[];
}

export function homeAmountCents(receipt: Receipt, homeCurrency: CurrencyCode): number | null {
  if (receipt.amountCents === null) return null;
  if (receipt.currency === homeCurrency) return receipt.amountCents;
  return receipt.fx ? convertCents(receipt.amountCents, receipt.fx.rate) : null;
}

export function summarizeClaim(receipts: Receipt[], homeCurrency: CurrencyCode): ClaimSummary {
  const lines: SummaryLine[] = [];
  const issues: ReceiptIssue[] = [];
  let totalCents = 0;
  let gstCents = 0;

  receipts.forEach((receipt, index) => {
    const number = index + 1;
    const issue = (kind: IssueKind) => issues.push({ receiptId: receipt.id, number, kind });

    if (!receipt.confirmed) issue('unconfirmed');
    if (receipt.amountCents === null) issue('missing-amount');
    else if (receipt.currency !== homeCurrency && !receipt.fx) issue('missing-exchange-rate');

    const home = homeAmountCents(receipt, homeCurrency);
    if (home !== null) totalCents += home;
    if (receipt.currency === homeCurrency && receipt.gstCents !== null) {
      gstCents += receipt.gstCents;
    }
    lines.push({ number, receipt, homeAmountCents: home });
  });

  return { homeCurrency, lines, totalCents, gstCents, issues };
}
