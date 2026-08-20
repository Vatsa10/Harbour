# PHASE 7 — MARKET RESEARCH

**Status: partial. Read the evidence-quality warning before reading anything else.**

Companion to PHASE1–PHASE6 (code scout) and ERP-MVP-PLAN.md (revision 3). Where this report contradicts the plan, it says so and names the section. Where it cannot contradict the plan because no evidence was gathered, it says that too — and that is the majority of this document.

---

## 0. EVIDENCE QUALITY — READ FIRST

Twelve research passes were run. **Nine of twelve terminated early** because the session's web-search budget was exhausted, in several cases after one or two queries. Every one of those nine was then fact-checked against the live pages it cited. The audits changed the picture materially.

### 0.1 What the audits found

| Audit verdict | Passes | Meaning |
|---|---|---|
| trustworthy | 2 | Job-work / Section 143 statutory mechanics; global ERP failure statistics (honest failed pass) |
| partly-inflated | 8 | Real URLs, but numbers or quotes attached to pages that do not contain them |
| unreliable | 2 | GST compliance pass (6 of 8 citations do not support their claims); one empty stub |

The dominant failure mode was **not invented URLs**. Almost every cited page exists and is on-topic. The failure was **source-to-claim mismatch**: precise-looking figures and quotation-marked strings attached to pages that do not carry them. That is the more dangerous failure, because the reports' own hedging ("search-summarized", "not independently verified") reads as discipline and causes a reader to trust the unhedged items.

### 0.2 Claims deleted from this report as fabricated or untraceable

These appeared in the raw research and are **struck**. None of them may appear in any downstream document, pitch deck, or financial model.

| Struck claim | Why |
|---|---|
| "Tally holds 75–80% of the Indian SME accounting market" (attributed to Gartner India 2024) | The quote exists on an SEO blog that cites no Gartner document. The 80% figure traces to nothing at all. Tally's dominance is real and can be asserted qualitatively; **no percentage may be stated.** |
| "SMEs are 65% of the India accounting software market" | Cited source is paywalled, global-scope, and redacts the SME share as "xx%". |
| "Tally retains its base through its CA ecosystem" | The cited market report does not contain the phrase or the claim. This was the *only* evidence for the CA-lock-in hypothesis. It has none. |
| ERPNext manufacturing implementation "₹6–15 lakh" | Neither cited source contains this figure. The verified range stops at ₹5 L. |
| "ERP projects don't fail on go-live day. They fail quietly — three months later" (tabsyst) | Page exists; quote is not on it. |
| E-invoice threshold cut to ₹2 Cr effective Oct 2025 | Not on any of the three cited blogs; two explicitly say the opposite. |
| "30% of businesses received ITC-mismatch notices in 2025 audits" | Not present on the page it is sourced to. Origin unknown. |
| myBillBook "₹399/year Silver plan" | Not on any resolvable page. Actual Silver is ₹199/month. |
| Zoho Books Professional ₹1,499 / Premium ₹2,999 / Ultimate ₹9,999 per month | Annual-billing effective rates presented as monthly list rates; Ultimate matches no Zoho figure. Corrected in §2. |
| TallyPrime Server TSS ₹27,000/yr | Cited source says ₹54,000. |
| Tally.ERP 9 ₹3,600 / ₹10,800 annual | Not on either cited source. |
| Vyapar total funding ~$129.9M | Both accessible sources say ~$35 M. Likely confusion with the $117.71 M valuation. |
| Udyam 4.77 crore / 31% manufacturing / 97% under ₹50 L / 79.54% proprietary | Snippet-only; the government dashboard cited is connection-refused and was never read. Directionally plausible, **not quotable**. |

### 0.3 What was never researched at all

Entire question areas returned zero results. These are **coverage gaps, not findings of absence**:

- **Why Indian SMEs stay on Tally, and what frustrates them.** The incumbent this product must beat. Zero user voice obtained. Zero pricing-sensitivity data. Zero migration-away stories. The CA-influence hypothesis is completely untested.
- **How Indian manufacturing SMEs buy software** — decision-maker, evaluation process, dealer channel, willingness to pay, subscription-vs-perpetual preference, cloud-vs-on-prem trust.
- **Unit economics** — ACV, CAC, churn, collections, annual-upfront norms. Nothing.
- **Competitor coverage** — Marg ERP, BUSY, Khatabook, Odoo India partners, SAP Business One India, Focus, Giddh, ClearTax: all queried, all returned nothing.
- **Market sizing in the target band** — no count of enterprises at ₹5–50 Cr turnover; no cluster geography; no employee-count distribution; no ERP-adoption/digitisation rate.
- **Vernacular / mobile / WhatsApp behaviour** among Indian SME owners — zero evidence, which directly undercuts §3's ability to define "simple".
- **Reddit and any Indian-language forum content.** Repeated targeted searches surfaced none.

### 0.4 The structural bias in what did survive

**Every real user voice in this report is about ERPNext, and almost none of it is from an Indian manufacturing SME owner.** The verified quotes come from the Frappe forum (developers, implementers, partners) and Capterra (global reviewers: a CEO in software, a retail user, one manufacturing user, an IT-services president, a real-estate user). That is the population that writes reviews — not the ₹5–50 Cr fabrication-shop owner the plan targets.

So §1 below is honestly titled: it is what *ERPNext's users* complain about. It is a proxy for the target buyer, not a measurement of them. Treat it accordingly.

**Overall confidence in this report: LOW-MEDIUM.** The ERPNext complaint pattern and the Section 143 statutory mechanics are solid. Almost everything commercial — price, buyer, channel, demand — is not evidenced.

---

## 1. WHAT USERS ACTUALLY COMPLAIN ABOUT

Ranked by frequency across independent sources, recency, and how load-bearing the complaint is for a switching decision. Caveat from §0.4 applies to the whole section: this is ERPNext's user base, not the target segment.

### Rank 1 — Setup, deployment and onboarding require developer-level knowledge
**Strength: CORROBORATED (first-party forum + two review sites, 2019–2026, verified verbatim)**

The most consistent complaint in the entire evidence set, and the only one that appears across seven years and three independent platforms.

- Frappe's own forum, 14 Mar 2026: a thread titled *"The onboarding & deployment experience of Frappe/ERPNext is unnecessarily confusing for new users"* — user **BetterLuke** describes a deep dependency chain and no conceptual clarity around Site / App / Bench / Frappe. User **brian_pond** replies the same day: *"I remember experiencing all of these pain points when I started my ERPNext journey."* [VERIFIED — quote confirmed on page] — https://discuss.frappe.io/t/the-onboarding-deployment-experience-of-frappe-erpnext-is-unnecessarily-confusing-for-new-users/161474
- Capterra, **Marco S.** (Retail, Jan 2024): installation *"must have a very good knowledge of linux"* [VERIFIED — near-verbatim confirmed] — https://www.capterra.com/p/164441/ERPNext/reviews/
- Capterra, **Graeme H.** (Manufacturing, Sept 2022): *"quite a steep learning curve for setting up the system."* [VERIFIED — reviewer real]
- Capterra, **Martin S.** (CEO, Computer Software, Jul 2019): *"ERPNext is not yet easy and straight forward to use... really made for experts."* [VERIFIED — reviewer real, but 2019 and dated]

**Why it ranks first:** it is corroborated on the vendor's own forum by experienced contributors, not only by frustrated evaluators, and it has not been fixed across seven years and multiple major versions.

**What it does and does not mean for this plan.** It means the *self-serve or lightly-assisted setup path* is a real, persistent, unfixed weakness in the free competitor. It does **not** mean the target buyer feels it — an Indian SME buying ERPNext buys it through a partner who absorbs exactly this pain. The complaint is loudest in the population that self-installs. §8.4 answer 10 already exploits this correctly ("free the way a puppy is free"); it can now cite a specific dated quote instead of a price estimate.

### Rank 2 — Daily navigation loses the user's place, still unresolved in v16
**Strength: CORROBORATED (three named users, one thread, Nov 2025, verified)**

- **jewel71** (18 Nov 2025): *"the navigation between modules and doctypes feels confusing... I also often lose track of where I started."*
- **Bas_de_Reus** (18–19 Nov 2025): navigation *"feels a bit cumbersome"*; workspace switches on opening a linked item *"with no visual reference back."*
- **nextgen** (24 Nov 2025): requests reverting to v15 navigation; the new design *"forces users to make too many clicks."*
- Counter-evidence in the same thread: jewel71 also says *"UI and performance improvements are impressive."*

