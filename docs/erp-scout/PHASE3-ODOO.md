# Phase 3 — Odoo 19.0 Community: architectural teardown

**Scope.** This report covers **Odoo Community only**, from a source checkout that identifies itself as
`odoo/release.py:15 → version_info = (19, 0, 0, FINAL, 0, '')`. 631 addons, of which 224 are `l10n_*`
localization packs. Everything asserted below is anchored to a repo-relative path in that checkout.
Enterprise addons are **not** present; Section 5 lists the verified holes and how they were verified.

Companion reports: ERPNext in `PHASE2-ERPNEXT.md`, Gauzy + IDURAR in `PHASE1-GAUZY-IDURAR.md`.

**Evidence note.** This synthesis is built from the deep-scan reports across seven subsystems
(ORM/registry, module system, security, `account`, `payment`/EDI/analytic/pricing, `stock`+valuation,
`mrp`, sale/purchase, HR/resource, web client). No separate adversarial audit contradicted the scans on
any load-bearing claim; where a scan hedged (e.g. "the account.report renderer *appears* absent") the
report below states the verification command that settles it rather than the hedge. Two places where
scans disagreed with themselves are flagged inline as **[unsettled]**.

---

## 1. Verdict

**World-class at.** Odoo is the only open-source ERP that has solved *composability at the data layer*.
A later addon's model class is not a subclass at runtime — it is prepended as an additional **base** of a
single dynamic class per model (`odoo/orm/model_classes.py:152-230`), so every recordset in the process
sees an override instantly, including through models that inherited the patched model. On top of that
sits a genuinely deep compute/dependency engine that inverts `@api.depends` dotted paths into a
registry-wide trigger tree and walks it *backwards* through the inverse-field map to decide exactly which
records of which fields to recompute (`odoo/orm/registry.py:621-695`, `odoo/orm/models.py:6756-6918`).
The business-domain depth built on that is the real asset: the tax engine
(`addons/account/models/account_tax.py:1143-1341`), the double-entry location ledger in `stock`, the
declarative procurement rule engine (`addons/stock/models/stock_rule.py`), the working-time interval
algebra (`odoo/tools/intervals.py` + `addons/resource/`), and the reconciliation/exchange-difference
model are each ten-plus years of edge cases that no greenfield team will re-derive from first principles.
Schema migration is convergent and automatic: declare a field, `_auto_init` reconciles the Postgres table
(`odoo/orm/models.py:3170-3247`), with a deferred-constraint queue and staged `pre`/`post`/`end` scripts
so the product upgrades in place.

**Weak at.** Everything Odoo does well, it does by fusing the domain model to Python's mutable-class
semantics and to PostgreSQL. There is no abstraction seam anywhere — a port is a rewrite of the same
design, not a lift of the code. The global mutable registry has no ownership, no versioning of the patch
surface, and no way to see the effective definition of a model without booting the server. View
inheritance by XPath against another module's markup is the fragile half of the extension bet, and
`ir.ui.view.priority` exists explicitly to hack around ordering conflicts the code's own comments call
"dependency hell" (`odoo/addons/base/models/ir_ui_view.py:770-778`). Business flow is entangled with UI:
`pre_button_mark_done` returns `ir.actions` wizard dicts, so closing a manufacturing order is not
callable headlessly without threading `skip_*` context flags. Context keys are used pervasively as
hidden control flow (`skip_invoice_sync`, `no_procurement`, `fifo_qty_already_processed`,
`force_manual_consumption`, ~30 more), so behaviour is not inferable from signatures. Installing a module
takes an `EXCLUSIVE` table lock, commits mid-request, and rebuilds the in-process registry
(`odoo/addons/base/models/ir_module.py:610-650`) — which rules out immutable or rolling deployments, and
is forbidden inside tests by the code itself. And several subsystems are visibly mid-refactor in a
*released* version: `stock.valuation.layer` has been deleted in favour of recompute-on-read, with dead
`_run_avco`, commented-out landed-cost blocks, and memory-guard batching left in place.

---

## 2. Module depth matrix

