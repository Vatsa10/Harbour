# PHASE 6 — Remaining-Surface Sweep

Scope: what PHASE1–PHASE5 did not cover. frappe-books (typed-TS ledger), shop-floor
execution, statutory document numbering under concurrency, data import / opening
balances / Tally, HR shifts & attendance, POS + warehouse barcode, maintenance &
repair, BI, and deployment/ops.

Sources scanned: `frappe-books/`, `frappe-frappe/`, `erpnext/`, `frappe-hrms/`,
`frappe-india-compliance/`, `frappe-insights/`, `odoo/`, `ever-gauzy/`.
All GPL/AGPL — clean-room reimplementation only; nothing below is copyable code.

---

## 1. MVP-blocking findings

Four domains came back `mvp-blocking`. Each blocks for a different reason, and
three of them are *adoption* blockers rather than feature blockers — i.e. the
product cannot be sold to its first customer without them, regardless of how good
the manufacturing modules are.

| # | Blocker | Why it blocks | Primary evidence |
|---|---|---|---|
| 1 | Statutory invoice numbering under concurrency | A duplicated or unexplained-gap invoice number is a GST filing failure, not a bug report. Must be right at v1; retrofitting numbering after go-live means renumbering live books. | `frappe-frappe/frappe/model/naming.py`, `odoo/addons/account/models/sequence_mixin.py`, `odoo/odoo/addons/base/models/ir_sequence.py` |
| 2 | Opening balances at go-live | Every prospect is a *live* company mid-financial-year. Without AR/AP/stock/trial-balance opening entry, the ERP cannot be switched to at all. | `erpnext/erpnext/accounts/doctype/opening_invoice_creation_tool/`, `erpnext/erpnext/stock/doctype/stock_reconciliation/stock_reconciliation.py`, `erpnext/erpnext/accounts/doctype/journal_entry/journal_entry.py` |
| 3 | Tally interoperability | Tally is the incumbent in ~every Indian manufacturing SME, and the CA is the gatekeeper. No import path = no sale. Nothing in any of the five repos implements it. | `erpnext/erpnext/change_log/v12/v12_0_0.md` (removed Tally Migrator), `erpnext/erpnext/public/js/setup_wizard.js` |
| 4 | Shift/attendance → payroll pipeline | Factory wages are attendance-driven. An ERP that cannot produce a wage sheet from biometric punches is a partial system the customer runs alongside their existing one. | `frappe-hrms/hrms/hr/doctype/shift_type/shift_type.py`, `frappe-hrms/hrms/payroll/doctype/salary_slip/salary_slip.py` |
| 5 | Deployment/ops economics | Determines whether one server serves one customer or thirty. Wrong choice here caps gross margin permanently. | `frappe-frappe/frappe/commands/site.py`, `odoo/debian/control`, `ever-gauzy/docker-compose.infra.yml` |

### 1.1 Numbering — the decision, stated

Three mechanisms exist in the references:

| Mechanism | Where | Gap behaviour | Verdict |
|---|---|---|---|
| Counter table + `SELECT … FOR UPDATE` (blocking) | `frappe/model/naming.py::getseries` | Rollback un-consumes the number (same txn). Gaps only on delete. | **Adopt this shape** |
| Native Postgres `SEQUENCE` | `ir_sequence.py`, `implementation='standard'` | Rollback *burns* the number silently | **Reject** — unexplained gap in a GST series |
| Optimistic retry against a UNIQUE index + SAVEPOINT | `account/models/sequence_mixin.py::_locked_increment` | No gaps, but savepoint-per-retry cost | Reject as primary; borrow its in-txn cache for bulk generation |

Two details from the references are load-bearing and must be reproduced:

- **Cancellation must never return a number.** Frappe only decrements on *hard
  delete of a draft*, and only if the counter still equals that document's number
  (`revert_series_if_last`, `naming.py`). Cancelled submitted invoices keep their
  number forever — which is exactly what GSTR-1 requires (cancelled numbers must
  be disclosed in-sequence).
- **Locking prevents future gaps but never detects existing ones.** Odoo added an
  explicit continuity auditor (`made_sequence_gap`, `_get_chains_to_hash` refusing
  to hash a gapped chain) precisely because migrations, restored backups and manual
  DB edits break sequences that no lock was ever going to protect. Frappe has no
  equivalent — grep found nothing. Build the auditor, and make it a **blocking
  precondition on IRN generation / GSTR-1 filing**, not a dashboard warning.