[VERIFIED — quotes and dates confirmed on page] — https://discuss.frappe.io/t/erpnext-16-beta-version-navigation-between-modules-feels-confusing/156969

**Why this ranks high:** it is recent (Nov 2025), it is about the *newest* version, and it is about daily use rather than first-day setup. A shop-floor or gate operator who "loses track of where they started" does not use the system — they call the accounts person. This is the single strongest piece of evidence for the plan's §8.2 W3 argument that ERPNext's generic form engine cannot render operational task UIs.

### Rank 3 — Customisation breaks on upgrade
**Strength: SINGLE-SOURCE (one Frappe forum thread, Feb 2026 — the research overstated this as "multiple")**

Server-side / core-file modifications are reported as being overwritten by version upgrades; client-side customisation (custom fields, client scripts, print formats) is described as safer. Source: https://discuss.frappe.io/t/safe-way-to-upgrade-erpnext-when-core-files-are-modified/160782 [VERIFIED page exists and says this; it is one question-and-one-answer thread, not a pattern]

The research pass claimed "multiple anecdotes"; the audit found one thread. **Downgrade accordingly.** The claim is directionally uncontroversial for any codebase, but it is not evidenced as a widespread user complaint.

Note that a quote used to support this — *"there are never any major upgrades completed without issue"* — was attributed vaguely to "an admin guide" with no URL. **Struck.**

### Rank 4 — GST and e-invoicing bugs in the India Compliance layer
**Strength: CORROBORATED (forum + GitHub issue, both verified, 2026)**

- Frappe forum, **CA_akshad**, May 2026: *"GST Compliance – Invoice Management System does not fetch all invoices from GST portal"* — https://discuss.frappe.io/t/gst-compliance-invoice-management-system-does-not-fetch-all-invoices-from-gst-portal/162608 [VERIFIED]
- GitHub **frappe/erpnext#47509**, "GST mismatch in invoices" — exempted-item tax templates still populating a 9% tax amount. [VERIFIED] **Important detail the research omitted: the issue was closed as "not planned."** — https://github.com/frappe/erpnext/issues/47509
- E-invoice IRN validation errors thread — https://discuss.frappe.io/t/e-invoicing-gst-validation-error/72932

**Why the "closed as not planned" matters.** It is the concrete instance of the plan's §8.1 argument that a free project cannot fund a compliance function. A GST correctness defect, reported with a reproduction, closed without a fix. That is a sellable sentence in a first call, and it is a verifiable one.

### Rank 5 — Support responsiveness
**Strength: DATED — all located evidence is 2019–2023; no 2024–2026 instance found**

Capterra reviewers **Conn C.** (Sept 2022, *"bug fixes that languished... with little response from product owners"*), **Sayed A.** (Apr 2023, *"customer support isn't great and... server keeps crashing"*), **Laxman T.** (Aug 2020). [VERIFIED reviewers real]

**Do not use this in positioning.** Every instance is at least three years old and no current instance was found. It is historically documented, not confirmed current.

### The counter-evidence, stated at equal weight

The complaint list above is not the whole picture and a report that omitted this would be misleading.

- Long-tenure users report satisfaction: *"We have been using ERPNext for ten years now and have no complaints... especially when compared to SAP implementations"*; *"I love using ERPNext and recommend it to any discrete manufacturing company."* [UNVERIFIED — search-snippet only; G2 returns 403 to direct fetch. Reviewer names and dates could not be confirmed.]
- Capterra reviewers also praise the UI: *"easy to use when you know what is where"*, the interface is *"very appealing and inline with present best practices in UI/UX."* [VERIFIED — on the Capterra page]
- G2 ~4.2–4.3/5 across ~48–50 reviews; TrustRadius ~8.6/10. [UNVERIFIED — both platforms 403 to fetch; snippet-derived. **Do not cite these numbers externally.**]

**The honest synthesis: the user base is bimodal, split by time-invested-to-competence.** People who get past the first thirty days — usually via a partner — become advocates and rate it well against SAP. People expecting SaaS-simple self-service find it genuinely hard. The complaints are concentrated in *first impressions and daily navigation*, not in the ceiling of capability.

That distinction is load-bearing for §3.

### What is conspicuously absent from the evidence

- **Zero complaints about Tally**, from anyone, anywhere in this research. The incumbent's weaknesses are entirely unmeasured.
- **Zero Indian manufacturing SME owner voices.** Not one.
- **Zero evidence that anyone switched ERP because of simplicity**, or because of job-work tracking, or because of anything.

---

## 2. THE COMPETITIVE MAP

All prices exclude 18% GST unless stated. Prices marked [VERIFIED] were confirmed against the vendor's own pricing page during fact-check; [AGGREGATOR] means third-party listing sites only, which disagreed with each other.

| Product | Segment | Price (INR) | Real strengths | Verified complaints against it |
|---|---|---|---|---|
| **TallyPrime** (incumbent) | Every Indian SME with books. Accounting + inventory + GST; not a manufacturing ERP | **Perpetual [VERIFIED]:** Silver ₹22,500, Gold ₹67,500 (+GST). **Subscription [VERIFIED]:** Silver ₹750/mo, ₹2,250/3mo, ₹9,000/yr; Gold ₹2,250/mo, ₹6,750/3mo, ₹27,000/yr. **TSS renewal [AGGREGATOR]:** Silver ₹4,500/yr, Gold ₹13,500/yr (~20% of licence) | Universal CA familiarity; on-prem native; installed base; GST filing workflow SMEs already know | **NONE GATHERED.** This is the largest single gap in this report |
| **ERPNext** (free alternative) | Full ERP, all verticals, global. Deep in 22 modules incl. subcontracting both directions (PHASE2) | Software ₹0 (GPLv3). **Implementation in India [SINGLE-SOURCE, partner blog]:** ₹75,000–₹1.5 L small, ₹1.5–3 L mid, ₹3–5 L+ enterprise | Genuinely deep manufacturing; free; trained India partner network; `india-compliance` app; runs on 4 GB | Setup requires Linux/Bench/Docker knowledge (§1 R1); v16 navigation disorients users (§1 R2); GST bugs incl. one closed "not planned" (§1 R4); core-file customisation breaks on upgrade (§1 R3) |
| **Zoho Books** (India) | Cloud accounting for SME/startup. Not manufacturing | [VERIFIED, per org/month]: Free (turnover <₹25 L, 1 user), Standard ₹899, Professional ₹1,799, Premium ₹3,599, Elite ₹5,999, Ultimate ₹9,599. Annual billing ~17% off. Extra user ₹180/mo (₹150 annual) | In-app GSTR-1/3B preparation and "Push to GSTN" (**only on supported plans with configured GSTN API credentials** — not unconditional); AI OCR receipt extraction; intelligent bank-feed matching | Not researched. No manufacturing depth (BOM/WO/job work) |
| **Vyapar** | Micro/small billing + basic accounting. Mobile-first | [AGGREGATOR, sources disagree]: desktop ~₹3,399–3,799/yr; desktop+mobile ~₹3,959–4,399/yr; mobile Silver ~₹699/yr | Well capitalised: **~$35 M raised** (Inc42: $34.97 M over 3 rounds; Tracxn: $35.9 M over 4), ~1,382–1,564 employees (2025–26), acquired Suvit Nov 2025 and NeoDove 2022 | Not researched. Claim of a "permanently free" mobile tier could not be verified and is contradicted by a paid ₹699/yr mobile plan on one listing |
| **myBillBook / FloBooks** | Micro/small billing | [AGGREGATOR]: Silver ₹199/mo, Diamond ₹291/mo, Platinum ₹333/mo, Enterprise ₹570/mo | Vendor claims "1 crore+ small businesses" (**vendor copy republished by aggregators — no independent methodology**) | Not researched |
| **Marg ERP, BUSY, Khatabook, Odoo India, SAP Business One, Focus, Giddh, ClearTax** | — | — | — | **NOT RESEARCHED — zero data. All queried; all returned nothing.** |

### Three things this table changes

**1. "Indian SMEs won't buy subscription software" is dead as an assumption.** Tally itself now sells monthly, quarterly and annual subscriptions alongside the perpetual licence [VERIFIED on tallysolutions.com]. The incumbent has already trained the market on recurring payment. The plan makes no explicit assumption here, but any pricing conversation that assumes perpetual-only is starting from a false premise.