| Module | Depth | What it really implements | Key files |
|---|---|---|---|
| `odoo/orm/` | Very deep | Two-tier class system (definitions vs registry classes), per-attribute field merge, trigger-tree recompute, per-transaction cache with prefetch groups, lazy write-behind flush driven by SQL metadata, convergent schema migration | `odoo/orm/model_classes.py` (633), `odoo/orm/models.py` (7130), `odoo/orm/registry.py` (1296), `odoo/orm/fields*.py` (~6100), `odoo/orm/environments.py` (964) |
| `odoo/modules/` + `base` | Deep | Manifest plugin descriptor, dependency DAG with phase computation, XML/CSV seed data keyed by external id, desired-state upgrade reconciliation, `pre/post/end` migration scripts, `auto_install` bridge modules | `odoo/modules/module_graph.py:33-200`, `odoo/modules/loading.py:110-330`, `odoo/addons/base/models/ir_model.py:2376-2725`, `odoo/modules/migration.py:58-253` |
| Security | Deep | Four ORM-enforced layers: group lattice, model ACL matrix, record-rule domains (global AND / group OR), field-level `groups=` enforced *inside* domain→SQL compilation | `odoo/addons/base/models/res_groups.py`, `ir_model.py:2141-2160`, `ir_rule.py:141-173`, `odoo/orm/domains.py:1115` |
| `account` | Very deep | Unified `account.move`/`account.move.line` for invoices, bills, entries and payments; generic multi-country tax engine; reconciliation as a partial-edge graph; sequence inference; chart-template localization | `account_move.py` (7456), `account_move_line.py` (3777), `account_tax.py`, `sequence_mixin.py`, `chart_template.py` |
| `stock` (+`stock_account`, `stock_landed_costs`) | Very deep | Double-entry location ledger, quant reservation counters with eventual consistency, pull/push rule engine, orderpoints + scheduler, lot/serial + nested packages, valuation (std/FIFO/AVCO) and anglo-saxon COGS | `stock_move.py`, `stock_quant.py`, `stock_rule.py`, `stock_warehouse.py`, `stock_account/models/product.py` |
| `mrp` (+`mrp_account`, `mrp_subcontracting`) | Deep | Batch-quantity BoMs with variant filtering, kits as procurement-time explosion, MO state as derived compute, work-order scheduling as calendar leaves, joint-product cost share | `mrp_bom.py:369-474`, `mrp_production.py:570-604, 1981-2214`, `mrp_workcenter.py:339-437`, `mrp_account/models/mrp_production.py:57-92` |
| `sale` / `purchase` (+`_stock`) | Deep | Tri-quantity order-line ledger (ordered/fulfilled/invoiced), pluggable fulfilment source, invoicing policy, down payments as negative lines, idempotent procurement launch, vendor pricelists | `sale_order_line.py:983-1106`, `purchase_order_line.py:164-177`, `sale_stock/models/sale_order_line.py:385-424`, `purchase_stock/models/stock_rule.py:58-165` |
| `resource` / HR | Deep (resource) / Solid (HR apps) | Interval algebra over weekly calendars; employee as append-only `hr.version` timeline; leave duration in days *and* hours; declarative overtime rule engine; timesheets as analytic lines | `odoo/tools/intervals.py`, `resource_calendar.py:327-623`, `hr/models/hr_version.py`, `hr_holidays/models/hr_leave.py:585`, `hr_attendance/models/hr_attendance_overtime_rule.py` |
| `payment` / EDI | Solid–deep | PSP provider/method split with capability flags and an eligibility sieve; idempotent webhook state machine; capture/refund as child transactions; UBL/CII as an AbstractModel inheritance chain rendering a dict tree | `payment/models/payment_transaction.py:1002-1063`, `payment_provider.py:555-663`, `account_edi_ubl_cii/`, `account/tools/dict_to_xml.py` |
| `analytic` | Deep | Multi-dimensional cost allocation as one JSON column, GIN-indexed and group-by-able; plans materialize real runtime columns; cartesian distribution merge | `analytic/models/analytic_mixin.py:31-45`, `analytic_plan.py:118-370` |
| Web client | Deep | Fully metadata-driven views: XML arch + xpath inheritance, client-side Python expression evaluator for modifiers, server-side arch postprocessing | `odoo/addons/base/models/ir_ui_view.py`, `odoo/tools/template_inheritance.py`, `addons/web/static/src/views/` |
| Reporting engine | **Definitions only** | `account.report`/line/expression models + 165 report data records ship; the evaluator and UI do not | `addons/account/models/account_report.py` (967 lines, fields only) |

---

## 3. THE ARCHITECTURAL BETS

### Bet 1 — In-place model patching via `_inherit` (runtime class composition)

**What it is.** `MetaModel` collects every class per module; `Registry.load()` walks that list and calls
`model_classes.add_to_registry()` (`odoo/orm/model_classes.py:152-230`), which either creates a new
dynamic class or, if `_name` already exists, **prepends** the new definition to the existing registry
class's base tuple. `__bases__` reassignment is deferred to `_prepare_setup()` because it is slow.
`pool is not None` is the sole discriminator between a static "model definition" and a per-registry
"model class". Three cleanly separated mechanisms: `_inherit` alone = in-place patch; `_inherit` + new
`_name` = prototype copy to a new table; `_inherits` = delegation, implemented by materializing every
parent field as a `related` field with `inherited=True` over a required delegate Many2one
(`model_classes.py:465-508`). Fields merge **per attribute** across all definitions via `_base_fields__`,
so a downstream module flips `required=True` without restating the field
(`model_classes.py:369-415`). Read the design essay at `model_classes.py:32-139` before designing
anything.

**Buys.** 631 addons compose without forks. Field ownership is stamped into `ir.model.data`
(`ir_model.py:1252-1273`) so uninstalling an addon drops exactly its columns. `_inherits` delegation costs
zero extra machinery because it reuses the related-field engine, including `create()` cascading to parent
records and record rules on parents.

**Costs.** No ownership model, no patch versioning, no static view of a model's effective definition.
`_check_model_extension` only guards abstract/transient flips (`model_classes.py:233-250`). Registry
rebuild is expensive enough that the code is full of micro-optimizations around it, including a CPython
hack at `registry.py:530`. It requires runtime class mutation — a language without it needs a different
composition strategy entirely.

**Recommendation: ADAPT.** Take the semantics (composition by MRO, per-attribute field override, the
`_inherit`/`_inherits`/prototype trichotomy) and the ownership stamping. Reject the *unbounded* patch
surface: require an extending module to declare which model+fields it is extending in its manifest, so
the effective schema is computable statically without booting. In TypeScript this is a mixin chain
rebuilt at boot from a declared extension manifest.

### Bet 2 — One `account.move` / `account.move.line` for every financial document

**What it is.** `account.move.move_type ∈ {entry, out_invoice, out_refund, in_invoice, in_refund,
out_receipt, in_receipt}`; `account.move.line` carries the accounting facet (account, debit/credit,
balance, amount_currency) *and* the commercial facet (product, qty, price_unit, discount, subtotals)
simultaneously, with `display_type` deciding the role (`product | tax | payment_term | rounding |
discount | epd | line_section | line_note | …`). Invoice totals are **not** stored independently — they
are re-derived by summing line balances filtered by `display_type` times `direction_sign`
(`account_move.py:1146-1219`). The balanced invariant is a contextmanager around create/write running a
single `GROUP BY … HAVING ROUND(SUM(balance)) != 0` query in SQL, deliberately avoiding computed stored
fields (`account_move.py:2766-2806`).

**Buys.** Every report, aging, reconciliation, tax return and audit trail works identically for invoices
and manual entries. No invoice_line table to keep in sync with journal items. Payments and bank statement
lines are thin wrappers over the same entry.

**Costs.** `account_move.py` is 7456 lines and `account_move_line.py` 3777, in one class each; invoice,
journal entry, payment sync, hashing, mail gateway, PDF sending and OCR import all live together.
Keeping the two facets from corrupting each other needs DB CHECK constraints (`credit*debit=0`,
`sign(balance)==sign(amount_currency)`, section/note lines must have no account and zero amounts) plus
`display_type` discipline everywhere.

