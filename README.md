# remi
A mobile app that lets you photograph receipts, automatically packs many of them onto each page of a single PDF, and adds up the verified total so you can submit one compact, easy-to-check expense claim for reimbursement.

## Architecture

```
┌──────────────── Mobile app (apps/mobile, Expo + React Native) ──────────────────┐
│ Capture            Review                     Export                            │
│ ML Kit Document    edit + confirm fields,     pick batch → share PDF + CSV      │
│ Scanner / VisionKit duplicate warnings                                          │
│ (crop, deskew)                                                                  │
│      │ photo + on-device OCR text                                               │
└──────┼──────────────────────────────────────────────────────────────────────────┘
       ▼
┌──────────────── @remi/core (packages/core, pure TypeScript, no UI) ─────────────┐
│ extract.ts     OCR text → suggested total / GST / date / merchant (+confidence) │
│ duplicates.ts  same merchant + date + amount + currency → warn                  │
│ totals.ts      claim total in home currency, GST, blocking issues               │
│ layout.ts      pack mixed-width photos, keep pinned ones, split long receipts   │
│ column-layout.ts  resolve editable 1–3 column A4 pages and safe breaks          │
│ drag.ts        validate a dragged receipt's drop → placements to save           │
│ pdf.ts         claim PDF: cover sheet + packed receipt pages                    │
│ cover.ts       cover sheet: numbered rows + total                               │
│ csv.ts         one row per receipt for finance-system import                    │
└─────────────────────────────────────────────────────────────────────────────────┘
       ▼
Local storage: SQLite document → receipts in app documents → versioned PDF exports
```

Key decisions:

- **Money is integer cents**, never floats. Foreign amounts are converted once with a stored rate and rate date.
- **The editor uses fixed A4 columns.** Drafts default to two columns and can use one or three. Receipts print at the column width, at least 60 mm, with their original aspect ratio. Normal additions backfill available space while preserving saved placements; optimisation proposes a full repack. Long receipts split at recognised text gaps or a user-confirmed blank band.
- **OCR only suggests values.** Every extracted field carries a confidence, and export is refused until every receipt is confirmed and can be totalled.
- **The PDF is only a view.** Draft documents and their images remain editable after export. Each export is stored as a separate PDF version.
- **The canvas and PDF share placements.** The document stores every resolved position in millimetres. PDF preview opens the generated file in the phone's native viewer, including the claim cover page.
- **Drafts stay on this device.** SQLite and the app's document directory survive restarts; there is no account or cross-device sync.

## Usage

```ts
import { extractFields, findDuplicates, renderClaimPdf, toCsv } from '@remi/core';

const suggested = extractFields(ocrText); // show as editable fields
const duplicates = findDuplicates([...existingReceipts, ...newReceipts]);
const pdf = await renderClaimPdf({ batch, receipts, loadImage: (uri) => readFileBytes(uri) });
const csv = toCsv(receipts, batch.homeCurrency);
```

Images must be upright PNG or JPEG with their real pixel size in `receipt.image`. Downscale photos to about 300 DPI at print width (about 950 px wide for an 80 mm slip, 2250 px for a full-width invoice) before export to keep the PDF small.

## Development

A pnpm workspace with two packages: `packages/core` (the library) and `apps/mobile` (the Expo app, which imports the built library from `packages/core/dist`).

```sh
pnpm install       # also builds packages/core
pnpm test          # vitest
pnpm typecheck     # core and app
pnpm build         # rebuild packages/core/dist after changing core
```

The mobile app uses native VisionKit/ML Kit scanning, on-device OCR, and a local native image processor for gallery photos. It needs a development build; Expo Go cannot load the local processor. The native scanner returns corrected images only, so its output is the earliest image available for camera scans. Gallery uploads retain their selected original separately.

```sh
cd apps/mobile
pnpm expo run:android  # requires Android SDK and a connected device/emulator
pnpm expo run:ios      # requires macOS and Xcode
pnpm start             # connect the installed development build
```

For an Android phone from Windows, sign in from `apps/mobile` with `pnpm dlx eas-cli login`, link the app once with `pnpm dlx eas-cli init`, then run `pnpm dlx eas-cli build --platform android --profile development`. Install the APK from the EAS build link.

For an iPhone without a paid Apple Developer membership, build locally on a Mac. Install Xcode, sign in to your Apple Account under Xcode Settings → Accounts, and connect your iPhone with Developer Mode enabled. With this app's source on the Mac, run `pnpm install` from the repository root, then `pnpm exec expo run:ios --device` from `apps/mobile`. If signing needs attention, select your Personal Team under Signing & Capabilities in Xcode. Personal Team provisioning expires after seven days, so reinstall the build when it expires. An EAS iPhone build from Windows instead requires Apple Developer Program membership: run `pnpm dlx eas-cli device:create`, then `pnpm dlx eas-cli build --platform ios --profile development`.

After either development build is installed, run `pnpm start` from `apps/mobile` and keep the phone and computer on the same Wi-Fi.

The first native build may download OpenCV and ML Kit on Android. On iOS, the processor uses system Vision and Core Image frameworks. Images and PDFs are kept in the app's private document directory, so uninstalling the app removes them. Check scanned text and totals before confirming a receipt; obscured financial information is never reconstructed.
