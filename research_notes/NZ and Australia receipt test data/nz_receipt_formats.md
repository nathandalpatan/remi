# NZ Retail Receipt and Tax Invoice Formats (for synthetic OCR test fixtures)

Research date: 2 November 2026. Primary sources are IRD (ird.govt.nz) and Foodstuffs. Retailer-specific receipt layouts were NOT found in any accessible source; anything about layout below that has no citation is marked as an unverified inference.

## 1. IRD taxable supply information (TSI) requirements since 1 April 2023

### Takeaway
Since 1 April 2023 NZ law requires "taxable supply information" (TSI) instead of a formal "tax invoice". There are three value bands: $200 or less, over $200 up to $1,000, and over $1,000. Retailers may still title the document "Tax Invoice", and most receipts still look the same as before.

### Cited Findings
- New laws effective 1 April 2023 replaced the requirement to use tax invoices with a more general requirement to provide and keep records called "taxable supply information" — [IRD: Taxable supply information for GST](https://www.ird.govt.nz/gst/taxable-supply-information-for-gst)
- Term mapping: tax invoice became taxable supply information, debit/credit note became supply correction information, and buyer-created tax invoice became buyer-created TSI — [IRD: Taxable supply information for GST](https://www.ird.govt.nz/gst/taxable-supply-information-for-gst)
- Businesses do not need to change the wording on their documents. They "may continue to provide taxable supply information in a single document marked as a 'tax invoice'" — [IRD: Taxable supply information for GST](https://www.ird.govt.nz/gst/taxable-supply-information-for-gst)
- **Supplies of $200 or less** need: the seller's name or trade name, the date of invoice (or time of supply), a description of the goods or services, and the consideration (amount paid). The GST number and buyer details are NOT required — [IRD: How tax invoices for GST work](https://www.ird.govt.nz/gst/tax-invoices-for-gst/how-tax-invoices-for-gst-work)
- **Supplies over $200 up to $1,000** need: the seller's name or trade name **and GST number**, the date, a description, and either (a) the GST-exclusive amount, GST amount and GST-inclusive amount, or (b) the GST-inclusive amount plus a statement that GST is included. Option (b) is allowed only when everything listed is charged GST at the standard rate. Buyer details are not required — [IRD: How tax invoices for GST work](https://www.ird.govt.nz/gst/tax-invoices-for-gst/how-tax-invoices-for-gst-work)
- **Supplies over $1,000** have the same seller and payment requirements. If the buyer is GST-registered, the document must also show the buyer's name and at least one identifier: a physical or postal address, phone, email, trading name, NZBN, or website URL — [IRD: How tax invoices for GST work](https://www.ird.govt.nz/gst/tax-invoices-for-gst/how-tax-invoices-for-gst-work)
- For supplies over $200, the seller must provide TSI to a GST-registered buyer within 28 days of a request, or by an agreed date — [IRD: How tax invoices for GST work](https://www.ird.govt.nz/gst/tax-invoices-for-gst/how-tax-invoices-for-gst-work)
- TSI can be provided through automated exchange such as PEPPOL eInvoicing. A single physical tax invoice is no longer required, and records like bank statements and contracts can support GST figures, alone or combined — [IRD: How tax invoices for GST work](https://www.ird.govt.nz/gst/tax-invoices-for-gst/how-tax-invoices-for-gst-work); [VATCalc](https://www.vatcalc.com/new-zealand/new-zealand-digitises-gst-invoices-2023/)
- Secondary sources agree that a document titled "Tax Invoice" is no longer legally required — [Stripe](https://stripe.com/resources/more/tax-invoice-requirements-in-new-zealand); [Xero NZ glossary](https://www.xero.com/nz/glossary/invoice/)
- Before 2023 the old tax-invoice regime had a $50 low-value threshold. I could not confirm this in the sources fetched (see Gaps).

### Inferences
- Fixtures should include receipts **with and without** a "TAX INVOICE" heading, and small receipts (under $200) **with no GST number at all**. All of these are legal.
- Many retail receipts print only the GST-inclusive total and a line such as "GST included". IRD allows this whenever every item is standard-rated. The extractor should therefore be able to derive GST as 3/23 of the total when no GST amount is printed.
- Invoices over $1,000 (for example, hardware trade invoices) may carry buyer name and address blocks. The extractor must not take the buyer's name as the merchant.
- Mixed supplies (zero-rated plus standard-rated, which is rare in retail) must show the excl, GST and incl amounts separately. When the receipt prints a GST figure, 3/23 of the total may not equal it, so test that the extractor prefers the printed GST amount.

### Gaps
- I did not fetch the exact pre-2023 thresholds ($50 / $1,000) from a primary source.
- IRD does not prescribe wording such as "GST included" vs "Incl GST". The rule only requires "a statement that GST is included".

## 2. GST number format and how GST appears on receipts

### Takeaway
A business's GST number is its IRD number. IRD numbers are 8 or 9 digits, with a mod-11 check digit as the last digit. IRD treats them as 9 digits, with older 8-digit numbers zero-padded. In print they are commonly grouped as `12-345-678` or `123-456-789`.

### Cited Findings
- IRD numbers contain 9 digits. An 8-digit number is entered with a leading 0 — [IRD myIR help: IRD numbers](https://www.ird.govt.nz/myir-help/logging-in/ird-numbers) (via search summary)
- An IRD number has a 7- or 8-digit base and a trailing check digit, validated by a modulus-11 algorithm — [python-stdnum nz.ird](https://arthurdejong.org/python-stdnum/doc/stdnum.nz.ird)
- From an announcement dated 10 February 2026: the maximum valid IRD number rises from 150,000,000 to 200,000,000, and numbers "will remain 9 digits" — [IRD news, Feb 2026](https://www.ird.govt.nz/updates/news-folder/2026/increase-to-ird-number-validation-upper-limit)
- A business's IRD number is used as its GST registration number — [Commenda](https://www.commenda.io/blog/nz-ird-number-verification) (secondary)
- The GST rate is 15%, so the GST content of a GST-inclusive price is 3/23. This matches the app's assumption. I did not re-fetch an IRD page to confirm it in this session.

### Inferences
- Synthetic GST numbers should pass the mod-11 check, so a validator in the app does not reject them. They should also fall below the 200,000,000 upper limit and be printed in mixed styles:
  - `GST No: 12-345-678`
  - `GST# 123-456-789`
  - `GST Reg No. 123456789`
  - `GST NO 98-765-432`
- Unverified: typical GST wording on NZ retail receipts includes `GST Included`, `Total includes GST`, `Incl. GST`, `GST 15%`, `GST Content`, `Total GST`, `Prices include GST`, and occasionally `*GST exempt`. None of these strings was confirmed from a real receipt source.
- Worked 3/23 examples for fixtures (cents arithmetic):
  - 2300 → 300 exactly
  - 4567 → 13701/23 = 595.70 → 596
  - 1000 → 3000/23 = 130.43 → 130
  - 9999 → 29997/23 = 1304.22 → 1304

  If a POS sums GST per line, the printed GST can differ by about 1c from 3/23 of the total. Include at least one fixture where the printed GST is 1c off the computed value.
- The receipt may also print an NZBN (13 digits, beginning 94) or a company number. These are not the GST number, so a 13-digit NZBN fixture is a useful distractor. The NZBN format is unverified in this session.

### Gaps
- I did not find an authoritative statement on hyphenation style. `xx-xxx-xxx` and `xxx-xxx-xxx` are conventions, not rules.

## 3. Date and time formats

### Takeaway
I found no source documenting NZ receipt date formats. The points below are unverified convention.

### Cited Findings
- None found.

### Inferences (unverified)
- NZ uses day-first dates. Fixtures should mix formats:
  - `02/11/2026`
  - `2/11/26`
  - `02-11-2026`
  - `02 Nov 2026`
  - `02-NOV-26`
  - `Mon 02 Nov 2026`

  EFTPOS terminal slips often use a compact format such as `02NOV26 14:35`.
- Times come in both 24h (`14:35`, `14:35:07`) and 12h (`2:35 PM`, `2:35pm`). EFTPOS slips tend toward 24h, while cafe POS systems (for example Square or Lightspeed style) often use 12h.
- Ambiguity tests: include dates such as `03/04/2026`, which must parse as 3 April and not 4 March. Also include a receipt that carries both a till date and a different EFTPOS slip date or time, such as a slip printed just after midnight.

### Gaps
- No primary or real-receipt source was found for date format prevalence by retailer.

## 4. Cash rounding

### Takeaway
NZ withdrew the 5c coin in 2006. Cash totals are rounded to the nearest 10c, and card or EFTPOS payments are not rounded. Rounding of amounts ending in exactly 5c was left to each retailer: the Retailers' Association advised rounding down, but practice is inconsistent.

### Cited Findings
- 1c and 2c coins ceased being legal tender in 1990. The 5c coin was withdrawn in 2006 and demonetised from 1 November 2006 (the changeover began 31 July 2006, and old coins were usable until 31 October 2006) — [Wikipedia: Cash rounding](https://en.wikipedia.org/wiki/Cash_rounding); [Senate of Canada committee evidence](https://sencanada.ca/en/Content/Sen/committee/403/fina/18evb-e); [E-Sylum](https://coinbooks.org/esylum_v09n22a21.html)
- Under the 10c system, totals ending in 1 to 4 cents round down and totals ending in 6 to 9 cents round up. Totals ending in exactly 5 cents are at the retailer's discretion, and most round down — [Wikipedia: Cash rounding](https://en.wikipedia.org/wiki/Cash_rounding)
- The RBNZ said retailers would round up and down as they had in 1990. The Retailers' Association advised rounding $9.75 down to $9.70, though some retailers were expected to round up — [Scoop media release 2005](https://www.scoop.co.nz/stories/BU0503/S00348.htm); [Scoop 2006](https://www.scoop.co.nz/stories/BU0610/S00086.htm)
- Rounding affects only cash transactions and only the final total — [Senate of Canada committee evidence](https://sencanada.ca/en/Content/Sen/committee/403/fina/18evb-e)
- "Swedish rounding" is the NZ term, used by the RBNZ in 1990 — [Wikipedia: Cash rounding](https://en.wikipedia.org/wiki/Cash_rounding)

### Inferences
- Valid rounding adjustments range from -0.05 to +0.04 when 5c rounds down, or -0.04 to +0.05 when 5c rounds up. Never generate a value outside ±0.05. Examples:
  - $23.47 → $23.50 (+0.03)
  - $23.44 → $23.40 (-0.04)
  - $9.75 → $9.70 (-0.05, rounds down) or $9.80 (+0.05, rounds up)
- Unverified printed forms:
  - `Rounding -0.04`
  - `ROUNDING 0.03`
  - `Cash Rounding -$0.02`
  - `Rnd Adj 0.01`
  - `Total (rounded) $23.50`
- Design decision for the app: on a cash receipt the "amount due" (rounded) and the pre-rounding total differ. Decide which one is the receipt "total". The rounding is not part of the taxable supply price. Unverified: the GST printed is normally computed on the unrounded total. Include fixtures where:

  ```
  TOTAL 23.47
  Rounding +0.03
  CASH 50.00
  CHANGE 26.50
  ```

### Gaps
- I did not find a primary RBNZ page that is currently live. The current RBNZ wording on "retailer discretion" is from secondary and archival sources.
- I found no real-receipt evidence of the exact rounding label wording.

## 5. Retailer layouts, EFTPOS slips, loyalty and savings lines

### Takeaway
Real NZ receipt images and transcriptions were not found in accessible sources, so retailer layouts below are unverified. Several brand facts that change fixture text have been confirmed:
- Countdown became **Woolworths** (rebrand completed December 2025).
- Onecard was replaced by **Everyday Rewards** (February 2024).
- New World **Clubcard** was replaced by **Club+** across New World, PAK'nSAVE and Four Square (15 June 2026; Clubcard closed 26 July 2026).
- The card surcharge ban has been legislated in principle but **had not commenced** as of early 2026, so surcharge lines remain realistic.

### Cited Findings
- **Woolworths / Countdown:** Woolworths NZ announced in July 2023 that all Countdown stores would revert to the Woolworths name. The rebrand ran from early 2024, and the last store switched in December 2025 (NZ Herald, 8 Dec 2025, "The final Countdown: Woolworths rebrand complete as last store makes switch") — [Wikipedia: Woolworths New Zealand](https://en.wikipedia.org/wiki/Woolworths_New_Zealand); [Inside Retail 2023](https://insideretail.co.nz/2023/07/18/woolworths-to-rebrand-its-entire-nz-countdown-store-network/)
- **Everyday Rewards:** Launched in NZ in February 2024, replacing Onecard. Points are earned at Woolworths, BP and Vineonline — [Inside Retail Feb 2024](https://insideretail.co.nz/2024/02/01/woolworths-launches-everyday-rewards-loyalty-program-into-nz/); [Wikipedia: Everyday Rewards](https://en.wikipedia.org/wiki/Everyday_Rewards)
- **Club+ (Foodstuffs):**
  - Sign-up opened 18 May 2026, and Club+ went live in stores on 15 June 2026 across New World, PAK'nSAVE and Four Square.
  - It replaces the New World Clubcard, which closed at 11.59pm on 26 July 2026.
  - Currency: "Club+ Dollars" (1 Club+ Dollar = $1), replacing "New World Dollars". Other terms: "Club+ Picks" (personalised PAK'nSAVE offers), "Club Deals", an Airpoints option, and Club+ fuel discounts.
  - The card can be digital or plastic.

  — [Foodstuffs news release 2026](https://www.foodstuffs.co.nz/news-room/2026/new-world-pak-nsave-four-square-launch-club---a-smarter-way-to-save-on-groceries)
- Before Club+, PAK'nSAVE shoppers could redeem but not earn rewards, and got no member-only prices — [Consumer NZ](https://www.consumer.org.nz/articles/what-s-the-cheapest-supermarket)
- New World limited Club Deal prices to card-carrying customers — [Consumer NZ](https://www.consumer.org.nz/articles/no-card-no-discount-new-world-limits-club-deals-to-card-carrying-customers)
- **Fuel discount receipts:** Non-members can still get a fuel discount on the receipt (North Island). South Island New World and PAK'nSAVE stores still print fuel discount receipts, with some exceptions — [Consumer NZ: Club+ vs Everyday Rewards](https://consumer.org.nz/shopping/supermarkets/the-new-club-vs-everyday-rewards-which-supermarket-loyalty-card-is-better) (via search summary)
- **Card surcharges:**
  - The Government announced a ban on surcharges for in-store payments in July 2025, initially targeted for no later than May 2026, through the Retail Payment System (Ban on Merchant Surcharges) Amendment Bill.
  - As of the Eftpos NZ 2026 guide, the bill had stalled and "no changes have been confirmed".
  - If passed as drafted, the ban would cover in-store EFTPOS, Visa and Mastercard (debit and credit), but not online payments or Amex, Diners or UnionPay.

  — [Eftpos NZ blog](https://blog.eftpos.co.nz/blog/2026-surcharge-ban-guide-for-nz-businesses); [RNZ/ODT](https://www.odt.co.nz/business/govt-ban-surcharges-store-payments-rnz); [Buddle Findlay](https://www.buddlefindlay.com/insights/bill-to-ban-merchant-surcharges-passes-first-reading/)
- **EFTPOS terminals:** Terminals show and print an Approved or Declined result, and print merchant and customer copies. Receipt wording on Worldline-network terminals is configured by Worldline NZ — [Eftpos NZ Verifone guide](https://blog.eftpos.co.nz/blog/eftpos-basics-getting-started-with-your-verifone-android-eftpos-terminal); [Eftpos NZ help](https://support.eftpos.co.nz/update-your-eftpos-receipt)
- **Bunnings NZ** refers to a "receipt or tax invoice" as proof of purchase for returns — [Bunnings NZ returns policy](https://www.bunnings.co.nz/policies/returns)

### Inferences (unverified, from general familiarity, not from sources found in this session)
- **Supermarket till receipt structure:**
  1. Store name and branch, for example `WOOLWORTHS [suburb]` or `PAK'nSAVE [suburb]`, then address, phone and GST number
  2. Optionally `TAX INVOICE`
  3. Item lines: description truncated to about 20 to 30 chars, then price
  4. Weighed items: `1.234 kg @ $3.99/kg`
  5. Multi-buys: `2 @ $2.50`
  6. Promo or member discount lines with negative amounts
  7. Item count
  8. `TOTAL` / `BALANCE DUE`
  9. Tender line (`EFTPOS`, `VISA`, `CASH`), then `CHANGE`
  10. GST line
  11. Loyalty block: card number masked, points or dollars earned, balance
  12. Savings summary
  13. Store, lane, operator and transaction numbers, with date and time
  14. Returns policy or barcode
- **PAK'nSAVE** is commonly printed with that exact casing. **Mitre 10** sometimes appears as `MITRE 10 MEGA [location]`. **The Warehouse** often appears as `The Warehouse` or `TW`. **Z Energy** fuel receipts list pump number, litres, $/L and product names such as `ZX Premium`, `Z91` and `Diesel`.
- Possible savings and loyalty strings to include as distractors:
  - `Everyday Rewards`
  - `Points earned`
  - `Club+ Dollars earned`
  - `Club Deal`
  - `Member Price`
  - `You saved $x.xx today`
  - `Total Savings`
  - `Fuel discount 6c/L`

  Exact current wording is unverified.
- **EFTPOS slip block**, often printed inline at the bottom of the till receipt:

  ```
  EFTPOS / CUSTOMER COPY
  merchant name and terminal ID (TID / TSP)
  card type (EFTPOS, VISA, MASTERCARD, DEBIT MASTERCARD) and masked PAN `****1234`
  PURCHASE    NZ$45.67
  SURCHARGE   NZ$0.45
  TOTAL       NZ$46.12
  ACCEPTED / APPROVED
  AUTH 123456
  ```

  Also: account type (`CHQ` / `SAV` / `CR`) and contactless markers (`Contactless`, `paywave`).
- **Cafe receipts:**
  - Square, Lightspeed or Kounta style
  - Possible `Surcharge` lines: Sunday/public holiday surcharge 10 to 15%, card surcharge 1.x%
  - `Tip` / `Gratuity` lines (less common in NZ)
  - Table number, and a server first name (fixtures should use invented names)

### Gaps
- No photographs or transcriptions of real Woolworths, New World, PAK'nSAVE, The Warehouse, Mitre 10, Bunnings, Z or cafe receipts were found in accessible sources. Reddit was not reachable through search in this session.
- Exact Club+ and Everyday Rewards receipt line wording was not found.
- I found no confirmation of whether the surcharge ban passed later in 2026. Check the NZ Parliament bill page.

## 6. Macrons in Māori place and business names

### Takeaway
Macrons are increasingly used in official place names, signage and business branding, and companies can register names with macrons. Receipts may therefore contain macronised or unmacronised forms, or OCR mangles of them. I found no direct evidence about receipt-printer support.

### Cited Findings
- Official Māori place names approved by the NZ Geographic Board include macrons, and official spellings should keep them even where local signage does not — [OpenStreetMap NZ names guidance](https://wiki.openstreetmap.org/wiki/User:AlephNull/NZ_names_draft); [Kāpiti Coast DC macron policy](https://www.kapiticoast.govt.nz/media/kc2huwzb/sp-10-066-use-of-macron.pdf)
- Many signs historically lacked macrons. Councils such as Marlborough took about three years to fix incorrect street signs, and Wānaka's welcome signs needed a spelling fix — [Te Ao News 2024](https://www.teaonews.co.nz/2024/02/26/reo-street-signs-in-marlborough-fixed-after-three-years); [Crux](https://crux.org.nz/crux-news/wanakas-welcome-sign-to-get-permanent-spelling-fix/); [Newshub 2017](https://newshub.co.nz/home/new-zealand/2017/09/lack-of-macrons-on-signs-for-m-ori-place-names.html)
- Organisations and businesses increasingly add macrons when updating logos and signs, and Progressive Enterprises (Countdown, now Woolworths) introduced bilingual department signage — [Crux](https://crux.org.nz/crux-news/wanakas-welcome-sign-to-get-permanent-spelling-fix/); [The Spinoff 2022](https://thespinoff.co.nz/politics/14-09-2022/the-mcmaori-saga-and-the-business-of-te-reo-maori)

### Inferences
- Fixture variants for a store name: `Woolworths Māngere`, `Woolworths Mangere`, plus OCR errors (`Mãngere`, `Ma-ngere`, `M?ngere`, `Mangere` with a stray accent).

  Other names worth using:
  - `Taupō`
  - `Whangārei`
  - `Ōtāhuhu`
  - `Wānaka`
  - `Ōtautahi`
  - `Kāpiti`
  - `Paraparaumu`
  - `Pukekohe`
  - `Te Awamutu`
- Thermal receipt printers with limited code pages may drop or substitute macron characters (unverified). The extractor and merchant matching should normalise with Unicode NFD and strip combining macrons for comparison.
- Te reo greetings or sign-offs (`Kia ora`, `Ngā mihi`) may appear in headers or footers and should not be taken as the merchant name.

### Gaps
- I found no source on receipt printer or POS handling of macrons.

## 7. Things that can confuse an extractor

### Takeaway
NZ receipts routinely carry several money figures near the word "total". The sources found confirm surcharges, loyalty discounts and fuel discounts exist. The specific confusion cases below are design inferences for fixtures.

### Cited Findings
- In-store card surcharges were still legal as of early 2026, because the ban had not commenced — [Eftpos NZ blog](https://blog.eftpos.co.nz/blog/2026-surcharge-ban-guide-for-nz-businesses)
- Member pricing (Club Deals, Everyday Rewards) means receipts carry discount lines tied to the loyalty card — [Consumer NZ](https://www.consumer.org.nz/articles/no-card-no-discount-new-world-limits-club-deals-to-card-carrying-customers); [Foodstuffs 2026](https://www.foodstuffs.co.nz/news-room/2026/new-world-pak-nsave-four-square-launch-club---a-smarter-way-to-save-on-groceries)
- Bunnings accepts a "receipt or tax invoice" for refunds, so refund documents exist — [Bunnings NZ](https://www.bunnings.co.nz/policies/returns)
- An Australian forum report shows terminal surcharges listed separately from the purchase price on the slip. This is Australia, but the same terminal vendors operate in NZ — [Australian Frequent Flyer](https://australianfrequentflyer.com.au/community/threads/extra-credit-card-surcharge-for-using-a-rewards-card.56948)

### Inferences (fixture checklist)
1. **Multiple totals:** `SUBTOTAL`, `TOTAL`, `BALANCE DUE`, and the EFTPOS `PURCHASE` / `TOTAL` (which includes surcharge or tip). Decide whether the app's total is the till total or the amount charged. Generate both cases.
2. **Card surcharge:** The till total is $45.67, the EFTPOS TOTAL is $46.12 with `SURCHARGE 0.45`. Unverified: the GST on the till receipt is computed on $45.67. A surcharge is arguably also a taxable supply, so 3/23 of $46.12 will not match a printed GST of $5.96.
3. **Cash:** `TOTAL 23.47 / ROUNDING +0.03 / CASH 50.00 / CHANGE 26.50`. Neither 50.00 nor 26.50 is the total.
4. **Savings lines:** `TOTAL SAVINGS $12.40`, `You saved $3.20`, `Club Deal -1.50`. These must not be taken as the total or as GST.
5. **Loyalty balances:** `Club+ Dollars balance $15.00`, `Everyday Rewards points 1,250`, `Fuel discount 6c/L`.
6. **Refunds and negatives:**
   - Formats: `REFUND`, `-$29.98`, `$29.98-`, `(29.98)`, `CR`
   - A total that is negative
   - Supply correction information (formerly "credit note")
7. **Tips at cafes:** `TIP 5.00` added on the EFTPOS slip after the till receipt.
8. **GST distractors:**
   - `GST 15%`, where the "15" is not an amount
   - `GST Exclusive 39.71 / GST 5.96 / Total 45.67`
   - Mixed zero-rated items, so 3/23 of the total does not equal the printed GST
   - GST number digits that look like money (`123-456-789`)
9. **Other numbers that look like totals:** item count, transaction or receipt number, auth code, terminal ID, NZBN, phone (`09 123 4567`, `0800 xxx xxx`), and litres or $/L on fuel receipts.
10. **Merchant ambiguity:** Franchise operating company name vs trading name (for example `Foodstuffs North Island Ltd` vs `PAK'nSAVE [suburb]`), "Countdown" on pre-2024 fixtures vs "Woolworths" on current ones, and mall or landlord names.
11. **Currency markers:** `$`, `NZ$`, `NZD`, or none. Thousands separators appear on trade invoices over $1,000 (`$1,234.50`).
12. **Duplicate copies:** A merchant copy and a customer copy in one OCR text, so the total appears twice.

### Gaps
- None of the above confusion cases was validated against real NZ receipt samples. These cases are inferred from the rules and from the typical POS and EFTPOS structure.
