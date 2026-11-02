# remi
A mobile app that lets you photograph receipts, automatically packs many of them onto each page of a single PDF, and adds up the verified total so you can submit one compact, easy-to-check expense claim for reimbursement.

## Architecture

```
┌──────────────── Mobile app (React Native, not in this repo yet) ────────────────┐
│ Capture            Review                     Export                            │
│ ML Kit Document    edit + confirm fields,     pick batch → share PDF + CSV      │
│ Scanner / VisionKit duplicate warnings                                          │
│ (crop, deskew)                                                                  │
│      │ photo + on-device OCR text                                               │
└──────┼──────────────────────────────────────────────────────────────────────────┘
       ▼
┌──────────────── remi-core (this package, pure TypeScript, no UI) ───────────────┐
│ extract.ts     OCR text → suggested total / GST / date / merchant (+confidence) │
│ duplicates.ts  same merchant + date + amount + currency → warn                  │
│ totals.ts      claim total in home currency, GST, blocking issues               │
│ layout.ts      pack photos into ≥60 mm columns, split very long receipts        │
│ pdf.ts         cover sheet (numbered rows + total) + packed receipt pages       │
│ csv.ts         one row per receipt for finance-system import                    │
└─────────────────────────────────────────────────────────────────────────────────┘
       ▼
Local storage: Batch → Receipt (original full-res photo kept) → exported files
```

Key decisions:

- **Money is integer cents**, never floats. Foreign amounts are converted once with a stored rate and rate date.
- **Packing keeps receipts legible.** Every receipt prints at the same column width (at least 60 mm), and the page fills with first-fit decreasing. A receipt taller than a page is split into numbered parts instead of being shrunk.
- **OCR only suggests values.** Every extracted field carries a confidence, and export is refused until every receipt is confirmed and can be totalled.
- **The PDF is only a view.** Original photos stay in storage, so a claim can be re-exported with a different page size or order.

## Usage

```ts
import { extractFields, findDuplicates, renderClaimPdf, toCsv } from 'remi-core';

const suggested = extractFields(ocrText); // show as editable fields
const duplicates = findDuplicates([...existingReceipts, ...newReceipts]);
const pdf = await renderClaimPdf({ batch, receipts, loadImage: (uri) => readFileBytes(uri) });
const csv = toCsv(receipts, batch.homeCurrency);
```

Images must be upright PNG or JPEG with their real pixel size in `receipt.image`. Downscale photos to about 300 DPI at print width (about 700 px wide) before export to keep the PDF small.

## Development

```sh
pnpm install
pnpm test          # vitest
pnpm typecheck
pnpm build         # emits dist/
```
