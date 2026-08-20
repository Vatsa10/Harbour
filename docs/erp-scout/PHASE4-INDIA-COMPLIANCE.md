# Phase 4 — India Statutory Compliance Requirements

**Audience:** the team building a new commercial, closed-source ERP for Indian manufacturing SMEs.
**Status:** requirements document. This is a hard shipping gate — an Indian ERP that cannot produce a compliant tax invoice is not sellable.

---

## ⚠️ READ THIS FIRST

**This document is not legal advice and must not be trusted as a statement of current Indian law.**

Every rule below is derived from *reading source code* of four reference implementations (frappe/india-compliance, frappe/erpnext, frappe/hrms, odoo `l10n_in*`). Code is evidence of *what a working Indian ERP does*, not of what the statute says. Indian GST and income-tax rules change by notification several times a year, and the reference codebases themselves contain forward-dated, contradictory and suspect data.

Three labels are used throughout:

| Label | Meaning |
|---|---|
| **[CODE]** | Directly observed in reference source. Reliable as *implementation shape*. |
| **[VERIFY]** | Observed in code, but the number/date/threshold must be re-confirmed against the current notification before it ships. |
| **[NOT IN CODE]** | Required by the brief but implemented **nowhere** in any reference. Must be built from the statute. Do not copy a number from anywhere — there isn't one. |

Where the adversarial audits of the scout reports disagreed with the scout reports, **the audit wins and the audited position is what appears below.** In particular the audits forced: (a) removal of any statutory citation that existed only as a scout inference rather than as a string in the code; (b) demotion of every threshold to **[VERIFY]**; (c) explicit **[NOT IN CODE]** marking of PF/ESI/PT rates, Section 143 deadlines, and turnover-based applicability — all of which the references *label* but never *compute*. No number in this document is asserted on the authority of this document.

A qualified Indian CA/GST practitioner must sign off on the rule table before v1 ships. Budget for that.

---

## 1. THE COMPLIANCE GATE

Blunt version: without the items in this section the product cannot be sold to a GST-registered Indian manufacturer at all. Everything else in the ERP is optional by comparison.

### 1.1 Mandatory for every registered business — no exceptions, v1 blockers

| # | Capability | Why it is a gate |
|---|---|---|
| G1 | GSTIN capture + structural validation (15 chars, state code, embedded PAN, mod-36 check digit) on company, customer, supplier, address | A wrong GSTIN poisons every downstream return and cannot be corrected after filing |
| G2 | Place of Supply as a stored, first-class field with an explicit fallback chain | This single field decides CGST+SGST vs IGST on every invoice |
| G3 | Intra-state vs inter-state tax-head determination, with blocking validation | Wrong head = recipient loses ITC = customer churn |
| G4 | Named GST accounts per company per account type (Input / Output / RCM / Refund) | Without these, GSTR-3B cannot be reconciled to the ledger |
| G5 | HSN/SAC on every item, with digit-count enforcement | Blocks GSTR-1 filing and e-invoice generation |
| G6 | Item-level `gst_treatment` (Taxable / Zero-Rated / Nil-Rated / Exempted / Non-GST) + item-wise taxable value and per-tax rate/amount columns | Without these you cannot emit a GSTR-1 or an e-invoice payload *at all* |
| G7 | Invoice number ≤16 chars, alphanumeric start, only `-` and `/` thereafter, **no gaps in the series** | IRP rejects anything else; gaps are an audit finding |
| G8 | Reverse charge flag with balanced mirrored tax rows, and RCM self-invoice numbering | Unavoidable for SMEs (GTA freight, legal, unregistered purchases) |
| G9 | Immutable audit trail / edit log, non-disableable once enabled (see §7) | MCA mandate; constrains the core data layer, cannot be retrofitted |
| G10 | Blocking validations that prevent an *unfileable* invoice from ever being submitted (see §2.6) | Cheaper to block at save than to unwind after filing |
| G11 | GSTR-1 and GSTR-3B **preparation** with correct table classification | The monthly close is impossible without it |
| G12 | GSTR-2B download + purchase reconciliation | ITC is only claimable to the extent it appears in 2B |
| G13 | Multi-GSTIN support, GSTIN-scoped everywhere | A factory in one state + depot in another = two registrations, two returns |
| G14 | Payroll statutory deductions (PF, ESI, PT) and TDS on salary | Any manufacturer with staff is covered |

### 1.2 Mandatory above a turnover threshold

**[VERIFY] — every threshold in this table. None of the reference implementations computes aggregate turnover at all; all of them make the operator enter a date or a digit manually.** This is itself a differentiation opportunity (see §8).

| Capability | Threshold as encoded in references | Evidence quality |
|---|---|---|
| **e-Invoicing (IRN)** | **No turnover logic exists.** india-compliance stores an operator-entered "e-Invoice Applicable From" date (globally or per company) that may not precede 2021-01-01. Odoo uses a per-company boolean feature flag. | [CODE] that no threshold is implemented; **[VERIFY]** the actual statutory turnover trigger |
| **HSN digit count** | Company setting with three options whose *labels* read "4 Digits (turnover < 5 CR.)" / "6 Digits (turnover > 5 CR.)" / "8 Digits" (Odoo). india-compliance has `min_hsn_digits` ∈ {4,6,8}, default 6, whose field description cites **CBIC Central Tax Notification No. 78/2020** as requiring 4 or 6 digits "based on turnover" — but implements **no turnover lookup whatsoever**. | [CODE] for the setting; **[VERIFY]** for the ₹5 Cr boundary and for whether N-78/2020 is still the operative notification |
| **GSTR-1 filing frequency (monthly vs quarterly)** | Modelled as a `filing_preference` field (Monthly \| Quarterly) with quarter-month document-shuffling logic. No turnover test. | [CODE]; **[VERIFY]** the QRMP eligibility turnover |
| **ITC-04 periodicity (quarterly / half-yearly / annual)** | Period codes exist (13–16 quarters, 17–18 half-years, 19 annual) but **which periodicity applies is chosen by the operator picking a date range.** | [CODE]; **[VERIFY]** the turnover boundary |
| **TDS on purchase of goods** | Threshold ₹50,00,000, rate 0.1% (5% no-PAN), tax on **excess only**. | **[VERIFY]** — encoded under Income-tax Act *2025* section numbering effective 2026-04-01, which is forward-dated and may not be operative |

### 1.3 Mandatory for manufacturers specifically

| # | Capability | Why manufacturers specifically |
|---|---|---|
| M1 | **e-Way Bill on stock movement, not just on invoices** — Delivery Note, Stock Entry, Subcontracting Receipt | Factory material moves on a delivery challan long before any invoice exists. Truck detention is the failure mode. |
| M2 | **Job work / subcontracting challan flow** with sub-supply types Job Work (4) and Job Work Returns (6), document type CHL | Core to Indian discrete manufacturing |
| M3 | **ITC-04** Table 4 (RM sent) + Table 5A (goods received back), with mandatory linkage from every inward document to its original outward challan | Statutory return unique to job work |
| M4 | **Open-challan register with ageing** against the Section 143 return window, and deemed-supply consequence on expiry | **[NOT IN CODE] — see §5. No reference implements this. It is the single biggest gap.** |
| M5 | **Ineligible ITC handling** routing tax into GST expense or into item valuation | Directly changes manufacturing cost accounting |
| M6 | **Bill of Entry** as a separate customs document (assessable value + BCD → IGST base) with Landed Cost capitalisation | Imported raw material is normal |
| M7 | Scrap / secondary output / process-loss capture, both as costing and as reportable loss quantity | Scrap is a taxable outward supply, and a TCS collection code exists for it |
| M8 | Item aggregation to stay inside payload limits (1000 lines IRN, 250 lines e-way bill) | BOM-heavy invoices exceed both |
| M9 | UQC (Unique Quantity Code) on every UoM with `OTH` fallback | Required the moment you print an HSN summary |

---

## 2. GST REQUIREMENTS

### 2.1 Party & identity rules

| Rule | Specification | Source |
|---|---|---|
| GSTIN length | Exactly 15 characters or reject | [CODE] |
| GSTIN structure | pos 1–2 = state code; pos 3–12 = PAN; pos 13 = entity serial; pos 14 = fixed letter; pos 15 = check digit | [CODE] |
| Check digit | Alphabet `0-9A-Z`, mod 36. Walk chars 1–14 with factor alternating 1,2,1,2…: `d = factor * index(char)`; `d = d//36 + d%36`; `total += d`. Expected char = `alphabet[(36 - total%36) % 36]`, must equal char 15. | [CODE] |
| Check-digit exemption | GST Transporter IDs / Unique Common Enrolment Numbers are exempt (code cites `29AAFCA7488L1Z0` as a valid transporter ID that fails the check); IDs beginning `88` treated as non-GSTIN | [CODE] |
| Format by category | Distinct regex families per GST Category (Normal/Composition/SEZ/Deemed Export/ISD; UIN holders; Overseas NRI/OIDAR; TDS deductor; TCS operator). A GSTIN whose format contradicts its declared category is rejected. | [CODE] |
| PAN derivation | `PAN = gstin[2:12]`, validated as `^[A-Z]{5}[0-9]{4}[A-Z]{1}$`. Where a GSTIN exists, PAN is force-derived and the field made read-only. | [CODE] |
| State consistency | `gstin[:2]` must equal the address's state code, else throw | [CODE] |
| Pincode | `^[1-9][0-9]{5}$`, and first 3 digits must fall in the state's band | [CODE]; **[VERIFY]** — bands are coarse 3-digit ranges with known overlaps (Chandigarh/Punjab, Telangana/AP, Puducherry) that reject legitimate addresses. Build as versioned data, not constants. |
| GST Category taxonomy | Registered Regular, Registered Composition, Unregistered, SEZ, Overseas, Deemed Export, UIN Holders, Tax Deductor, Tax Collector, Input Service Distributor | [CODE] |
| Category ↔ GSTIN coherence | Party without GSTIN → only Unregistered or Overseas. Party with GSTIN → never Unregistered. | [CODE] |

**Design note:** treat the two synthetic state codes as first-class — `96` "Other Countries" (the universal export/SEZ sentinel) and `97` "Other Territory". Odoo makes these real state records; do the same.

### 2.2 Place of Supply determination (implementable algorithm)

Stored as the string `"NN-State Name"`. Mandatory on every GST transaction.

```
SALES / PAYMENT ENTRY:
  if party.gst_category == Overseas:
      if shipping_address is in India: PoS = shipping_address.state     # goods never left India
      else:                            PoS = "96-Other Countries"
  else if setting "determine address tax category from" == Shipping Address:
      PoS = shipping_address.state
  else:
      PoS = billing_address.state       # i.e. the state of the customer's GSTIN
  fallback (unregistered):     PoS = customer_address.state
  final fallback (B2C/retail): PoS = company_gstin state

PURCHASE / SUBCONTRACTING:
  PoS = company_gstin state,  fallback supplier_gstin state

STOCK ENTRY:
  PoS = bill_to gstin state,  fallback bill_from
```

**[CODE].** Two divergences the references never resolved, which you must decide deliberately:

- Purchase-side PoS is unconditionally the company's state. That is wrong for bill-to/ship-to purchases and third-party deliveries.
- There are **no special place-of-supply rules for services** anywhere (immovable property, transportation, events, telecom, OIDAR). PoS is derived purely from address geography. **[VERIFY / NOT IN CODE]** — if you sell services, this is a real gap.

### 2.3 Tax-head determination (the single most important rule in the product)

```
is_inter_state:
  if counterparty.gst_category == SEZ:  return TRUE     # SEZ is always inter-state
  source_state =
      sales / payment entry     -> company_gstin[:2]
      purchase / subcontracting -> supplier_gstin[:2]
                                     (Overseas supplier    -> "96";
                                      unregistered supplier -> supplier address state)
                                     fallback company_gstin[:2]
      stock entry               -> bill_from_gstin[:2], fallback bill_to
  return place_of_supply[:2] != source_state

inter-state -> IGST only
intra-state -> CGST + SGST, each exactly half the headline rate
```

**Rate split is always exactly 50/50** of the headline rate (18% ⇒ 9+9; 28% ⇒ 14+14). [CODE, both references agree.]

**Blocking validations at save/submit — these must throw, not warn:**

1. An inter-state document may not carry any CGST or SGST account row.
2. An intra-state document may not carry an IGST account row.
3. An intra-state document using GST accounts must use **both** CGST and SGST — one alone is an error.
4. A GST account row may never use charge type "On Previous Row Amount".
5. "On Item Quantity" is permitted only for the `cess_non_advol` account, and that account must use "On Item Quantity" or "Actual".
6. Sales documents may use only Output / Sales-RCM / Output-Refund accounts; purchase documents only Input / Purchase-RCM.