**2. The plan's stated ERPNext implementation cost is above the only verified range.** §8.4 answer 10 says *"budget ₹3–8 lakh for a partner to implement it."* The one verified partner source gives ₹75,000–₹5 L, topping out at "₹3 L–₹5 L+ enterprise" — and the ₹6–15 L manufacturing figure that would have supported the ₹8 L number was fabricated. **Restate as ₹75,000–₹5 L.** Saying a number that a prospect's own quote undercuts costs credibility in exactly the conversation §8.4 calls "the one that decides the deal."

**3. There is a price shelf between ₹10 K/yr and ₹50 K/yr that nothing in the table occupies for manufacturing.** Zoho Books tops out around ₹115 K/yr for accounting with no factory. Tally Gold is ₹27 K/yr subscription or ₹67.5 K perpetual with no job work. ERPNext is free plus ₹75 K–₹5 L of services. The plan's product would sit above Zoho and above Tally Gold, justified by manufacturing + compliance depth. **That is an inference from a price table, not evidence of willingness to pay.** Q15 remains unanswered.

---

## 3. THE SIMPLICITY QUESTION

**The hypothesis, as stated by the owner:** radical simplicity is the wedge. ERP is complex, users hate complexity, therefore a radically simple ERP wins.

### 3.1 What the evidence supports

Three things, and they are narrower than the hypothesis.

**(a) The free competitor's onboarding is genuinely hard, and has been for seven years.** Rank 1 in §1. Verified on Frappe's own forum by an experienced contributor. This is real.

**(b) Its daily navigation disorients users, including in the version shipping now.** Rank 2 in §1. Three named users, Nov 2025, v16 beta. Also real.

**(c) The complaints are concentrated in the first thirty days and in wayfinding — not in capability.** The same platforms carry praise for the UI once learned, and ten-year users reporting no complaints. The bimodal pattern in §1 is the most important structural fact in this section.

### 3.2 What the evidence does not support

**No source anywhere says an Indian SME chose or rejected an ERP on simplicity.** Not one. The complaint population is developers, implementers and global reviewers who self-install. The buying population is factory owners who buy through a partner and never see a Bench command.

**"Simple" was never defined by any evidence gathered.** The specific mechanisms the question asks about — mobile-first, vernacular/Hindi UI, WhatsApp as an interface, fewer screens — were all queued for research and **none of them were researched**. There is zero evidence in this report that an Indian manufacturing SME owner wants a Hindi UI, would use a WhatsApp bot, or prefers mobile. Anyone who tells you otherwise from this document is reading something that is not here.

**The "simple" category is already occupied and well funded.** Vyapar has raised ~$35 M and employs ~1,400+ people. myBillBook prices at ₹199/month. These companies own "simple Indian business software" and have spent a decade and a lot of capital getting there. A manufacturing ERP will not out-simple them, and does not need to — they do not do BOMs, work orders, job-work challans or ITC-04.

### 3.3 Where simple tools hit their ceiling — and this part *is* evidenced

The ceiling is statutory, and it is sharp. From §7's verified compliance picture:

| Obligation | Why a "simple" tool cannot carry it |
|---|---|
| GSTR-2B reconciliation | 2B freezes on the 14th; GSTR-3B is due the 20th. A **six-day window** to reconcile every purchase invoice. This is a data-matching problem across two systems, not a form |
| Section 143 job work | Inputs must return in 1 year, capital goods in 3. Failure retroactively deems the original dispatch a taxable supply, with interest running from the dispatch date. Requires a stock ledger, a GL, and a GST engine **simultaneously** |
| E-invoice ≥₹10 Cr | 30-day upload window from invoice date. A blocking rule against a clock |
| Manufacturing valuation | COGS as the delta in stock value, moving-average repost on back-dated entries. Not expressible in a billing app |

A billing app can produce a GST invoice. It cannot tell you that a challan issued 11 months ago is about to become a taxable supply. **That gap is the plan's whole thesis, and this is the one place the evidence genuinely supports it.**

### 3.4 Can a GST-compliant manufacturing ERP actually be simple?

**In scope: no.** The plan's own §4.1 IN list is ~40 entities, 79 numbered business rules, 14 unconditional statutory capabilities, ~25 reports. §7.6 refuses to state a timeline for it. That is not a simple product and calling it one would be a lie the first CA catches.

**In surface-per-role: yes, and that is the only version worth pursuing.** The gate operator sees one screen with a vehicle number. The weighbridge operator sees a weight and a variance. The job-card screen shows a timer and a reason code. The owner sees a challan-ageing list. Each is simple; the system is not.

This is exactly what the plan already argues in §8.2 W3: ERPNext's generic Desk *architecturally cannot render* bulk data entry, POS/counter, mobile/shop-floor and stateful operational screens — grep-verified, ~99,000 LOC of generic renderer with a categorical ceiling. **"ERPNext's own POS is a hand-written page — that is the tell."** That is a far stronger, far narrower, far more defensible claim than "we are simpler."

### 3.5 VERDICT

> **Radical simplicity is a necessary hygiene property, not a wedge. Do not position on it.**

Reasoning, in order:

1. **The evidence for simplicity-as-pain is real but comes from the wrong population.** It measures self-installers and implementers, not the buyer. Using it as a wedge means betting the company on a proxy.
2. **The complaint is concentrated in first-30-days and wayfinding, not in capability ceiling.** So the addressable version of "simple" is *onboarding and task-screen design*, which is an execution standard, not a differentiator. Everyone claims it; nobody can be sued for failing it.
3. **A competitor can copy "simple." A competitor cannot copy a rule store with a CA on retainer, or four screens their form engine cannot render.** The plan's §8.5 counter-argument — "any of hundreds of Frappe partners ships the same clock in a quarter, free" — applies with *more* force to UI simplicity than to job work, because UI is the cheapest thing to copy.
4. **The plan has already banked the defensible half of this hypothesis** in §8.2 W3. Keep it there. Do not promote it to a headline.
5. **Where simplicity does pay, it pays as a sales-cycle and support-cost property, not a price premium.** "Live in two weeks" (§8.4 answer 10) is a simplicity claim that converts. "Simpler than ERPNext" is a claim that invites a demo comparison you may lose, because ERPNext's advocates genuinely like its UI once learned.

**The one concrete simplicity commitment worth making, because it is evidenced:** the setup path must hide infrastructure entirely — no Bench, no Docker, no Linux, no site/app concepts ever visible. That is the specific, dated, first-party complaint in §1 Rank 1, and it is the one place where being categorically different from ERPNext is both cheap and provable.

**What would change this verdict:** direct evidence from ₹5–50 Cr manufacturing owners that they abandoned or rejected an ERP because staff could not use it. That evidence does not exist in this report and is a Stage 0 interview question.

---

## 4. THE SEGMENT QUESTION

**The tension:** the owner wants to serve every business. The plan (§1, §4) targets Indian discrete and light-process manufacturers at ₹5–50 Cr turnover, 20–150 employees, 1–3 GSTINs, job-work-heavy — and explicitly excludes continuous/batch chemical process, multi-country, export-first, >250 employees, and retail.

### 4.1 The case for "serve every business", argued honestly

- **No evidence in this research argues for narrowing.** Not a single source says ERPNext should be vertical-specific. The one piece of "vertical-first ERP" industry commentary that the research cited turned out to be a **dead domain** (DNS failure) and is struck. So the pro-narrow argument gets no external support from this pass either.
- **The volume is at the bottom.** The Udyam-registered universe is overwhelmingly micro — the (unverified, snippet-only) figures suggest ~97% report investment under ₹50 lakh and ~79.5% are sole proprietorships. If those are even roughly right, "every business" means mostly businesses with no BOM, no job work, and a ₹199/month budget. **These numbers are not quotable**, but the direction is consistent with the existence and funding of Vyapar and myBillBook.
- **A generic platform's flexibility is genuinely valuable to some.** ERPNext's ten-year satisfied users are running it across verticals.

### 4.2 The case for the narrow band, argued from evidence

**(a) The MSME classification, revised effective 1 April 2025, makes the band precise.** [VERIFIED — Notification S.O. 1364(E) dated 21 March 2025, per Taxmann]

