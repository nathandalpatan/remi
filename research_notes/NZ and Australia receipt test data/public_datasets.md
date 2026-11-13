# Public receipt image / OCR datasets for NZ and AU receipt testing

Researched 2026-11-02. About 15 tool calls; every claim below links the source I checked. Anything I could not verify is in Gaps.

## Do the well-known receipt datasets contain NZ or AU receipts?

### Takeaway
None of the major public receipt datasets I checked (SROIE, CORD, WildReceipt, ExpressExpense SRD, TrainingDataPro/UniqueData, the Kaggle SROIE derivatives) is documented as containing NZ or AU receipts. SROIE is Asian (Malaysian-style, with GST at 6%), CORD is Indonesian, and ExpressExpense is US-hosted restaurant receipts. Treat all of them as fallbacks only: useful for the general OCR-to-fields pipeline, not for NZD/AUD, 15%/10% GST, GST-number/ABN or DD/MM/YYYY date logic.

### Cited Findings
**SROIE / ICDAR 2019 (fallback, not NZ/AU)**
- Competition dataset of "1000 whole scanned receipt images and annotations". It has three tasks: text localisation, OCR and key information extraction. — [arXiv 2103.10213](https://arxiv.org/abs/2103.10213v1)
- The HF/FiftyOne mirror labels company, address, date and total, plus quadrilateral text boxes with transcripts. Its split is 712 train / 347 test (361 in some versions). Establishments are "primarily located in Asia" and receipts date from about 2015–2018. Licence is listed as CC BY 4.0. — [Voxel51/scanned_receipts on HF](https://huggingface.co/datasets/Voxel51/scanned_receipts)
- A Kaggle SROIE-derived layout dataset shows a "GST@6%" line in its sample annotations (Malaysian-style). — [Kaggle receiptdatasetssd300v2-csv](https://www.kaggle.com/datasets/elfuegodev/receiptdatasetssd300v2-csv), via search snippet
- Kaggle mirror: 973 receipts, each with a .jpg, an OCR text file and a key-info file. — [Kaggle SROIE datasetv2](https://www.kaggle.com/datasets/urbikn/sroie-datasetv2), via search snippet
- "Find it again!" is derived from SROIE: 988 receipt images plus transcriptions, with 163 forged images. — [Kaggle find-it-again](https://www.kaggle.com/datasets/nikita2998/find-it-again-dataset), via search snippet
- Licence is unclear. One 2025 arXiv corpus paper lists SROIE as MIT. A third-party paper says the terms are in the zzzDavid/ICDAR-2019-SROIE GitHub repo, but that repo's MIT licence covers its code. The official RRC site (rrc.cvc.uab.es/?ch=13) failed TLS verification when I fetched it. — [Bee corpus paper](https://arxiv.org/pdf/2510.13795); [zzzDavid/ICDAR-2019-SROIE](https://github.com/zzzDavid/ICDAR-2019-SROIE)

**CORD (Clova AI) (fallback, not NZ/AU)**
- Receipts are Indonesian, from shops and restaurants. Licence is CC BY 4.0. The public release has 1,000 receipts (800/100/100). Labels have 5 superclasses (menu, void menu, subtotal, void total, total) and up to 42 subclasses. — [clovaai/cord GitHub](https://github.com/clovaai/cord)
- `store_info`, `payment_info` and `etc` were removed from the published labels "due to Indonesian legal issues". That means **no merchant or date labels**, only menu, subtotal/tax and total. — [clovaai/cord GitHub](https://github.com/clovaai/cord)
- HF cord-v2 is CC BY 4.0, 2.31 GB, with `gt_parse` JSON (menu, sub_total incl. tax, total) and word-level boxes. — [naver-clova-ix/cord-v2](https://huggingface.co/datasets/naver-clova-ix/cord-v2)

**WildReceipt (MMOCR) (fallback, not NZ/AU)**
- English receipts: 1,740 images (other sources say 1,768), 68,975 text boxes, 25–26 key-info categories (12 keys, 12 values, 1 other). Split is about 1,267 train / 472 test. Distributed as wildreceipt.tar by OpenMMLab. — [arXiv 2103.14470](https://arxiv.org/pdf/2103.14470); [MMOCR KIE docs](https://mmocr.readthedocs.io/en/v0.3.0/datasets/kie.html)
- I found no licence statement or country of origin (see Gaps).

**ExpressExpense SRD (fallback, not NZ/AU)**
- 200 restaurant receipt images (>600 px longest side) showing business name, address, items, subtotal, tax and total. No ground-truth labels are described. Licence: "free for use under The MIT License (MIT)", with attribution to ExpressExpense.com requested. The company is in California; the receipts' country is not stated. Download: https://expressexpense.com/large-receipt-image-dataset-SRD.zip (19.2 MB). — [ExpressExpense blog](https://expressexpense.com/blog/free-receipt-images-ocr-machine-learning-dataset/)

**TrainingDataPro / UniqueData "OCR Receipts Text Detection" (fallback, licence-restricted)**
- Grocery receipt photos with boxes for store, item, date_time and total. The hosted part is 54.6 MB, "just an example". The full set is paid. Licence is CC BY-NC-ND 4.0. Origin country is not stated. — [HF TrainingDataPro](https://huggingface.co/datasets/TrainingDataPro/ocr-receipts-text-detection); also on [Kaggle](https://www.kaggle.com/datasets/trainingdatapro/ocr-receipts-text-detection)

**Others surfaced**
- CORU / ReceiptSense is a larger Arabic-English receipt dataset with OCR annotations, hosted on HF. — [arXiv 2406.04493](https://arxiv.org/pdf/2406.04493); [HF Timokerr/CORU](https://huggingface.co/datasets/Timokerr/CORU/blob/main/README.md)
- Kaggle "my receipts (pdf scans)" is user-contributed, mostly North American and French. — [Kaggle jenswalter/receipts](https://www.kaggle.com/datasets/jenswalter/receipts), via search snippet
- Roboflow "GST" CV dataset is listed CC BY 4.0, but its contents were not verified and it is likely Indian GST. — [Roboflow tapas/gst](https://universe.roboflow.com/tapas/gst-k29vz)

### Inferences
- SROIE's GST@6% lines and 2015–2018 dates match Malaysia's GST period (6%, 2015–2018). This fits the common description of SROIE as Malaysian, but no primary source I fetched says "Malaysia" outright.
- For a TS library whose parser takes OCR text, the most reusable fallback assets are SROIE's per-receipt OCR text plus company/date/total labels (it has merchant, date and total), and CORD's total/tax JSON. Neither exercises NZ/AU tax rates, currency or GST-number formats.
- Asian and US receipts often use MM/DD or other date orders and different tax labels ("SST", "Sales Tax", "GST 6%"). Tests built on them could encode the wrong assumptions for NZ/AU parsing.

### Gaps
- WildReceipt licence and image provenance: the arXiv PDF text could not be extracted and the docs I checked do not state either.
- MC-OCR (Vietnamese receipts, RIVF 2021) was not checked in this session. Its origin and licence are unverified here.
- I did not verify the official SROIE licence or terms of use (the RRC site failed TLS).
- I did not find any public Veryfi or Klippa sample receipt sets.

## Are there datasets specifically from New Zealand or Australia?

### Takeaway
I found no public, downloadable NZ or AU receipt dataset with ground-truth labels. The only AU receipt collection documented anywhere is a 118-receipt set in an academic paper (Melbourne/RMIT, Textract evaluation), and the paper says nothing about releasing it. I found no NZ receipt dataset at all. The realistic route is a small self-collected (or synthetic) NZ/AU set.

### Cited Findings
- **ReceiptCAT Australian receipts (paper, not public)**: 118 receipts as JPG/PNG. 77 are phone photos (Galaxy A52, Pixel 7 Pro, iPhone 13 Pro) and 41 are e-receipt screenshots.
  - Physical receipts: 62 clear / 15 blurred; 35 folded / 24 crumpled / 18 flat; 52 skewed.
  - 59 vendors, including Woolworths (19), Woolworths Metro (10), Coles (7), Medical Hub RMIT (6), BIG W (5), and Aldi, IGA, Sephora and Chemist Warehouse (4 each).
  - Vendor types: 39.8% groceries, 25.4% eating out/takeaway.
  - No formal labelled ground truth: the authors compared vendor, date, total and items by hand.
  - The paper gives no availability, link or licence.
  — [Towards Analysing Invoices and Receipts with Amazon Textract (arXiv 2512.19958)](https://arxiv.org/html/2512.19958v1)
- **Woolworths e-receipts**: `ekutilov/wooliesR` is a Woolworths e-receipt downloader that saves receipts as JSON. It includes a notebook for scraping your *own* e-receipts and does not appear to ship sample receipts. The related "myshopdash" app also handles Coles e-receipts. — [github.com/ekutilov/wooliesR](https://github.com/ekutilov/wooliesR); [GitHub topic: woolworths](https://github.com/topics/woolworths)
- I found no Kaggle dataset of Countdown/Woolworths NZ, New World, Bunnings, or Coles receipts in my searches. — [Kaggle search results](https://www.kaggle.com/datasets/samuiabhisek/receipt) (generic results only)
- **NZ labelling schema (IRD)**: a GST receipt must show the supplier's name and GST number and the date of supply. An IRD ruling (BR Prd 16/04, Paymark) accepts e-receipts and tax invoice photographs for GST record-keeping. — [IRD requirements](https://www.ird.govt.nz/gst/gst-for-overseas-businesses/gst-on-low-value-imported-goods/requirements-after-registration); [IRD BR Prd 16/04](https://www.taxtechnical.ird.govt.nz/rulings/product/br-prd-1604-paymark-limited)

**OCR vendor docs (locale support only, no NZ/AU sample data found)**
- **Azure Document Intelligence prebuilt-receipt**:
  - v2.1 lists locales en-US, en-AU, en-CA, en-GB and en-IN. No en-NZ.
  - v3.0+ thermal receipts list "English (`en`)" generically (Maori `mi` is also listed).
  - v4.0 adds TaxDetails (NetAmount, Rate) and CountryRegion fields.
  - The only sample is a generic Contoso receipt image (contoso-allinone.jpg) in Azure-Samples.
  — [Azure prebuilt language support](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/language-support/prebuilt); [Azure receipt model](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/receipt)
- **Taggun**: the Australia doc covers ABN extraction only (11 digits, checksum validation, `entities.ABN.data`) and mentions no sample images. The NZ page lists NZD and GST as the tax system. — [Taggun Australia](https://developers.taggun.io/docs/australia); [Taggun New Zealand](https://developers.taggun.io/docs/new-zealand)
- **Mindee**: docs suggest testing with your own receipts or Google Image results. I found no AU/NZ sample set. — [Mindee Python blog](https://mindee.com/blog/extract-receipt-data-with-mindees-api-using-python)
- **Apify "Receipt & Invoice Data Extractor (AU-aware)"**: an extraction service, not a dataset. — [Apify](https://apify.com/eastwoodapps/receipt-invoice-extractor)

### Inferences
- The ReceiptCAT paper's capture-condition breakdown (folded, crumpled, skewed, blurred, e-receipt screenshots) and vendor mix make a good template for a home-grown NZ/AU test set: roughly 20–50 receipts each from Woolworths/Coles/Aldi/BIG W/Bunnings (AU) and Woolworths NZ (formerly Countdown)/New World/Pak'nSave/Bunnings NZ (NZ).
- Because the parser consumes OCR text, a practical test-suite design is to store the OCR text output (from ML Kit / Vision) plus hand-labelled JSON ground truth, and keep the images out of the public repo. Text fixtures can also be redacted easily.
- Synthetic NZ/AU receipts (rendered from templates using real-format GST lines like "GST 15% included" / "Includes GST $x", ABN or GST numbers using known checksum-valid test values) could fill coverage gaps. I did not find an existing generator for this.
- It might be worth emailing the arXiv 2512.19958 authors for access, but the set contains real Melbourne transactions and may not be cleared for redistribution.

### Gaps
- I did not search Zenodo, data.govt.nz or data.gov.au directly. Whether any government open-data receipt sample exists there is unverified (none surfaced in general searches).
- Roboflow Universe was not searched systematically for "Woolworths"/"Coles"/"Countdown" projects.
- I could not confirm whether the ReceiptCAT dataset was ever released.

## Licences: which are safe for a test suite in a public repo?

### Takeaway
CORD (CC BY 4.0) and ExpressExpense SRD (MIT) are the clearest permissive options; both allow commercial use and redistribution with attribution. The Voxel51 SROIE mirror is labelled CC BY 4.0, but the original SROIE terms are unverified. TrainingDataPro/UniqueData (CC BY-NC-ND, paid full set) is not suitable. None of these is NZ/AU, so the NZ/AU fixtures will be self-made and under the developer's own licence.

### Cited Findings
- CORD: CC BY 4.0, licence text in the repo. — [clovaai/cord](https://github.com/clovaai/cord); [HF cord-v2](https://huggingface.co/datasets/naver-clova-ix/cord-v2)
- ExpressExpense SRD: MIT, with a citation request. — [ExpressExpense](https://expressexpense.com/blog/free-receipt-images-ocr-machine-learning-dataset/)
- SROIE: CC BY 4.0 on the Voxel51 HF mirror; listed as MIT in a third-party table. Neither is the original competition terms. — [Voxel51 HF](https://huggingface.co/datasets/Voxel51/scanned_receipts); [Bee paper](https://arxiv.org/pdf/2510.13795)
- TrainingDataPro OCR receipts: CC BY-NC-ND 4.0, and commercial use requires purchase. — [HF TrainingDataPro](https://huggingface.co/datasets/TrainingDataPro/ocr-receipts-text-detection)
- WildReceipt: no licence found.

### Inferences
- For a public repo, commit only a handful of attributed CORD or ExpressExpense images (or just derived OCR text) with a NOTICE/attribution file. Fetch larger sets at test time instead of vendoring them.
- Avoid vendoring SROIE and WildReceipt until their original terms are confirmed.
- NC/ND licences conflict with a commercial app's test suite, and ND forbids derived annotations.

### Gaps
- Original SROIE terms of use (the RRC site was unreachable).
- WildReceipt licence.

## Privacy concerns with crowdsourced receipt images

### Takeaway
Real receipts can carry partially masked card numbers (PANs), loyalty/member numbers, staff names, transaction/terminal IDs, and sometimes customer names or addresses. Curated datasets say they avoided customer PII but do not guarantee it. For self-collected NZ/AU receipts, redact those fields before committing anything public.

### Cited Findings
- The Voxel51 SROIE card says customer names, card numbers, phone numbers, emails and addresses were "not intentionally included". It also asks users not to identify individuals or share incidentally visible personal info. — [Voxel51 HF](https://huggingface.co/datasets/Voxel51/scanned_receipts)
- CORD removed store_info and payment_info labels "due to Indonesian legal issues". It does not describe any image anonymisation. — [clovaai/cord](https://github.com/clovaai/cord)
- The ReceiptCAT AU set includes medical-clinic receipts (Medical Hub RMIT, 6 receipts) and utilities/bills, categories likely to carry personal data. — [arXiv 2512.19958](https://arxiv.org/html/2512.19958v1)

### Inferences
- Before committing NZ/AU receipts, redact the following on both the image and the OCR text: card PAN fragments, auth codes, loyalty card numbers (Everyday Rewards, Flybuys, Clubcard), the customer name on e-receipts, and pharmacy/medical items. Business details (name, GST number/ABN, address) are public and can stay.
- NZ Privacy Act 2020 and AU Privacy Act 1988 considerations apply to collecting other people's receipts. Using the developer's own receipts avoids consent issues. This is an inference; I did not research the legal text.

### Gaps
- I did not verify specific NZ/AU privacy-law guidance on publishing receipt images.