> **Do not copy this escape hatch:** india-compliance skips validations 1–3 entirely when the *company's own* address category is SEZ. That disables the core determination rule rather than applying SEZ-specific logic. Implement SEZ properly instead.
>
> **Do not copy this default:** `is_inter_state` returns FALSE when place_of_supply is blank, so a missing PoS silently produces CGST+SGST. Fail loudly.

### 2.4 Item classification and HSN

| Rule | Specification |
|---|---|
| `gst_treatment` values | Taxable, Zero-Rated, Nil-Rated, Exempted, Non-GST. Only **Taxable** and **Zero-Rated** may carry GST. |
| Derivation | Sales to SEZ/Overseas ⇒ all lines Zero-Rated. Import purchase (Overseas/SEZ) ⇒ all lines forced Taxable. Document with no GST tax rows ⇒ lines keep Exempted/Non-GST if set, else become Nil-Rated. Otherwise from the Item Tax Template. |
| Nil vs Exempt vs Non-GST | **Three distinct zero-rate tax records, not "no tax".** Odoo models these as separate 0% taxes with their own tax groups precisely because GSTR requires them reported separately. Force the user to pick one; never leave the tax field blank. |
| Rate consistency | Item Tax Template carries `gst_treatment` + headline `gst_rate`. Non-Taxable ⇒ rate forced 0. Taxable ⇒ rate 0 rejected. Intra-state account rows must have `|rate| = gst_rate/2`; inter-state rows `|rate| = gst_rate`. |
| Permitted rates for e-invoice reporting | `{0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40}` — **[VERIFY]**; Odoo's fiscal-position generator uses `[1,2,5,12,18,28,40]`, and 12/28/40 coexisting suggests the data spans a slab transition. Do not treat either list as the current slab schedule. |
| HSN valid lengths | 4, 6 or 8 digits only — never 5 or 7. Regex `^\d{4}$\|^\d{6}$\|^\d{8}$` after stripping non-digits. |
| HSN floor | Company setting ∈ {4,6,8}; allowed lengths are those ≥ the floor (floor 6 ⇒ 6 or 8 only). |
| Service detection | HSN beginning `99` ⇒ service (SAC). Drives goods-vs-services, import-of-goods-vs-services, and e-way-bill applicability. |
| Enforcement | Warning at draft; **hard throw at submit on sales documents**. Mandatory 4/6/8 regardless of floor for e-invoice and for Overseas/SEZ purchase invoices. |

**Line-coherence validations (must throw):**

- GST applied on a line whose treatment is not Taxable/Zero-Rated ⇒ "Cannot charge GST on Non-Taxable Items", listing row numbers.
- No GST on a Taxable/Zero-Rated line ⇒ "No GST is being charged on Taxable Items" — except imports, except Zero-Rated lines on non-"export with payment" documents, except lines with taxable value 0.
- Computed item GST amount must equal `rate × taxable_value / 100` (or `rate × qty` for cess_non_advol). india-compliance tolerates a flat 1 currency unit per line; **use a proportional tolerance instead** — a flat ₹1 is meaningless on a ₹5 line and generous on a ₹5,00,000 one.

### 2.5 Reverse charge (RCM)

| Rule | Specification |
|---|---|
| Representation | Document flag `is_reverse_charge` + a mirrored tax pair. The RCM leg is either negative-when-added or positive-when-`Deduct`. |
| Balance | `sum(non-RCM GST rows) + sum(RCM booked) == 0` to 2 decimals, else throw ("Booked reverse charge is not equal to applied tax amount"). |
| Odoo's alternative | ±100% repartition: +100% to an asset "Reverse Charge GST on Purchase" account and −100% to GST Payable. Net zero on the bill, both legs land in the return. Cleaner than a flag; consider it. |
| Non-RCM documents | May not use any RCM-suffixed GST account (Payment Entry exempt). |
| Sales RCM | Only when enabled; a sales document cannot be RCM if the customer has no GSTIN. |
| Not applicable | Import of Goods + RCM ⇒ throw. |
| Auto-RCM for unregistered suppliers | If enabled (default off) and category = Unregistered and `grand_total > rcm_threshold` (default 5000) and not opening and PoS set ⇒ set RCM and swap in the RCM tax template. **[VERIFY]** the ₹5,000 figure — it is a configurable default in code, not law. |
| ITC classification precedence | Import Of Goods > Import Of Service > ITC on Reverse Charge > Input Service Distributor > All Other ITC |

**Weakness to fix:** auto-RCM triggers on the *document* total against a per-supplier threshold, and only for Unregistered category. It will not catch notified-category RCM (freight, legal, security, etc.) from *registered* suppliers, which is the common case for manufacturers. Model RCM as a property of the **HSN/SAC or expense category**, not of the counterparty's registration status alone.

### 2.6 Document-level validations that must block submission

The "prevent an unfileable invoice" set. All throw at validate.

| # | Validation |
|---|---|
| V1 | Company address (and hence company GSTIN) present; `company_gstin` and `place_of_supply` mandatory |
| V2 | `gst_category` mandatory and consistent with the party GSTIN |
| V3 | `place_of_supply` must be a valid `NN-State` option |
| V4 | **No GST when company GSTIN == party GSTIN** (internal transfer) |
| V5 | **No input GST on a purchase from a Registered Composition dealer** |
| V6 | **No GST on export/SEZ without payment of tax** (`is_export_with_gst = 0`) |
| V7 | **No GST on a non-RCM purchase from a supplier with no GSTIN** |
| V8 | Invoice number ≤16 chars, `^[^\W_][A-Za-z0-9\-\/]{0,15}$` — throws on Sales Invoice, and on an RCM self-invoice with no supplier GSTIN |
| V9 | Purchase Invoice: supplier bill number mandatory unless supplier is Unregistered (needed for 2A/2B reconciliation) |
| V10 | Overseas sales with an Indian PoS requires an Indian shipping address (classifies as B2C) |
| V11 | Post-submit: changing party address, GSTIN, category or PoS is blocked outright once an e-way bill or IRN exists |
| V12 | Recommended: block posting into a period whose GSTR-1 is already filed, except for a privileged role |

All GST validation is skipped when company country ≠ India, or company category is Unregistered, or the document is an opening entry.

### 2.7 Other invoice-content requirements