Both references are calendar-year only (`YYYY`/`year_range`). **The India FY
(1 Apr–31 Mar) reset token does not exist anywhere in the scanned repos** and must
be designed from scratch. Series scope must be `(legal entity GSTIN, document type,
FY)` — Odoo scopes by journal, Frappe by resolved prefix string; neither treats
per-GSTIN isolation as first-class, and a multi-state SME has several registrations.

Recommendation: pessimistic row lock with `FOR UPDATE NOWAIT` + short app-layer
backoff (Odoo's `no_gap` ergonomics, Frappe's simplicity), counter keyed on the
GSTIN+doctype+FY triple, plus a continuity auditor.

### 1.2 Opening balances — three tools, one principle

ERPNext has no single "go live" wizard. It has three mechanisms that all converge
on the same trick: **every opening entry balances against a placeholder
balance-sheet account, never a P&L account**, and the placeholder is swept later
by a manual Opening Journal Entry.

| Opening | Mechanism | Balancing leg |
|---|---|---|
| AR / AP | `opening_invoice_creation_tool.py` — one summarised invoice per party, `is_opening=Yes`, backdated, auto-submitted, missing parties auto-created, **each row in its own savepoint** so one bad row doesn't roll back the good ones | Temporary Opening account (`account_type == "Temporary"`; validated) |
| Stock | `stock_reconciliation.py`, `purpose="Opening Stock"` — also seeds Item Standard Cost when none exists | Difference account forced Asset/Liability (`OpeningEntryAccountError`) |
| GL / trial balance | `journal_entry.py`, `voucher_type="Opening Entry"` → `is_opening="Yes"`, blocked once a Period Closing Voucher exists | Manual, multi-line |

**The gap that is our opportunity:** there is no bulk/CSV import for a full opening
trial balance anywhere in ERPNext (confirmed by grep on `is_opening` /
`opening_balance` across accounts+stock). An SME arrives with a 100–300 line trial
balance from their CA. Hand-keying it is the single ugliest moment of onboarding.
A trial-balance CSV → one balanced Opening Journal Entry, with server-side
debit==credit validation, is a small feature with outsized sales impact.

Also note `chart_of_accounts_importer.py` refuses to run if the company has **any**
GL Entry, and `unset_existing_data()` wipes prior accounts before rebuilding. Keep
that guard — CoA import must be one-time and pre-transaction.

---

## 2. The typed-TypeScript ledger question

frappe-books is a standalone Electron/TS accounting app with **no Frappe framework
underneath**. It is the only clean data point we have on "accounting core written
in typed application code rather than a metadata engine."

### What it proves

- **A correct double-entry core is small.** `models/Transactional/LedgerPosting.ts`
  is ~200 lines: `debit()`/`credit()` accumulate per-account entries into a map,
  `post()` runs `_validateIsEqual()` (throws unless debits == credits) and only then
  `_sync()`s. That single assertion gate is the whole correctness story.
- **The lifecycle contract fits in one abstract class.** `Transactional.ts` requires
  exactly one method — `getPosting(): Promise<LedgerPosting|null>` — and wires
  validate/afterSubmit/afterCancel/afterDelete around it. Every document type
  (invoice, payment, journal) implements one method and inherits all plumbing.
  This is a genuinely better interface than scattering hooks across controllers.
- **Balances are never stored.** `Account.json` has no balance field at all;
  `reports/GeneralLedger` sums `AccountingLedgerEntry` rows. `isDebit`/`isCredit`
  derive from `rootType` alone. Adopt as a hard invariant: cached balances may exist
  only as an explicitly recomputable read model.
- **Immutable reversal works.** `AccountingLedgerEntry.revert()` is idempotent,
  flags the original `reverted=true`, and writes a *new* mirrored row with
  `reverts=<original>`. Nothing is edited or deleted. This is the audit trail an
  Indian statutory auditor expects.