| Class | Investment ≤ | Turnover ≤ |
|---|---|---|
| Micro | ₹2.5 Cr | ₹10 Cr |
| Small | ₹25 Cr | ₹100 Cr |
| Medium | ₹125 Cr | ₹500 Cr |

The plan's ₹5–50 Cr band straddles the top of Micro and the middle of Small. That is a real, notified, legally-defined segment — not an invented band.

**(b) The band is where compliance obligation peaks relative to in-house capability.** This is the strongest evidence-backed argument for the plan's targeting, and it was not made in the plan:

| Turnover | What kicks in |
|---|---|
| ≥ ₹5 Cr | E-invoicing mandatory [VERIFIED — since Aug 2023, still ₹5 Cr in 2026] |
| > ₹5 Cr | ITC-04 filing moves from **annual to half-yearly** [VERIFIED] |
| ≥ ₹10 Cr | 30-day IRP upload window from invoice date [VERIFIED — effective 1 Apr 2025] |

Below ₹5 Cr, a business can survive on a billing app. Above ~₹100 Cr, it has a finance team and buys SAP or Oracle. **Between ₹5 Cr and ₹50 Cr, obligation is mandatory and capability is a part-time accountant plus an external CA.** That is the segment definition, and it is derived from notified thresholds rather than from intuition.

**(c) "Serve every business" is precisely the mechanism that produces fragile systems.** The one verified upgrade-breakage thread (§1 Rank 3) shows what generic-plus-customisation costs: server-side changes overwritten on upgrade. Serving every business through customisation is how you get there. The plan's answer — opinionated defaults, additive-only extension fields, "custom logic is a paid service item" (§8.4 answer 8) — is the correct structural response.

**(d) The compliance surface is *segment-shaped*, not universal.** Retail needs POS and B2C dynamic QR. Services need PoS rules for services. Process chemicals need co-product yield allocation with a 100%-sum invariant per BOM (PHASE2 Q8). Exporters need RoDTEP/drawback/EPCG. Each of those is a different statutory subsystem, and the plan cuts all of them. "Every business" is not one product with more screens — it is N compliance regimes.

### 4.3 Does a narrow start foreclose widening?

**No — and the plan is already built so it doesn't. But the foreclosure risk is not where you'd expect.**

**Cheap to widen later (the code is already right):**
- **Up-market and down-market within manufacturing.** §4.2 D17 already makes every threshold-governed behaviour read an effective-dated rule-store row plus an operator-set applicability date. A customer crossing ₹5 Cr or ₹10 Cr changes data, not code. This is the single most important widening-enabler in the plan and it is already decided correctly.
- **New states** (Professional Tax slabs are rule-store rows — §10 Q10).
- **New verticals that share the discrete-manufacturing shape** (assembly, engineering job shops).

**Expensive to widen later:**
- **Process manufacturing.** Co-product cost allocation adds a 100%-sum invariant to every BOM (PHASE2 Q8) — a valuation-model change, not a feature.
- **Serial-level valuation.** Explicitly deferred (§4.2, PHASE2 Q7) precisely to avoid ERPNext's dual legacy representation. Deferring is right; adding it later is a real cost, knowingly accepted.
- **Retail/POS.** A different screen family entirely (§8.2 W3 names it).

**What actually forecloses widening is not the code. It is distribution and reference customers.** If the first ten customers are auto-component shops in one cluster, the eleventh sale is an auto-component shop, because that is who the reference calls reach. Widening then costs a new channel, not a new module. **This is the real segment risk and no evidence in this report addresses it** — §10 Q2 (partner distribution) is untouched.

### 4.4 RECOMMENDATION

> **Keep the narrow band. It is correct and now has notified-threshold evidence behind it that the plan did not previously cite. But narrow it *further* for the first ten customers, and be explicit that the narrowing is a go-to-market choice, not a product limit.**

Concretely:

1. **Keep ₹5–50 Cr discrete manufacturing as the product boundary.** Justified by §4.2(b) — it is the band where e-invoicing, the 30-day IRP window and half-yearly ITC-04 all bite while in-house capability is thinnest.
2. **Pick one sub-vertical and one or two geographic clusters for the first ten.** The plan's Stage 0 already says "sign 3 design partners in one sub-vertical" — make that the explicit go-to-market unit, and record which cluster, because §10 Q10 (Professional Tax states) depends on it and because reference-selling is cluster-shaped.
3. **Say "no" out loud to retail, process chemicals and export-led.** §8.4 answer 6 already does this for export-led. Extend the same honesty to the other two. A prospect you decline in month two is cheaper than a customer you fail in month fourteen.
4. **Protect the widening path in the one place it matters: the rule store and applicability model (§4.2 D17).** Already decided. Do not relitigate it.
5. **Do not tell the owner "narrow forever."** Tell them: the code widens on the compliance axis for free and on the vertical axis expensively, and the binding constraint on widening is the sales channel, which Stage 0 Q2 has not tested.

---

## 5. IS JOB WORK REALLY THE WEDGE?

The plan bets on it hard. §8.2 calls Section 143 job-work control "the strongest evidence item in the whole scout" and W2's ranking over Tally migration is one of the eight explicit disagreement resolutions in §9.4. §8.3 leads the entire sales story with it.

### 5.1 What the evidence confirms — and this is the cleanest evidence in the whole report

The Section 143 / ITC-04 statutory skeleton is **the only research pass in twelve that the fact-check graded "trustworthy" with zero unsupported numbers.** Five sources, all live, each containing the claim attributed to it.

| Fact | Status |
|---|---|
| Inputs sent to a job worker must return within **1 year**; capital goods within **3 years** | [VERIFIED across 4 sources] |
| Failure triggers a **deeming provision**: the original dispatch is treated as a taxable supply **on the dispatch date**, creating retrospective tax + interest | [VERIFIED — caclubindia carries a worked illustration applying 18% interest from the original dispatch date] |
| Challans must accompany goods (Rule 45); ITC-04 reports goods sent and received | [VERIFIED] |
| ITC-04 filing cadence: **annual** for turnover ≤ ₹5 Cr, **half-yearly** above ₹5 Cr | [VERIFIED, 2 sources] |
| Non-filing / incorrect filing: penalty **up to ₹25,000** under Section 125, plus demand notices and possible GST registration suspension | [VERIFIED] |

Sources: https://www.oxyzo.in/blogs/itc-04-filing-process-benefit-exemption-and-penalties · https://piceapp.com/blogs/gst-itc-04/ · https://www.caclubindia.com/articles/-section-143-of-the-cgst-act-facilitating-job-work-with-discipline-54817.asp · https://www.taxtmi.com/article/detailed?id=15915 · https://taxgarden.in/blog/gst-on-job-work-services-section-143-rates-compliance-india-2026

**This materially improves the plan's own confidence position.** ERP-MVP-PLAN.md §10 closes by listing among "the six things this plan is least confident about": *"the §143 statutory windows (**no reference code corroborates 1 year or 3 years**)."* Five independent Indian tax sources now corroborate exactly those two figures. They are still secondary sources and still require CA sign-off (§5.5 q24–q33), but they are no longer uncorroborated. **That line in §10 should be revised.**

### 5.2 What the evidence does not confirm — and this is the whole bet

**Zero evidence of felt pain. Zero. Not one data point.**

Specifically, none of the following was found, despite being the explicit research target:

- How commonly job work is actually used by Indian discrete manufacturers — **no prevalence data at all**
- What SMEs use today to track it — spreadsheets, physical challan books, nothing — **unknown**
- Any real story of a notice, a penalty, or a deemed-supply demand arising from a lapsed §143 window — **none found**
- Any assessment of whether existing software handles it badly enough to switch for — **none**
- Any indication that a business owner would pay for a challan-ageing clock — **none**

The research pass that was supposed to find these terminated before running the queries. The regulatory skeleton is confirmed; the market for it is entirely unexamined.

### 5.3 The uncomfortable asymmetry the fact-check surfaced

The auditor of the job-work pass made an observation the research itself glossed over, and it deserves to be stated plainly:

> The statutory exposure (Section 143 retroactive deemed supply) sounds severe, while the actual codified ITC-04 filing penalty (₹25,000 cap, **annual** filing for sub-₹5 Cr turnover) sounds mild. These point in different directions on how expensive the pain really is, and no primary source was found to resolve which dominates real SME experience.