- **HSN-wise summary annexure** on the invoice, grouped by `(HSN, UoM, combined GST rate)` where the rate is the **sum** of the distinct igst/cgst/sgst amounts on the line (so a 2.5+2.5 intra-state line groups under rate 5, matching the IGST line's rate 5). Cess excluded from the grouping key, reported as its own column. Compute **server-side once** — Odoo implements it twice (Python + JS for POS) and flags the duplication as a correctness hazard.
- **UQC** from the government's closed code list (`BAG, BOX, BTL, CBM, CMS, DOZ, GMS, KGS, KLR, LTR, MTR, MTS, NOS, PCS, SET, SQM, TON, UNT`, …), formatted `CODE-DESCRIPTION`, fallback `OTH-OTHERS`.
- **Amount in words**, fiscal year ending 31 March, **round-per-line** tax rounding (not round-per-document — this materially changes the tax).
- **Statutory declaration text** printed on export/SEZ invoices, with/without-payment variants.
- **Cess**: model as `cess` (ad valorem) + `cess_non_advol` (per-unit) with a quantity-based charge type. Both references encode "higher of X% or ₹Y per unit" rules **only in the tax's display name** — that is not computable. Implement a real `max(ad_valorem, specific × qty)` formula. **[NOT IN CODE]**

---

## 3. E-INVOICE + E-WAY BILL

### 3.1 e-Invoice (IRN) — when required

Five-condition gate, all must hold [CODE]:

1. No IRN already exists on the document.
2. `company_gstin != billing_address_gstin` (self-invoices excluded).
3. Not B2C — i.e. buyer has a GSTIN **or** PoS is `96-Other Countries` (exports qualify without a GSTIN).
4. e-Invoicing enabled, and where per-company applicability is configured, the company is listed with its own applicable-from date.
5. `posting_date >= applicable_from` (which may not precede 2021-01-01).

Plus: when the nil/exempt setting is "Do Not Generate" (the default), an invoice whose every line is non-taxable is skipped.

**Document types:** `INV` (normal), `CRN` (credit note / `is_return`), `DBN` (debit note). Delivery Notes and Stock Entries are never e-invoiced.

**Reporting time limit:** blocked when `today > posting_date + N days`, default N = 30. **[VERIFY]**

**Cancellation:** only within 24 hours of acknowledgement (`acknowledged_on + 1 day >= now`). **There is no amendment API.** The only remedy after 24h is a credit note. Reason codes: 1 Duplicate, 2 Data Entry Mistake, 3 Order Cancelled, 4 Others.

### 3.2 e-Invoice payload

Schema `"Version": "1.1"` (NIC generate-IRN v1.03). Blocks:

`TranDtls{TaxSch:"GST", SupTyp, RegRev, IgstOnIntra}` · `DocDtls{Typ,No,Dt}` · `SellerDtls` · `BuyerDtls` (+ `Pos`) · `DispDtls` (dispatch-from, no GSTIN) · `ShipDtls` (ship-to, with GSTIN) · `ItemList[]` · `ValDtls` · `PayDtls` · `RefDtls.PrecDocDtls[]` (original invoice for credit notes) · `EwbDtls` · `ExpDtls`.

**Supply type derivation:** Overseas + IGST ⇒ `EXPWP`; SEZ + IGST ⇒ `SEZWP`; else map Deemed Export→`DEXP`, Overseas→`EXPWOP`, SEZ→`SEZWOP`, other→`B2B`.

**`IgstOnIntra` = 'Y'** only when supply is intra-state AND IGST present AND category is neither SEZ nor Overseas. (Code comment: export and SEZ must be treated as inter-state supply.)

**Overseas normalisation:** GSTIN → literal `"URP"`, Pin → `999999`, Stcd → `"96"`, Pos → `"96"`.

**Export block (`ExpDtls`)** when category is Overseas: `RefClm` ('Y' if IGST present), `ForCur` (when currency ≠ INR), `CntCode`, `ShipBNo`, `ShipBDt`, `Port` (validated against the government port-code list).

**Hard rules that constrain the ERP's own data model:**

| Rule | Detail |
|---|---|
| Max **1000** line items per IRN | Aggregate BOM-heavy invoices |
| **No negative lines** | Any item with `AssAmt < 0` must be folded into positive lines sharing the same `(HsnCd, GstRt)` as an additional Discount, consumed in descending `AssAmt` order; a line fully consumed is zeroed across *all* amount keys. A "global discount" (untaxed line, negative subtotal) is excluded from `ItemList` entirely and reported in `ValDtls.Discount`. |
| Negative unit price + negative qty | Both sign-flipped (the portal rejects negatives) |
| Rounding | Amounts 2 dp, quantities and rates 3 dp |
| Address validation **before** the call | street 3–100, city 3–100; India: state 3–50, PIN `^([1-9][0-9]{5})$`, state TIN `^(?!0+$)([0-9]{2})$`. Email/phone format-checked and **omitted from the payload if invalid** rather than sent. |

Address validation is deliberately done **locally, before the call** — the code comment says this exists to avoid being blacklisted by the government servers for repeated bad requests. Copy that discipline.

**Response storage (this is your audit record, not your own totals):** `IRN`, `AckNo`, `AckDt`, `SignedInvoice` (JWT), `SignedQRCode`, the decoded JWT payload, and a sandbox-mode flag. Store the request JSON too.

> ⚠️ Both references decode the government's signed JWT with **signature verification disabled**, and in Odoo the JWT library is an *optional import* — so if it is absent, duplicate-IRN verification is silently skipped entirely. **Verify the signature.** The stored "signed invoice" is the defensible statutory artefact; trusting it unverified is a correctness hole in the most safety-critical path.

### 3.3 e-Way Bill — when required

```
applicable IF   e-way bill enabled
            AND at least one GOODS line (HSN not starting 99, qty != 0)
            AND company_gstin != counterparty_gstin
            AND abs(base_grand_total) >= threshold
```

**Threshold resolution:**

- inter-state ⇒ global `e_waybill_threshold`, default **₹50,000** **[VERIFY]**
- intra-state ⇒ per-state row: if the state row says `intrastate_applicable = false`, the e-way bill is **never applicable** for that state; else use that state's threshold; if no row exists, fall back to the global threshold.

Applicable doctypes: **Sales Invoice, Purchase Invoice, Delivery Note, Purchase Receipt, Stock Entry, Subcontracting Receipt.** (M1 above — this breadth is the manufacturing requirement.)

**Blocked when:** all lines are services; bill-from/bill-to addresses missing; party GSTIN == company GSTIN (except Delivery Notes and outward stock entries); Purchase Invoice without `bill_no` for a registered supplier.

### 3.4 e-Way Bill payload

Single endpoint with an `action` parameter. Key fields: `supplyType` (O/I), `subSupplyType`, `subSupplyDesc`, `docType`, `docNo`, `docDate`, `transactionType`, from/to party blocks with **both** `fromStateCode` (billing) and `actFromStateCode` (actual dispatch), the tax value block, transport block, `itemList[]` (max **250** rows — aggregate HSN+UOM+rate-wise beyond that, and error if still over), and `mainHsnCode`.

**Code tables — memorise these:**

| subSupplyType |
|---|
| 1 Supply · 2 Import · 3 Export · **4 Job Work** · 5 For Own Use · **6 Job Work Returns** · 7 Sales Return · 8 Others · 9 SKD/CKD · 10 Line Sales · 11 Recipient Not Known · 12 Exhibition or Fairs |

| docType | transactionType | transMode | vehicleType |
|---|---|---|---|
| INV Tax Invoice · BIL Bill of Supply · BOE Bill of Entry · **CHL Delivery Challan** · OTH Others | 1 Regular · 2 Bill-To/Ship-To · 3 Bill-From/Dispatch-From · 4 both | 1 Road · 2 Rail · 3 Air · 4 Ship · 5 In Transit | R Regular · O Over-Dimensional Cargo |

**Cancellation reason codes differ between the two documents, and this is deliberate:**

| Code | e-Invoice | e-Way Bill |
|---|---|---|
| 1 | Duplicate | Duplicate |
| 2 | Data Entry Mistake | Order Cancelled |
| 3 | Order Cancelled | Data Entry Mistake |
| 4 | Others | Others |

Keep them as two separate constants. They are trivially easy to cross-wire.

**Conditional transport rules:**

- Mode Ship ⇒ vehicle type forced to `O`; `R` rejected.
- No valid transporter GSTIN ⇒ mode must be Road **and** a vehicle number supplied.
- Rail/Air/Ship ⇒ transport doc no + date required.
- Empty transport keys stripped from the payload entirely.

**Distance:** send as integer km; `>= 4000` ⇒ send 0 and let the portal compute. If dispatch and destination PINs are identical, distance must be `< 100` and a zero forced to 1. When 0 is sent, the portal returns the distance inside an alert string, which must be parsed back and stored.

**Validity (`validUpto` / `EwbValidTill`) is NEVER computed locally** — always taken from the portal response. Consequence: an offline/JSON-only user has no validity tracking at all.

**Part A / Part B:** when the portal returns no `validUpto`, only Part A was created — the bill is not valid until Part B (vehicle) is filled via the vehicle-update action `{ewbNo, vehicleNo, fromPlace, fromState, reasonCode (1 Break Down, 2 Trans Shipment, 3 Others, 4 First Time), reasonRem, transDocNo, transDocDt, transMode, vehicleType}`. Transporter reassignment is a separate action. Both refused once `valid_upto` has passed. **SMEs generate Part A at invoicing and fill the vehicle when the truck loads — this flow is not optional.**

**Extension:** allowed only in the window `[valid_upto − 8h, valid_upto + 8h]`; outside it, offer a *scheduled* extension executed by a daily job. Refused entirely if a transporter other than the company holds the bill. Remaining distance mandatory and ≤ original. Reason codes 1 Natural Calamity, 2 Law and Order, 4 Transshipment, 5 Accident, 99 Others; consignment status M In Movement / T In Transit; transit type R/W/O mandatory when In Transit.

**Cancellation:** within 24h of generation. Cancelling an e-invoice must **first** cancel its attached e-way bill, then the IRN, then the ERP document.

### 3.5 e-Way Bill via IRN (the short path)

When an IRN exists, all lines are taxable, and the document is not a credit/debit note, request the e-way bill through the e-invoice API with a minimal payload `{Irn, Distance, TransMode, TransId, TransName, TransDocNo, TransDocDt, VehNo, VehType, DispDtls}`.

> ⚠️ **The key names and the response keys differ entirely between the two channels** (`TransMode` vs `transMode`; `EwbNo/EwbDt/EwbValidTill` vs `ewayBillNo/ewayBillDate/validUpto`). Credit and debit notes **must** use the direct e-way bill API — error 4010 is documented as "E-way Bill cannot be generated for Debit Note, Credit Note and Services".

### 3.6 API integration shape

| Aspect | Requirement |
|---|---|
| Access model | Everything goes through a **GSP/ASP gateway**, never directly to NIC/GSTN. Both references do this. |
| Auth (NIC standard mode) | POST auth with `{UserName, Password, AppKey}`; the whole JSON base64'd then RSA/PKCS1v15-encrypted with NIC's public key. Response returns `AuthToken` + `Sek`; `Sek` is AES-decrypted with the app key to yield the session key. Subsequent requests: body AES-encrypted with the session key, sent as `{Data: …}`; response `Rek` decrypts `Data`; an `Hmac` (HMAC-SHA256 over base64 of decrypted data, keyed with `rek`) must be verified — mismatch throws. |
| Session lifetime | e-invoice: parse `TokenExpiry` from the response (it is **IST** — convert to UTC before storing). e-way bill: one reference **hardcodes a 6-hour window** rather than reading the real expiry. Read the real expiry. |
| Token invalidation | e-invoice error **1005** and e-way bill error **238** both mean stale token (typically because another instance authenticated with the same credentials). Re-authenticate once and replay the identical request — **with a recursion guard**, which one reference lacks. |
| Timeouts | Set one on **every** call. One reference sets `timeout=10` on e-way bill and **nothing at all** on e-invoice — and holds a DB row lock across that call. |
| HTTP error mapping | 401 / 403 access_denied → gateway connection error; 403 → invalid API key; **429 → credits/quota exhausted (a distinct, first-class retryable state)**; 504 → gateway timeout. Vendor strings `GSPGSTDOWN`, `GSPERR300`, `Connection reset`, `No route to host` → GSP server error; `GEN5005` → limit exceeded. |
| Sandbox | Per-company boolean. Substitute fixed dummy credentials/GSTINs, randomise the document number, force consistent PoS state codes, raise a one-time "request was made in Sandbox Mode" alert, and **stamp every log record with `is_generated_in_sandbox_mode`** so sandbox artefacts are never mistaken for real ones. Auto-retry schedulers must skip sandbox. |
| Secret handling | Mask `x-api-key`, auth token, password, `app_key`, `sek`, `rek` before logging. Both references store credentials as **plaintext** fields restricted to a system group — do better; vault them. |
| Error catalogue | One reference ships ~330 NIC e-way-bill error codes; the e-invoice side special-cases only a handful. Ship a full, versioned code→(message, class) table for **both**. Never classify errors by string-matching government prose — NIC changes wording. |

**Non-fatal error codes to handle rather than fail on:**

| Doc | Code | Meaning | Action |
|---|---|---|---|
| e-Inv | 2150 | Duplicate IRN | Query back and verify (§3.7 R3/R4) |
| e-Inv | 2283 | IRN >2 days old | Fall back to the taxpayer portal |
| e-Inv | 9999 | Invoice not active | Treat as already cancelled |
| e-Inv | 4002 | EWB already generated for IRN | Fetch it |
| e-Inv | 2148 | IRN data not available (generated on another portal) | Regenerate via the direct EWB API |
| e-Inv | 3028 / 3029 / 3001 | GSTIN invalid / not active / data unavailable | Refresh counterparty GSTIN from master, retry once, abort if status ≠ ACT |
| EWB | 312 | Not yours / already cancelled | Treat as cancelled |
| EWB | 604 | EWB already generated for this doc number | Search active bills by date and link |
| EWB | 328 | Transporter details not retrievable | Continue |

### 3.7 Resilience requirements — the part both references get wrong

**Verdict on the references:** synchronous, user-request-scoped implementations with duplicate-recovery bolted on. **No queue, no scheduled retry, no background worker, no backoff, no dead-letter handling.** Every portal call happens inline in the user's transaction. They are better than naive-sync in exactly three ways (pessimistic row locking, forced commits, query-back-on-duplicate) and worse than a job queue in every other way.

**Our implementation must meet these. Hard requirements, not nice-to-haves:**

| # | Requirement |
|---|---|
| R1 | **Never block document submission on a government call.** The invoice posts; the statutory number arrives asynchronously. A status field (`Pending / Generated / Cancelled / Failed / Auto-Retry / Not Applicable / Manually Generated / Manually Cancelled`) drives the dashboard. Essential in Indian connectivity conditions. |
| R2 | **Durable job queue** with per-document jobs, attempt counter, last-attempt timestamp, exponential backoff, dead-letter state. Not a global "retry pending" flag with a 5-minute cron that blocks *all* new generations while set — that is a crude circuit breaker that stalls unrelated invoices. |
| R3 | **Idempotency by query-back, because the portals have no idempotency key.** On duplicate errors, re-query (`getirnbydocdetails`, `getewaybillgeneratedbyconsigner`, `get_ewaybill_by_irn`) and adopt the existing number. **This is the single most important pattern to reimplement.** |
| R4 | **Verify before adopting a recovered number.** e-invoice does this: decode the returned SignedInvoice, compare `BuyerDtls.Gstin` and `ValDtls.TotInvVal` (within ±1) against the local document; refuse and instruct the user to raise a fresh invoice on mismatch. **The e-way bill path does no such verification** — whatever the portal returns for that docNo is adopted. **Implement e-invoice-grade verification on both sides.** |
| R5 | **Commit boundary immediately after persisting the government-returned number**, before any downstream side effect (PDF, mail, ledger). Both references break transactional atomicity deliberately with an explicit commit for exactly this reason. Make it a conscious design decision, not an accident. |
| R6 | **Self-healing reconciliation sweep.** Recovery in both references only fires when the *next* attempt returns a duplicate code. If the process dies between the HTTP response and the commit, nothing re-drives it — a human must press the button. Run a periodic sweep reconciling pending documents against the portal. |
| R7 | **Error triage into three classes,** not two: permanently-invalid (fix the data — do not retry), transient (retry with backoff), quota/outage (pause the queue). The 330-code table makes this possible; neither reference does it. |
| R8 | **Concurrency:** one in-flight submission per document. Use a lock, but never hold a DB row lock across an untimed network call. |
| R9 | **Observability:** a persisted submission log independent of the document — attempt no., timestamp, endpoint, request hash, response code, latency. Neither reference has any metrics; they have chatter messages and a logger warning. |
| R10 | **Offline fallback:** JSON export for portal upload (e-way bill bulk format `{billLists:[…]}`), and a manual-entry path validating a 12-digit numeric e-way bill number. Not every SME buys GSP credits from day one. |

---

## 4. GST RETURNS

### 4.1 GSTR-1 construction

GSTR-1 is built **purely from books**. Every Sales Invoice **item row** is classified by a strictly ordered predicate chain into exactly one primary table — **first match wins, and the order must be preserved:**

| # | Table | Predicate |
|---|---|---|
| 1 | **ECOM-RCM** | `ecommerce_gstin` set AND `is_reverse_charge` ⇒ excluded from all normal tables, reported only under s.9(5) |
| 2 | **B2B** | not ecom-rcm, not nil/exempt/non-GST, not a note, recipient has GSTIN, not export |
| 3 | **B2CL** | not ecom-rcm, not nil/exempt, not a note, no recipient GSTIN, not export, qualifies as B2C-large |
| 4 | **Exports** | not ecom-rcm, not nil/exempt, not a note, is export |
| 5 | **B2CS** | not ecom-rcm, not nil/exempt, no recipient GSTIN, not export, fails both B2CL tests |
| 6 | **Nil-Exempt** | item treatment ∈ {Nil-Rated, Exempted, Non-GST} |
| 7 | **CDNR** | is a note, recipient has GSTIN, not export |
| 8 | **CDNUR** | is a note, no recipient GSTIN, and (is export OR passes the B2CL-note test) |

Definitions: **export** = `place_of_supply == "96-Other Countries"` AND `gst_category == "Overseas"`. **note** = `is_return OR is_debit_note`. Items with `taxable_value == 0` drop out of all invoice tables but still feed the HSN summary.

> **Audit flag:** predicate 5 (B2CS) **does not exclude notes**, unlike every other predicate in the chain — so a small intra-state note to an unregistered customer lands in B2CS rather than CDNUR. Whether that is intended is **not stated in code. [VERIFY] against the statute before copying.**

**Sub-classification within B2B/CDNR:** Deemed Export→`DE`; SEZ + with-payment→`SEWP`; SEZ + without-payment→`SEWOP`; else RCM→`R`; else Regular→`R`. All five serialise into the single portal key `b2b`.

**Exports:** `WPAY` / `WOPAY`. Export notes go to CDNUR as `EXPWP`/`EXPWOP`; non-export unregistered notes as `B2CL`. Export rows carry port code, shipping bill number and date.

**B2C-Large threshold — date-versioned, inter-state only [VERIFY]:**

| Invoice date | Threshold |
|---|---|
| ≤ 2024-07-31 | ₹2,50,000 |
| ≤ 2099-03-31 (sentinel) | ₹1,00,000 |

Odoo encodes the same change as `invoice_date >= 2024-11-01` ⇒ ₹1,00,000, ₹2,50,000 before. **The two references disagree on the effective date (2024-08-01 vs 2024-11-01). Neither cites a notification. This must be verified.** Comparison is against the invoice **total** (tax-inclusive); for notes, `max(abs(note total), abs(original invoice total))`. Only inter-state qualifies; intra-state B2C is always B2CS.

> **Build this as an effective-dated rule table from day one.** In Odoo this is the *only* date-versioned rule in the entire module and it is an inline literal; in india-compliance the sentinel end-date of 2099-03-31 means every future change is a code change. That is the biggest architectural mistake to avoid.

**Other GSTR-1 aggregations:**

- **Nil/exempt** reported as a 4-way matrix, not per invoice: `<Inter|Intra>-State supplies to <registered|unregistered> persons`, taxable value split three ways (Nil-Rated / Exempted / Non-GST).
- **B2CS** aggregated by `"<place_of_supply> - <gst_rate>"`, document type always `OE`.
- **HSN summary** keyed `"<hsn> - <uom> - <rate>"`, summing qty, taxable value, IGST/CGST/SGST/cess; document value = taxable + four taxes. Bifurcated into B2B/B2C from **2025-05-01** **[VERIFY]** (`gst_category ∈ {Unregistered, Overseas}` ⇒ B2C). Description truncated to 30 chars; service HSNs forced to UOM `OTH-OTHERS` and qty 0; s.9(5) rows excluded entirely.
- **Document Issued** series table (including delivery challans for job work), bucketed by nature, with contiguous-series detection.
- **Advances received (11A)** and **adjusted (11B, multiplier −1)** from GL entries against Payment Entries hitting Output GST accounts; intra-state splits 50/50 into CGST/SGST, inter-state all IGST; rate back-computed as `round(tax / taxable × 100)`.
- **SUPECOM** e-commerce table: s.52 (TCS) rows are **in addition** to the primary table; s.9(5) rows are **exclusive**. Because of the overlap, the summary must compute the count of invoices appearing in more than one of {Nil-Exempt, e-commerce, taxable} and report it as a negative "Overlapping Invoices" adjustment.

**Universal exclusions:** submitted invoices only (`docstatus 1`); opening entries excluded; self-invoices (billing GSTIN == company GSTIN) excluded.

**Rounding discipline:** round at the `(invoice, GST rate)` item level; accumulate the truncation residue into a `rounding_difference` bucket. Because the invoice tables round at rate level, the HSN table will not tie — the reference forces the residual difference onto the largest HSN row to make it balance, and the portal rejects the return otherwise. **That workaround deliberately misstates one HSN row.** Design a principled allocation, or round consistently so no residue arises.

**QRMP / quarterly:** in months M1 and M2 of a quarter, only B2B Regular, B2B RCM, SEZWP, SEZWOP, Deemed Exports and CDNR may be uploaded; everything else is stripped into an "excluded for quarterly" list, and HSN + Document Issued are deleted for M1/M2. In the quarter-end month, load the two prior months' logs and move already-filed documents into an "already included" list so nothing is reported twice.

### 4.2 GSTR-3B construction

**Table 3.1 outward bucketing — first match wins:**

| Condition | Bucket | Carries |
|---|---|---|
| treatment ∈ {Nil-Rated, Exempted} | `osup_nil_exmp` | taxable value only |
| treatment = Non-GST | `osup_nongst` | taxable value only |
| ecom s.9(5) (`ecommerce_gstin` + RCM) | `eco_dtls.eco_reg_sup` | taxable value only |
| treatment = Zero-Rated | `osup_zero` | taxable value, IGST, cess (**no CGST/SGST**) |
| everything else | `osup_det` | taxable value + all four taxes |

RCM **sales** invoices have all four tax amounts **zeroed** before accumulation (the recipient pays). RCM **purchase** invoices are pulled into the same computation and land in `isup_rev`. Advances (11A +1, 11B −1) are injected as pseudo-invoices into the Taxable bucket.

**Table 3.2** (inter-state to unregistered / composition / UIN): only rows already in `osup_det`, sub-category Taxable, `gst_category ∈ {Unregistered, Registered Composition, UIN Holders}`, IGST > 0 and rate > 0. Accumulated per `(category, place_of_supply)` into `unreg_details` / `comp_details` / `uin_details`.

**Table 4 ITC** — three sources: Purchase Invoices (submitted, not opening, company GSTIN ≠ supplier GSTIN, not BoE-applicable), Bills of Entry, and Journal Entries of voucher type `Reversal Of ITC` / `Reclaim of ITC Reversal`.

Purchase-Invoice bucketing order is fixed: Composition/Exempted/Nil-Rated → table 5; Non-GST → table 5; ITC Available (when reason ≠ "ITC restricted due to PoS rules"); Ineligible (when reason == "ITC restricted due to PoS rules"); then ITC Reversed.

> **The critical subtlety:** ITC Reversed is evaluated **last**, and a row already classified ITC Available is **duplicated** — the original stays in 4(A) and a clone goes to 4(B) whenever the item carries `is_ineligible_for_itc` and the invoice is not PoS-restricted. A s.17(5) item therefore appears as both availed and reversed, netting to zero, and a mixed invoice reverses only the offending line's tax. **A PoS-restricted invoice must NOT also be reported as a 17(5) reversal.**

Sub-rows: 4(A) keyed `IMPG` (import of goods), `IMPS` (import of services), `ISRC` (RCM), `ISD`, `OTH`, driven by `itc_classification`. 4(B) reversal: `RUL` (rules 42 & 43 / s.17(5)) and `OTH`. 4(D) ineligible: `RUL` (reclaim) and `OTH` (PoS restriction).

**Net ITC (4C) sign convention:** `+1` for every 4(A) row, `−1` for every 4(B) reversal row, `0` for 4(D) ineligible rows. Cess for these purposes = `cess_amount + cess_non_advol_amount`.

**Table 5** (nil/exempt/non-GST inward): Purchase Invoices only. Nil-Rated/Exempted, or supplier category = Registered Composition ⇒ `ty='GST'`; Non-GST ⇒ `ty='NONGST'`. Taxable value placed entirely in `inter` or `intra`.

**Period basis:** outward tables are **always** computed on posting date. Inward/ITC tables honour a `filter_by` of Posting Date or ITC Claim Period. **The two halves of the same return can therefore be built on different period bases.** Defensible, but make it an explicit product decision.

**Uniqueness:** at most one 3B report per `(company GSTIN, month/quarter, year)`. Fiscal year runs 1 April – 31 March throughout.

**Absent and must be built: there is NO interest/late-fee node** (table 5.1). No rate, no computation, no field, no Excel row. **[NOT IN CODE]**

**Also absent:** immutability after filing. GSTR-1 has an `is_latest_data` flag and stored filed JSON; **3B has neither** — the report can be regenerated and silently change *after* filing. Do not repeat that.

### 4.3 GSTR-2B download and the purchase-reconciliation algorithm

**2B availability rule:** the newest available period is the previous month if `day_of_month >= 14`, else two months back. **[VERIFY]** — the 14th is a hardcoded constant with no citation and GSTN generation dates have moved historically. Make it a parameter.

**2B is a snapshot that can retract documents.** On each import for a period, compare what was previously stamped with that `return_period_2b` against what the portal now reports: records no longer present have their 2B period cleared; records in the portal's *rejected* block are **deleted outright**.

**Portal-side identity:** an inward supply record is keyed `(bill_no, bill_date, classification, supplier_gstin)`; records with no bill number additionally key on the supplier's return period.

#### The matching algorithm

Deterministic, ordered, greedy rule-cascade over (books purchase docs) × (portal inward supplies). This is the most reusable artefact in any of the references.

**Step 0 — Candidate selection.** Category by category over fixed (original, amended) pairs: `(B2B,B2BA), (CDNR,CDNRA), (ISD,ISDA), (IMPG,—), (IMPGSEZ,—), (ECOM,ECOMA)`. Portal side: unmatched records only, excluding `Amended`, excluding TDS/TCS (stored but never reconciled). Books side: submitted, not opening, `reconciliation_status ∉ {Reconciled, Match Found, Not Applicable}`, at least one Taxable/Zero-Rated line, category-constrained. Books taxes aggregated as **absolute** sums so credit notes compare positively. **Books lookback starts one year before the FY start of the selected from-date** — older purchases remain eligible.

**Step 1 — CDNR split.** Run twice: (portal Debit Note × books `is_return=0`) and (portal Credit Note × books `is_return=1`). A debit note must never match a credit note.

**Step 2 — GSTIN-level pass.** Bucket both sides by `supplier_gstin`; matching only within a bucket. Seven rules applied **strictly in order**, each a *complete sweep* over all remaining pairs before the next begins — so a better rule wins globally, not per-invoice.

Operators: `E` exact · `F` fuzzy bill number · `R` |difference| ≤ 1 · `N` not compared.
Field vector: `[fy, supplier_gstin, company_gstin, bill_no, place_of_supply, is_reverse_charge, taxable_value, cgst, sgst, igst, cess]`

| Rule | Vector | Result |
|---|---|---|
| R1 | `E E E E E E 0 0 0 0 0` | **Exact Match** |
| R2 | `E E E F E E 0 0 0 0 0` | Suggested Match |
| R3 | `E E E E E E R R R R R` | Suggested Match |
| R4 | `E E E F E E R R R R R` | Suggested Match |
| R5 | `E E N E N N N N N N N` | Mismatch |
| R6 | `E E N F N N N N N N N` | Mismatch |
| R7 | `E E E N E E R R R R R` | Mismatch |

**Step 3 — PAN-level pass.** Re-bucket the remainder by PAN (`gstin[2:-3]`), so supplier GSTINs necessarily differ. Empty-GSTIN records dropped. Compares **total GST** (cgst+sgst+igst) instead of the three-way split. Vector `[fy, company_gstin, bill_no, place_of_supply, is_reverse_charge, taxable_value, total_gst, cess]`; all four rules yield Mismatch: `P1 E E E E E R R R` · `P2 E E F E E R R R` · `P3 E N F N N N N N` · `P4 E E N E E R R R`. **Skipped entirely for IMPG** — GST amounts are not reported in 2A for imports.

**Step 4 — Date guard.** In any rule where `bill_no` is not compared (R7, P4) and the category is not CDNR, reject if `|purchase.bill_date − inward.bill_date| > 10 days`.

**Step 5 — Fuzzy bill-number match.** False if either number is empty or the bill dates differ by more than 10 days. Then clean both: strip every FY representation (`2024-2025`, `2024/2025`, `20242025`, `2024-25`, `2024/25`, `202425`, `24-25`, `24/25`, `2425`), replace `/` and `-` with spaces, collapse whitespace, strip leading zeros. Match if the partial ratio is exactly 100, or the best extracted similarity score ≥ 90.

**Step 6 — Greedy consumption.** For each supplier bucket, for each purchase, take the **first** inward supply satisfying the rule in insertion order; remove both from the working sets; break.

**Step 7 — Write-back.** Stamp `match_status`, `link_doctype`, `link_name` on the portal record; set books `reconciliation_status = Match Found`; recompute the ITC claim period.

**Step 8 — Residue.** Present as *Only in 2A/2B* or *Only in Books*. Display differences: `taxable_value_difference = inward − purchase`, `tax_difference = total inward tax − total purchase tax`, both 2 dp; label "Rounding Difference" when either exceeds 0.01 (exact/suggested matches only).

**Cess normalisation:** fold books `cess_non_advol` into `cess` and zero it before comparing, so one cess figure meets one cess figure.

**Tolerances — exactly three exist:** 1 currency unit (absolute, per field, hardcoded); the fuzzy thresholds (ratio == 100, or score ≥ 90); the 10-day date window.

**Three things to improve rather than copy:**

1. **Greedy first-fit is order-dependent.** Where a supplier has several near-identical invoices in a month (repeat freight, raw-material deliveries — the manufacturing norm), the pairing is arbitrary. Use a cost-based assignment (Hungarian on a similarity score).
2. **The 1-unit tolerance is absolute and per-field.** On a large invoice, a genuine ₹1 difference in each of taxable value, CGST, SGST and cess passes as a suggested match; on a tiny invoice it is proportionally enormous. Use configurable percentage-plus-absolute.
3. **The fuzzy cleaner is aggressive.** `INV/001`, `INV-1` and `2024-25/INV/0001` all collapse to `INV 1`; at a 90% threshold, distinct invoices from one supplier can be conflated. The 10-day date guard is the only thing limiting the damage.

**State machine.** Portal `match_status`: `'' | Exact Match | Suggested Match | Mismatch | Manual Match | Unlinked | Amended`, plus two never-persisted presentation values (*Only in 2A/2B*, *Only in Books*). Books `reconciliation_status`: `'' | Match Found | Reconciled | Unreconciled | Ignored | Not Applicable`. User actions: Accept→Reconciled, Pending→Unreconciled, Ignore→Ignored; Ignore refused on a linked pair, Accept refused on an unlinked row.

**Amendments supersede.** When an amended record arrives, force the original to `Amended`, action `No Action`, and link it forward. Where `amendment_type == "Receiver GSTIN Amended"`, **any existing credit claim is invalidated** — force `Amended`, clear the link, and warn the user that the previously claimed credit has been reversed. `Amended` records are excluded from all reconciliation queries.

### 4.4 ITC claim period

Every Purchase Invoice / Bill of Entry carries `itc_claim_period` = `MMYYYY` or the literal `Deferred`. Derivation, strict precedence:

1. Current period already in the set of filed GSTR-3B periods ⇒ do nothing.
2. IMS action Rejected/Pending being applied ⇒ `Deferred`.
3. IMS action Accepted with an explicit period ⇒ that period.
4. Matched inward supply's `ims_action` ∈ {Rejected, Pending} ⇒ `Deferred`.
5. Otherwise default = the document's posting period, raised to `max(posting period, return_period_2b)`; then walk forward month by month and return the **first period whose GSTR-3B is not yet filed**, stopping at the deadline. If every period up to the deadline is filed, return nothing.

**Deadline [VERIFY]:** the helper is named `_get_section_16_4_deadline`, implying CGST Act s.16(4). It computes November of the year following the FY of the posting date — for FY 2024-25 purchases, period `112025`. **No notification is cited anywhere.**

**Validation:** the period must match `^(0[1-9]|1[0-2])\d{4}$` or be `Deferred`, and must not be a period whose 3B is already filed. On update-after-submit, block the change if either the old or new period is filed, naming both. Bulk system-driven changes must write an audit comment recording the new period and its source.

### 4.5 Return-period / filing-status tracking

One log record per `(return_type, return_period MMYYYY, GSTIN)`, named `<TYPE>-<MMYYYY>-<GSTIN>`. Stores `filing_status`, ARN, filing date, `filing_preference`, `is_latest_data`, `generation_status`, and gzipped JSON attachments for books / reconcile / filed / unfiled / raw_gov_data and their summaries.

**Any submission or amendment of a Sales Invoice must set `is_latest_data = 0` on the GSTR-1 log for that posting period.** That is how a back-dated edit forces regeneration.

### 4.6 Filing — the portal state machine

**Filing (not just preparation) IS implemented** in the reference, and it is a hard third-party GSP dependency.

**GSTR-1:** `RETSAVE` → `RETNEWPTF` (`{gstin, ret_period}`, plus `isnil='Y'` for a nil return) → `RETFILE` with the summary payload plus `st='EVC'` and `sid` formatted **exactly** as `<PAN>|<EVC OTP>`.

**GSTR-3B:** `RETSAVE` → `RETSUBMIT` → `RETOFFSET` (offset liability from cash/credit ledgers) → `RETFILE` with `st='EVC'`, `sid='<PAN>|<OTP>'`.

Status is polled with `RETSTATUS` using `{ret_period, ref_id}` — **filing is asynchronous and reference-id based**, so a persisted log document per (return type, period, GSTIN) with a status field is mandatory, not a synchronous call. Async status codes: `P` Processed, `PE` Processed with Errors, `ER` Error, `IP` In Progress.

Supporting reads: `RETSUM` (filed summary), `AUTOLIAB` (portal auto-computed liability), `RETINT` (portal-computed interest), `CLOSINGBAL` / `RCMCLOSINGBAL`, `OPENINGBAL` / `RCMOPNBAL`. **There is a "validate 3B against auto-calc" step** — books-computed 3B must be diffed against the portal's auto-populated figures before filing.

**Session:** OTP-authenticated per GSTIN, **bound to the caller's public IP** (sent as an `ip-usr` header); the stored token is invalidated when the IP changes; `AUTH4033` = invalid session, forcing re-auth. **Practical consequence: filing cannot be fully unattended** — a human supplies an OTP per session, and the server's egress IP must be stable. This is a deployment constraint, not just a code one.

---

## 5. JOB WORK / SUBCONTRACTING

### 5.1 The document flow

```
Purchase Order (service item, is_subcontracted)
   → Subcontracting Order (SCO) with a supplied-item table
   → Stock Entry, purpose "Send to Subcontractor"
        moves RM from company warehouse → "supplier warehouse"
        (still company-owned stock — ownership NEVER transfers)
   → Subcontracting Receipt (SCR)
        receives FG, consumes RM out of the supplier warehouse,
        rolls RM cost + service cost + additional cost + landed cost
        into the FG valuation rate
```

Odoo achieves the same shape with a per-partner *internal* subcontracting location and auto-created MOs. Either way: **goods at the job worker remain the principal's inventory.** That is the single most important modelling decision here.

**Reverse flows:** RM returned = Stock Entry `Material Transfer` with `is_return=1`. FG rejected = Subcontracting Receipt with `is_return=1`.

### 5.2 The challan and its GST treatment

Goods move under a **delivery challan, not an invoice**. e-Way bill payload: `docType = CHL`, `subSupplyType = 4` (Job Work) outward / `6` (Job Work Returns) inward; `supplyType` `O` on outward legs, `I` on returns.

Eligible Stock Entry purposes: Material Transfer, Material Issue, Send to Subcontractor, Subcontracting Delivery, Return Raw Material to Customer.

**The challan must carry a declared taxable value even though no supply occurs.** Rules:

- Rate is picked from the enabled Sales Taxes and Charges Template matching the company's IGST output account. Inter-state ⇒ one IGST row; intra-state ⇒ CGST + SGST at half each.
- Charge type must be "On Net Total" or "On Item Quantity"; "Actual" is rejected.
- **GST cannot be charged when Bill-From GSTIN == Bill-To GSTIN.**
- Job worker delivering FG from customer material: `additional_taxable_value = (Σ(order_rate × consumed_qty) / produced_qty) × delivered transfer_qty`, in stock UOM, per finished good.
- Returning unused customer RM: `additional_taxable_value = (received-item rate × transfer_qty) − row amount` (may be negative). The code docstring cites **Rule 55** here — returned RM is valued at the *customer's declared value*, not the job worker's book value. **This is the only rule-level citation present anywhere in the job-work code.**

> **Do not copy the rate-derivation heuristic.** Scraping "whatever enabled tax template happens to reference the IGST output account, preferring `is_default` then most-recently-modified" is a guess, not a rate determination. Resolve the rate deterministically from the item's HSN/tax template.

**Same-GSTIN exclusion:** every ITC-04 query filters `bill_to_gstin != bill_from_gstin`. **The job-work register must key on GSTIN pairs, not on party master records** — a transfer to a branch under the same GSTIN is internal stock movement; a transfer to the same legal entity's *other* GSTIN is a supply.

**Direction reversal:** for a non-return Stock Entry, company = bill-from and party = bill-to; for a return, the roles swap. When mapping an SCO or Purchase Receipt into a Stock Entry, bill-from/bill-to and ship-from/ship-to are swapped relative to the buying document.

### 5.3 ITC-04

**Table 4 — goods sent to job worker.** Sources: submitted Stock Entries with purpose "Send to Subcontractor" where `bill_to_gstin != bill_from_gstin`; and submitted Subcontracting Receipts with `is_return = 1`. Per row: challan no (= document name), challan date (= posting date, dd-mm-yyyy), job worker state code, HSN, description, UQC, absolute quantity, absolute taxable value, CGST/SGST/IGST rates, cess. **Goods type: `8b` when the item is an Input, `7b` when Capital Goods** — derived from `Item.is_fixed_asset`. Gov JSON key `m2jw`.

**Table 5A — goods received back.** Sources: Stock Entries with `is_return=1` and purpose "Material Transfer"; and Subcontracting Receipts with `is_return=0`, where the reported challan number is the **job worker's own** `supplier_delivery_note`, not the internal document name. Each row must carry the **original** challan number and date, resolved through the reference table. Rows keyed `"<original_challan> - <job_work_challan>"`. Gov JSON key `table5A`; fields `ctin, jw_stcd, o_chnum, o_chdt, jw2_chnum, jw2_chdt, nat_jw, uqc, qty, desc, lwqty, lwuqc`.

**Linkage enforcement.** The reference **hard-throws** ("Please Select Original Document Reference for ITC-04 Reporting") on an RM-return Stock Entry with no original reference — but only **soft-alerts** on the FG-receipt Subcontracting Receipt, and then **silently drops** unreferenced rows from the JSON with nothing but a `has_invalid_data` boolean surfacing. **Block submission in both directions.**

**Return periods** (period code + year): `13/14/15/16` = quarters Apr-Jun / Jul-Sep / Oct-Dec / Jan-Mar; `17` = Apr-Sep; `18` = Oct-Mar; `19` = annual. A date range matching none of these throws.

**Filing:** the reference produces a downloadable JSON only (`ITC-04-Gov-<GSTIN>-<period>.json`) for manual portal upload. **No direct ITC-04 API call is implemented.**

### 5.4 Section 143 — the deadlines and the deemed-supply consequence

> ### ⛔ **[NOT IN CODE] — NOTHING IMPLEMENTS THIS. ANYWHERE.**
>
> A repo-wide grep across india-compliance for `143`, `one year`, `1 year`, `three year`, `3 year`, `deemed supply` returned **only HSN-code digit coincidences**. ERPNext and Odoo have nothing either.
>
> There is **no ageing clock from the challan date, no open-challan register, no threshold constant, no alert, no auto-generated tax invoice on expiry, and no ITC reversal.**
>
> The only trace of the input-vs-capital-goods distinction that any deadline depends on is the ITC-04 `goods_type` derivation (`is_fixed_asset` ⇒ Capital Goods / `7b`, else Inputs / `8b`) — and that exists **purely for reporting**.

**This must be built from the statute.** The brief states the windows as 1 year for inputs and 3 years for capital goods; **[VERIFY]** both against the current Section 143 text and any extension notifications, because **no reference code corroborates either figure.**

What our product must implement:

| # | Requirement |
|---|---|
| J1 | **Open-challan register** — every outward challan with item type (Input / Capital Goods), quantity sent, quantity received back, quantity returned as scrap/loss, quantity still outstanding. This is the artefact both ITC-04 and the deadline depend on, and it is the thing SMEs most commonly lack. |
| J2 | **Quantity-level FIFO matching** of received qty against a specific outward challan's outstanding qty. The references link document-to-document only; partial returns across multiple challans are not apportioned at all. |
| J3 | **Ageing clock per challan line**, by item type, from the despatch date |
| J4 | **Escalating alerts** before expiry (T-90 / T-30 / T-7, configurable) |
| J5 | **Deemed-supply on expiry** — raise a tax invoice **dated back to the original despatch date**, with interest, and reverse the ITC |
| J6 | **Moulds, dies, jigs, fixtures and tools carve-out** from the deadline. **[VERIFY]** — no reference models this category at all; the only classification present is `is_fixed_asset`. |
| J7 | **Direct supply from the job worker's premises** to a third-party customer (requiring the job worker's place as an additional place of business, or the job worker being registered). **[NOT IN CODE]** |