- **Schema/behaviour split survives without a metaframework.** `schemas/app/*.json`
  = shape (fieldtype, target, required, naming strategy); `models/baseModels/**/*.ts`
  = behaviour via typed `FormulaMap` / `ValidationMap` / `ReadOnlyMap` / `DefaultMap`.
  `backend/database/core.ts` diffs schema JSON against SQLite columns and auto-migrates.
  So "doctype-like" is achievable without inheriting a metaframework.

### What it fails to prove

- **The typing is shallower than it looks.** Fieldnames in the hook maps are plain
  strings, not compile-time-checked against the schema. You get TS on the document
  *class* properties, declared by hand, mirroring the JSON. Without generated types
  from schema, this is stringly-typed with extra steps — and the generation step is
  the actual engineering work PHASE5 must cost.
- **It is single-writer.** `fyo/models/NumberSeries.ts` does read → existence-check →
  write with no lock. Fine for one Electron user, unsafe the moment there are two.
  This is not a small patch; it means the whole app was designed without contention
  in mind.
- **Everything the metaframework gives you is absent.** No permissions, no roles,
  no workflow beyond draft→submitted→cancelled, no server scripting, no REST/RPC
  layer, no multi-tenancy. That is the real trade the PHASE5 decision is about — the
  ledger is the easy part.
- **No accounting depth.** No fiscal period close or period lock, no cost centres /
  dimensions on ledger rows (only account, party, referenceType/Name), no FX
  gain/loss (just `amount * exchangeRate` at posting time), no GST mechanics at all.

### Tax model, specifically

`Tax.json` + `TaxDetail.json` = a template that is an ordered list of
`(account, rate)` pairs; `Invoice.getTaxItems()` applies each to the line's net
amount, `getTaxSummary()` groups by account into posting legs. CGST+SGST models
naturally as two TaxDetail rows.

That shape is right and worth adopting. Everything that makes it *Indian* is absent:
HSN/SAC-driven rate lookup, place-of-supply → CGST+SGST vs IGST selection,
inclusive-of-tax pricing, tax-on-tax, reverse charge, TDS/TCS. Net-new design.

**Verdict for PHASE5:** frappe-books validates the ledger-in-typed-code approach and
gives us a posting/reversal design worth copying at the design level. It does not
validate skipping a metadata layer for the *rest* of the ERP, and its own typing is
weaker than the "typed TS" framing suggests.

---

## 3. Shop floor

### What the references implement

| Capability | Best reference | Notes |
|---|---|---|
| Operator time + capacity double-booking guard | `erpnext/erpnext/manufacturing/doctype/job_card/job_card.py` | `validate_overlap_in_time_log` / `validate_employee_overlap` compare against every open job card on the same workstation and employee, against `Workstation.production_capacity` (parallel slots) — slot allocation, not a boolean overlap test. Best-in-class here. |
| OEE | `odoo/addons/mrp/models/mrp_workcenter.py` | `mrp.workcenter.productivity` logs time against a `loss_type` taxonomy (productive / performance / quality / availability); `oee = productive/(productive+blocked)`. A real OEE engine from one unified time-log table. |
| Downtime | `erpnext/.../downtime_entry/downtime_entry.json` | Reason-coded, machine+operator — but **not linked to the Job Card it interrupted**, so it cannot feed OEE or delay-cause analysis. Odoo's model is strictly better. |
| Quality inspection | `erpnext/erpnext/stock/doctype/quality_inspection/quality_inspection.json` | One doctype, template-driven, `inspection_type` ∈ Incoming/Outgoing/In Process, attachable to 7 transaction types, structured readings tied to batch/serial. Take as core design. |
| Batch genealogy | `erpnext/erpnext/stock/doctype/batch/batch.json` | `parent_batch` self-link + `reference_doctype`/`reference_name` gives upstream/downstream recall tracing. |
| MRP / demand planning | `erpnext/.../production_plan/production_plan.json` | SO/MR demand → assembly qty → BOM explosion → RM plan → safety stock → WO/MR generation. Mature; take the flow. |
| Machine reliability | `odoo/addons/maintenance/models/maintenance.py` | `MaintenanceMixin` computes MTBF/MTTR from closed *corrective* requests, plus `estimated_next_failure`. Nothing in ERPNext computes these. |
| Scrap | `odoo/addons/mrp/models/stock_scrap.py`, `mrp_account/models/mrp_workorder.py` | Scrap = a stock move to a scrap location at standard cost; labour = `hours × workcenter.costs_hour`. **No cost-of-quality P&L line in either system.** |
| Rework | ERPNext Corrective Job Card (`is_corrective_job_card`, `for_job_card`, `for_operation`) | A workflow flag, not a costed rework job. Pattern worth taking, cost capture must be added. |