Two consequences for the plan:

**(a) A ₹25,000 capped penalty on an annual filing is not a product.** For the bottom third of the target band (₹5 Cr is the ITC-04 cadence boundary, and the plan's band starts at ₹5 Cr), filing is half-yearly, not annual — so this is less bad than it first looks. But the *filing* pain is periodic and capped. **The plan must sell the deemed-supply liability, not the ITC-04 filing.** §8.2 W2 already understands this — it moved J5 (deemed-supply posting) into v1 specifically because the challan register plus ageing report is the commoditisable half. That call is correct and this evidence reinforces it.

**(b) The filing is periodic; the material tracking is continuous.** Even if ITC-04 is a twice-a-year chore, *knowing what is out, with whom, and since when* is a daily operational question. That may be the real pain — and it is an operations pain, not a compliance pain. **These are different products with different buyers.** A compliance pitch goes to the owner/CA; an operations pitch goes to the stores manager. The plan pitches compliance (§8.3). Nothing in the evidence says that is the right choice.

### 5.4 The strongest argument for the bet, restated honestly

The plan's §8.2 W2 argument is that the deemed-supply payload — a tax invoice carrying the despatch date as its supply date, with interest, plus ITC reversal — touches stock, GL and GST simultaneously, so **a bolt-on app cannot do it; only whoever owns the ledger can.**

That argument survives this research completely intact. It is an argument about *defensibility*, and it is correct. The verified 18%-interest-from-dispatch-date mechanic makes it stronger, not weaker — computing interest from the original dispatch date requires the original dispatch document, its stock movement, and a GL that can post a retroactive-dated supply.

**But defensibility is not demand.** §8.5's counter-reading remains the better default until Q1 answers: these capabilities do not exist in ERPNext after fifteen years or Odoo after twenty, and the honest reading is *"nobody paid enough for it to get built."* Absence in competitor code is evidence of a **gap**. It is not evidence of a **market**.

### 5.5 VERDICT

> **The bet is not disproven. It is also not evidenced at all. Nothing in this research moves it in either direction on the demand question, and the plan should stop describing it as "the strongest evidence item in the whole scout" — the evidence is of competitor absence, not of customer demand.**

What to do about it, in order:

1. **Do not weaken the technical bet.** J5 in v1 is right. The interest-from-dispatch-date mechanic is verified and is exactly the kind of thing a bolt-on cannot do.
2. **Rewrite Stage 0 Q1** (see §8 edit E7). The current question — "what will a job-work-heavy SME pay per year for the §143 clock alone" — asks about the commoditisable half and about a periodic filing. Ask instead about the liability, and separately test whether the felt pain is filing or visibility.
3. **Add a falsification criterion to Q1.** If fewer than 6 of 10 interviewees can, unprompted, name a challan currently outstanding beyond six months, the pain is theoretical and the wedge should be reconsidered against §8.5's "sell the module" alternative.
4. **Hold the §8.5 alternative open until Q1 returns.** Nothing in this research reduces the force of "choosing to build the whole ERP is choosing the most capital-intensive path to test the cheapest hypothesis."

---

## 6. BUYING, PRICING AND DISTRIBUTION

**This section is mostly a list of things we do not know.** The three research passes assigned to buying behaviour, pricing/unit economics and distribution all terminated after two queries or fewer. Read §0.3 before drawing any conclusion from what follows.

### 6.1 Who decides — UNKNOWN

Nothing evidenced. The only material found was vendor-authored advice content ("shortlist 2–3, get a demo, involve your teams"), and the specific quotation the research attributed to it **is not on the page** — a fabricated quotation, struck.

One anecdote survived verification and is worth keeping because it is honest and specific, from an Indian ERP consultancy's own blog:

> *"a decision made largely on who had the best salesperson. Six months into the implementation, the organisation realises the software fits their demo environment beautifully and their actual shopfloor not at all."*
[VERIFIED verbatim] — https://tatvamasilabs.com/best-erp-for-manufacturing/

That is one vendor's anecdote, not research. But it is consistent with the plan's §7.5 GA gate (two pilots through two real month-ends) being the right discipline, and with §8.4's "rehearse the honest answer" approach.

**The CA-as-gatekeeper hypothesis — which the plan relies on in §4.2 ("The CA is the gatekeeper"), §8.4 answer 1, and §10 Q6 — has zero external evidence.** The one source cited for it does not contain the claim. It may well be true; it is an untested assumption in a plan that otherwise labels its assumptions carefully.

### 6.2 What they pay — anchors only, no willingness-to-pay data

| Reference point | Annual cost | Status |
|---|---|---|
| TallyPrime Silver, perpetual + TSS | ₹22,500 once, then ~₹4,500/yr | [VERIFIED] |
| TallyPrime Gold, perpetual + TSS | ₹67,500 once, then ~₹13,500/yr | [VERIFIED licence; AGGREGATOR TSS] |
| TallyPrime Gold, subscription | ₹27,000/yr | [VERIFIED] |
| Zoho Books Premium → Ultimate | ₹43,200 → ₹115,200/yr | [VERIFIED] |
| ERPNext implementation (one-time, services) | ₹75,000 – ₹5,00,000 | [SINGLE-SOURCE partner blog] |

**Implication, stated as an inference and not as evidence:** a manufacturing ERP with GST depth, job work, payroll computation and a Tally migration sits above all of these on capability. A defensible opening hypothesis is an ACV in the ₹60,000–₹2,00,000 range plus implementation — but **there is no evidence for this number and §10 Q15 remains completely unanswered.** Do not let it into a financial model as anything but a hypothesis to be tested in ten interviews.

### 6.3 Channel — UNKNOWN, and this is the biggest unmitigated risk in the plan

Zero evidence gathered. §10 Q2 ("will any implementation partner carry an unknown closed-source ERP against a free one they already sell?") is untouched by this research.

What can be said: nothing found **contradicts** §8.5's argument that Indian manufacturing SMEs are reached through implementation partners with ERPNext skills, an ERPNext-shaped services business, and a zero-cost base letting them keep the whole engagement fee. Nothing found **supports** it either. It remains the plan's own reasoning, unvalidated.

The one adjacent data point: ERPNext implementations in India are priced at ₹75 K–₹5 L of services against ₹0 of licence [SINGLE-SOURCE]. If accurate, a partner's entire economics is services. A closed-source product that takes a licence fee out of that pool has to fund a better partner margin than 100% — which is §8.5's exact argument, now with a number attached to the denominator.

### 6.4 Cloud vs on-premise — UNKNOWN

The plan assumes on-prem demand: §4.1F specifies a self-host build running on a 4 GB box, citing PHASE6 §6 ("Indian SMEs will demand on-prem on a ₹40–80k/yr server"). **No market evidence was gathered for or against this.**

One observation worth flagging: Tally is on-prem-native, and the assumption may be inherited from the incumbent's *shape* rather than from customer *preference*. Tally now also sells subscription, and Zoho Books — pure cloud — is a real presence in the Indian SME market. The on-prem requirement drives real cost (packaging, backup, retention, update distribution, support of customer hardware) and it is currently carried on an unverified premise. **Add it to Stage 0.**

### 6.5 Do the unit economics support a 9–11 month build?

**This report cannot answer that, and neither can the plan.** §7.6 already refuses to state a timeline, correctly, and calls the 9–11 month / 6–8 engineer figure a **placeholder** derived by multiplying a prior whose own author marked it unmeasured.

What this research adds is the revenue side of the same problem, and it is also blank:

- No ACV evidence → no revenue model
- No CAC evidence → no payback period
- No churn evidence → no LTV
- No channel evidence → no distribution cost
- No willingness-to-pay evidence → the price is a guess

**The one arithmetic worth writing down, entirely from the plan's own numbers plus the price anchors above, as a Stage 0 forcing function:**

At a hypothesised ₹1,00,000 ACV, ₹1 Cr of ARR needs 100 customers. The plan's GA gate is **two pilots** completing two consecutive month-ends, with pilot go-live at month 9 and GA at month 13–14 (§7.5), plus 3–4 months of hiring before Stage 1 can run at full team (§7.6), plus a full-time implementer per pilot who is not in the 6–8 engineer count (§10 Q16). Against 6–8 engineers for 12–14 months plus a CA retainer plus a statutory data source of unknown cost (§3.9), the build is a multi-crore commitment reaching two paying customers around month 14.

**That is not a reason to stop. It is the reason §7.6 and §10 Q15 exist, and it is why Stage 0's one-page financial model is a gate rather than a nicety.** This report's contribution is to confirm that no external evidence exists to fill any of those blanks — they can only be filled by talking to ten prospects.

---

## 7. COMPLIANCE REALITY AND WHAT IS CHANGING

Everything below is [VERIFIED] against a live source unless marked. **Every one of these still requires CA sign-off before it enters code** — this section changes what the plan should *ask* the CA, not what it may assume.

### 7.1 E-invoicing

| Fact | Status |
|---|---|
| Mandatory turnover threshold is **₹5 Cr**, reduced from ₹10 Cr in **August 2023** | [VERIFIED, 2 sources] |
| A further cut to **₹2 Cr has been discussed at multiple GST Council sessions but has NOT been notified.** One source, as of mid-2026: *"you will see headlines and vendor blogs treating it as imminent, but the live threshold remains Rs 5 crore until a notification says otherwise"* | [VERIFIED verbatim — accountune.com] |
| Businesses with turnover **≥ ₹10 Cr must upload e-invoices to the IRP within 30 days of the invoice date**, effective **1 April 2025**, continuing into FY 2026-27 | [VERIFIED — gimbooks.com] |

**The earlier research claimed a ₹2 Cr threshold effective October 2025 and framed it as contradicted by a CBIC denial. Both halves were wrong** — the ₹2 Cr/Oct-2025 claim appears on none of its cited sources, and the "CBIC denial" source is a suspended domain. There is no contradiction. The threshold is ₹5 Cr; ₹2 Cr is discussed and unnotified.

**What it forces:**
- The e-invoice threshold **must be a rule-store row with an applicability date, never a constant.** The plan's §4.2 D17 already decides exactly this ("switchable effective-dated behaviour IN; the computation engine OUT"). **This evidence is the justification for that decision and should be cited in it** — the threshold has already moved once and is under active discussion to move again.
- The **30-day IRP window is a blocking validation that the plan does not currently name anywhere.** See §8 edit E3.
- Default to supporting e-invoicing regardless of a customer's current turnover. The direction of travel is one-way.

### 7.2 ITC reconciliation — the sharpest recurring pain found

| Fact | Status |
|---|---|
| **GSTR-2B is generated/frozen on the 14th**; **GSTR-3B is due the 20th** → a **~6-day reconciliation window** every month | [VERIFIED, 2 sources] |
| Wrongly availed ITC attracts **18% p.a. interest** (Section 50) | [VERIFIED as statutory background; the specific worked example the research quoted is not on its cited page and is struck] |
| **Rule 88D / DRC-01C**: a system-generated intimation when GSTR-3B ITC exceeds GSTR-2B ITC beyond a prescribed threshold, with a **7-day reply window** | [SINGLE-SOURCE — caclubindia. Note: that source attributes subsequent GSTR-1 filing blocks to **Rule 59(6)**, not to DRC-01C non-response. The research conflated the two. **Verify with CA before building.**] |

Source: https://www.caclubindia.com/articles/gstr-2b-mismatch-and-itc-protection-the-complete-2026-playbook-55807.asp · https://futurexsolutions.com/gstr-2b-reconciliation-itc-mismatch-fix/ · https://legalsuvidha.com/blog/gstr-2b-mismatch-notice/

**What it forces — and this is a genuine product-design consequence the plan has not absorbed:** a six-day window is not a month-end report, it is a **continuous background process with a standing worklist**. The plan's §4.1C lists "GSTR-2B download and purchase reconciliation" as a capability, and §5's gate treats it as an unconditional N12 item — but nothing in the plan specifies *cadence*. If 2B reconciliation is designed as a month-end screen, the customer meets it for the first time on the 15th with six days to go. If it is designed as a standing mismatch list refreshed on every available 2B pull, the 15th is a review, not a scramble. **Same data, same API, different UX — and the difference is cheap now and expensive later.** See §8 edit E5.

### 7.3 Job work — see §5.1

Verified: 1 year / 3 years, deemed supply retroactive to dispatch with 18% interest from the dispatch date, ITC-04 annual ≤ ₹5 Cr / half-yearly > ₹5 Cr, penalty ≤ ₹25,000 under Section 125.

### 7.4 MSME classification — revised, and it affects an existing v1 feature

Effective **1 April 2025** (Notification S.O. 1364(E), 21 March 2025): Micro ≤ ₹2.5 Cr investment / ≤ ₹10 Cr turnover; Small ≤ ₹25 Cr / ≤ ₹100 Cr; Medium ≤ ₹125 Cr / ≤ ₹500 Cr. [VERIFIED — Taxmann]

**What it forces:** the plan's §4.1C includes "MSME/Udyam classification → 45-day due date → 43B(h) disallowance report." That classification depends on these thresholds. **If the rule store is seeded with pre-2025 numbers, the 45-day supplier classification is wrong and the 43B(h) report is wrong.** Cheap to get right, silent when wrong. See §8 edit E12.

### 7.5 Not researched, and therefore open

- **IMS (Invoice Management System)** — the GST portal's newer invoice-acceptance flow. Zero coverage. If it affects 2B composition, it affects N12 directly.
- **GST rate rationalisation** — zero coverage. Directly relevant to §3.9's rate-master sourcing cost.
- **E-way bill operational friction** — zero coverage, despite the plan putting the full EWB lifecycle in v1.
- **Actual notice/penalty base rates** — zero credible data. Any pitch that quantifies "how often SMEs get notices" would be fabricating.

---

## 8. WHAT THIS CHANGES IN THE MVP PLAN

Concrete edits to `ERP-MVP-PLAN.md`, each tied to a finding above. Ordered by consequence.

---

### E1 — §8.4 answer 10: correct the ERPNext cost figure
**Finding: §2, third bullet.** The plan says *"budget ₹3–8 lakh for a partner to implement it."* The only verified source gives **₹75,000–₹5,00,000**; the ₹6–15 lakh manufacturing figure that would have supported ₹8 L was fabricated.

**Edit:** replace "₹3–8 lakh" with "₹75,000 to ₹5 lakh, depending on modules, customisation and data migration" and cite https://psdigitise.com/blogs/erpnext-implementation-cost-india [single-source, partner blog, Apr 2026]. Mark it single-source in the plan.

**Why it matters:** §8.4 answer 10 is the answer the plan itself calls "the one that decides the deal." Quoting a number a prospect's own quote undercuts loses that conversation.

---

### E2 — §8.4 answer 10: add a citable quote to replace an uncitable number
**Finding: §1 Rank 1 and Rank 4.**

**Edit:** after "we checked the source, not the brochure", add two verifiable specifics:
- ERPNext's own forum, March 2026, on onboarding: *"unnecessarily confusing for new users"* — with a long-time contributor replying *"I remember experiencing all of these pain points."*
- `frappe/erpnext` issue #47509: a GST tax-computation defect on exempted items, reported with reproduction, **closed as "not planned."**

**Why it matters:** these are dated, first-party, verifiable, and they demonstrate the §8.1 claim ("a free project cannot fund a CA on retainer") with an instance rather than an assertion.

---

### E3 — §4.1C and §6 Wave 1: ADD the 30-day IRP upload rule as a blocking validation
**Finding: §7.1.** Turnover ≥ ₹10 Cr must upload e-invoices to the IRP within 30 days of the invoice date, effective 1 April 2025. **This rule appears nowhere in the plan.**

**Edit:** add to the §4.1C compliance summary and to the V-series blocking validations in §6: *"V-nn: for tenants above the applicable turnover threshold, an invoice whose document date is more than N days old cannot be submitted for IRN generation. N and the turnover threshold are rule-store rows with applicability dates."* Add a `[VERIFY]` question to §5.5 asking the CA to confirm N=30, the ₹10 Cr threshold and its current status.

**Cost:** one rule-store row plus one blocking validation. Near zero. **Cost of omission:** a customer above ₹10 Cr discovers on day 31 that their invoice cannot be IRN'd, in production.

---

### E4 — §4.1C and §6: decide DRC-01C explicitly, in or out
**Finding: §7.2.** Rule 88D / DRC-01C is a system-generated ITC-mismatch intimation with a 7-day reply window. The plan does not mention it.

**Edit:** add a row to §4.2 (OUT) reading: *"DRC-01C / Rule 88D response workflow — OUT of v1. What is IN: the 2B reconciliation report must expose the GSTR-3B-vs-2B ITC delta as an explicit, named figure so the customer can see the DRC-01C trigger before filing 3B, not after receiving the intimation."* Add a §5.5 `[VERIFY]` question covering the prescribed threshold, the 7-day window, and whether non-response blocks subsequent GSTR-1 (the source attributes that block to Rule 59(6), and the two must not be conflated).

**Why:** the mechanism is a real automatic-notice path whose consequences cascade into filing. Cutting it is defensible; not knowing about it is not.

---

### E5 — §4.1C: reframe 2B reconciliation from month-end batch to continuous worklist
**Finding: §7.2 — the verified six-day window between 2B freeze on the 14th and 3B due on the 20th.**

**Edit:** amend the §4.1C line "GSTR-2B download and purchase reconciliation" to state cadence explicitly: *"2B download on every available refresh, feeding a standing purchase-mismatch worklist with ageing, not a month-end reconciliation screen. The statutory window between 2B generation (14th) and GSTR-3B (20th) is six days; a batch design meets the customer inside that window."* Add the corresponding note to §6 Wave 1.

**Why:** UX cadence is a schema-and-workflow decision, cheap now, a rework later. And it is one of the few places where the product can be *visibly* better than a spreadsheet in month one.

**Note the dependency:** §10 Q4 already flags as **blocking** whether 2B download inherits an OTP-bound session. If it does, "continuous" is impossible and this becomes an attended operation. **Q4 must be answered before this edit is implemented, not after.**

---

### E6 — §4.2 D17: cite the evidence for the applicability decision
**Finding: §7.1.** The e-invoice threshold moved ₹10 Cr → ₹5 Cr in Aug 2023; a further cut to ₹2 Cr is discussed and unnotified as of mid-2026.

**Edit:** add to the D17 row and to the §4.2 turnover-applicability row: *"Evidence: the e-invoice threshold has already moved once (₹10 Cr → ₹5 Cr, Aug 2023) and a cut to ₹2 Cr is under active GST Council discussion but unnotified as of mid-2026. A hardcoded threshold would already have been wrong twice."* Additionally, add ITC-04 filing cadence (**annual ≤ ₹5 Cr, half-yearly > ₹5 Cr**) as a named applicability row — §4.1D's job-work capability does not currently mention filing cadence at all.

**Why:** D17 is currently argued on principle. It can now be argued on a dated fact, which is what §5's standing caveat asks for.

---

### E7 — §7 Stage 0 and §10 Q1: rewrite the single most important question
**Finding: §5.2 and §5.3.** Zero demand evidence. The ITC-04 *filing* penalty is capped at ₹25,000 and the filing is periodic; the severe exposure is the deemed-supply tax + 18% interest from dispatch date.

**Edit — replace the Q1 text with three questions and a falsification criterion:**

| | Question |
|---|---|
| Q1a | Do you send material out for job work, and how much is out right now? *(prevalence — completely unmeasured)* |
| Q1b | How do you track it today, and has a challan ever aged past a year? *(pain, and whether the pain is filing or visibility)* |
| Q1c | If a system told you today that ₹X of material has been out for 11 months and is about to become a taxable supply with interest from the dispatch date, what is that worth per year? *(price the liability, not the clock)* |
| **Falsify** | **If fewer than 6 of 10 can name, unprompted, a challan currently outstanding beyond six months, the pain is theoretical.** Escalate to the §8.5 decision: sell the module, not the ERP |

**Why:** the current Q1 ("what will they pay per year for the §143 clock alone") prices the commoditisable half — the ageing report that §8.2 itself concedes any Frappe partner ships in a quarter — and it asks about a periodic filing. It also has no failure condition, which makes it un-answerable as a gate.

---

### E8 — §10: ADD a new Stage 0 question — "what do you hate about Tally?"
**Finding: §0.3 and §1's closing note.** The research produced **zero** evidence about the incumbent's weaknesses. Not one complaint, not one migration story, not one pricing objection.

**Edit:** add as a Stage 0 gate question alongside Q1: *"Qn — What does Tally not do for you? What do you keep in Excel because Tally can't hold it? What would have to be true for you to move off it? (10 interviews, same conversation as Q1.)"*

**Why this may outrank Q1:** the plan's entire switching argument (§8.4 answers 2 and 10, W4 migration, "no import path = no sale") depends on the customer wanting to leave Tally. Nothing in this research establishes that they do. A prospect who is content with Tally + Excel does not buy a manufacturing ERP no matter how good the §143 clock is. **This is a cheaper and more fundamental question than Q1 and it currently is not asked anywhere in the plan.**

---

### E9 — §10, closing paragraph: downgrade the §143 uncertainty
**Finding: §5.1.**

**Edit:** the closing "six things this plan is least confident about" lists *"the §143 statutory windows (no reference code corroborates 1 year or 3 years)."* Amend to: *"the §143 statutory windows — **no reference code** corroborates them, but five independent Indian tax sources do (1 year inputs / 3 years capital goods, deemed supply on the original dispatch date with 18% interest). Still `[VERIFY]` pending CA sign-off under §5.5 q24–q33, but no longer uncorroborated."*

**Why:** the plan's confidence budget is finite and this item can be spent down. The absence was an absence in *GPL competitor code*, which was never the right place to look for Indian statute.

---

### E10 — §6.7 / J5: specify the interest computation date
**Finding: §5.1 — caclubindia's worked illustration applies 18% interest from the **original dispatch date**, not from the date the deeming provision triggers.**

**Edit:** in the §6.7 J5 rule, state explicitly: *"Interest on the deemed supply accrues from the original dispatch date, not from the expiry of the §143 window. The deemed-supply invoice carries the dispatch date as its supply date (already stated in §8.2 W2); the interest computation must use the same date."* Add a `[VERIFY]` reference.

**Why:** a one-line rule that silently understates the customer's liability if wrong — and understating a tax liability in a compliance product is the defect class that ends a reference customer relationship.

---

### E11 — §8.2 W5: confirm the AI downgrade, with evidence, and adopt one constraint
**Finding: §0 evidence set on AI in ERP, 2026.**

Three verified-enough points:
- ERPNext core ships only **minimal native field-level AI helpers**; substantive AI capability is third-party community apps and MCP bridges. A native-AI-provider feature request for v16 is **open, not shipped** — https://github.com/frappe/erpnext/issues/50807 (opened 29 Nov 2025).
- Zoho Books' AI is OCR receipt extraction, intelligent bank-feed matching and dashboard insights — **automation of existing steps, not a new interaction paradigm.** No source describes users abandoning the normal UI for a chat interface.
- The Frappe community's AI copilots are deliberately built as **permission-aware, restricted query layers** rather than giving an LLM raw database or Python access. [Note: this is one developer's project across two forum posts, not a community norm — the research overstated it.]