### 5.5 Where the reference implementations fall short

| Gap | Impact |
|---|---|
| Section 143 deadlines and deemed supply | **Total absence.** Highest-value differentiation in this whole document. |
| Loss/waste in ITC-04 | Schema defines `lwqty`/`lwuqc`; the exporter **never populates them** — despite ERPNext tracking `process_loss_qty` on the very same receipt. Wire them together. |
| `nature_of_job` | Hardcoded to the literal string `"Job Work"` with an in-code TODO ("What should this be?"). The actual job description is captured on no document. |
| Challan identity | The ERP document name doubles as the statutory challan number. **Build a first-class Delivery Challan document with its own naming series** — conflating internal naming with a statutory serial makes amendment/cancellation semantics murky. |
| FG-receipt challan number | Taken from `supplier_delivery_note`, a free-text field with **no validation, no uniqueness, no date**. If the job worker doesn't supply it, the row is unusable. |
| ITC-04 periodicity by turnover | Not implemented; the user picks a date range. |
| Waste/scrap arising at the job worker | Who may supply it and under whose registration is not modelled. **[VERIFY]** |
| Registered vs unregistered job worker | Not distinguished, though it affects waste/scrap reporting and the additional-place-of-business requirement. |
| Direct ITC-04 filing | JSON download only. |