### The gaps that matter for an Indian factory

These returned **zero grep hits across both erpnext and odoo/addons**:

1. **Material Gate Entry / inward-outward register.** No gate entry, no vehicle number,
   no driver, no time-in/time-out. This is the first physical checkpoint for every
   inbound and outbound movement in an Indian factory and it precedes any Purchase
   Receipt or Delivery Note. Entirely unimplemented upstream.
2. **Weighbridge.** Zero hits for `weighbridge` anywhere. No gross/tare/net capture,
   no device integration point, no tie-back from slip to PR/DN quantity variance.
   Hard requirement for steel/casting/chemical/agro SMEs.
3. **Delivery Challan as a non-invoice goods movement.** Job-work dispatch, returnable
   gate pass, tool loan, sample dispatch — with expected-return-date and e-way-bill.
   ERPNext's Delivery Note is invoice-linked dispatch; not the same document.
4. **Shift master / shift-wise production.** ERPNext has a flat
   `workstation_working_hour` list plus a holiday list; Odoo `mrp` has no shift entity
   at all. No "Shift A produced X of Y" rollup tied to a roster. (HRMS *does* have a
   shift model — see §5 — but it is not wired to production output in any reference.)
5. **Cost centre / dimension on ledger rows** — see §2; a manufacturing P&L is
   normally read per cost centre.

Not read this pass, flagged: `erpnext/erpnext/manufacturing/scheduling/`
(`engine.py`, `plan_adapter.py`, `DESIGN.md`) — may contain real finite-capacity
scheduling; and `erpnext/erpnext/quality_management/doctype/{non_conformance,quality_action}`
(CAPA workflow). Odoo's real Quality app is not in this checkout (no `quality/`,
no `mrp_workorder/`), so Odoo-side QC could not be evaluated at all.

**Items 1–4 are the differentiator.** They are not exotic; they are the daily
operating reality of the target customer and no open reference implements them.

---

## 4. Onboarding and migration — an adoption problem

Frame: nobody buys an ERP. They buy a *migration*. The features in §3 decide
renewal; the material in this section decides whether there is a first invoice at all.

### The three-step reality

1. **Get their data in.** Master data (customers, suppliers, items, CoA) from an
   arbitrary Excel/Tally export.
2. **Get their balances in.** AR, AP, stock, trial balance, as of go-live date.
3. **Keep their CA happy.** GSTIN, HSN, place of supply, reverse-charge on every
   migrated document, or GSTR reconciliation breaks and the CA vetoes the switch.

### Import machinery — what to take from where