**Recommendation: ADOPT the model, REJECT the packaging.** One ledger table is right. Split the code into
services (invoicing, tax sync, reconciliation, numbering, hashing) over the same tables rather than one
god-model. Keep the SQL balance check and the CHECK constraints verbatim.

### Bet 3 — Inventory as double-entry between locations

**What it is.** Nothing is ever incremented or decremented in isolation. Every change is a `stock.move`
from a source to a destination location; non-physical events get a *virtual counterpart* location typed by
`usage ∈ {supplier, customer, inventory, production, transit, view, internal}`
(`addons/stock/models/stock_location.py:32-47`). Receipt = supplier→internal; delivery =
internal→customer; a physical count adjustment = internal↔inventory-loss
(`stock_quant.py:996-1035`); scrap = internal→an `inventory`-usage location; intercompany = via `transit`.
`should_bypass_reservation()` (`stock_location.py:411-413`) marks the infinite-stock usages that are never
reserved against. On-hand lives in `stock.quant`, keyed `(product, location, lot, package, owner)` with
`quantity`, `reserved_quantity`, `in_date`.

**Buys.** Total auditability — every inventory report is a query over one uniform ledger. Scrap, loss,
production consumption, dropship and intercompany all collapse into "pick the right virtual counterpart".
Counts produce real moves rather than silently overwriting a number.

**Costs.** Reservation consistency is *eventual*: duplicate quants are tolerated and merged
asynchronously by scheduler jobs using raw SQL (`stock_quant.py:1123-1230`), so between runs
`quant.reserved_quantity` can disagree with the sum of open move lines. There is no DB uniqueness on the
quant key. Negative quants are legal and compensated after the fact.

**Recommendation: ADOPT.** This is the highest-value single idea in the whole codebase and should be
built first, before any warehouse feature. Keep the tolerate-duplicates concurrency strategy (it avoids
serialization failures under concurrent picking) but add a periodic assertion job that alarms on
divergence rather than silently repairing.

### Bet 4 — One declarative procurement rule engine; every app is a rule action

**What it is.** A `Procurement` is a NamedTuple `(product, qty, uom, location, name, origin, company,
values)`. `stock.rule.run()` resolves a rule per procurement and dispatches to `_run_<action>`; `purchase`
adds `buy`, `mrp` adds `manufacture`, core supplies `pull`/`push`. Rule resolution
(`stock_rule.py:566-640`) walks the location tree **upward** from the need location and at each level
tries routes in priority order — explicit `route_ids` > packaging/package-type > product | category >
warehouse — each ordered by `(route.sequence, rule.sequence)`, with warehouse-specific rules beating
warehouse-agnostic ones. Warehouse config materializes this: `get_rules_dict()`
(`stock_warehouse.py:766-792`) is a declarative `Routing(from_loc, dest_loc, picking_type, action)` table
per config key, so "2-step reception" or "pick-pack-ship" generates concrete rules, with the first rule
MTS, the rest MTO, and `propagate_cancel` deliberately cleared on the last rule of a chain.

**Buys.** Multi-level MRP explosion is an *emergent property* — a new MO's raw moves re-enter procurement
— not a separate planning run. Purchase, manufacture and dropship plug in as new rule actions rather than
new workflows. Lead times accumulate through one `_get_lead_days` hook per action, returning both a
number and a human-readable breakdown for the "why is this date" popover
(`stock_rule.py:207-244`, `mrp/models/stock_rule.py:207-244`).

**Costs.** Rule resolution is expensive and effectively undebuggable: no explain/trace facility,
misconfiguration surfaces as "No rule has been found", and `push_domain` is a `literal_eval`'d Python
string retried in a loop with growing exclusion lists.

**Recommendation: ADOPT, with a trace facility as a first-class requirement.** The engine is right; ship
`explain(procurement) → ordered candidate rules with match/reject reasons` from day one. The precedent is
`_get_compatible_providers` in `payment` (`payment_provider.py:555-663`), which already records a
machine-readable rejection reason per candidate — do that everywhere.

### Bet 5 — Fully generic, metadata-driven web client

**What it is.** Views are `ir.ui.view` records holding XML `arch` (model, type, inherit_id, mode,
priority). Child views modify parents by locator specs — `xpath`, or a `<field name=…>` match, or
tag+attribute match — with `position ∈ {inside, after, before, replace, attributes, move}`
(`odoo/tools/template_inheritance.py:71-292`). Conditional UI is declarative: `invisible`, `readonly`,
`required`, `column_invisible` hold **Python boolean expressions** evaluated client-side by a JS Python
interpreter (`addons/web/static/src/core/py_js/py.js`); when a field appears twice in an arch the
modifiers merge invisible=AND, readonly=AND, required=OR
(`addons/web/static/src/model/relational_model/utils.js:150-200`). `get_views()` returns postprocessed
arch plus `fields_get` metadata in one round trip. Odoo 19 has dropped the old `attrs`/`states` JSON dicts
entirely — `ir_ui_view.py:493` raises if any survive.

**Buys.** Zero bespoke JS per screen. Any addon can restructure any other addon's form. Studio-style
runtime customization falls out for free (`state='manual'` models/fields,
`model_classes.py:535-594`, with an `x_` namespace CHECK preventing collision with future upstream
fields).

**Costs.** XPath against someone else's markup is brittle; any upstream refactor silently breaks
downstream addons, and `priority` is the documented escape hatch. Shipping a Python interpreter to the
browser to evaluate `invisible` expressions is a large tax.

**Recommendation: ADAPT.** Keep metadata-driven views and the modifier merge rules (they are exactly
right). Reject XPath-against-markup: define *named extension points* (slots/regions/field anchors) that a
view author declares, so extensions bind to a contract rather than to a DOM path. Use a small JS/TS
expression language, not a Python interpreter.

### Bet 6 — Access control as domain expressions enforced in the ORM