---

## 6. PAYROLL STATUTORY

> ### ⚠️ The honest position on numbers
>
> **The references contain essentially zero Indian payroll statutory content.** frappe/hrms ships `hrms/regional/india` with exactly **three files**. What exists is: HRA exemption maths, marginal relief, a gratuity rule seed, custom fields (PAN, PF account, IFSC, MICR), a `component_type` dropdown, and three report definitions.
>
> **PF, ESI and PT amounts are whatever formula the user types into a Salary Component.** There is no rate, no ceiling, no threshold, no slab table anywhere in any reference.
>
> Consequently **this section does not state PF/ESI/PT numbers**, because doing so would mean inventing them. Every figure marked **[NOT IN CODE]** must be sourced from the governing statute and notifications by a qualified professional. Do not let a number reach the codebase without that provenance.

### 6.1 The engine shape (this part IS reusable)

Every earning/deduction is a **Salary Component** carrying an abbreviation, an optional `condition` and `formula` (or a flat amount), plus ~20 behavioural flags: tax applicable, depends on payment days, statistical, flexible benefit, accrual, exempted from income tax, variable-based-on-taxable-salary, remove-if-zero, round-to-nearest-integer, do-not-include-in-total/accounts, arrear component.

**This data-driven design is the single decision that makes an Indian payroll shippable** — PF/ESI/PT/gratuity/bonus rules differ by state, wage ceiling and company policy, and change by notification. Hardcoding components means a code release per statutory change.