**Edit:** in W5, replace "no evidence in any of the six reports supports it — nothing was scanned for it" with the above, and add one architectural constraint: *"If AI is built, it reads through the same permission predicate as every other query path (§3.8). No raw SQL, no bypass. This is not a preference; a chat interface that leaks another cost centre's margins is a permission defect with a friendly face."*

**Why:** W5's "multiplier, not a wedge" verdict is confirmed — the market's shipped AI is bolt-on automation, and nobody has captured a defensible position. The permission constraint is free to adopt now and a re-model later.

---

### E12 — §4.1C: check the MSME threshold vintage
**Finding: §7.4.** MSME classification thresholds were revised effective 1 April 2025 (S.O. 1364(E), 21 Mar 2025).

**Edit:** add to the §4.1C MSME/Udyam line: *"Classification thresholds are rule-store rows dated to the 1 April 2025 revision (Micro ≤ ₹2.5 Cr investment / ≤ ₹10 Cr turnover; Small ≤ ₹25 Cr / ≤ ₹100 Cr; Medium ≤ ₹125 Cr / ₹500 Cr). Seeding pre-2025 values makes the 45-day due date and the 43B(h) disallowance report wrong for every supplier near a boundary."* Add the notification number to the §5.5 verification list.

**Why:** silent-wrong, cheap-right. Exactly the class of defect §5's standing caveat exists to catch.

