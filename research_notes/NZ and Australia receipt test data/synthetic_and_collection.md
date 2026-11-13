# Building an NZ/AU receipt test corpus: synthetic generation, self-collection, OCR capture, augmentation, evaluation, vendor labelling

Scope note: about 16 tool calls. Licence and free-tier figures were checked against primary pages where possible. Where vendor figures conflict, the conflict is recorded.

## 1. Synthetic receipt generators and NZ/AU localisation

### Takeaway
No off-the-shelf receipt generator targets NZ or AU. The usable building blocks are permissively licensed (Donut/SynthDoG and SynthTIGER are MIT). Because the library under test takes OCR **text**, the cheapest high-value path is a small in-repo TypeScript generator for receipt *text*, fed with NZ/AU rules (GST 15%/10%, "GST incl." wording, ABN or GST number, tax-invoice thresholds). Rendering images is only needed to test the OCR and PDF stages.

### Cited Findings
- Donut's repository (NAVER, MIT licence) includes SynthDoG, a synthetic document generator used for pre-training. Each sample pairs an image with `{"text_sequence": ...}`. Pre-generated sets of about 0.5M samples exist for English, Chinese, Japanese and Korean. Generation details live in `synthdog/README.md`. — [clovaai/donut](https://github.com/clovaai/donut)
- The same repo points to CORD (a receipt parsing dataset, `naver-clova-ix/cord-v2` on Hugging Face) as its receipt benchmark. The Donut page does not state CORD's licence. — [clovaai/donut](https://github.com/clovaai/donut)
- SynthTIGER (NAVER, ICDAR 2021) is a synthetic text-image generator for OCR, published on PyPI as `synthtiger`. Copyright is NAVER Corp 2021-present. The licence is reported as MIT, but I saw only a third-party index and a mirror, not the LICENSE file itself. — [PyPI synthtiger](https://pypi.org/project/synthtiger/1.1.0/); [oosmetrics](https://oosmetrics.com/repo/clovaai/synthtiger)
- arXiv 2508.03754 (Aug 2025), "Generating Synthetic Invoices via Layout-Preserving Content Replacement": OCR a seed document (doctr), use an LLM to swap in new content, then re-render. The output is paired image and JSON labels with tracked text-fragment IDs. The authors argue generative image models struggle with label consistency. — [arXiv 2508.03754](https://arxiv.org/html/2508.03754v1)
- WellApp-ai/Well `ai-receipt-generator` is described as an LLM-based, locale-aware receipt/invoice generator. It outputs JSON (not images), can simulate missing or broken fields, and falls back to Faker. **I saw it only through a Reddit post and did not open the repo.** — [GitHub link via Reddit](https://github.com/WellApp-ai/Well/tree/main/ai-receipt-generator)
- Other "receipt generator" hits were browser fake-receipt makers (PNG/PDF export) aimed at mockups, plus a one-commit template repo (alainrinder/target.py). These are of little engineering value, and fake-receipt makers carry misuse and expense-fraud connotations. — [alainrinder/target.py](https://github.com/alainrinder/target.py); [Receipt Mocker](https://peerlist.io/hellolaurynas/project/receipt-mocker)
- A commercial Apify actor generates invoice OCR ground truth (images, PDFs and JSON with word boxes) at about $50 per 1,000 pages. — [Apify](https://apify.com/jserle/ocr-ground-truth-document-factory)
- **AU rules a generator should encode (ATO).** A tax invoice is needed for GST credits on sales of $82.50 or more (GST-inclusive). Under $1,000 it must show 7 details: that it is intended as a tax invoice, seller identity, seller ABN, date, item description, and either the GST amount or a statement that the price includes GST. At $1,000 or more it must also show the buyer's identity or ABN. — [ATO tax invoices](https://www.ato.gov.au/business/gst/tax-invoices/) (via search summary); [Sprintlaw](https://sprintlaw.com.au/articles/ato-tax-invoice-requirements-what-must-be-on-your-invoices/)
- **NZ rules (IRD, "taxable supply information" regime since April 2023).**
  - $200 or less: seller name or trade name, date, description and total payable. A till receipt usually suffices.
  - Over $200 up to $1,000: adds the seller's GST number, plus the GST-exclusive amount and the GST amount (per the IRD summary).
  - Over $1,000: adds buyer identification.
  — [IRD: how taxable supply information works](https://www.ird.govt.nz/gst/tax-invoices-for-gst/how-taxable-supply-information-for-gst-works); [GST Act s19E (NZLII)](https://mail.nzlii.org/nz/legis/consol_act/gasta1985226/s19e.html)

### Inferences
- Because the library parses OCR text, a TypeScript generator that runs inside Vitest gives the most coverage per hour. Faker is MIT and has `en_AU` and `en_NZ` locales. Sketch: `generateReceipt({country:'NZ'|'AU', seed})`, returning `{ocrText, expected:{total, gst, date, merchant, currency, country}}`.
- Vary these dimensions in the generator:
  - GST rate and wording ("GST 15%", "Incl. GST", "Total includes GST of $x", "*" item flags with "GST-free" lines in AU).
  - ABN formats (11 digits, usually spaced as 2-3-3-3) and NZ GST number formats (8-9 digits, often "GST No: 123-456-789").
  - Date formats (DD/MM/YYYY, DD/MM/YY, "02 Nov 2026", 24-hour times).
  - Totals with and without the "$" sign, AUD/NZD labels, rounding lines (cash rounding to 10c in both countries), "EFTPOS" or card lines, surcharges, and tips.
  - Lines that should be traps: "Subtotal", "Change", "Cash tendered", "Savings", "Points balance".
- Derive GST from the total and print it too, so the generator stays consistent with the rules: NZ GST = total x 3/23, AU GST = total / 11.
- The ATO $82.50 and IRD $200 and $1,000 thresholds give natural boundary cases: AU receipts under $82.50 without an ABN, NZ receipts at or under $200 without a GST number.
- Use SynthDoG or SynthTIGER only if image-level tests of the OCR or PDF path are wanted. They need NZ/AU text corpora and thermal-printer-style fonts (monospace) supplied by the user. Both are Python, outside the TS toolchain.
- The layout-preserving replacement approach (arXiv 2508.03754) is a good fit for turning a handful of real NZ/AU receipts into many synthetic variants that keep realistic layout while removing personal data.
- Avoid real retailer logos and branding in published or shared synthetic images. Merchant *names* in text fixtures for parser tests are low risk, but realistic forged receipts should not be distributed.

### Gaps
- No receipt-specific synthetic-generation paper with NZ/AU content was found.
- The WellApp generator repo and its licence were not verified directly.
- SynthDoG customisation docs (corpus and fonts) were not fetched.
- The CORD licence was not confirmed.
- No public NZ or AU receipt dataset was found on Hugging Face or Kaggle. — [search summary](https://huggingface.co/datasets/CC1984/mall_receipt_extraction_dataset/tree/1de9238b3de18614893f36138efc6fb3ff6c2de0)

## 2. Self-collecting or crowdsourcing real receipts: privacy, redaction, labels

### Takeaway
Real receipts are the realism gold standard and cheap to collect from the developer, family and friends. They can contain personal information: masked card digits, names, loyalty or member numbers, and sometimes addresses. Collect with explicit consent for a stated purpose, redact before storing, and keep the original photos out of git.

### Cited Findings
- NZ Privacy Act 2020 has 13 Information Privacy Principles (IPPs), plus **IPP 3A (in force 1 May 2026)** covering what to tell individuals when information is collected from another source. Relevant here:
  - IPP1: purpose
  - IPP3: tell the individual
  - IPP4: manner of collection
  - IPP5: storage and security
  - IPP9: retention
  - IPP10/11: limits on use and disclosure
  - IPP12: disclosure outside NZ, relevant if sent to US-hosted OCR vendors
  - IPP13: unique identifiers
  — [OPC NZ privacy principles](https://www.privacy.org.nz/privacy-principles/)
- Australian Privacy Principles: APP 3 (collection of solicited information), APP 5 (notification), APP 6 (use and disclosure), and APP 11 (security, plus the duty to destroy or de-identify information no longer needed). — [OAIC APP quick reference](https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-quick-reference)
- High-value transactions (≥$1,000 in both countries) can carry buyer identity by law, so large receipts are the most likely to contain a person's name. — [ATO](https://www.ato.gov.au/business/gst/tax-invoices/); [IRD](https://www.ird.govt.nz/gst/tax-invoices-for-gst/how-taxable-supply-information-for-gst-works)

### Inferences
- Collection workflow:
  1. Use a one-paragraph consent note saying photos will be used for automated testing, will be redacted, will not be published, and will be deleted on request.
  2. Record contributor ID separately from images.
  3. Redact masked PANs, card-type lines and auth codes if desired, customer names, loyalty, member or Flybuys/Everyday Rewards/AA Smartfuel-style numbers, phone numbers, email addresses, and handwritten signatures.
  4. Store originals in a private bucket, not the repo. Commit only the redacted OCR text, or redacted images if the contributor agrees.
- For the TS library, the committable artefact is the OCR text JSON, scrubbed by a redaction script (regex for 12+ digit runs, emails and phone numbers) plus manual review. This greatly reduces the privacy surface compared with storing photos.
- The small-business exemption (APP entities generally exclude businesses under A$3M turnover) may mean the APPs do not formally bind an indie developer. NZ has no such exemption. Following the principles anyway is cheap. This exemption claim is from general knowledge and was not verified in this session.
- Ground-truth schema per receipt:
  - `id`, `country` (NZ/AU), `currency` (NZD/AUD)
  - `merchant` (canonical name plus the raw string as printed)
  - `date` (ISO), `time`
  - `total` (string decimal, e.g. "23.40"), `gst` (string decimal or null), `gstInclusive` boolean
  - `taxId` (ABN or GST number, normalised), `isTaxInvoice` boolean
  - `paymentMethod`
  - Capture conditions: device, OCR engine and version, lighting, paper type (thermal or inkjet), length class, crumpled/faded flags
  - `notes` for ambiguous cases, e.g. multiple totals or refunds
- Use string decimals or integer cents for money to avoid float comparison issues in Vitest.
- Coverage checklist for NZ/AU:
  - Supermarkets (Woolworths/Countdown NZ, New World, Pak'nSave, Coles, Aldi, IGA)
  - Fuel (Z, BP, Ampol, Mobil)
  - Hospitality with surcharges and tips
  - Pharmacies, hardware (Bunnings, Mitre 10), Kmart/The Warehouse
  - Parking and transport, e-receipts (PDF/email) and handwritten receipts
  - Refunds and voids, multi-currency tourist receipts
  This list reflects common NZ/AU chains and was not sourced.

### Gaps
- No OPC NZ or OAIC guidance specific to receipt photos or test datasets was found.
- The detailed OAIC de-identification guidance was not fetched.
- The APP small-business exemption threshold was not verified in this session.

## 3. Capturing ML Kit / Apple Vision OCR output for golden-file tests

### Takeaway
Both engines return hierarchical text with geometry and confidence. Serialise the raw result to JSON once per receipt photo on a real device, commit the JSON, and run the TS extraction against it in Vitest. Snapshot or compare against labelled expectations, and re-capture when OS or engine versions change.

### Cited Findings
- ML Kit Text Recognition v2 hierarchy: Text → Blocks → Lines → Elements (words) → Symbols. Each level carries the frame (bounding box), corner points, rotation degree, confidence, recognised language and text. The example output shows no language code on Symbols. — [ML Kit Text Recognition v2](https://developers.google.com/ml-kit/vision/text-recognition/v2)
- Apple Vision WWDC25 session 272 introduced `RecognizeDocumentsRequest`. It returns one `DocumentObservation` per image, with hierarchical structure (lines grouped into paragraphs, tables with cells grouped into rows). It uses the DataDetection framework for phone numbers, emails and postal addresses. — [WWDC25 session 272](https://developer.apple.com/videos/play/wwdc2025/272/)
- The classic `VNRecognizeTextRequest` / `RecognizeTextRequest` API (observations with `topCandidates`, confidence, normalised bottom-left-origin `boundingBox`, `recognitionLevel`, `recognitionLanguages`, `usesLanguageCorrection`, `customWords`) could not be confirmed. The Apple doc page did not render in fetch, so these details come from model knowledge. — [Apple RecognizeTextRequest](https://developer.apple.com/documentation/vision/recognizetextrequest)

### Inferences
- Fixture format: `fixtures/{country}/{id}/ocr.mlkit.json`, `ocr.vision.json` and `expected.json`.
  - Store the full hierarchy with boxes, not just `text`. Line-ordering and column-merge bugs (price column split from item column) are a major receipt failure mode, and geometry lets the parser be re-tested if it later uses layout.
  - Also store `engine`, `engineVersion`, `osVersion`, `device`, `recognitionLevel` and language settings.
- Capture: add a debug-only "export OCR JSON" action in the app (share sheet or write to Files), or a small dev harness app.
  - On macOS, the Vision framework can run via a Swift CLI script over a folder of images, which batches capture without a phone.
  - ML Kit has an iOS SDK as well as Android. This is from general knowledge and was not verified here.
- Test levels:
  - (a) Exact assertions on extracted fields vs `expected.json`.
  - (b) Optionally `toMatchSnapshot` / `toMatchFileSnapshot` on the full extraction output, to catch regressions in secondary fields.
  - Prefer explicit expected fields over snapshots for the four key fields, so a snapshot update cannot silently accept a wrong total.
- Capture each real receipt with both engines. They differ in line grouping and character confusions (O/0, S/5, $/S), and the library must handle both.

### Gaps
- The exact Swift API names and property shapes of `RecognizeDocumentsRequest` were not verified from the API reference.
- No official guidance on ML Kit output determinism across versions was found.

## 4. Image-quality variations and how to simulate them

### Takeaway
Use Augraphy (MIT) for document-specific degradation: folding, shadows, bad photocopy, lighting gradients, ink bleed. For geometric and photometric variation, note that the original Albumentations (MIT) was archived in July 2025, and its successor AlbumentationsX is AGPL-3.0 or commercial. Pin `albumentations` at its last MIT release, or use OpenCV/torchvision-style transforms to avoid AGPL. Simulated degradation does not replace real faded thermal paper and long receipts.

### Cited Findings
- Augraphy: MIT licence (Sparkfish LLC). Its augmentations include Folding, ShadowCast, BadPhotoCopy, LightingGradient, ReflectedLight, Faxify and InkBleed. No dedicated "thermal fade" augmentation is listed. Version 8.2.6 is cited. Recent maintenance activity could not be confirmed (18 open issues, 4 open PRs). — [sparkfish/augraphy](https://github.com/sparkfish/augraphy)
- The Augraphy paper describes a pipeline in ink, paper and post phases, with 26 augmentations in the original paper. It is installable with `pip install augraphy`. A 2026 Japanese document-OCR dataset paper used it for degradation. — [Augraphy arXiv 2208.14558](https://arxiv.org/pdf/2208.14558); [Synth-JDoc arXiv](https://arxiv.org/pdf/2608.28248)
- Albumentations was archived on 10 July 2025 ("no longer actively maintained"). Development moved to AlbumentationsX, a drop-in replacement under dual AGPL-3.0 or commercial licensing. The AGPL option is free only for AGPL projects and is incompatible with MIT, Apache or BSD. — [albumentations-team/albumentations](https://github.com/albumentations-team/albumentations)
- Azure's receipt model guidance says minimum text height is about 12 px on a 1024x768 image (about 8-pt at 150 dpi). That is a practical lower bound to include in low-resolution and distant-shot test cases. — [Azure receipt model](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/receipt)

### Inferences
- Variations to include, real where possible and simulated otherwise:

| Variation | Simulation |
|---|---|
| Faded thermal | Real old receipts, or Augraphy low-contrast/BadPhotoCopy plus brightness reduction |
| Crumpled/folded | Folding, plus real crumpled samples |
| Long receipts | Real only. Test both multi-photo stitching and partial captures, which matters for PDF packing |
| Low light / shadow | ShadowCast, LightingGradient |
| Glare on glossy paper | ReflectedLight |
| Skew/rotation/perspective | Affine or perspective warp |
| Motion/defocus blur | Gaussian or motion blur |
| JPEG compression | Re-encode at low quality |
| Partial crops | Total line cut off. The expected output is "no total" rather than a wrong one |
| Background clutter | Receipt on a table or patterned surface |
| Upside-down | 180° rotation |

- Pipeline: run augmentation offline in Python, run each augmented image through ML Kit/Vision on device or Mac, and commit only the resulting OCR JSON with the same `expected.json` as its source. The TS test suite then stays image-free and fast.
- A rough corpus mix: one clean and two or three degraded variants per real receipt. Tag the variant type so per-condition accuracy can be reported.

### Gaps
- No published validation was found showing that Augraphy's effects realistically match faded *thermal* receipt paper specifically.
- Augraphy's recent release cadence was not confirmed.
- The last MIT release number of Albumentations was not confirmed.

## 5. Evaluation metrics and test-set size

### Takeaway
Report per-field exact match after normalisation, per country and per condition, plus an "abstain" rate (field returned null) separately from the error rate. For amounts, require exact cents match. For receipts, a wrong confident total is worse than a missing one. Sizes in the low hundreds per country give confidence intervals of roughly ±5–10 percentage points.

### Cited Findings
- SROIE (ICDAR 2019), the standard real-receipt benchmark, has 626 training and 347 test receipts and four key fields: company, address, date and total. This gives a reference point for a "meaningful" public benchmark size. — [search summary citing PICK arXiv 2004.07464](https://arxiv.org/pdf/2004.07464)
- Donut reports about 91% on CORD document parsing (a tree-edit-distance-based score), which shows that field-level scores in the 90s are typical for strong models on clean receipt datasets. — [clovaai/donut](https://github.com/clovaai/donut)

### Inferences
- Metrics per field (total, gst, date, merchant):
  - **Accuracy** = correct / all receipts that have that field in ground truth.
  - **Precision** = correct / predicted non-null.
  - **Coverage** = predicted non-null / all.
  - Track **false-confident errors** separately.
- Normalisation rules:
  - Amounts as integer cents, exact match (no tolerance). A ±$0.01 tolerance only hides rounding bugs. If a tolerance is wanted, report it as a secondary metric.
  - Dates as ISO, exact match. Flag DD/MM vs MM/DD confusions specifically, since US-default parsers mis-read AU/NZ dates.
  - Merchant: case-folded, punctuation-stripped match against a canonical name or alias list, or normalised Levenshtein similarity ≥0.8 as a secondary metric.
  - GST: exact cents, plus a consistency check (NZ GST ≈ total×3/23, AU ≈ total/11, within 1c, when all items are taxable).
- Sample size, binomial approximation: the 95% CI half-width is about 1.96·√(p(1−p)/n).
  - At p=0.9: n=100 gives ±5.9pp, n=200 gives ±4.2pp, n=400 gives ±2.9pp.
  - At p=0.95 with n=100, it is ±4.3pp.
  - So around 100–200 real receipts per country gives a usable regression signal. Distinguishing a 2pp improvement needs several hundred, or paired comparison on the same set (McNemar-style counts of fixed vs broken cases).
- Use the corpus as two tiers:
  - (a) A fast deterministic Vitest suite, every commit: synthetic text plus real OCR JSON, hard assertions.
  - (b) An accuracy report script that prints per-field, per-country and per-condition tables and fails CI only if a metric drops below a committed baseline.
- Keep a held-out set of real receipts that is never used while writing regexes or heuristics, to avoid overfitting the parser to the fixtures.

### Gaps
- The official SROIE Task 3 metric definition and the CORD licence were not fetched directly.
- No published guidance specific to sample sizes for receipt-field evaluation was found. The sizes above are standard binomial arithmetic, not a sourced recommendation.

## 6. Using OCR vendor free tiers to label a small corpus

### Takeaway
Free tiers can bootstrap labels for a few hundred receipts per month: Azure Document Intelligence F0 (500 pages/month, en-AU receipt locale), Mindee (about 250/month), AWS Textract AnalyzeExpense (100 pages/month for new accounts, 3 months), and Veryfi (about 100/month). Treat vendor output as *pre-labels* to verify by hand, never as ground truth. Sending receipts to overseas vendors is a cross-border disclosure (NZ IPP12, AU APP 8), so consent should cover it.

### Cited Findings
- **Azure Document Intelligence**
  - The `prebuilt-receipt` model (v4.0 GA, 2024-11-30) extracts MerchantName, phone, TransactionDate, tax and Total. v4.0 adds `ReceiptType`, `TaxDetails.NetAmount`, `TaxDetails.Description`, `TaxDetails.Rate` and `CountryRegion`.
  - F0 tier limits: 4 MB files, first 2 pages per request only. Minimum text height is about 12 px at 1024x768.
  - The page was updated 2026.
  — [Azure receipt model](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/receipt)
  - Receipt locale **en-AU** is listed alongside en-US, en-CA, en-GB and en-IN, with auto-detect as the default. This comes from older and Azure China docs. v4.0 confirmation was not obtained, and **no en-NZ receipt locale was seen**. — [Azure China prebuilt language support](https://docs.azure.cn/it-it/ai-services/document-intelligence/language-support/prebuilt?view=doc-intel-2.1.0); [.NET RecognizeReceiptsOptions.Locale](https://learn.microsoft.com/en-us/dotnet/api/azure.ai.formrecognizer.recognizereceiptsoptions.locale?view=azure-dotnet)
  - F0: 500 pages free per month (seen on a localised pricing page), 1 transaction per second, not adjustable. — [Azure pricing](https://azure.microsoft.com/ja-jp/pricing/details/ai-document-intelligence/); [service limits](https://docs.azure.cn/en-us/ai-services/document-intelligence/service-limits)
- **AWS Textract AnalyzeExpense**: free tier of 100 pages/month for 3 months, new AWS customers only. One third-party calculator says 150, which is likely wrong. — [AWS Textract pricing](https://aws.amazon.com/textract/pricing/)
- **Mindee receipt API**: the free plan is 250 receipts/month with no card, then from $0.10/receipt. Mindee's own docs conflict on the trial terms (14 days with 200 pages vs 500 pages). Check the live page. — [Mindee receipt OCR](https://mindee.com/product/receipt-ocr-api); [Mindee plans docs](https://docs.mindee.com/account-management/plans)
- **Veryfi**: the pricing page lists receipts free up to 100/month, then $0.08/receipt. The FAQ wording is ambiguous ("100 Documents" total vs monthly). The paid Starter plan is about $500/month. — [Veryfi pricing](https://veryfi.com:443/pricing); [Veryfi FAQ](https://faq.veryfi.com/en/articles/3743986-what-are-the-plans-prices-for-ocr-api)
- NZ IPP12 governs disclosure outside NZ. — [OPC NZ](https://www.privacy.org.nz/privacy-principles/)

### Inferences
- Labelling workflow:
  1. Redact the photo.
  2. Send it to two vendors, e.g. Azure with `locale=en-AU` and Mindee.
  3. Auto-accept a field when both vendors agree *and* it matches the GST arithmetic check.
  4. Hand-review disagreements in a simple spreadsheet or small labelling page.
  5. Write `expected.json`.
  At about 850 free pages/month combined across the four vendors, a 200–400 receipt corpus can be pre-labelled within a month at zero cost.
- Vendor outputs make a useful **baseline**: compare the on-device library's accuracy with Azure or Mindee on the same receipts to show how far on-device extraction lags cloud extraction.
- Check each vendor's terms on data retention and on using submitted documents for model training before sending real receipts. This was not verified in this session.
- NZ receipts sent with the en-AU locale should mostly work (same currency symbol, DD/MM dates), but the 15% NZ GST rate and GST-number formats may be weaker. Report vendor accuracy on NZ and AU separately.

### Gaps
- v4.0 Azure locale list confirmation (en-AU, and whether en-NZ exists) was not obtained.
- Vendor data-retention and training-use terms were not checked.
- Free-tier numbers change often. The official pricing pages should be re-checked before relying on them.
- Google Document AI's Expense Parser free tier was not researched.