**Evaluation order:** earnings → `gross_pay` injected into the context → deductions → employer contributions, in one shared mutating context so PF/ESI formulas can reference gross.

**Two passes per slip:** the Salary Structure Assignment evaluates a period-independent "full cycle" pass producing `default_amount`; the slip re-evaluates against a payment-days-prorated context producing `amount`.

**Proration:** `amount = default_amount × payment_days / total_working_days`. Skipped for Arrear / Payroll Correction / Employee Benefit Claim additional salaries and for accrual components. A structure **refuses to save** if a row's formula references a payment-days-dependent abbreviation *and* the row itself has `depends_on_payment_days` (double deduction).

> ⚠️ **Do not copy the sandbox.** The reference evaluates formulas with a real `eval` guarded by a *denylist* (string-matching unsafe attribute names plus a small AST node blocklist), and the code itself documents this as safe only for admin-authored input. In a commercial multi-tenant product, anyone with Salary Structure write permission effectively gets code execution. **Use a whitelisted-AST expression evaluator or compiled rule objects.** Security requirement, not a preference.

### 6.2 Provident Fund — [NOT IN CODE]

**What exists:** a `component_type` dropdown with values `{Provident Fund, Additional Provident Fund (voluntary PF), Provident Fund Loan, Professional Tax}`; a seeded "Provident Fund" Deduction component with `is_tax_applicable = 1`; an Employee "Provident Fund Account" free-text field (UAN/PF number, **no format validation**).

**What must be built from statute — none of these numbers exist in any reference:**

| Item | Status |
|---|---|
| Employee contribution rate | **[NOT IN CODE]** |
| Employer contribution rate | **[NOT IN CODE]** |
| Statutory wage ceiling | **[NOT IN CODE]** |
| EPS vs EPF employer split | **[NOT IN CODE]** |
| EDLI | **[NOT IN CODE]** |
| Administrative / inspection charges | **[NOT IN CODE]** |
| VPF cap | **[NOT IN CODE]** |
| International-worker and excluded-employee handling | **[NOT IN CODE]** |
| Applicability headcount trigger | **[NOT IN CODE]** |
| **ECR monthly return file** | **[NOT IN CODE]** — no generator exists |

### 6.3 ESI — [NOT IN CODE]

**The string "ESI" appears in the entire hrms repository only as an ad-hoc test-fixture component name and in one code comment.** There is no wage threshold, no employee or employer rate, no contribution-period logic, no return.

Must be built: wage threshold; employee rate; employer rate; the two fixed contribution periods; **the rule that an employee crossing the threshold mid-period stays covered until the period ends**; applicability headcount trigger; monthly contribution file. All **[NOT IN CODE]**.

### 6.4 Professional Tax — [NOT IN CODE]

**What exists:** a seeded "Professional Tax" Deduction component with `exempted_from_income_tax = 1` (so PT paid reduces taxable income before slab tax), plus the component-type label and a listing report.

**What must be built:** a **state master and state-wise slab table**; a state field on employee/company; monthly vs half-yearly vs annual filing frequency per state; the **February-differs** rule several states have; PT challans per state. All **[NOT IN CODE]**. No Indian state is named anywhere in the repository.

### 6.5 Gratuity — partially [CODE]

**Implemented [CODE]:** a configurable Gratuity Rule with `minimum_year_for_gratuity`, `total_working_days_per_year`, work-experience calculation method (`Manual` / `Round off Work Experience` / exact), `calculate_gratuity_amount_based_on` (`Current Slab` / `Sum of all previous slabs`), applicable earnings components, and slab rows `(from_year, to_year, fraction_of_applicable_earnings)`.

**India seed [CODE]:** rule "Indian Standard Gratuity Rule" — `minimum_year_for_gratuity = 5`, `Current Slab`, `Round Off Work Experience`, one open-ended slab `(0, 0)` with `fraction = 15/26`.

⇒ `gratuity = applicable_earnings × (15/26) × completed_years`, requiring 5 years' service. **[VERIFY]** — the 15/26 fraction and the 5-year minimum appear as bare data with **no statutory citation anywhere in the code**; the Payment of Gratuity Act is never referenced.

**Service computation [CODE]:** relieving date mandatory; `total_working_days = relieving_date − date_of_joining`, reduced by LWP-type `On Leave` attendance (Leave mode) or `Absent` attendance (Attendance mode); `years = days / total_working_days_per_year`.

**Four defects to fix rather than copy:**

1. **No statutory maximum cap** on the gratuity amount. **[NOT IN CODE] — [VERIFY] the current ceiling and enforce it.**
2. **No death/disability waiver** of the 5-year minimum.
3. "Round Off Work Experience" rounds 4.5 years **up to 5** and would pay someone who has not completed five years. The statutory notion (completed years, over-six-months counted as a full year) is not what the code implements.
4. The base is read from the **last submitted salary slip** ordered by start date descending, with no guard that it is recent or belongs to the correct period.

### 6.6 Income tax (TDS on salary) — engine [CODE], numbers [NOT IN CODE]

**Slab computation [CODE]:**

```
if annual_taxable_earning <= tax_relief_limit: tax = 0; stop
for each slab passing its optional condition:
    to_amount blank and income >= from  -> tax += (income - from + 1) * pct/100
    from <= income < to                 -> tax += (income - from + 1) * pct/100
    income >= to                        -> tax += (to     - from + 1) * pct/100
apply marginal relief
apply surcharge hook            # NO-OP in the reference — India surcharge NOT implemented
apply other_taxes_and_charges rows (cess), cumulatively on the running tax
```

> ⚠️ **The `+1` rupee offset in every band is a boundary hack that systematically overstates tax. Do not copy it.** Implement clean band arithmetic.
>
> ⚠️ **"Other taxes and charges" rows compound** — each applies to the *running* tax, not the base tax. Fine for a single cess row; **wrong** if surcharge and cess are both entered as rows.

**Marginal relief [CODE]:** if `tax_relief_limit < income < marginal_relief_limit` and `(income − tax_relief_limit) < tax`, reduce tax to exactly `(income − tax_relief_limit)`. Both thresholds are user-entered; **no rupee value is hardcoded anywhere.**

**Slab bands, rates, cess %, standard deduction, relief threshold: all user-entered data. [NOT IN CODE] — [VERIFY] every figure.**

**Old vs new regime [CODE that it is NOT modelled]:** grep for "regime" returns **nothing**. The pattern is one Income Tax Slab record per regime, selected via the employee's Salary Structure Assignment; the new regime is expressed by setting `allow_tax_exemption = 0`. **There is no per-employee regime election record, no lock-in, no comparison, and no rule that specific exemptions are disallowed under one regime.** Build all four.

**Annualise-and-spread algorithm [CODE] — genuinely reusable:**

```
annual_taxable =  previous periods' taxable earnings (submitted slips in the period)
                + opening taxable_earnings_till_date (mid-year joiner)
                + current period structured taxable earnings (on payment days)
                + current full-period taxable earnings × (round(remaining_sub_periods) − 1)
                + current additional earnings
                + income from other sources
                − total exemption amount
                − deductions flagged exempted_from_income_tax (prev/current/future)

total_structured_tax = slab(annual_taxable excluding full-tax additional components)
current period tax   = max( (total_structured_tax − taxes already paid this period)
                            / remaining_sub_periods , 0 )
full-tax additional earnings: add slab(total incl.) − slab(total excl.) in full this month
```

`remaining_sub_periods` for Monthly = exact month diff from slip start to `min(period end, relieving date)`.

> ⚠️ Inconsistency to resolve: the reference uses `round(remaining_sub_periods) − 1` in one place and `ceil(remaining_sub_periods) − 1` for the same concept elsewhere. Pick one.

**HRA exemption [CODE] — least of three:**

1. actual HRA received for the period;
2. annual rent paid − 10% of annual Basic;
3. 50% of annual Basic if `rented_in_metro_city`, else 40%.

Clamped at 0 if negative; monthly = annual / 12. Requires company-level `basic_component` and `hra_component` links. **[VERIFY]** — the 10/50/40 constants are hardcoded with an in-code `TODO make this configurable` and **no section is cited**. Metro is a **manual checkbox** with no city list.

**Proof-submission pro-rating [CODE]:** `factor = round(((rented_to − rented_from + 1)/30) × 2)/2` (nearest half month); monthly rent = amount / factor; eligible exemption = monthly_exemption × factor. Rent periods must be ≥15 days and must not overlap another submitted proof for the same period.

**Declaration → proof state machine [CODE]:** during the year use the **declaration** total; once `deduct_tax_for_unsubmitted_tax_exemption_proof` is set (forced in the **last period**), switch to the submitted **proof** amount — so declared-but-unproven exemptions are reversed and the tax recovered in the final slip. Standard deduction is added on top either way.

**Exemption caps [CODE]:** generic Category → Sub-Category containers each with a `max_amount`. **No Indian section limits (80C, 80D, 80CCD(1B), 24(b)) are seeded anywhere, and no aggregate 80C ceiling across sub-categories exists.** A blank sub-category max silently allows **unlimited** exemption — fix that.

**Mid-year joiners [CODE]:** `taxable_earnings_till_date` and `tax_deducted_till_date` openings on the Salary Structure Assignment.

### 6.7 Statutory payroll returns — [NOT IN CODE], all of them

| Return / form | Status |
|---|---|
| EPF ECR monthly file | **[NOT IN CODE]** |
| ESI monthly contribution file | **[NOT IN CODE]** |
| PT challans per state | **[NOT IN CODE]** |
| Form 24Q (quarterly TDS on salary) | **[NOT IN CODE]** |
| Form 16 Part A / Part B | **[NOT IN CODE]** |
| Form 12BB | **[NOT IN CODE]** |
| Form 3A / 6A | **[NOT IN CODE]** |
| Challan (ITNS-281) tracking, BSR code, deposit due date, late-deposit interest | **[NOT IN CODE]** |
| Labour Welfare Fund | **[NOT IN CODE]** — no doctype, field, component or mention anywhere |
| Statutory Bonus (eligibility ceiling, %, set-on/set-off) | **[NOT IN CODE]** — bonus is only an ad-hoc Additional Salary |
| Minimum Wages floor validation | **[NOT IN CODE]** |
| Statutory registers (muster roll, wage register) | **[NOT IN CODE]** |