**What it is.** Four layers, all in the ORM so RPC/REST/UI enforce identically. (1) `res.groups` as an
implication **lattice** with the transitive closure precomputed into a set-algebra object
(`res_groups.py:362-376`). (2) `ir.model.access`: CRUD booleans per (model, group), compiled to one
cached SQL per `(uid, mode)` returning a frozenset of allowed model names — O(1) membership, default-deny
(`ir_model.py:2141-2160`). (3) `ir.rule`: per-model domains where **groupless rules are global and AND-ed,
rules matching the user's groups are OR-ed**, and the union is AND-ed with the globals
(`ir_rule.py:141-173`); the resulting domain is injected into the SQL `WHERE` of every search
(`models.py:5373-5381`), so pagination stays correct. (4) Field-level `groups=`, checked on read/write,
in `fields_get`, and critically **inside domain→SQL compilation** (`odoo/orm/domains.py:1115`) so a hidden
field cannot be binary-searched. Multi-company is not a fifth layer: it is global rules over
`company_ids`, with a separate `_check_company` *consistency* pass (`models.py:3997-4097`) that stops you
pointing at another company's records even when rules let you see them.

**Buys.** One security model for every access path. Rules compose across modules because group rules only
ever widen. `_get_failing` (`ir_rule.py:80-111`) re-runs each rule to say *which* rule blocked *which*
records and suggests a company to switch to — 20 years of support tickets distilled.

**Costs.** Deny rules are inexpressible; restricting requires a global rule plus re-grants to everyone
else (see the HR bank-account pattern in `addons/hr/security/hr_security.xml`). `[(1,'=',1)]` rules are
used to *neutralize* another module's restriction — real cross-module coupling. Multi-company isolation is
entirely hand-written per-model rules with nothing asserting that a model with `company_id` has one.
Domains are Python strings `safe_eval`'d at runtime, validated only at write time.

**Recommendation: ADOPT the semantics, REJECT stringly-typed domains.** Keep AND-global/OR-group, the
ORM-level chokepoint, field ACLs inside query compilation, and the ACCESS-vs-CONSISTENCY split. Store
rules as structured/typed predicates validated against the schema at migration time, and make
company-scoping a *declared property* of a model that the framework enforces, not a rule an author may
forget.

---

## 4. Business rules worth inheriting

Each rule below is stated to reimplementation precision.

### 4.1 Tax computation (`addons/account/models/account_tax.py`)

- **Pure function.** `_get_tax_details(taxes, price_unit, quantity, precision, rounding_method, product,
  uom, special_mode)` — no records required. Mirrored line-for-line in
  `addons/account/static/src/helpers/account_tax.js`.
- **Order.** Flatten groups (no nesting allowed), sort by `(sequence, id)`, children inherit the parent's
  position (`:901-980`).
- **Batching.** Consecutive taxes batch when `amount_type`, `price_include` and `include_base_amount` all
  match, broken at an `is_base_affected` boundary (`:929-980`). *This is what makes two 10% price-included
  taxes divide by 1.20, not by 1.10 twice.*
- **Three passes.** Fixed taxes descending → price-included descending → price-excluded ascending
  (`:1143-1341`). Extra bases propagate between taxes via `_propagate_extra_taxes_base` (`:982-1086`,
  worked examples in comments).
- **Four closed forms** (`:1103-1141`): percent-included base = `raw/(1+Σbatch%)·rate%`;
  division-included = `raw·rate%`; percent-excluded = `raw·rate%`; division-excluded =
  `raw·rate%/(1−Σbatch%)`.
- **Special modes** `total_excluded`/`total_included` force all taxes to behave excluded/included so a
  known gross can be back-solved.

### 4.2 Rounding (`account_tax.py:1829-2298`)

- Compute every amount **raw** (unrounded, kept as `raw_*` for EDI), round **exactly once**, then
  redistribute the delta between "sum of rounded parts" and "rounded sum" cent by cent.
- `_distribute_delta_amount_smoothly(precision_digits, delta, target_factors)`: normalize factors by
  `|weight|`, allocate `round(factor·nb_of_cents)` each, hand leftover cents to the largest factors first
  (`:1846-1897`).
- Applied at three levels: per tax across base lines, per base-line total (in "included" mode when *all*
  taxes are price-included, so base+tax reconstructs the entered gross), and across a tax's repartition
  lines. The 21.53 @21% incl. worked example is in the `_round_base_lines_tax_details` docstring
  (`:2188-2298`).

### 4.3 Tax repartition and reverse charge (`account_tax.py:558-601, 2371-2518`)

- A tax owns two ordered lists (`invoice_repartition_line_ids`, `refund_repartition_line_ids`), each with
  exactly one `base` line and ≥1 `tax` lines carrying `factor_percent`, `account_id`, `tag_ids`.
- Both lists must have the **same length, order and percentages**. Positive tax factors sum to **+100**;
  if any negative factors exist they must sum to **−100** — that is the reverse-charge pattern, and it
  makes the engine emit a mirror `tax_data` with `is_reverse_charge=True`, inverted amount, forced
  price-excluded.

### 4.4 Reconciliation (`addons/account/models/account_move_line.py`, `account_partial_reconcile.py`)

- Model: `account.partial.reconcile` is an **edge** between one debit and one credit line, carrying
  `amount` (company currency, always positive) plus per-side foreign amounts. `amount_residual` is a
  stored compute from one SQL `SUM` over partials (`account_move_line.py:809-877`).
- A **connected component** of partials that reaches zero becomes an `account.full.reconcile`;
  `matching_number` is assigned by union-find over the partial graph
  (`account_partial_reconcile.py:191-231`).
- **Multi-currency.** Pick the reconciliation currency (prefer a shared foreign currency, else company
  currency), match minimum residuals, then compare the resulting company-currency amounts against a
  **±half-rounding rate interval**; if they differ only by rounding, snap them equal and emit **no**
  exchange entry (`account_move_line.py:2388-2419`, ASCII diagram in source). Otherwise the exchange
  difference entry adjusts **only** the company-currency side, never the foreign amount.
- Unreconciling is a pure edge deletion that cascades to reversing derived exchange and cash-basis
  entries.

### 4.5 Inventory valuation (`addons/stock_account/`)

