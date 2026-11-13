# Australian retail receipt and tax invoice formats (for synthetic OCR test fixtures)

Research date: 2026-11-02. Note: ato.gov.au returned HTTP 403 to automated fetches, so ATO rules below are taken from secondary sources (Xero, Stripe) that paraphrase the ATO. These sources agree with each other on the core rules. If exact legal wording matters, check them against the ATO "Tax invoices" page (https://www.ato.gov.au/business/gst/Tax-invoices).

## 1. ATO tax invoice requirements; receipts under $82.50

### Takeaway
A tax invoice under $1,000 must show: the words "Tax Invoice", the seller's name and ABN, the date, each item's description, quantity and price, and the GST (as an amount or as "total price includes GST"). Where only some items are taxable it must also show which ones. At $1,000 or more it must also show the buyer's identity or ABN. Below $82.50 (incl. GST) no tax invoice is legally required, and a plain docket is enough.

### Cited Findings
- Under $1,000 (incl. GST), required elements are: a "tax invoice" label, the seller's GST-registered business name, the seller's ABN, the invoice date, a short description of each item, the quantity, the price, "the GST amount, or a statement that the total includes GST", and which items are taxable vs GST-free/input-taxed. "You don't need to show the buyer's name or ABN for invoices under $1,000." — [Xero AU](https://www.xero.com/au/guides/tax-invoice-requirements/)
- $1,000 or more: all of the above "plus the buyer's identity or their ABN." — [Xero AU](https://www.xero.com/au/guides/tax-invoice-requirements/); [Stripe](https://stripe.com/resources/more/australian-tax-invoice-requirements)
- A tax invoice must be provided within 28 days of a customer's request for any taxable supply of $82.50 or more (incl. GST). Sales below $82.50 "don't legally require a tax invoice". For purchases of $82.50 or less, a receipt showing the supplier's name, amount paid, date and description is usually enough for an input tax credit. — [Xero AU](https://www.xero.com/au/guides/tax-invoice-requirements/); [Stripe](https://stripe.com/resources/more/australian-tax-invoice-requirements)
- Stripe calls $82.50 common practice: "Many businesses will automatically issue tax invoices for sales above AU$82.50 and use regular receipts for sales under that threshold." — [Stripe](https://stripe.com/resources/more/australian-tax-invoice-requirements)
- An example of the inclusive wording is "Total price includes GST of $X". A single total GST figure "should be used when everything on the invoice is taxable at the standard rate." — [Stripe](https://stripe.com/resources/more/australian-tax-invoice-requirements)
- Stripe: "An ABN that doesn't match ATO records invalidates the invoice." — [Stripe](https://stripe.com/resources/more/australian-tax-invoice-requirements)
- Conflict on labelling: Stripe says invoices must be labelled "Tax Invoice" (or "Recipient Created Tax Invoice"). A community post citing the ATO says a document with no taxable items can be titled just "Invoice". — [Stripe](https://stripe.com/resources/more/australian-tax-invoice-requirements); [Open Food Network forum](https://community.openfoodnetwork.org/t/requirements-for-tax-invoices/315)
- The ATO tells small businesses to keep cash register dockets, receipts or invoices to support GST claims, and to keep tax invoices and GST records for five years. — [ATO, GST for small business (via search snippet)](https://www.ato.gov.au/other-languages/information-in-other-languages/gst/gst-for-small-business)
- Sprintlaw: "there isn't one single 'receipt law' in Australia that lists a universal set of receipt requirements." — [Sprintlaw](https://sprintlaw.com.au/articles/receipt-requirements-in-australia-a-practical-checklist/)

### Inferences
- In practice, large AU retailers print one docket that doubles as a tax invoice, headed "TAX INVOICE" with the ABN near the top, even for small sales. Fixtures should include both "TAX INVOICE" headed dockets and plain "RECEIPT" or untitled small-merchant dockets, the latter often without a GST line.
- For dockets of $1,000 or more (e.g. JB Hi-Fi, Bunnings), add a buyer name/ABN block ("Customer:", "Account:", "Cust ABN") as a realistic variant.

### Gaps
- I could not fetch the ATO's own tax invoice page (403), so I have no verbatim ATO text.

## 2. ABN format and how GST is printed

### Takeaway
An ABN is 11 digits, conventionally grouped 2-3-3-3 ("ABN 12 345 678 901"), with a mod-89 checksum. Fixture ABNs should pass that checksum if the extractor validates them. GST shows up either as a GST amount line or as an "includes GST" statement.

### Cited Findings
- The ABN is 11 digits: two leading check digits followed by nine identifying digits. To validate, subtract 1 from the first digit, multiply each digit by the weights 10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19, sum the products, and check the sum is divisible by 89. — [ABR, Format of the ABN](https://abr.business.gov.au/Help/AbnFormat)
- Worked example: ABN 53 004 085 616 gives a weighted sum of 445 = 5 x 89, so it is valid. A valid checksum does not prove the ABN is registered or GST-registered. — [lookuptax](https://lookuptax.com/docs/tax-identification-number/australia-tax-id-guide)
- Accepted GST statements are the GST amount, or a statement that the total includes GST, e.g. "Total price includes GST of $X". — [Stripe](https://stripe.com/resources/more/australian-tax-invoice-requirements); [Xero AU](https://www.xero.com/au/guides/tax-invoice-requirements/)

### Inferences (wording variants for fixtures; I could not find sourced photos for most)
- ABN spacing variants for OCR noise: "ABN 53 004 085 616", "ABN: 53004085616", "A.B.N. 53 004 085 616", and OCR errors such as "ABN 53 OO4 O85 616". A fixture ABN must not be a real business's ABN unless it is a published example. Generate checksum-valid random numbers instead.
- GST line variants to cover: "GST", "GST INCLUDED", "TOTAL INCLUDES GST", "Total includes GST of $4.55", "GST Amount $4.55", "Incl. GST 10%", "GST incl.", "Total GST", and a "*" or "#" marker footnoted as "* = GST applicable" / "# indicates taxable item". The exact Woolworths and Coles marker wording is not verified (see section 3 gaps).
- AU GST is 10%, so on a fully taxable docket GST = total / 11. Using integer cents, a $50.00 total gives 454.5 cents, which receipts print as $4.55. The extractor should allow ±1 cent when cross-checking.

### Gaps
- No primary source for the exact marker legends that major supermarkets print.

## 3. GST-free items and mixed-supply receipts (GST is not 1/11 of the total)

### Takeaway
Supermarket dockets usually mix GST-free basic food with taxable goods, so the printed GST is much less than total / 11. The docket must flag which lines are taxable and print GST only on those.

### Cited Findings
- Where taxable and GST-free items appear together, each line must be identified as taxable or not, "regardless of the total price of the invoice". — [Stripe](https://stripe.com/resources/more/australian-tax-invoice-requirements)
- Mixed invoices: "Clearly mark which items attract GST and which don't, either with symbols or labels, or by grouping them in separate sections", show GST only on taxable items, and "show the total GST amount separately". — [Xero AU](https://www.xero.com/au/guides/tax-invoice-requirements/)
- Secondary guides say "Total price includes GST" is meant for fully taxable sales and should not be used for mixed invoices, because GST is not exactly 1/11 of the total. — [Sprintlaw](https://sprintlaw.com.au/articles/ato-tax-invoice-requirements-what-must-be-on-your-invoices/) (summarised in a search result; page not fetched)
- Real-world example: a Woolworths purchase of tea, coffee and milk totalling $33.00 carried GST of $2.65, versus $3.00 if GST were 1/11. — [Dealer Solutions help](https://help.dealersolutions.com.au/Accounting/add_taxable__non_taxable_compo.htm) (search snippet)
- OzBargain users note that some groceries carry no GST (milk, honey, goat's milk), and a Woolworths online receipt can show no GST at all if every item is GST-free. — [OzBargain](https://ozbargain.com.au/node/230016)
- Westpac says the "includes GST" statement is limited to totals under $1,000, which the ATO-based summaries do not mention. — [Westpac](https://westpac.com.au/business-banking/cash-flow/gst-tax-invoice-template-australia) (search snippet)

### Inferences
- Fixture categories to include:
  1. Fully taxable (Bunnings, Kmart, JB Hi-Fi, Officeworks): GST = round(total / 11).
  2. Mixed (Woolworths, Coles, Aldi): GST well below total / 11. Taxable lines are flagged, e.g. "^" or "*" before or after the price, or a "GST" column.
  3. Wholly GST-free (fresh produce or milk only): GST $0.00 or no GST line at all. The extractor must not compute total / 11.
- GST-free categories commonly seen on dockets are fresh fruit and vegetables, bread, milk, meat and eggs. Taxable items include soft drinks, confectionery, chips, hot or prepared food, and household goods. These categories are from general knowledge, not a source I fetched. Verify against the ATO "GST and food" guidance if fixtures need exact classifications.
- The extractor should prefer an explicitly printed GST amount over any computed one, and treat total / 11 only as an upper-bound sanity check.

### Gaps
- No verified source for how Woolworths, Coles or Aldi mark taxable lines, or for the exact legend text.
- The ATO "GST and food" detailed food list was not fetched.

## 4. Date and time formats

### Takeaway
AU dockets use day-first dates (DD/MM/YY or DD/MM/YYYY). EFTPOS slips also use "17 Feb 2024 at 06:40 PM" style, and 12-hour times with AM/PM are common.

### Cited Findings
- A Tyro sample EFTPOS slip prints "17 Feb 2024 at 06:40 PM", i.e. day, abbreviated month, year, then a 12-hour time with AM/PM. — [Tyro integrated receipts docs](https://docs.integrated-eftpos.tyro.com/integrated-eftpos/iclient/implementation-guide/integrated-receipts.md)

### Inferences
- Variants to include: "02/11/2026 14:35", "02/11/26 2:35PM", "02-Nov-2026 14:35:07", "Sun 02 Nov 2026", "2/11/2026". Day-first is the AU convention, so "02/11/2026" means 2 November. Include an ambiguous date (e.g. 05/06/2026) where US-style parsing would give the wrong answer.
- A docket can carry two dates: the POS docket date at the top and the EFTPOS slip date/time at the bottom. These are usually identical, but they can differ at midnight.

### Gaps
- No sourced photos of the exact date formats Woolworths, Coles and Bunnings print.

## 5. Cash rounding, card surcharges, weekend/public holiday surcharges, tips

### Takeaway
Cash totals round to the nearest 5c, while card totals stay exact. Since 1 October 2026, surcharges on eftpos, Visa and Mastercard cards are being removed under RBA reforms. Fixtures dated before then (or for Amex) can still show "Card surcharge 1.5%"-type lines, and weekend/public holiday surcharges are separate and still lawful.

### Cited Findings
- Cash rounding goes to the nearest 5c. The ACCC guideline: 1–2c round down to 0, 3–4c round up to 5, 6–7c round down to 5, 8–9c round up to 10. Card/EFTPOS payments need not be rounded. Example: $19.92 is $19.92 by card but $19.90 in cash. — [WA Consumer Protection](https://www.consumerprotection.wa.gov.au/consumer-protection/rounding); [ACCC (via search snippet)](https://accc.gov.au/media-release/rounding-and-eftpos-transactions)
- The RBA Conclusions Paper (31 March 2026) removes "surcharging on debit, prepaid and credit cards on the designated eftpos, Mastercard and Visa card networks". "Most of these changes will come into effect on 1 October 2026". Foreign-card interchange caps and some transparency changes start on 1 April 2027. — [RBA media release mr-26-10](https://rba.gov.au/media-releases/2026/mr-26-10.html)
- Mechanism: the RBA "will lift its prohibition of 'no-surcharge' rules for all designated card networks", which allows the networks to ban surcharging. The Government could legislate if surcharging persists. American Express is non-designated, and its treatment was left for a mid-2026 review. BNPL, mobile wallets and three-party schemes were out of scope. — [RBA Conclusions Paper, Surcharging](https://www.rba.gov.au/payments-and-infrastructure/review-of-retail-payments-regulation/2026-03/conclusions-paper/surcharging.html); [RBA mr-26-10](https://rba.gov.au/media-releases/2026/mr-26-10.html)
- Conflict: NAB guidance reportedly says the ban also covers American Express and UnionPay. The RBA text names only eftpos, Mastercard and Visa. — [NAB](https://www.nab.com.au/business/payments-and-merchants/merchant-support-centre/rba-surcharging-changes) (search snippet) vs [RBA](https://rba.gov.au/media-releases/2026/mr-26-10.html)
- Weekend and public holiday surcharges are lawful and uncapped, typically 10–15%, and must be disclosed before ordering. Secondary sources differ on the exact signage wording and on single-pricing rules for cafes. — [Sprintlaw](https://sprintlaw.com.au/articles/public-holiday-surcharges-in-australian-cafes-essential-compliance-guide/); [Zeller](https://www.myzeller.com/au/blog/payments/card-surcharge-sign) (search snippets)
- The ACCC has taken action against cafes over Sunday and public holiday surcharge pricing (e.g. a $20,000 penalty for a Canberra cafe). — [SmartCompany](https://www.smartcompany.com.au/business-advice/20101209-cafe-hit-with-20-000-fine-over-component-pricing-breach/)
- Tyro's integration docs say the surcharge and tip must each appear as a separate line item on the tax invoice. — [Tyro integrated receipts docs](https://docs.integrated-eftpos.tyro.com/integrated-eftpos/iclient/implementation-guide/integrated-receipts.md)

### Inferences
- Cash fixture: "SUBTOTAL 23.47 / ROUNDING -0.02 / TOTAL 23.45 / CASH 50.00 / CHANGE 26.55". The extractor should take the rounded total actually paid (23.45), or decide on a policy and test it. Include a "+0.02" (round up) case too.
- Card surcharge fixture (pre-Oct 2026 or Amex): "SUBTOTAL 42.00 / CARD SURCHARGE 1.5% 0.63 / TOTAL 42.63". GST on the surcharge is debatable. Many POS systems treat the surcharge as taxable, so the GST figure may include 1/11 of it. That is an inference, not a sourced claim.
- Cafe fixture: "Sunday Surcharge 10% 4.20" or "Public Holiday Surcharge 15% 6.30", plus a tip line ("TIP 5.00") on the EFTPOS slip. The POS docket total then differs from the EFTPOS total, which is a key extractor trap.
- Post-1 October 2026 fixtures with Visa/Mastercard/eftpos should usually have no card surcharge line. Keep some older-dated fixtures with surcharges, since users scan old receipts.

### Gaps
- No primary ACCC text verifying the current mandated weekend surcharge signage wording.
- Whether networks actually implemented no-surcharge rules on 1 Oct 2026 was not confirmed beyond the RBA release.

## 6. Layouts and wording by retailer and terminal

### Takeaway
Primary sources for retailer docket layouts were not found. The most reliable sourced material is Tyro's EFTPOS slip text and Finder's description of where Woolworths prints rewards lines. Everything else below is a hypothesis to be marked as such in fixtures.

### Cited Findings
- Tyro EFTPOS slip lines (sample): "CUSTOMER COPY", "Merchant 99921", "Tyro EFTPOS", "Visa", "Card: XXXXXXXXXXXXX7508(s)", "Purchase     AUD     $112.00", "APPROVED                  00", "Terminal ID: 1", "Transaction Ref: 257248", "Authorisation No: E73642", "17 Feb 2024 at 06:40 PM". — [Tyro integrated receipts docs](https://docs.integrated-eftpos.tyro.com/integrated-eftpos/iclient/implementation-guide/integrated-receipts.md)
- Tyro merchant copies carry a "MERCHANT COPY" heading (plus a signature line when required). Customer copies carry "CUSTOMER COPY" and no signature line. — [Tyro, Receipt printing via POS](https://docs.integrated-eftpos.tyro.com/integrated-eftpos/tta/receiptprintingviapos4-1) (search snippet)
- Westpac/St George gateway receipts show "Result: APPROVED/DECLINED/FAILED (Reason code)" and "Grand Total AUD". — [St George merchant docs](https://merchants.stgeorge.com.au/onlinepay/docs/receipts) (search snippet)
- On printed Woolworths dockets, the Everyday Rewards details appear below "Thank you for shopping with us", and "Points earned" sits directly under "Total Savings". — [Finder](https://www.finder.com.au/woolworths-rewards-faq) (search snippet)
- Coles: Flybuys members can redeem 2000 points for $10 off at checkout. An OzBargain user claims the Flybuys-paid portion is not charged GST. That is a community interpretation, not an official one. Digital receipts appear in the Coles app when it is linked to Flybuys. — [OzBargain](https://www.ozbargain.com.au/node/976427) (search snippet)

### Inferences (unverified layout templates; build fixtures from these but label them synthetic)
- Supermarket (Woolworths/Coles/Aldi) header: brand and store name, store address, phone, "ABN xx xxx xxx xxx", "TAX INVOICE". Item lines are description plus price, with multi-buy or weight sub-lines (e.g. "0.512 kg NET @ $4.90/kg") and promo lines ("Member Price Saving -1.50"). Footer: "SUBTOTAL", "TOTAL", "TOTAL SAVINGS $x.xx", "GST INCLUDED IN TOTAL $x.xx" (or similar), tender lines ("EFTPOS", "VISA", "CASH", "CHANGE"), card slip, then rewards lines ("Everyday Rewards card ****1234", "Points earned 120"; Coles: "Flybuys ****" and points), store/register/transaction numbers and time.
- Bunnings/Officeworks/Kmart/JB Hi-Fi: fully taxable, so GST is about total / 11 and printed as "GST" or "Total includes GST". JB/Officeworks dockets are often long, with SKUs, serial numbers and warranty text. Bunnings may show "PowerPass" or trade account lines.
- Servo (Ampol, BP, 7-Eleven): a fuel line with litres and price per litre (e.g. "Unleaded 91  42.15L @ 189.9c/L  $80.04"), shop items, possibly a fuel discount docket or app discount line ("Fuel Disc -4c/L"). Fuel is taxable.
- Cafe (Square, Lightspeed, Zeller, Tyro): short items, "Weekend surcharge 10%", "Card surcharge 1.4%" (pre-Oct 2026), "Tip", and "Total (incl. GST)".

### Gaps
- No sourced photos or official descriptions of Woolworths, Coles, Aldi, Bunnings, Officeworks, Kmart, JB Hi-Fi, 7-Eleven, Ampol or BP docket layouts or exact wording. Real receipts (photographed by the developer, with personal data stripped) would be the best basis.
- No Square AU receipt sample found.

## 7. Extractor confusers

### Takeaway
The main traps in AU receipts are: several "total"-like lines (subtotal, total, total savings, total GST, EFTPOS purchase/total, rounded cash total), surcharges and tips added after the POS total, mixed GST, container deposits, and negative/refund lines.

### Cited Findings
- Container deposit schemes (e.g. NSW Return and Earn) pay a 10c refund per eligible container (150 mL–3 L, marked with the 10c refund mark). Refunds come as printed retail vouchers from reverse vending machines, as digital vouchers or PayPal/bank transfers via the app, or as cash at depots. — [Return and Earn, how it works](https://returnandearn.org.au/how-it-works/); [NSW EPA](https://www.epa.nsw.gov.au/Your-environment/Recycling-and-reuse/Return-and-earn) (search snippets)
- Card surcharges and tips must be separate lines on the tax invoice. — [Tyro integrated receipts docs](https://docs.integrated-eftpos.tyro.com/integrated-eftpos/iclient/implementation-guide/integrated-receipts.md)
- Cash rounding makes the paid total differ from the item subtotal by up to 2c. — [WA Consumer Protection](https://www.consumerprotection.wa.gov.au/consumer-protection/rounding)
- "Total Savings" on Woolworths dockets is a separate figure that appears near the total. — [Finder](https://www.finder.com.au/woolworths-rewards-faq)

### Inferences (fixture scenarios to build)
1. "TOTAL SAVINGS $12.40" printed near "TOTAL $87.35". The extractor must not pick the savings figure.
2. A POS total ($42.00) followed by an EFTPOS slip with "PURCHASE $42.00 / TIP $5.00 / TOTAL AUD $47.00". Decide which one the app stores; the amount charged is usually the right choice.
3. A cash docket with a "ROUNDING -0.02" line and "CASH 50.00 / CHANGE 26.55". The extractor must not pick the tendered or change amounts.
4. A mixed GST docket where printed GST = $1.82 on a $64.30 total (1/11 would be $5.85).
5. A refund docket: "REFUND", negative lines ("-24.00"), "TOTAL -24.00", GST "-2.18". Also an exchange docket with returns and purchases netting out.
6. A voucher/rewards redemption ("Everyday Rewards $10 off -10.00" or "Flybuys redemption -10.00") or a Return and Earn voucher scanned as tender, so the total due is less than the item total.
7. Multi-buy and member-price discounts as negative lines inside the item list.
8. A servo docket with litres and c/L figures (e.g. "189.9") that look like prices.
9. Two copies (CUSTOMER COPY / MERCHANT COPY) in one photo, which duplicates totals.
10. An ABN that looks like an amount or phone number, and phone numbers like "(02) 9xxx xxxx" near the header.
11. Dockets of $1,000 or more with a customer name/ABN block, so two ABNs appear.
12. Amex payments after 1 Oct 2026 that may still show a surcharge, versus Visa/MC payments without one.

### Gaps
- No sourced evidence on whether AU supermarkets print container-deposit amounts as separate lines on drink purchases. In most schemes the deposit is built into the shelf price, which is an unverified inference.
- No verified examples of how Woolworths/Coles print refund dockets.