---

### E13 — §4.1F and §7 Stage 0: test the on-prem assumption
**Finding: §6.4.** The plan carries a self-host build for a ₹40–80 k/yr box on PHASE6 §6's assertion that Indian SMEs will demand on-prem. **No market evidence exists for this.**

**Edit:** add a Stage 0 question: *"Would you accept a cloud-hosted system, or is on-premise a requirement? If a requirement, why — data control, internet reliability, cost, or precedent from Tally?"* And add to §4.1F: *"The on-prem build is carried on an unverified assumption inherited from the incumbent's shape. If Stage 0 says cloud is acceptable to 8 of 10, the self-host packaging, backup/retention and customer-hardware support burden are candidates for v1.1."*

**Why:** on-prem drives packaging, update distribution, backup, and a support surface on hardware you do not control. It is a large hidden cost carried on a single unverified sentence. Note it interacts with §10 Q8 (dedicated-database isolation) — ask both in the same conversation.

---

### E14 — §10 Q15: seed the financial model with verified anchors
**Finding: §6.2.**

**Edit:** append to Q15: *"Reference anchors, verified Aug 2026 — TallyPrime Silver ₹22,500 perpetual (+~₹4,500/yr TSS) or ₹9,000/yr subscription; Gold ₹67,500 perpetual (+~₹13,500/yr) or ₹27,000/yr subscription; Zoho Books ₹899–₹9,599 per org per month; ERPNext ₹0 licence plus ₹75,000–₹5 L implementation. **Note that Tally now sells subscription alongside perpetual — 'Indian SMEs won't buy recurring' is not a valid objection; the incumbent has already trained the market.**"*