- **Valued location predicate.** A location counts toward company valuation iff it has a company **and**
  `usage ∈ {internal, transit}` (`stock_account/models/stock_location.py:36-41`). This one predicate
  defines `is_in`/`is_out` for every move.
- **Consignment.** Any quant/move-line whose `owner_id` differs from the company partner is excluded from
  valuation — physically present, financially absent.
- **In-move value cascade** (`stock_account/models/stock_move.py:365-450`): manual override
  (`product.value`) > invoice/bill > production > SO/PO line > original move (returns) > `standard_price`;
  then add landed costs. Each step consumes remaining qty and appends a human-readable justification.
- **AVCO negative-stock rule** (`stock_account/models/product.py:485-533`): when `previous_qty <= 0` the
  average **resets** to the incoming unit price instead of accumulating.
- **Anglo-saxon COGS is an invoice-time journal item, not a stock-time one**
  (`stock_account/models/account_move.py:68-161`): paired `display_type='cogs'` lines injected at
  `_post`, unwound on draft/cancel, price from the linked done moves; refunds reuse the original
  invoice's COGS price.
- **Landed costs** are pro-rated by the move's `remaining_qty` — goods already sold are never
  retro-valued on the balance sheet (`stock_landed_costs/models/stock_landed_cost.py:121-152`).

### 4.6 Reservation and availability (`addons/stock/`)

- `stock.move.line` **is** the reservation: creating one raises `quant.reserved_quantity`; validating it
  transfers the quant.
- `_get_reserve_quantity` (`stock_quant.py:834-914`): down-round to the move UoM then half-up back, so you
  never over-reserve; serials reserve integers only; negative quants are netted per key before allocation.
- **Chained moves reserve strictly against what upstream delivered** — the exact `(location, lot, package,
  owner)` tuples from upstream done move lines, minus what sibling moves already took
  (`stock_move.py:1992-2039, 2136-2173`).
- `_free_reservation` (`stock_move_line.py:795-848`): when an operator picks more than was reserved, steal
  reservation back from other open lines — current picking first, then latest scheduled date.
- **Removal strategy** decides quant ordering: FIFO/LIFO by `in_date`, `closest` by location path, FEFO by
  removal date, `least_packages` by an actual A* search (`stock_quant.py:630-740`).

### 4.7 Reordering / procurement forecasting (`addons/stock/models/stock_orderpoint.py`)

- `qty_to_order = max(min_qty, max_qty) − virtual_available(at horizon) − quantity_in_progress`, then
  rounded **up** to the replenishment UoM multiple.
- **Forecast is evaluated at the lead-time horizon date**, never at today: `to_date = today + Σ(rule
  lead days along the resolved chain) + company.horizon_days` (`:484-490, 648-670`).
- `quantity_in_progress` must include documents that are **not yet stock moves** (open RFQs), or the
  scheduler double-orders — hence the `_quantity_in_progress` hook overridden by `purchase`.
- MTSO in-batch guard: `_prepare_procurement_qty` tracks a shared `consumed_from_stock_dict` so several
  moves in one batch don't each claim the same free stock (`stock_move.py:1787-1819`).
- Batch job shape worth copying (`:707-786`): batches of 1000, savepoint per batch, on failure drop only
  the failing records and retry the rest, then log a mail activity per unfulfillable orderpoint.

### 4.8 Quantity and status propagation (`addons/sale/`, `addons/purchase/`)

- An order line is a **ledger of three quantities**: ordered (`product_uom_qty` / `product_qty`),
  fulfilled (`qty_delivered` / `qty_received`), invoiced (`qty_invoiced`). Every status is a pure function
  of those three plus the order state. No workflow flags.
- **Fulfilment source is pluggable** via `qty_delivered_method ∈ {manual, analytic, stock_move,
  timesheet}` — each module adds a branch and delegates the rest to `super()`
  (`sale/models/sale_order_line.py:217-235`).
- `qty_to_invoice` = (ordered **or** delivered, per `product.invoice_policy`) − invoiced, and only while
  `state == 'sale'` (`:1047-1075`).
- **`upselling` state**: for an order-basis product where `qty_delivered > product_uom_qty` — neither
  invoiceable nor done, it is a sales opportunity (`:1077-1106`).
- **Refunds subtract only when linked back to the order** (`:983-1017`) — otherwise an unrelated credit
  note would silently make the order re-invoiceable.
- **Delivered qty from stock** subtracts incoming moves only if they are genuine returns
  (`origin_returned_move_id` set, or outgoing source location, or the picking has a `return_id`) — the
  dropship-receipt trap (`sale_stock/models/sale_order_line.py:199-220`).
- **Idempotent procurement**: procure `ordered − already_procured`, short-circuit on zero; ordered qty may
  never drop below max delivered (`sale_stock/models/sale_order_line.py:385-431`).
- **Asymmetric third-party updates**: increasing a linked PO qty is automatic; decreasing schedules a
  human activity on the PO instead of silently changing a document already sent
  (`sale_purchase/models/sale_order_line.py:75-112`).

### 4.9 Working-time calendar (`addons/resource/`, `odoo/tools/intervals.py`)

- Universal primitive: `Intervals` = ordered disjoint `(start, stop, payload_recordset)` triples with
  union/intersection/difference. **work = attendance − leave**; unavailable = inverse of work.
  The payload recordset means after computing work time you still know *which* attendance or leave
  produced each slice.
- Duration in days derives from each attendance line's `duration_days` prorated by covered fraction:
  `days = Σ(meta.duration_days) · interval_hours / Σ(meta.duration_hours)`, rounded to 0.001
  (`resource_calendar.py:623`).
- Two-week alternating schedules use `floor((ordinal−1)/7) % 2`, deliberately **not** ISO week numbers, so
  an even week always follows an odd one (`resource_calendar_attendance.py:69`).
- Batch by timezone: generate the day set once in UTC, then localize the same result once per distinct tz
  in the resource set (`resource_calendar.py:327`).
- **Approved absence is materialized into the scheduling layer** — a validated leave writes a
  `resource.calendar.leaves` row, so no other module needs to know `hr_holidays` exists
  (`hr_holidays/models/hr_leave.py:1028`).