| Capability | Reference | Take? |
|---|---|---|
| Header→field mapping by label/fieldname with per-doctype cache | `frappe/core/doctype/data_import/importer.py::build_fields_dict_for_column_matching` | Yes — but only sufficient for templates *we* generate |
| **Type-gated fuzzy header matching + persisted per-source mapping memory** | `odoo/addons/base_import/models/base_import.py::_extract_header_types`, `_get_mapping_suggestion` (SequenceMatcher, cutoff 0.2) | **Yes — highest-value single idea here.** Prospect exports never have matching headers; the second export from the same customer should auto-map perfectly |
| **Per-*value* remapping** ("Bombay Steel Corp" → "Bombay Steel Corp Pvt Ltd") without re-uploading the file | `frappe/core/doctype/data_import/value_mapping.py` | Yes — this is the difference between an import a non-technical clerk can finish and a wall of red errors |
| Resumable/idempotent import via persisted per-row log | `frappe/.../data_import/importer.py::import_data` + Data Import Log | Yes — a 5,000-row import dying at row 3,412 must retry only that row, not re-fire side effects on 3,411 |
| Insert/Update/**Upsert** with diff-before-save no-op skip | `importer.py::update_record` (uses `version.get_diff`) | Yes — monthly master-refresh re-imports shouldn't version-bump unchanged rows |
| Tree import: parent-by-alias, cycle detection, topological insert order | `importer.py::build_tree_preview`, `sort_tree_payloads` | Yes — a CoA or item-group tree from a customer file is never in parent-before-child order |
| External ID vs internal DB ID (`id` vs `.id`) | `odoo/odoo/orm/models.py::load` | Yes — the primitive that makes repeat imports idempotent |
| Batch insert with per-row savepoint fallback on error | `odoo/odoo/orm/models.py::flush` | Yes — bulk speed, per-row diagnostics |

### Tally — the honest position

**No working Tally integration exists in any of the five repos.** ERPNext shipped a
Tally Migrator in v12 (PR #17405); only the changelog line survives in
`erpnext/erpnext/change_log/v12/v12_0_0.md`. The only other trace is
`erpnext/erpnext/public/js/setup_wizard.js` line 73, where "Tally" heads the
`persona_current_system` dropdown — i.e. ERPNext's own onboarding assumes you are
coming from Tally, and then offers you nothing.

What the repos *do* give us is a precise specification of the target shape a Tally
bridge must fill:

| Tally concept | Target shape | Mapping difficulty |
|---|---|---|
| Ledger under Group (flat; groups are labels) | `Account` nested set: `parent_account`, `lft`/`rgt`, `is_group`, `root_type` (5 values), `account_type` (~30 enum) — `erpnext/erpnext/accounts/doctype/account/account.json` | **Hard.** Tally has no `root_type`/`account_type` concept. Wrong inference breaks P&L vs Balance Sheet for every account. Needs heuristics + human review step. |
| Named voucher types (Sales/Purchase/Payment/Receipt/Contra/Journal/DN/CN/Stock Journal + user-defined) | `voucher_type` is a **DocType name**, not an enum — `gl_entry.json`, `stock_ledger_entry.json` | Not a rename. Each maps to a different document class with different mandatory fields and validation. |
| Stock Items / Stock Groups / Godowns (optional module; many Tally SMEs are accounts-only) | Item / Item Group / Warehouse + full perpetual `stock_ledger_entry.json` (FIFO queue, valuation_rate, batch/serial) | Detect whether inventory is even enabled; likely backfill opening stock via one Stock Reconciliation rather than replaying history |
| — (absent in Tally) | GSTIN, gst_category, place_of_supply, HSN per item/line, reverse-charge — all custom fields in `frappe-india-compliance/india_compliance/gst_india/constants/custom_fields.py`, HSN master in `.../data/hsn_codes.json` | Must be derived or collected during migration, or GSTR reconciliation on migrated invoices fails |

**Tally's own formats — XML export schema, ODBC layer, TDL, Tally Prime vs ERP 9
differences — are not present in any repo and must not be inferred from this
codebase.** That is external research (Tally documentation / a real export file)
and is a prerequisite before any interop spec can be written. Treat it as a
scheduled research task, not a design task.

**Position:** the ecosystem has left Tally interop unsolved at the connector level.
Both Frappe and frappe-books fall back to generic field-mapped CSV. A real bridge
(XML/ODBC, with CoA-type inference and a GST-completion step) is an evidenced,
genuine competitive gap and is probably the strongest single wedge available.

---

## 5. The rest

### HR — shifts and attendance · **MVP: in, minimum viable slice**

HRMS has a complete, credible shift→payroll pipeline and it is the one place a
reference implements something Indian factories actually need end to end:

- `hrms/hr/doctype/shift_type/shift_type.py` — start/end, check-in window buffers,
  grace periods, two punch modes (alternating vs strict `log_type`), and
  `working_hours_threshold_for_half_day` / `_for_absent` driving status.
- `hrms/hr/doctype/employee_checkin/` — biometric ingestion (`device_id`,
  `add_log_based_on_employee_field` matching by `attendance_device_id`),
  `fetch_shift()` deciding which shift a punch belongs to, geofence radius check,
  duplicate-log guard, `skip_auto_attendance` for corrections.
- `ShiftType.process_auto_attendance()` — batched, checkpointed on
  `last_sync_of_checkin` (so offline devices syncing late are safe), marks
  Absent/Half Day/Present, sets late_entry/early_exit, then marks absent for dates
  with no attendance at all.
- `hrms/hr/doctype/leave_ledger_entry/` — append-only signed-delta ledger; balance is
  `SUM(leaves)`. Same invariant as the GL. Prevents retroactive balance editing.
- `hrms/payroll/doctype/salary_slip/salary_slip.py` —
  `calculate_lwp_ppl_and_absent_days_based_on_attendance()` converts Absent/Half Day/
  On Leave rows into LWP/PPL days using each Leave Type's
  `fraction_of_daily_salary`, giving `payment_days`.

MVP slice: shift type + assignment (with overlap guard) + checkin ingestion +
auto-attendance + LWP/absent day count feeding the wage sheet. Defer: leave
encashment, earned-leave accrual schedules, multi-level approval, geofencing,
overtime types (`actual_overtime_duration` was not examined and Indian OT rules —
1.5×/2×, minimum thresholds — need their own spec).

### Barcode and POS · **MVP: warehouse barcode in, POS out**

- `odoo/addons/barcodes/models/barcode_rule.py` + `barcode_nomenclature.py` —
  sequence-ordered regex rules with `{N}`/`{D}` numeric extraction; extensible types.
- `odoo/addons/barcodes_gs1_nomenclature/` — `gs1_decompose_extended()` parses
  FNC1-delimited Application Identifiers, so **one scan yields product + lot +
  expiry + qty**. This eliminates manual lot entry at receiving. Take this.
- `odoo/addons/barcodes/models/barcode_events_mixin.py` — `_barcode_scanned` onchange
  hook; clean pattern to bolt scanning onto picking / work-order screens.
- `odoo/addons/stock/models/stock_move_line.py` — lot/serial validation at pack time
  (`_onchange_serial_number` duplicate-serial guard).

**Critical gap: `stock_barcode` is absent from this checkout (Odoo Enterprise-only).**
The parsing infrastructure and lot/serial models are Community; the *warehouse
scanning UI* — pick, receive, count — is not. That UI is custom work for us either
way. POS (`odoo/addons/point_of_sale/`) is retail-shaped: session open/close with a
batch accounting post, auto-validated single-step pickings. The session-close
accounting pipeline (`_accumulate_amounts` → tax grouping → payment splits → COGS →
reconcile) is a good architectural reference for any batch-close job, but POS itself
is out of scope for a manufacturing ERP.

### Maintenance and repair · **MVP: out; Phase 2**

`odoo/addons/maintenance/models/maintenance.py` is the strongest design here:
preventive vs corrective split, recurring requests auto-cloning on completion with
`schedule_date += repeat_interval`, MTBF/MTTR from closed corrective requests only,
`estimated_next_failure`, equipment categories carrying default technician and
custom property definitions, team dashboards, kanban `blocked` state (= waiting on
parts).

`odoo/addons/repair/` (draft → confirmed → under_repair → done, `repair_line_type`
add/remove/recycle, `under_warranty` zeroing prices, auto-created sale order lines)
is customer-RMA-shaped, not in-house-machinery-shaped. `odoo/addons/fleet/` is cost
tracking with no MTBF/team/recurrence — skip unless the customer runs delivery
vehicles.

Gaps in all of them: maintenance does not consume spare parts from stock or raise
POs, does not reduce production capacity during scheduled downtime, and has no cost
centre allocation. Those integrations are the actual value and they are ours to build.

### BI · **MVP: embedded reports only; no BI platform**

`frappe-insights` is a full standalone BI app: Ibis-abstracted connectors across
7 databases, queries as JSON operation pipelines (`filter`/`summarize`/`join`/
`pivot_wider`/…) compiled to SQL, an embedded DuckDB warehouse with incremental
sync (cursor column + primary key upsert) and 30-day unused-table cleanup, 10-minute
result caching keyed on `digest(sql, backend_id)`, team-based resource permissions,
and pagination + `concurrent_limit(wait_timeout=0)` to fail fast rather than exhaust
the pool.

Genuinely good architecture, and entirely disproportionate to "an SME wants six
dashboards." Two ideas are worth lifting without the platform: the JSON operation
pipeline as a serialisable query representation, and the embedded-DuckDB warehouse
for aggregate/history data so heavy reporting never touches the operational DB.
Note its caching is wrong for us — 10 minutes is far too stale for operational
metrics; we want event-driven invalidation on posting.

---

## 6. Deployment and ops

| | Frappe / ERPNext | Odoo | Ever-Gauzy |
|---|---|---|---|
| DB | MariaDB **or** PostgreSQL **or** SQLite | PostgreSQL only | PostgreSQL 17 only |
| Services | app + Redis + RQ queue + gevent-websocket (in-process) | app (gevent workers) + PG | PG + Redis + Minio + OpenSearch + Cube.js + Jitsu + Zipkin + Nginx |
| Multi-tenancy | **Native — database per site, one bench** (`bench new-site`) | One instance per tenant | One compose stack per tenant |
| Realistic RAM | 4 GB works, 8 GB comfortable, 20–50 users | 4 GB min, 8 GB+ recommended | 8 GB+ before it's usable |
| Migrations | Patch-based, `bench migrate`: hooks → patches → doctype sync from code → fixtures | LTS-pinned deps per Python/distro release | — |
| Backup | `bench backup` / `bench restore`, per-site encryption key, full dumps only | — | — |

References: `frappe-frappe/frappe/installer.py`, `frappe/commands/site.py`,
`frappe/migrate.py`, `frappe-frappe/pyproject.toml`, `erpnext/pyproject.toml`,
`odoo/debian/control`, `odoo/setup/odoo`, `ever-gauzy/docker-compose.infra.yml`.

**Read on our own ops burden:**

- Multi-tenancy is the margin decision. Database-per-tenant on a shared runtime
  (Frappe's model) means one 8 GB box can serve many SMEs. Instance-per-tenant
  (Odoo, Gauzy) multiplies infrastructure by customer count. If we are SaaS, we
  must design database-per-tenant from day one — it is not retrofittable.
- Dependency footprint is a support cost, not a technical one. Frappe's stack is
  four processes; Gauzy's is nine services with persistent volumes each. Every
  service is an on-call surface. For self-hosted SME deployments on a customer's
  own box, anything beyond app + DB + Redis will be operated badly.
- Self-host will be demanded. Indian manufacturing SMEs frequently insist on
  on-premise, and the hardware budget is a ₹40–80k/yr class server. That rules out
  a Gauzy-shaped architecture entirely and argues for a stack that runs acceptably
  on 4 GB.
- Patch-based migrations (versioned code files + declarative schema sync from code)
  beat hand-written SQL migration files for a product shipping to many independently
  upgraded customer installs. Adopt the shape.

Not covered by any repo and therefore ours to solve: automated backup/retention
(all three offer manual CLI full dumps only), disaster recovery/failover, bulk
import runtime benchmarks (critical when migration time is a sales commitment), and
SaaS metering/billing.

---

## 7. Safe to defer past MVP

| Deferred | Reasoning |
|---|---|
| BI platform | Embedded fixed reports + a handful of parameterised dashboards cover SME needs. A query builder is a product in itself. Revisit once customers ask the *same* ad-hoc question three times. |
| POS | Retail surface. No manufacturing SME buys the ERP for it. |
| Maintenance / MTBF / preventive scheduling | Real value, but only after production and inventory are trustworthy. Downtime capture (reason-coded, **linked to the job card**) should ship in MVP so the data exists when the module arrives. |
| Fleet | Only relevant if the customer owns delivery vehicles, and even then it's cost tracking that accounting already does. |
| Repair / RMA | Customer-service revenue stream, not core manufacturing. |
| Multi-currency FX gain/loss | Multiply-by-rate-at-posting covers domestic SMEs. Importers/exporters need proper realized/unrealized treatment — defer until a customer needs it. |
| Leave encashment, earned-leave accrual, multi-level leave approval | Attendance→wage-sheet is the blocking half. Leave policy sophistication is not. |
| Finite-capacity scheduling | Job cards + workstation capacity guard cover the floor. Real APS is a multi-quarter project. (Read `erpnext/erpnext/manufacturing/scheduling/DESIGN.md` before scoping.) |
| CAPA / non-conformance workflow | Ship the Quality Inspection doctype in MVP; CAPA layers on top later without schema churn. |
| Geofenced attendance, OpenSearch-class search, distributed tracing | Ops weight with no SME-visible payoff. |

**Not deferrable, restated:** statutory numbering with FY+GSTIN scoping and a gap
auditor; opening balances for AR/AP/stock/trial balance; a Tally import path; the
attendance→wage-sheet pipeline; gate entry / weighbridge / delivery challan if the
target vertical is metals, chemicals or agro-processing.