**There are zero government API integrations in the payroll module** — no EPFO, no ESIC, no TRACES, no PAN/UAN validation. The only file outputs are bank remittance / ECS spreadsheets, which are banking, not statutory.

**An SME cannot legally close a month without these.** Large, well-defined build.

### 6.8 Direct-tax withholding on purchases (TDS/TCS)

**What exists [CODE]:** a versioned rate table keyed on `(category, statutory section, deductee entity type, effective date window)`, with `entity_type ∈ {Individual, Company, Company Assessee, No PAN / Invalid PAN}`, `round_off_tax_amount`, `tax_on_excess_amount`, and rate rows carrying `from_date, to_date, rate, single_threshold, cumulative_threshold`.

**Dual threshold model [CODE]:** `single_threshold` (per-transaction) and `cumulative_threshold` (annual, per payee). Where they differ, a running per-payee annual accumulator is required. `tax_on_excess_amount = 1` means tax applies **only to the amount exceeding the threshold**.

**No-PAN penal rate [CODE]:** modelled as a **separate `entity_type`, not a multiplier** — a per-section lookup value, not a "higher of 20% or twice the rate" formula.

**PAN-level aggregation [CODE] — the most important rule here:** the party tax identifier is overridden to return the **PAN**, so threshold accumulation and lower-deduction certificates aggregate across **all party records sharing a PAN**, not per party record. Verified by tests: two suppliers with one PAN pool their invoice values against the cumulative threshold; an LDC issued to supplier A applies to supplier B on the same PAN. **Getting this wrong under-deducts tax and creates interest/penalty exposure for the customer.**

**Lower Deduction Certificate [CODE]:** `(company, supplier, certificate_no, category, fiscal_year, valid_from, valid_upto, rate, certificate_limit)`. Utilisation = sum of `taxable_amount` on submitted withholding entries against that certificate; the reduced rate applies only up to the unutilised balance. Assumption baked in: only one LDC per category valid at a time.

**PAN validation [CODE]:** regex `^[A-Z]{5}[0-9]{4}[A-Z]{1}$`, uppercased and stripped. Derived from `gstin[2:12]` when a GSTIN exists, **overwriting any user-entered PAN** and making the field read-only. **No checksum, no government verification.** Odoo does validate a PAN checksum and maps the 4th character to an entity type (`c` Company, `p` Individual, `h` HUF, `f` Firm, …) — do that.

> ### ⚠️ Major [VERIFY] on the whole withholding rate table
>
> The reference's current data file has been **fully migrated to Income-tax Act 2025 / IT Rules 2026 section numbering** (sections 392/393/394, 4-digit return codes 1001–1092) **effective 2026-04-01**, with the old 194-series retained in a separate legacy file. Odoo ships **both schedules simultaneously with no effective-date field on either.**
>
> **Neither the renumbering nor the 2026-27 rate rows can be assumed operative.** Treat section numbering itself as **versioned, effective-dated data** — it is not a constant.

**Known data defects in the reference — do not copy:** setup creates only rate rows whose `to_date >= today`, so installing after the file's expiry creates **nothing**, and installing today omits all historical rates (back-dated transactions cannot be computed). Rate rows are non-overlapping single-year windows with **no fallback and no validation that a category has a row covering the transaction date** — a gap means **silent zero deduction**. Several legacy rows look like outright data errors (a 0% rate with 0 thresholds; a ₹1 threshold).

**Absent [NOT IN CODE]:** Form 26Q/27Q/27EQ/24Q generation; FVU export; Form 16/16A; TRACES; challan generation and deposit-due-date tracking; **194Q vs 206C(1H) mutual exclusion** (the two live as unrelated rate rows with nothing preventing both applying); **turnover-based applicability** (the preceding-year turnover test determining whether the deductor is liable at all); 206AB non-filer higher rates; 15G/15H; DTAA; 15CA/15CB; salary TDS under the new section codes; **all TCS rates including scrap (code 1073), which is directly relevant to manufacturers.**

---

## 7. AUDIT TRAIL

> **This constrains the core data layer. It cannot be retrofitted. Build it into the schema on day one.**

### 7.1 The mandate