- Same trick for capacity: a scheduled work order is a calendar leave with `time_type='other'` on the work
  center's resource, so `_get_first_available_slot` is pure interval algebra
  (`mrp/models/mrp_workcenter.py:339-408`).

### 4.10 Other rules worth stating

- **Numbering** (`account/models/sequence_mixin.py`): infer the format from the *previous document's
  name* via regex (fixed / yearly / year_range / monthly / year_range_monthly) rather than from
  configuration, so renaming `INV/2024/0001` makes the system follow. Lock the next number by `UPDATE`ing
  a row covered by the unique index inside a savepoint, retry on `UniqueViolation`, then cache the counter
  for the rest of the transaction (`:355-424`) — repeated subtransactions destroy Postgres performance.
  Gaps are **detected, not prevented** (`account_move.py:5795-5880`): a move made a gap if its number ≠
  previous+1, or if it is unposted while its predecessor is posted.
- **Posting rules** (`account_move.py:5557-5789`): a negative-total invoice is illegal (use a credit
  note); the posting date is silently snapped past any violated lock date; deletion downgrades to
  cancellation or reversal when the audit trail forbids it.
- **BoM explosion** (`mrp_bom.py:419-474`): only **phantom** children flatten — a nested normal BoM is a
  procurement boundary, not an explosion boundary. Convert through each child BoM's *batch* quantity.
  Round leaf component quantities **up** in the component's own UoM.
- **Down payments** (`sale/wizard/sale_make_invoice_advance.py:138-196`): real order lines flagged
  `is_downpayment`, re-emitted on the final invoice with `quantity = −1` and reversed tax data — so tax
  treatment, partial refund and multi-currency all fall out of the normal line machinery.
- **Webhook state machine** (`payment/models/payment_transaction.py:1002`): each setter declares its
  allowed source states; `_update_state` skips no-ops with an INFO log and **refuses illegal transitions
  with a WARNING rather than raising**. Capture/void/refund are child transactions whose completion
  re-derives the parent state by amount summation (`:1063`).
- **Cron without a broker** (`base/models/ir_cron.py:308-370`): acquire with `SELECT … FOR NO KEY UPDATE
  SKIP LOCKED` on a dedicated cursor — the row lock *is* the distributed mutex, held for the job's
  duration. `FOR NO KEY UPDATE` specifically, because `FOR UPDATE` conflicts with the KEY SHARE locks that
  FK references take. Wake on demand via `ir_cron_trigger` rows; reschedule by whole intervals in the
  job's timezone with no catch-up burst (`:641-657`). This removes Celery/Redis from the stack.