**Why:** §8.4 answer 10 is currently "argued entirely on features against a competitor whose price is zero with our own number left blank." These are the first real numbers to put on the other side of that comparison.

---

### E15 — §7.5 GA gate: add ITC-04 and the 30-day rule to the acceptance suite
**Finding: §5.1, §7.1.**

**Edit:** extend GA criterion 2 (GSTR-1 JSON passes the government offline tool with zero errors) with: *"…and an ITC-04 extract covering Tables 4 and 5A validates against the government offline utility for both pilots."* Extend the continuous red-CI acceptance suite (§7) to assert the 30-day IRP blocking rule.

**Why:** §8.3 leads the whole sales story with the job-work flow. If ITC-04 output is not in the GA gate, the lead capability ships unproven against the government's own validator while GSTR-1 ships proven.

---

### E16 — §8.5: strengthen, do not soften
**Finding: everything in §5.2, §6.1, §6.3.**

**Edit:** add one line to §8.5: *"Phase 7 market research changed nothing here. It found no demand evidence for the job-work wedge, no distribution answer, no willingness-to-pay data, and no evidence that the target customer wants to leave Tally. The case against remains as strong after market research as before it, and Stage 0 must produce a written, signed answer to this section as a whole — not merely to Q1 and Q2 individually."*

**Why:** the honest reading of this research pass is that the commercial thesis is exactly as unevidenced as it was before, and the plan should record that rather than absorb a market report as implied validation.

---

### E17 — Do NOT change: things this research explicitly leaves alone

Recorded so they are not relitigated on the strength of a thin report:

| Plan decision | Why it stands |
|---|---|
| §8.2 W2 ranked above W4 (job work over Tally migration) | Nothing found on either side. The plan's reasoning in §9.4 stands on its own terms. |
| §8.2 W3 (factory-floor UI) | This is the *defensible* form of the simplicity hypothesis and §1 Rank 2's v16 navigation complaints strengthen it. |
| J5 (deemed-supply posting) in v1 | Confirmed. The verified interest-from-dispatch mechanic makes it more clearly the half a bolt-on cannot do. |
| §4.2 D17 (switchable applicability, no computation engine) | Confirmed by §7.1's threshold history. |
| Timeline refusal in §7.6 | Confirmed. This research adds nothing that would let anyone state a timeline, and the revenue side is as blank as the cost side. |
| GST filing OUT of v1 (prepare only) | Untouched by evidence. Note Zoho's own "Push to GSTN" is gated on plan tier and configured GSTN credentials — the incumbent cloud player treats direct filing as conditional too. |

---

## 9. WHAT WE STILL DO NOT KNOW

Split by whether more web research would help.

### 9.1 Answerable with a fresh search budget — re-run these

These failed for a mechanical reason (search quota exhausted), not because the information does not exist:

| Gap | Why it matters |
|---|---|
| Tally pricing, licensing and dealer-channel structure, from primary sources | E14; the incumbent's economics define the price ceiling |
| Marg ERP, BUSY, Odoo India partners, SAP Business One India — pricing and positioning | §2 has a hole where half the competitive set should be. **BUSY and Marg in particular are the ones an Indian manufacturer actually shortlists against Tally, and we know nothing about either** |
| Market sizing: enterprise counts by turnover band, manufacturing cluster geography, employee distributions, ERP-adoption rates | Sized TAM, and go-to-market geography (§4.4 point 2 needs this) |
| IMS (Invoice Management System), GST rate rationalisation, e-way-bill operational friction | §7.5 — all three touch v1 scope directly |
| Documented OCR/AI accuracy in Indian accounting tools | Whether the AI multiplier in W5 is real or demo-ware |
| Vernacular / mobile / WhatsApp usage among Indian SME owners | The entire concrete definition of "simple" in §3 is currently unevidenced |

**Recommendation: re-run these in a session with search budget available before Stage 0's financial model is written.** They are cheap relative to the decision they inform.

### 9.2 Not answerable by any amount of web research — design-partner conversations only

These are the ones that decide the project, and no search engine has them.

1. **Will a ₹5–50 Cr manufacturer pay for the §143 deemed-supply liability, and how much?** (§5.5, E7.) No published source will ever contain this. It requires ten conversations. It is the plan's Q1 and it remains the single cheapest way to be wrong about the biggest decision.

2. **Is the felt pain compliance (periodic filing) or operations (continuous material visibility)?** (§5.3.) These are different products with different buyers and different pitches. Only the customer's own words distinguish them.

3. **What do they actually hate about Tally, and what would make them leave?** (E8.) The most important question the research did not ask, and one that only an owner can answer. Published sources contain marketing, not grievance.

4. **Who really decides?** Owner, next-generation family member, plant manager, or the external CA. §6.1 is empty and the plan's CA-as-gatekeeper assumption is untested.

5. **Will an implementation partner carry a closed-source product against a free one they already sell profitably?** (§10 Q2.) This is a negotiation, not a fact. Five conversations.

6. **Is on-premise a requirement or an inherited habit?** (E13.) The customer's reason matters more than their answer — "data control" is negotiable, "our internet drops daily" is not.

7. **What will they pay, and what is the CAC?** (§10 Q15.) Price discovery is a conversation. Every anchor in §6.2 is a competitor's price, not this product's.

8. **Extension-field demand in numbers.** (§10 Q9.) PHASE5 calls this "the single highest-leverage piece of missing evidence in this entire scout." It is unchanged after Phase 7.

9. **Do the first ten import raw material?** (§10 Q7.) Bill of Entry in or out.

10. **Which states, which sub-vertical, which cluster?** (§10 Q10, §4.4.) Determines PT slab coverage and the shape of the reference-selling motion.

---

## 10. THE ONE-PARAGRAPH SUMMARY

The evidence confirms that ERPNext is hard to set up and disorienting to navigate — persistently, across seven years and into the version shipping now — and that its GST layer carries defects that go unfixed because a free project cannot fund a compliance function. It confirms the Section 143 statutory machinery the plan bets on, in more detail and with better corroboration than the code scout could reach, including the interest-from-dispatch-date mechanic and a threshold history that vindicates the plan's decision to make applicability a data row. It confirms that thresholds move and will keep moving. **It confirms nothing about demand.** No evidence was found that any Indian manufacturing SME wants to leave Tally, would pay for a job-work clock, values simplicity enough to switch, or can be reached through any channel. Radical simplicity is a hygiene property, not a wedge, and the defensible version of it is already in the plan as W3. The narrow segment is right and better-justified than the plan currently argues, because ₹5–50 Cr is precisely the band where e-invoicing, the 30-day IRP rule and half-yearly ITC-04 all bite while in-house finance capability is thinnest. And §8.5's case against the whole project stands entirely intact — market research did not validate the commercial thesis, it simply confirmed that the thesis is untested, which makes Stage 0's ten interviews more important than anything in this document.