The reference implements this as MCA Notification dated **24-03-2021** (the field's own help text carries the e-gazette URL) — the edit-log requirement for accounting software used by companies, i.e. the Rule 11(g) audit-trail mandate. **[CODE]** for the notification reference; **[VERIFY]** the current text and any subsequent amendments.

**Shipping an ERP to Indian companies without this exposes the customer's auditor to a qualified report. It is a sales blocker, not a feature.**

### 7.2 Requirement 1 — the switch is one-way, enforced server-side

A single tenant-level boolean. Server-side validation: **if the value changed and the new value is falsy, hard error — "Audit Trail cannot be disabled once enabled."** Client-side the control becomes read-only once set.

Model this as a **monotonic, irreversible tenant flag with a server-enforced one-way transition.** Add a first-login nudge for tenants who have not yet enabled it, cleared automatically once enabled.

### 7.3 Requirement 2 — scope: every GL- or stock-affecting document, plus the config record itself

The reference force-enables change tracking on 24 document types, on enable and on **every migration**:

| Group | Documents |
|---|---|
| The config itself | Accounts Settings (so the act of enabling/altering the audit trail is itself logged) |
| Ledger-affecting | Dunning, Invoice Discounting, Journal Entry, Payment Entry, Period Closing Voucher, Process Deferred Accounting, Purchase Invoice, Sales Invoice, Asset, Asset Capitalization, Asset Repair, Delivery Note, Landed Cost Voucher, Purchase Receipt, **Stock Entry**, **Stock Reconciliation**, **Subcontracting Receipt** |
| Books of account | Asset Depreciation Schedule, POS Invoice, Cost Center Allocation, Exchange Rate Revaluation, Asset Value Adjustment |
| Import duty | Bill of Entry |

**Rule for us: every document that produces or alters a general-ledger or stock-ledger effect, plus the audit-trail configuration record itself.** Note for manufacturers specifically that **Stock Entry, Stock Reconciliation, Subcontracting Receipt and Landed Cost Voucher are in scope** — production and job-work movements, not just invoices.

### 7.4 Requirement 3 — three independent tamper locks

| Lock | Specification |
|---|---|
| **Configuration lock** | Any attempt to set change-tracking to 0 for an in-scope document type — via UI, or by creating/editing/**deleting** the underlying property record — must throw. The check must inspect **both the new and the pre-save state**, so a document type cannot be swapped out of protection. Only creations that set the value to 1 pass. |
| **Log immutability** | Change-log records referencing an in-scope document type cannot be modified or deleted. Again check **both current and pre-save reference**, so the reference field cannot be rewritten to escape the check. |
| **Data-retention lock** | Any "delete linked ledger entries" / purge feature must be forced off when the audit trail is on, and can never be re-enabled. |

Guards are bypassed only during install and migrate.

### 7.5 Requirement 4 — what our log must capture

The reference's report surfaces only: timestamp, document type, document name, creation date, party type/name, amount, created-by, modified-by, remarks. **That is an activity summary, not an audit trail.**

**Our minimum, from day one:**

| Field | Note |
|---|---|
| **Who** | User id (and impersonation / API-key identity if applicable) |
| **When** | Timestamp with timezone |
| **What document** | Type + immutable identifier |
| **What changed** | **Field-level before → after deltas, including child-table rows.** The reference captures none of this in its report. |
| **Action class** | create / modify / submit / cancel / amend / delete-attempt |
| **Tenant / company stamp on every row** | The reference's version log carries **no company stamp**, so it explicitly **drops the company filter** for modification counts and a multi-company report cannot segregate them. Close this. |
| **One row per change event** | The reference's detailed view keys on last-modified timestamp and returns **one row per document**, so multiple edits within a window collapse into a single row and the actual before/after values are never shown. |

**Reporting views required:** detailed (per change event), summary by document type (new vs modified counts), summary by user. Filters: company (mandatory), date window (mandatory), optional user, optional document type.

### 7.6 Requirement 5 — push immutability into the storage layer

The reference's enforcement is **application-layer validation hooks**: anything writing directly to the database — and explicitly anything running during install or migrate — **bypasses every guard.** There is no hashing, no chaining, no tamper-evidence.

For a commercial product:

- append-only tables with `UPDATE` / `DELETE` grants revoked at the database role level;
- hash chaining (each row carries the hash of its predecessor) so tampering is **detectable**, not merely blocked;
- deletions **logged**, not silently blocked;
- an explicit retention-period policy;
- an export of the log in a fixed format for the auditor.

Also worth capturing, none of which the reference does: login/logout, permission changes, and read/view access to sensitive records.

**Related [CODE]:** Odoo makes posted Indian invoices undeletable outright (`_can_be_unlinked` returns False for any posted Indian move — reversal only) and force-enables a restrictive audit trail for any Indian company that already has accounting entries. Adopt both.

---

## 8. GAPS — RANKED BY HOW MUCH AN INDIAN MANUFACTURER ACTUALLY CARES

Things **none** of the four references implement. This is where a commercial product differentiates. Ranked by real customer pain, not implementation difficulty.

| # | Gap | Why the manufacturer cares | Difficulty |
|---|---|---|---|
| **1** | **Section 143 job-work deadline tracking and deemed supply** — open-challan register with ageing, quantity-level FIFO matching, alerts, auto-invoice on expiry | **Total absence everywhere.** A manufacturer who sends material out and loses track faces a deemed supply with interest, discovered at assessment years later. Every job-work-heavy SME has this problem and no software solves it. | Medium |
| **2** | **PF / ESI / PT statutory content** — rates, ceilings, state slabs, and the ECR / ESI / PT return files | Zero implementation anywhere. Every manufacturer with staff needs this monthly and currently uses a separate consultant or spreadsheet. Bundling it is a category-level differentiator. | High (breadth, not depth) |
| **3** | **Turnover-based applicability engine** — compute aggregate turnover and derive e-invoice applicability, HSN digit requirement, GSTR-1 frequency, ITC-04 periodicity automatically | Every reference makes the operator enter a date or a digit manually and get it wrong silently. An ERP that *knows* when e-invoicing became mandatory for you is materially safer. | Medium |
| **4** | **Rule 37 / 180-day payment ITC reversal** | Grep for `180` across india-compliance returns only e-way-bill error text and HSN data. No ageing of unpaid supplier invoices, no automatic reversal, no reclaim on payment. A routine assessment finding. | Medium |
| **5** | **Effective-dated statutory rule store with audit** — every threshold, rate, slab, code list, port code, UQC, pincode band as versioned data with validity periods, not constants | The references' *biggest* architectural failure. The B2CL threshold is the only date-versioned rule in Odoo and it is an inline literal; india-compliance uses a 2099 sentinel so every change is a code change. Ship a maintained rule feed and this becomes a recurring-revenue moat. | Medium |
| **6** | **Interest and late-fee computation** (GSTR-3B table 5.1) | Entirely absent — no rate, no computation, no field, no Excel row. SMEs file late routinely and compute interest by hand. | Low |
| **7** | **194Q vs 206C(1H) mutual exclusion** | The two live as unrelated rate rows; nothing prevents both applying to one transaction and nothing exchanges buyer/seller declarations. Causes real double-deduction disputes with customers. | Low |
| **8** | **MSME / Section 43B(h) 45-day payment discipline** | Vendor MSME/Udyam classification, 15/45-day due-date derivation, and the disallowance report are **absent everywhere** ("MSME No." exists only as a print-header label). A live income-tax exposure manufacturers are actively worried about. | Low–Medium |
| **9** | **Dynamic QR code on B2C invoices** | Absent everywhere. The only QR generators are the IRP-signed QR echoed back for B2B and an e-way-bill QR; the e-invoice code explicitly refuses B2C. | Low |
| **10** | **Cash / credit / liability ledger modelling and set-off order (IGST→CGST→SGST)** | No ledger modelling, no set-off, no challan or payment tracking anywhere. The 3B output stops at declared figures. | Medium |
| **11** | **Rules 42 & 43 proportional reversal** | Exists only as a **label** on a reversal row — no formula, no turnover ratio, no D1/D2/C2. The user computes it by hand and books a Journal Entry. | Medium |
| **12** | **Proper e-way-bill lifecycle** — Part-B updates, transporter change, validity extension, multi-vehicle / transhipment, consolidated e-way bill, expiry monitoring | Odoo has **none** of it (once generated, immutable except cancel); india-compliance has Part-B and extension but no consolidated bill and no multi-vehicle. In real freight the vehicle changes mid-transit. | Medium |
| **13** | **Signature verification on the government-signed JWT** | Both references decode with verification **disabled**; in Odoo the JWT library is an optional import, so verification is silently skipped entirely if absent. The stored "signed invoice" is the defensible artefact. | Low |
| **14** | **Composition scheme for the company's own outward supplies** (CMP-08 / GSTR-4) | Composition exists only as a *counterparty* attribute that blocks ITC. Not every target customer is composition, but some are. | Low |
| **15** | **Cess "higher of ad-valorem or specific" formula** | Encoded only in the tax's **display name** ("CESS 21% or 4.170"), which is not computable. Anyone copying that structure silently computes the wrong cess. | Low |
| **16** | **GSTR-9 / 9C annual return** | Absent entirely. Annual, so lower urgency than monthly — but every registered business needs it once a year. | High |
| **17** | **Place-of-supply special rules for services** (immovable property, transportation, events, telecom, OIDAR) | PoS derived purely from address geography, which is wrong for several service categories. Lower priority for a pure goods manufacturer. | Medium |
| **18** | **Bill-to / Ship-to as an explicit deeming rule** | Approximated by shipping-partner precedence; the statutory deeming provision is not modelled. | Low |
| **19** | **ISD credit distribution (GSTR-6)** | ISD is only a category label and an ITC classification. Only matters for multi-location groups. | Medium |
| **20** | **RoDTEP / duty drawback / EPCG / advance authorisation / high-seas sales as a document type / Form 15CA-CB** | Zero hits anywhere. Only matters for exporters — but for those it matters a great deal. | High |

---

## 9. BUILD IMPLICATIONS

What the above forces in the core architecture. These are constraints on the foundation, not features.

### 9.1 Immutable, append-only audit log at the storage layer

Section 7 is not an application feature. It requires:

- append-only change tables with `UPDATE` / `DELETE` revoked at the DB role level;
- hash chaining for tamper-evidence;
- **a tenant/company stamp on every log row** (the reference's omission permanently breaks multi-company reporting);
- **field-level before/after deltas including child rows**, captured by the ORM/persistence layer, not by individual document handlers;
- one row per change **event**, not per document;
- a monotonic, server-enforced one-way tenant flag.

**This cannot be added later.** Retrofitting field-level deltas onto an existing write path means rewriting every write path.

### 9.2 Document numbering with statutory series and no gaps

- Series defined per (company GSTIN, document type, financial year).
- Format constraint enforced at **series-design time**, not at submission: **≤16 characters, alphanumeric start, only `-` and `/` thereafter.** Retrofitting after customers have live series is painful.
- **No gaps.** Cancelled documents must remain in the series as cancelled, not vanish. The GSTR-1 Document Issued table reports issued / cancelled / draft / net counts per contiguous series, and gaps are an audit finding.
- Series must be a **first-class tracked field on the document**, not inferred from the name. The reference infers contiguous series by heuristic string arithmetic and documents two false-positive classes (gaps that are multiples of 10; identical serials in different months).
- **A first-class Delivery Challan document with its own naming series**, separate from internal stock-document naming.
- Financial year = 1 April – 31 March, everywhere.

### 9.3 State-aware tax engine

- **State is the 2-digit code, not a name.** It is the join key for GSTIN parsing, place of supply, e-way bill payloads and every report. Include the synthetic codes 96 and 97 as real state records.
- **One explicit, unit-testable predicate `is_inter_state(pos_state, source_state, counterparty_category)`.** Odoo launders this through a fake in-memory partner fed to a generic fiscal-position matcher — it works, but the actual rule is invisible and untestable. Make it a function.
- **Tax character (`igst`/`cgst`/`sgst`/`cess`) must be stored as authoritative data on the tax record, and tags derived from it — not the reverse.** Odoo computes the GST character *from* the repartition tags, so a user editing tags silently changes a tax's identity, and the HSN summary and GSTR bucketing follow. A correctness trap.
- **GSTR section classification stored per line at post time**, not computed at report time. Deferring it to report-time queries is the single most common source of filing mismatches.
- Round **per line**, not per document.
- Per-GSTIN scoping on every query, from the first schema migration.

### 9.4 Effective-dated statutory rule store

Every one of the following must be **data with a validity period**, never a constant in code:

thresholds (B2CL, e-way bill by state, RCM, TDS/TCS single and cumulative) · GST rate slabs · TDS/TCS **section numbering itself** · income-tax slabs, cess, relief and marginal-relief limits · PF/ESI/PT rates and ceilings · gratuity fraction and cap · HSN digit requirement · UQC list · port codes · country codes · pincode-to-state bands · permitted GST rates · 2B availability date · ITC claim deadline.

Requirements: validity windows with **no gaps and no silent fallback** (a missing rule must **error**, never compute zero); historical rows never mutated (append only); back-dated transactions compute from the rule in force on their posting date; a version stamp recorded on every computed document so you can prove which rule produced a given number.

### 9.5 Asynchronous government-API layer

A separate service, not inline in request handlers:

- durable job queue with per-document jobs, attempt counter, backoff, dead-letter;
- **query-back idempotency** as a first-class pattern, with verification before adopting a recovered number;
- three-class error triage (permanent / transient / quota-outage) driven by a versioned error-code table, never by string matching;
- commit boundary immediately after persisting the government number;
- a periodic reconciliation sweep against the portal for stuck documents;
- request/response persistence as the audit artefact, with secrets masked;
- a submission log independent of the document (attempt, timestamp, endpoint, request hash, response code, latency);
- sandbox flag stamped on every artefact;
- timeouts on every call; never hold a DB lock across one;
- vaulted credentials, per GSTIN, per service.

**Deployment constraint:** GST return filing binds the session to the caller's public IP. **The production egress IP must be stable and allow-listed**, and filing requires a human OTP per session. Plan the network topology now.

### 9.6 Data-model constraints that fall out of the above

- **Item:** HSN (independently editable on the transaction line, **not** copied on duplicate), UQC on UoM, `is_ineligible_for_itc`, fixed-asset flag (drives ITC-04 goods type).
- **Party:** GSTIN, GST category, PAN as a **shared entity** (threshold aggregation crosses party records), MSME/Udyam classification.
- **Address:** GSTIN, GST category, state, state code, pincode — the **authoritative** source of GSTIN and category for a transaction. Note the reference copies category onto the transaction at validate and only partially re-syncs after submit, so a recategorised party leaves historical documents inconsistent. Snapshot deliberately.
- **Transaction header:** company GSTIN, counterparty GSTIN, GST category, place of supply, RCM flag, export-with-payment flag, e-commerce GSTIN, IRN, e-way bill, statuses, ITC classification, ineligibility reason, ITC claim period, reconciliation status.
- **Transaction line:** HSN, `gst_treatment`, taxable value, per-tax rate **and** amount columns, ineligible-ITC flag, GSTR section.
- **Warehouse/dispatch address as a party distinct from the registered office** — a manufacturer's factory is rarely its registered address and both must print.
- **Stock moves must carry a taxable value and applicable taxes even with no invoice** — goods movement itself triggers the e-way-bill obligation, and job-work challans need a declared value.

---

## 10. OPEN QUESTIONS FOR THE OWNER

Ordered by how much each blocks the build.

| # | Question | Why it blocks | Recommendation |
|---|---|---|---|
| 1 | **Is return FILING in scope, or preparation only?** | Filing means a GSP contract, OTP-per-session UX, a static allow-listed egress IP, EVC handling, async reference-id polling, and liability if a filing fails. Preparation-only means we produce JSON/Excel and the CA files. This changes network topology, ops model and support burden. | **V1: preparation + 2B download + reconciliation. V2: filing.** Filing is where the OTP/IP constraints bite and it is not what wins the first deal. |
| 2 | **Which GSP?** | Everything routes through one. Determines the auth model (standard NIC crypto vs enriched), sandbox availability, error-code surface, credit metering, and whether e-invoice, e-way bill, returns and 2B all come from one vendor. Both references use a single ASP gateway with an API key. | Pick **one GSP covering e-invoice + e-way bill + returns + 2B**, but abstract behind an internal interface so a second can be added. Require a sandbox before signing. Negotiate 429 / credit-exhaustion behaviour explicitly. |
| 3 | **Do we build our own NIC "standard mode" crypto, or use the GSP's "enriched" mode?** | Standard mode means implementing RSA-encrypted auth, AES session encryption, Sek/Rek handling and HMAC verification ourselves. Enriched means the GSP does it and sees our payloads. | Start **enriched**; keep standard mode as a roadmap item for customers with data-residency objections. |
| 4 | **Who owns the statutory rule table, and how is it updated?** | §9.4 requires a maintained, versioned rule feed. Either an internal compliance function with a CA on retainer, or a purchased feed. An ongoing operating cost, not a one-time build. | **Internal, with a CA on retainer, delivered as signed data updates.** Also a recurring-revenue moat (gap #5). |
| 5 | **Which payroll statutes are in v1?** | §6 shows PF/ESI/PT are a from-scratch build with zero reference content. All three plus returns is a large workstream; none makes the product incomplete for any manufacturer with staff. | **V1: component engine + income tax + gratuity + PF. V2: ESI + PT (state by state, driven by where customers actually are). V3: statutory returns.** |
| 6 | **Which states do we support for Professional Tax, and in what order?** | PT is state-by-state with different slabs, frequencies and a February special case. Supporting all is a long tail. | Ship the **state master + slab engine** in v1; populate states on customer demand. |
| 7 | **Do we support exporters in v1?** | Export/SEZ pulls in LUT validity tracking (**not implemented anywhere** — the references treat "LUT No." as a print-header string or a boolean tax flag), shipping bills, port codes, foreign currency, and the four with/without-payment regimes. RoDTEP/drawback/EPCG are absent everywhere. | **Yes to the four export/SEZ regimes and LUT tracking; no to RoDTEP/drawback/EPCG in v1.** Export-under-LUT is common enough among manufacturers to be table stakes. |
| 8 | **B2CS vs CDNUR for small unregistered notes** | The reference's predicate chain puts them in B2CS by not excluding notes, unlike every other predicate. Not stated in code whether intended. | **Get a CA ruling before writing the classifier.** A wrong classification here misstates the return every month. |
| 9 | **B2CL threshold effective date: 2024-08-01 or 2024-11-01?** | The two references disagree and neither cites a notification. | **Verify against the notification.** Then encode as effective-dated data (§9.4) so the answer stops mattering. |
| 10 | **Is the Income-tax Act 2025 renumbering (sections 392/393/394, effective 2026-04-01) operative?** | The whole TDS/TCS section catalogue depends on it. One reference has migrated fully; the other ships both schedules with no effective date. | **Verify.** Then support **both** schedules with a dated changeover — the dual-catalogue requirement is real either way, because back-dated documents must use the old numbering. |
| 11 | **Do we implement turnover computation ourselves (gap #3)?** | No reference does. Requires an aggregate-turnover definition across GSTINs and a prior-FY evaluation. Unlocks four separate applicability decisions. | **Yes — v1.5.** High value, medium effort, nobody else has it. |
| 12 | **GSTR-3B period basis: posting date, or ITC claim period for the inward half?** | The reference computes outward always on posting date and inward optionally on claim period, so the two halves of one return can sit on different bases. | **Make it an explicit, documented, per-company setting with a clear default** — not an accident. |
| 13 | **Immutability of a filed return** | GSTR-1 has an `is_latest_data` flag and stored filed JSON; **3B has neither** and can be silently regenerated after filing. | **Snapshot and lock both** on filing. Regeneration produces a new version, never overwrites. |
| 14 | **Formula sandbox for payroll components** | The reference uses `eval` with a denylist and documents it as admin-only-safe. In a multi-tenant SaaS this is remote code execution. | **Whitelisted-AST evaluator or compiled rule objects. Non-negotiable.** |
| 15 | **Deployment model — SaaS multi-tenant, or per-customer?** | Drives the audit-log storage design, the GSP credential model (one key for us vs one per customer), the egress-IP constraint for filing, and the blast radius of the formula sandbox. | Answer **before** the audit-log schema is written, since §9.1 depends on the tenant model. |

---

### Provenance note

All rules above derive from reading four reference codebases: `frappe/india-compliance`, `frappe/erpnext`, `frappe/hrms`, and Odoo 19 `l10n_in*` addons. All four are GPL; per the project's MVP target this work is **clean-room** — the references are read for *requirements only*, and no code, data files, or structure may be copied. Statutory citations appear above **only where a section number or notification is literally present as a string in the source**; everywhere else the code cites nothing and the rule is marked for verification.

**Every threshold, rate, date and code list in this document reflects what those codebases implemented as of the date they were read. Indian GST and income-tax rules change frequently. Re-verify each against current law before implementing.**