- **Inter-worker cache invalidation** (`odoo/orm/registry.py:1063-1180`): insert-only `orm_signaling_*`
  tables (not sequences — logical replication doesn't replicate sequences). Cheap, DB-only,
  replication-safe.
- **Idempotent seed data** (`ir_model.py:2433-2451`): `INSERT … ON CONFLICT (module,name) DO UPDATE …
  WHERE (res_id differs OR model differs) AND NOT noupdate`. Upgrades reconcile by desired-state diffing —
  `_process_end` deletes any non-`noupdate` record of the updated modules that was not re-seen
  (`:2637-2713`). `noupdate="1"` is the user-edit escape hatch.
- **auto_install as a list** (`ir_module.py:408-440`): a bridge module declares which deps trigger it, and
  a fixpoint sweep installs it when they are all present. `sale` + `account` ⇒ `sale_account` glue
  materializes. Cleanest known answer to the N×M integration problem — copy exactly.

---

## 5. Community vs Enterprise — verified gaps

The framework hooks are all in Community; the split is which addon directories ship.
`ir.module.module.license` enumerates `OEEL-1` and `OPL-1` alongside the OSI options
(`ir_module.py:306-317`) — the loader itself is license-agnostic.

| Withheld | Verification | Consequence for us |
|---|---|---|
| **Financial report renderer** (Balance Sheet, P&L, General Ledger, Trial Balance, Aged Receivable/Payable, Cash Flow, tax-report UI) | `account.report`/`.line`/`.expression` models ship (`account/models/account_report.py`, 967 lines) with **fields and constraints only** — no `_compute_formula_batch`, no `_expand_unfoldable_line`, no per-engine evaluator. 165 `account.report` data records ship. No `ir.actions.client` with tag `account_report` exists anywhere. `module_account_reports` is rendered with `widget="upgrade_boolean"` (`account/views/res_config_settings_views.xml:350`) — Odoo's Enterprise-upsell widget. `addons/account_journal.py:1143` carries `# TODO move to account_reports in master`. | **The single biggest gap.** Community ships statutory report *definitions* with no UI to open them. Any new ERP must build the evaluation engine. Take the 5-engine design (`domain`, `account_codes`, `aggregation`, `external`, `tax_tags`) plus root/variant/section composition — declaring statutory reports as data is why 60+ countries ship tax reports. |
| Tax closing entries | `account.tax.group.tax_payable_account_id` / `use_in_tax_closing` exist (`account_tax.py:35-49, 5286-5306`); nothing generates the periodic closing move. | Build it. Small once reports exist. |
| Bank reconciliation widget & matching engine | `account.reconcile.model`/`.line` present but only ~200 lines; the rules engine and UI are `account_accountant`. | Build it. |
| Bank statement import / online sync | Statement models ship; providers do not. | Build or integrate. |
| Follow-up / dunning | `no_followup` fields exist purely as hooks (`account_move_line.py:470-477`). | Build it. |
| Assets, deferred revenue, consolidation, budgets | Absent; `adjusting_entry_origin_move_ids` hooks exist (`account_move.py:241-264`). `module_account_budget` is an upgrade_boolean. | Build. |
| **Payroll** | `hr_payroll` confirmed absent by repo-wide `find -iname '*payroll*'`. But `hr.payroll.structure.type` is a stub in `hr/models/hr_payroll_structure_type.py`, and `hr.version._get_normalized_wage()` (`hr/models/hr_version.py:476`) says in-source "overridden in hr_payroll". **`hr_work_entry` and `hr_work_entry_holidays` ARE open** and generate typed, conflict-checked work entries. | Draw the build boundary exactly where Odoo does: everything up to "here are the typed hours for this employee this month" is solved; only the money calculation is missing. |
| Studio (runtime customization UI) | Hooks are present and functional: `_add_manual_models` / `_add_manual_fields` (`model_classes.py:535-594`), an `x_` name CHECK, and `_build_insert_xmlids_values()` carries "this method is overriden in web_studio". | The mechanism is free; only the UI is withheld. |
| Barcode, Quality, Batch/Wave picking, Dispatch, Delivery carriers, Sign-on-delivery | Settings flags `module_stock_barcode`, `module_quality_control`, `module_stock_picking_batch`, `module_delivery`, etc. Core already ships GS1 barcode generation on quants, a QC location + picking type, and `_is_single_transfer()` documented as "Overriden for batches". | Scaffolding present, features absent. |
| Shop-floor work-order execution UI, MPS, PLM/ECO, Appraisal, Referral, Documents, Sign, Approvals, Helpdesk, Field Service, Planning/Gantt | No such directories in `addons/`. `_run_manufacture` special-cases `procurement.origin != 'MPS'` for a module that isn't here. | The entire visual-scheduling and approvals layer is Enterprise. |
| Upgrade scripts | `odoo.upgrade` is imported as a namespace package (`odoo/modules/migration.py:18`) and is **empty** in Community. | Community gets the migration *mechanism*, not the cross-major-version content. |
| Currency rate live feed, Intrastat, batch payments, SEPA DD, ISO20022, OCR/document digitization | All `upgrade_boolean` in `account/views/res_config_settings_views.xml`. | Commodity integrations; build or buy. |

**What this means as a reference.** Odoo Community is a *complete and honest* reference for the data
model, the ORM, the extension mechanism, security, tax, inventory, procurement, manufacturing and
scheduling. It is **not** a reference for financial reporting, payroll, or any of the visual planning
layer — for those you get the schema and the hook, and must design the engine yourself. Notably,
withholding the report *engine* while shipping the report *definitions* is worse than shipping neither:
it leaves rows in the database with no UI.

---

## 6. Traps and correctness pitfalls a new build must not repeat

**Ordering / lifecycle**

1. **Do not make correctness depend on write ordering inside a transaction.** Odoo values out-moves
   before `super()` and in-moves after, threading a `fifo_qty_already_processed` counter, with an in-code
   comment admitting the limitation when ins and outs are validated together
   (`stock_account/models/stock_move.py:177-191`). Make valuation an explicit, ordered pipeline instead.
2. **Do not use context keys as control flow.** ~30 of them steer stock/account/mrp behaviour
   (`skip_invoice_sync`, `check_move_validity`, `no_procurement`, `bypass_lock_check`,
   `force_manual_consumption`, `quants_cache`, `inventory_mode`, …). Behaviour becomes uninferable from
   signatures and untestable in isolation. Use explicit parameters or an explicit pipeline object.
3. **Do not return UI actions from business methods.** `pre_button_mark_done` returns wizard dicts, so
   "close this MO" cannot be called from an API without `skip_*` flags. Business method returns a decision
   object; the UI layer turns it into a wizard.
4. **Per-module commit during install** (`loading.py:270-272`) leaves a partially-upgraded DB on failure —
   `button_reset_state()` exists purely to un-wedge it. Wrap an install transactionally or make each step
   idempotently re-runnable.
5. **Bidirectional synchronization is a bug factory.** `account.payment ↔ account.move`
   (`_synchronize_to_moves` / `_synchronize_from_moves`) and the subcontracting MO↔receipt sync are both
   named as fragile in-source. Generate one direction only; make the derived record read-only.

**Data model**

6. **Put reservation/consistency invariants in the database where you can.** There is no DB uniqueness on
   the quant key `(product, location, lot, package, owner)`; uniqueness is a convention enforced by
   periodic merging. Tolerating duplicates for concurrency is defensible — silently repairing without
   alarming is not.
7. **Beware stringly-typed / schemaless side-channels.** Analytic distribution is JSON with comma-joined
   id keys needing a GIN index over a regexp expression to be searchable
   (`analytic/models/analytic_mixin.py:31-45`); down payments carry tax state in a JSON blob keyed by a
   `startswith`-matched string prefix (`sale_order_line.py:850-852`); `matching_number` is a denormalized
   graph value that must be recomputed manually on both create and unlink paths (an in-source comment
   documents the bug this caused). Each is a correctness hazard the schema could have prevented.
8. **Do not create database columns at runtime for business actions.** Analytic plans create
   `x_plan{id}_id` columns and `ir.model.fields` rows when a user reparents a plan
   (`analytic/models/analytic_plan.py:316-370`). Elegant, indexed, and a migration/multi-tenant hazard.
   Use a fixed set of dimension columns or an explicit dimension table.
9. **`unlink()` invalidating the entire transaction cache** (`models.py:4321-4323`) because the ORM cannot
   model DB cascades is a design smell worth avoiding: model cascade edges explicitly.

**Recompute / dependency**

10. **Fixpoint loops that log a warning on non-convergence permit silent staleness.**
    `MAX_FIXPOINT_ITERATIONS` in `environments.py:370-390`. Fail loudly.
11. **Dependency correctness is partly convention:** `recursive=True` must be hand-declared (only a
    warning otherwise, `fields.py:830-832`), `@api.constrains` silently ignores dotted names
    (`decorators.py:110-112`), non-searchable intermediate dependencies only warn (`fields.py:840-848`).
    Make these hard errors.
12. **Cache/dirty divergence is a known, not theoretical, failure mode** — `_flush`'s `KeyError` path
    raises a bare `AssertionError` dumping the whole cache (`models.py:6426-6431`).

**Security**

13. **Field-level ACLs are enforced in Python and silently shrink prefetch groups**
    (`models.py:3369-3382, 3759-3767`) rather than being enforced in SQL; `ir.model.fields.groups` is
    annotated in-source as an unimplemented empty table, so field ACLs are code-only and not
    administrator-configurable — unlike the other three layers.
14. **`env.companies` skips validation under sudo and defaults to *all* the user's companies when
    `allowed_company_ids` is absent** (`environments.py:266-283`). Any path that loses context — reports,
    `/web/image`, mail redirects, crons — evaluates rules against a wider company set than the UI showed.
15. **`sudo()` is used pervasively as a convenience** and bypasses all four layers at once;
    `_allow_sudo_commands=False` protects only a handful of models.
16. **Records with `company_id = False` are visible to everyone** wherever a rule is written
    `company_ids + [False]` (stock.lot, stock.location, stock.quant, hr.department, …). Feature or leak,
    decided per XML line.

**Performance**

17. **Recompute-on-read valuation is O(history).** FIFO re-walks in-moves 100 at a time; AVCO replays
    every move in 50k batches with manual `invalidate_model()` calls and raw-SQL cursor caches. Use an
    append-only valuation-layer ledger — which is what Odoo *had* before 19 and is the design to copy.
18. **Python loops over moves where SQL belongs** — `_prepare_qty_delivered` carries its own TODO
    (`sale_stock/models/sale_order_line.py:201`); `hr.version._search_end_date` loads every version across
    all companies into Python.
19. **`=like prefix%` + Python regex scan on every payment-transaction create** is a latent hot spot
    acknowledged in its own comments (`payment_transaction.py:370-450`).

**Extension surface**

20. **XPath-against-markup view inheritance** breaks silently on any upstream refactor; `_check_xml` has
    to defensively handle "an invalid xpath has been forcibly written". Use named extension points.
21. **Ordered `data` lists in manifests are a manual topological sort done by humans** — Odoo's own
    manifests carry comments like "Define sale order views before their references"
    (`addons/sale/__manifest__.py`). The system already knows the dependencies (xids *are* references).
    Resolve intra-module data order automatically or defer reference binding.
22. **`noupdate` is per-record and binary.** There is no field-level "user customized this one attribute"
    tracking, so one user edit either freezes the record against all future upstream improvements or gets
    silently overwritten.
23. **Uninstall is best-effort** — `_module_data_uninstall` catches exceptions, halves batches
    recursively, and ends by logging "could not be deleted" (`ir_model.py:2612`).

**[unsettled]** Two points the scans did not resolve and which need a decision before we copy them:
(a) whether AVCO's negative-stock reset rule is correct under *partial* returns spanning a reset, and
(b) whether `mrp.unbuild`'s own in-code TODO ("will fail if user does more than one unbuild with lot on
the same MO") is fully fixed by the later serial-exclusion patch. Treat both as unverified.

---

## 7. Open questions for the owner

1. **Valuation architecture.** Odoo 19 removed `stock.valuation.layer` in favour of recompute-on-read and
   the code is visibly mid-migration. Do we adopt the pre-19 **append-only valuation-layer ledger**
   (auditable, O(1) reads, immutable) and treat 19's approach as a cautionary tale? Recommendation: yes.
2. **Where does the CRM boundary sit?** Nothing in `account`, `stock`, `mrp` or the ORM is CRM-owned. The
   real contact surfaces are: `res.partner` as the shared spine (receivable/payable properties, credit
   limit, `customer_rank`/`supplier_rank` incremented on posting, `account_move.py:5766-5782`); quotation
   lifecycle before `state=='sale'`; `crm.team`/UTM attribution on orders; `calendar.event` shared between
   CRM meetings, recruitment interviews and time-off; and the record-rule ownership pattern
   (`user_id = me OR user_id = False` OR-ed with an "all leads" group rule,
   `addons/sale/security/ir_rules.xml`). **Question: does the CRM own the partner master, or the ERP?**
   Everything else follows from that answer.
3. **Which language/runtime?** The entire extension story depends on runtime class mutation and data
   descriptors. If we build in TypeScript, we need an explicit mixin chain rebuilt at boot plus a declared
   extension manifest (Bet 1 recommendation). Confirm before any ORM work starts.
4. **Postgres-only, or an abstraction seam?** Odoo has none, deliberately: jsonb for translations and
   company-dependent values, `jsonb_path_query`, `UPDATE … FROM (VALUES …)` batched writes,
   `pg_trgm`+`unaccent`, savepoints for deferred constraints, `FOR NO KEY UPDATE SKIP LOCKED` for cron,
   recursive CTEs for view inheritance and location trees, `pg_attribute` introspection for schema
   convergence. Committing to Postgres buys enormous leverage. Confirm we are willing.
5. **Do we build the financial report engine, and when?** It is the single biggest Enterprise gap and it
   gates "is this a real accounting system". The `account.report` data model plus its 5 evaluation engines
   is a good spec; the engine itself is a meaningful project.
6. **Payroll boundary.** `hr_work_entry` shows the clean seam. Do we ship typed work entries and integrate
   third-party payroll, or build the payslip/rule engine?
7. **Multi-company: framework-enforced or author-declared?** Odoo leaves it to hand-written per-model
   rules with nothing asserting coverage. Making `company_id` scoping a declared model property the
   framework enforces is a small change with a large safety payoff — but it constrains models that
   deliberately share master data (`company_ids + [False]`).
8. **Extension governance.** If we adopt in-place model patching, do we require a manifest declaration of
   the patch surface (my recommendation), and do we version it? Without this we inherit Odoo's
   "you cannot know a model's effective definition without booting" problem.
9. **Onchange / server-driven form recalculation.** Odoo's `onchange()` is `NotImplementedError` in the
   ORM and implemented in the `web` addon (`odoo/orm/models.py:6996`) — a data layer coupled to a specific
   client architecture. Do we want server round-trips for form recalculation at all, or client-side
   computation with server validation?
10. **Localization strategy.** 224 `l10n_*` packs is the moat. The mechanism — `@template`-decorated
    methods + `data/template/{model}[-{parent}].csv` with parent-chart inheritance, discovery without
    installation, and per-country tag mappers (`account/models/chart_template.py`) — is copyable. The
    *content* is 20 years of accountant-hours. Do we port, generate, or partner?
