# Receipt scanning contracts

This is the shared contract for the mobile receipt pipeline. The lead owns changes to
this document, `packages/core/src/types.ts`, the RemiScan TypeScript bridge, and
`apps/mobile/App.tsx`. Other owners request interface changes through the lead.

## Receipt and evidence

- A receipt ID is assigned once, before its source image is queued. Reprocessing,
  replacement, ordering, and layout changes keep that ID.
- `originalFile` points to the earliest image available to Remi. For Remi Camera
  and gallery it is the captured/imported photo; for Quick Scan it is the page
  returned by the system scanner. `originalPhotoAvailable` is false for Quick Scan.
- `processedFile` is optional until processing succeeds. Files are immutable within
  an image revision. `imageRevision` increases when source, crop, rotation,
  enhancement, or selected export image materially changes.
- Crop corners use normalized top-left coordinates ordered TL, TR, BR, BL. The
  processing result records source and output dimensions, rotation, filter,
  margin, and a source-to-output homography on the upright working image. OCR boxes use normalized top-left
  coordinates on the image recognized; vertical spans remain available for safe
  PDF page breaks. Original dimensions are retained; `originalToWorking` is present
  only when its pixel transform is known. A normalized or EXIF-rotated source may
  have no reliable original-to-working mapping, so consumers must check before
  projecting OCR boxes onto the original photo. End-to-end original-to-processed
  OCR coordinate mapping remains incomplete until image orientation handling is
  validated on devices.
- `integrity` contains a primary state, multiple issue codes, image revision,
  assessment revision, and optional acknowledgment of those exact revisions and
  issues. Acknowledgment never changes the assessment state.
- Top-level merchant, date, amount, and currency are current values. Candidate
  and evidence records contain alternatives and their image revision, not another
  authoritative value. Financial field verification is independent of integrity.
- `amountMinorUnits` is the canonical integer amount. Currency is an ISO 4217
  code or null; precision is validated against currency metadata. Legacy
  `amountCents` and `fx` are read for migration, never used for new conversion.
  Confirmed and provisional subtotals are grouped by currency.
- `claimIncluded` is independent of verification, integrity, and PDF selection.
  Existing receipts default to included during migration.
- `sourceSha256`, transaction ID, and OCR text are optional core-visible duplicate
  signals. Pairwise duplicate decisions live once on `SavedDocument`, not on
  each receipt.

## Queue and storage

- Persist the source file and queued receipt record before processing. Queue
  status is queued, processing, ready, or failed; `jobRevision` increases on
  retry, cancellation, replacement, or a superseding process request.
- Processing may run only while the app is active. On restart, a processing job
  becomes queued and resumes. A job result commits only when the receipt still
  exists with the expected image and job revisions. Stale temporary files are
  deleted without recreating a receipt.
- Database writes serialize through the existing documents store. Cleanup only
  removes files after committed references have changed and retains queued source
  files. A failed replacement leaves the prior evidence and record intact.
- Migration is idempotent and preserves IDs, order, images, layout, and metadata.
  The old editor set `confirmed: true` automatically when a typed amount parsed,
  so that flag cannot prove explicit review. Legacy amounts remain provisional
  regardless of `confirmed`; currency requires review because the old UI
  defaulted to NZD.

## Duplicates and export

- Duplicate candidates are pairwise, identified by sorted receipt IDs and both
  image revisions. Exact file hashes or sufficiently specific independent
  transaction evidence can be strong. Merchant/date/amount/currency matching
  alone is possible; OCR similarity alone is weak. Decisions are pairwise, so
  resolving one edge in a group cannot clear another.
- A reimbursement receipt is eligible only when included, processing is ready,
  amount and currency are verified, integrity is ready or its current issues are
  acknowledged, and no unresolved strong duplicate edge joins two included
  receipts. Every ineligible included receipt blocks final reimbursement export.
- Image-only export takes an explicit receipt subset and does not require
  financial verification. Reimbursement export takes all claim-included receipts,
  optionally lists excluded receipt details, and omits excluded images. Preview
  and final export use the same configuration and renderer.
- Both modes use validated safe column layouts. A long image can be split only at
  a verified blank/text-safe break or a user-selected break. The legacy equal-slice
  PDF fallback must not be used.
