# Phase 5 — Frappe Framework: Settling the Metadata-Engine Question

**Repo scouted:** `frappe-frappe/` (Frappe Framework, not ERPNext).

**Licence:** MIT. `LICENSE` line 1 = "The MIT License", line 3 = "Copyright (c) 2016-2021 Frappe Technologies Pvt. Ltd. <developers@frappe.io>". Independently verified in all eight scout passes and all eight adversarial audits. **This is the only one of our four references we may read, copy, and derive from directly in a closed-source commercial product, with attribution only.** ERPNext (GPLv3) and Odoo (LGPL/AGPL) remain clean-room.

**Audit precedence:** where a scout report and its adversarial audit disagree, **the audit wins and this document says so explicitly.** Six of eight audits returned `trustworthy`; two returned `partly-inflated`. All corrections are folded in below and flagged `[AUDIT]`.

---

## 1. THE VERDICT

**ADAPT — build a deliberately thin metadata layer over conventional typed models. Do not build a DocType engine. Do not reject metadata outright.**

The ERPNext scout (Phase 2, against) and the Odoo scout (Phase 3, adopt-with-guardrails) are both right, about different things, and Frappe's source is the tiebreaker because it lets us see the seam between them.

### The reasoning, numbered

1. **The two prior scouts answered different questions.** Phase 2 evaluated the metadata *engine* — schema-as-data core, generic ORM, generic form renderer. Phase 3 evaluated the customization *overlay*. Frappe's code shows these are architecturally separable: `frappe/model/meta.py` applies typed patches to a *description* of a model. Nothing in that mechanism requires the model's storage or business logic to be generic.

2. **The engine is not fundable at our stage.** Measured on disk: `frappe/model/document.py` 2,833 lines, `frappe/model/base_document.py` 1,683, `frappe/model/meta.py` 1,113, `frappe/core/doctype/doctype/doctype.py` 2,199, `frappe/database/query.py` 2,578, `frappe/model/db_query.py` 1,688, `frappe/permissions.py` 969, `frappe/database/schema.py` 494. Plus ~99,000 LOC of Desk UI (form/ 28,014, ui/ 21,379, views/ 17,152, list/ 8,611, model/ 2,604 JS, `frappe/desk/*.py` 21,142 — every count reproduced exactly under audit). Honest total for from-scratch parity: **18–30 engineer-months before the first invoice screen exists.**

3. **The overlay is cheap and is the entire commercial argument.** Custom Field + Property Setter + the meta-overlay loop is ~220–250 lines of `meta.py`. `[AUDIT]` — the scout claimed "the entire mechanism is 120 lines"; the audit measured `sort_fields` alone at ~90, plus `apply_property_setters` ~45, plus `add_custom_fields`, `set_custom_permissions` and `_update_field_order_based_on_insert_after` — roughly double the claim. Still small. Still the highest-leverage code in the repo.

4. **The payoff of metadata is horizontal, not domain-level.** The three measurably large savings are the generic API surface, the universal audit trail, and config-driven integrations — none of which touch accounting logic. `frappe/core/doctype/version/version.py` is exactly 260 lines and gives field-level history over every entity forever, **including customer-added fields**. That property — customer extensions audited by construction — cannot be replicated in typed code without reflection you write yourself.

5. **`[AUDIT]` The single biggest number in the pro-metadata case was inflated 3.5x.** The scout claimed `frappe/api/v2.py` (651 lines) is "the entire external API for the whole product". The real surface is `api/__init__.py` 110 + `api/v1.py` 159 + `api/v2.py` 651 + `api/discovery.py` 526 + `handler.py` 358 + `client.py` 574 ≈ **2,300 lines**. The argument survives directionally — 2,300 lines for unbounded entity count is still extraordinary leverage — but at a third of the claimed magnitude. Do not quote 650 in a build-vs-buy deck.

6. **Frappe's own code marks the boundary for us.** Where the generic engine leaks, it leaks in the same place every time: `AutoRepeat.update_doc` hardcodes ERPNext fieldnames (`naming_series`, `ignore_pricing_rule`, `posting_time`, `from_date`/`to_date`) and blanket-sets *every required Date field* to `next_schedule_date`, then falls back to an `on_recurring` `run_method` hatch. **SeaRM-four** core doctypes ship imperative `get_permission_query_conditions` hooks because the declarative permission model cannot express what they need (`[AUDIT]` — the scout said "around a dozen"; the real count *strengthens* the finding). Lesson: generic engines need per-entity typed hooks. Design the hook points deliberately from day one instead of retrofitting.

7. **Type safety and the escape hatch are mutually exclusive by construction, and Frappe admits it.** `frappe/types/exporter.py` (229 lines) generates `TYPE_CHECKING` stubs back into controllers — and its own docstring excludes "customizations like change of fieldtype and addition of fields", i.e. exactly the reason the metadata engine exists. You cannot have both. Typed models for the money; metadata for the extensions.

8. **Statutory logic must be greppable.** We will defend GST reverse-charge, HSN summarisation and ITC reversal to a CA and to GSTN. That logic behind a metadata indirection is indefensible. Frappe ships **zero** statutory content — grep-verified across the repo, only unrelated `sms_gateway_url` hits for "gst". We pay that bill identically under either architecture.

### The boundary, exactly

**Criterion:** *Metadata where the cost scales with entity count and the behaviour is uniform. Typed code where the cost scales with business complexity and the behaviour is money.*

| Layer | Metadata-driven | Typed code |
|---|---|---|
| Entity/field definitions, labels, layout hints | yes | |
| Extension fields + property overrides (per tenant) | yes | |
| Generic REST/RPC CRUD surface | yes | |
| Row/field permission rules | yes (declarative) | yes (compiled to typed predicates, one chokepoint) |
| Audit trail / versioning | yes (walks the field registry) | |
| List views, saved views, filters, exports | yes | |
| Reports `execute(filters) -> (columns, rows)` | yes (the contract) | yes (the function) |
| Print formats (Jinja templates as data) | yes | |
| Dashboards, charts, number cards | yes | |
| Workflow / approvals / notifications / assignment | yes | |
| Webhooks / integrations | yes | |
| **Core domain models** (Item, BOM, Work Order, Invoice, Stock Ledger, GL) | | yes |
| **Money logic** (costing, valuation, GST, e-invoice, e-way bill) | | yes |
| **The ~40 high-value screens** (invoice entry, BOM, work order, POS, shop floor, mobile stock) | | yes |
| **Schema migrations** | | yes (Alembic/EF Core against declarative models) |

Rough shape: **70/30 metadata-to-bespoke by screen count, ~50/50 by engineering effort.** That is the honest trade.

---

## 2. What the DocType engine actually is

Precisely enough to reimplement a subset.

### 2.1 A DocType is a row plus child rows, mirrored to JSON

`tabDocType` row + `tabDocField` children + `tabDocPerm` children, mirrored to `<module>/doctype/<name>/<name>.json`. Four transformations hang off it.

### 2.2 Transformation A — JSON to DDL

`DocType.on_update` calls `frappe.db.updatedb(self.name, Meta(self))` (`frappe/core/doctype/doctype/doctype.py:541`). `MariaDBTable.create()` (`frappe/database/mariadb/schema.py:54-62`) emits a **fixed 7-column spine on every table**:

```
name         varchar(140) primary key
creation     datetime(6)
modified     datetime(6)
modified_by  varchar(140)
owner        varchar(140)
docstatus    tinyint      not null default '0'
idx          int          not null default '0'
```

Then one column per non-virtual docfield, index definitions, and `_user_tags/_comments/_assign/_liked_by` for non-child tables. Child tables (`istable=1`) instead get `parent`, `parentfield`, `parenttype` varchar(140) plus `index parent(parent)` — note: **no composite index, no FK**. `autoname == 'autoincrement'` gives a DB sequence with `bigint` PK; `autoname == 'UUID'` gives a `uuid` PK.

**This spine is the single highest-leverage idea in the repo.** It is what makes generic audit, versioning, submit/cancel/amend and list views possible at all. Steal it even if you reject everything else.

### 2.3 Transformation B — fieldtype to column type

`setup_type_map()` at `frappe/database/mariadb/database.py:183`. A flat dict. Currency/Float/Percent/Duration to `decimal(21,9)`. Data/Link/Dynamic Link/Select/Read Only/Color/Icon/Phone/Autocomplete to `varchar(140)` (`VARCHAR_LEN = 140`, `database.py:96`). Code/Text Editor/Markdown/HTML/Signature/Barcode/Geolocation to `longtext`. Check to `tinyint(4)`. Rating to `decimal(3,2)`. Password to `text`.

`get_definition()` in `frappe/database/schema.py` applies overrides: Int length > 11 promotes to bigint; varchar below 64 floored to 64 (InnoDB row-size); Link to a UUID-named doctype silently becomes `uuid`. `NOT_NULL_TYPES = Check/Int/Currency/Float/Percent`, always NOT NULL with a numeric default.

**Semantic loss:** ~20 business fieldtypes collapse to ~8 physical types. Postgres cannot distinguish a Percent from a Currency. `decimal(21,9)` everywhere is defensible for GST math, but rounding policy lives entirely in application code.

### 2.4 Transformation C — Meta assembly (the load-bearing piece)

`frappe.get_meta(doctype)` (`frappe/model/meta.py:73`) checks `frappe.client_cache` under `doctype_meta::{name}`. On miss it constructs `Meta(doctype)` and runs `process()` (`meta.py:174-182`) in exactly this order:

1. `add_custom_fields()` — appends rows from `tabCustom Field` with `is_custom_field=1`
2. `apply_property_setters()` — rows from `tabProperty Setter` override *any* DocType or DocField attribute at runtime
3. `init_field_caches()`
4. `sort_fields()` — three-tier priority: `field_order` property setter > computed `insert_after` > custom-field `insert_after`
5. `get_valid_columns()`
6. `set_custom_permissions()` — Custom DocPerm rows **replace** shipped permissions wholesale
7. `add_custom_links_and_actions()`
8. `[AUDIT]` `check_if_large_table()` — omitted from the scout's ordering

`[AUDIT]` Seven `special_doctypes` (DocField, DocPerm, DocType, Module Def, DocType Action/Link/State) partially bypass this to break circularity — but not totally: `process()` still calls `add_custom_fields()` for DocPerm and `init_field_caches()` for all seven.

Property Setter primary key is `{doc_type}-{field_name|row_name|main}-{property}` (`property_setter.py:37-39`) — **at most one setter per (doctype, field, property)**. `validate()` deletes any prior row on insert. No overlay stack, no precedence, no layering. A deliberate choice to avoid Odoo's view-inheritance merge nightmare, with a serious cost (section 4).

### 2.5 Transformation D — lifecycle hooks

`Document.insert()` runs a fixed ladder: `_set_defaults` → `set_user_and_timestamp` → `set_docstatus` → `check_permission('create')` → `check_if_latest` → `_validate_links` → `run_method('before_insert')` → `set_new_name` → `set_parent_in_children` → `validate_higher_perm_levels` → `run_before_save_methods` (before_validate / validate / before_save) → `_validate` (mandatory, selects, length, precision, sanitize, passwords, workflow — then the same for every child row) → `db_insert` → children `db_insert` → `after_insert` → `run_post_save_methods` (on_update → notify_update → global search → save_version → on_change). `_action` selects the branch: save | submit | cancel | update_after_submit.

`run_method` (`document.py:1686`) wraps each hook in `Document.hook`, whose composer looks up `frappe.get_doc_hooks()[doctype][method]` plus a `'*'` wildcard and composes app handlers around the controller method. It then unconditionally fires `run_notifications`, `run_webhooks` (`document.py:1704`) and `run_server_script_for_doc_event` (`document.py:1705`).

**Cost:** every `run_method` pays a webhook lookup, a notification lookup and a server-script lookup. A Sales Invoice with 50 line items pays this ladder dozens of times.

### 2.6 Naming series — the concurrency bottleneck

`set_new_name` (`frappe/model/naming.py:144`) dispatches on `autoname`. The series path: `getseries(prefix, digits)` at `naming.py:428` does `SELECT current FROM tabSeries WHERE name=<prefix> FOR UPDATE`, then `UPDATE tabSeries SET current = current + 1`.

**The `FOR UPDATE` row lock is held for the remainder of the enclosing transaction** — which for a Sales Invoice includes all validation, all child inserts, and every `on_submit` GL posting. Every concurrent invoice sharing the prefix serialises behind it.

For Indian SMEs this is *defensible* — gapless statutory numbering is a GST legal requirement and genuinely demands serialisation. But buy it deliberately, and **never** reuse the mechanism for non-statutory documents.

### 2.7 Permission enforcement — one chokepoint, built by string concatenation

`get_role_permissions` (`frappe/permissions.py:287`) filters DocPerm rows to roles the user holds at permlevel 0, ORs each right across matching rows, then demotes if_owner-only grants into a nested `if_owner` dict — forcing top-level read/select to 1 so the list view is reachable, everything else to 0.

Row filtering: `DBQuery.build_match_conditions` (`db_query.py:1202`) appends `owner = <user>` when if_owner applies; user-permission clauses from walking every Link field; hook SQL from `permission_query_conditions` (`db_query.py:1334`, spliced verbatim); and an OR'd `name IN (<shared>)`.

Newer path: `Engine.add_permission_conditions` (`frappe/database/query.py:1662`), `get_user_permission_conditions` (`:1604`), `get_permission_query_conditions` (`:1752`), `apply_field_permissions` (`:1518`), and `RawCriterion` (`:2305`) faking a pypika Term from a raw string.

**Two structural defects not to repeat:**

- **Two implementations of one semantics.** Single-doc checks live in `permissions.py:has_user_permission`; list checks in `db_query.py:add_user_permissions`. They are demonstrably non-identical: the if_owner branch at `db_query.py:1229-1240` is an `elif`, so when an owner constraint applies, user permissions are **not** applied to the query at all — while `get_doc_permissions` applies both. Verified in source under audit.
- **`ignore_permissions` is normalised, not exceptional.** 775 references across `frappe/*.py`, **580 of them literally `ignore_permissions=True`** (exact, audit-verified). `frappe.get_all` == `get_list(ignore_permissions=True)` (`frappe/__init__.py:1300`; `[AUDIT]` the scout said 1302). `Engine.get_query`'s own default is `ignore_permissions=True` (`query.py:233`). The *safe* path is opt-in at the framework's lowest level.

---

## 3. Subsystem cost / payoff

Costs are engineer-months for a competent team building on Postgres only, assuming the substrate below exists. `[E]` marks estimates the audits flagged as unanchored judgment rather than measurement — order-of-magnitude priors, not plan inputs.

| Subsystem | What it buys | Cost `[E]` | Verdict |
|---|---|---|---|
| **Fixed column spine** (name/owner/creation/modified/modified_by/docstatus/idx) | Generic audit, versioning, submit-cancel-amend, list views, assignment, tags, attachments — on every entity automatically, including customer-created ones | ~0 | **TAKE — day one, non-negotiable** |
| **Fieldtype → column map** | Uniform coercion, one place to reason about precision | 0.25 | **TAKE** |
| **Custom Field + Property Setter overlay** | Per-tenant fields and property overrides without a fork. *The sole irreplaceable payoff.* | 2–3 | **TAKE — this is the product** |
| **Customize Form allowlist** (35 doctype + 56 docfield props, `customize_form.py:732-830`) | A decade of "which knob breaks the app" support tickets, encoded. MIT lets us copy it verbatim. | 0.25 to copy; 6–12 *calendar* months to derive | **COPY THE LIST** |
| **Declarative permissions** (role × entity × right, if_owner, row scoping, field groups, share) | Customer-configurable security; row-level correctness by construction | 3–4 **plus external security review** | **TAKE the model, reject the implementation** — parameterised predicates, one path for doc + list, never string SQL |
| **Generic CRUD / list query engine** | One repository, serializer and list endpoint for N entities | 2–3 (subset: dict/list filters, ~20 operators, no dot-notation joins) | **TAKE (subset)** |
| **Generic REST/RPC API** | Full CRUD + bulk + introspection for unbounded entity count. `[AUDIT]` real surface ~2,300 lines, not 650 | 4–6 | **TAKE** |
| **Version audit trail** | Field-level + child-row history across every entity, forever, incl. customer fields. 260 lines. | 0.5 + **0.75 hardening for Rule 11(g)** | **TAKE, then harden — section 5** |
| **Report contract** `execute(filters) -> (columns, rows)` | Filter UI, export, totals, charting, background exec, print — free per report | 3–4 (incl. XLSX/CSV formatting) | **TAKE** |
| **Prepared Report** (background exec, auto-promote past a 15s timer, `report.py:195-205`) | Slow stock/aging/BOM reports do not block | 0.75–1.5 | **TAKE — cheap, high value** |
| **Jinja print formats + letterheads** | Per-customer statutory layouts as DB rows, no deploy | 0.75–1 | **TAKE — highest ROI metadata in the repo** |
| **Dashboards / charts / number cards** (~950 lines total) | Config-driven plant dashboards at implementation time | 0.75–1 | **TAKE — best cost/benefit ratio measured** |
| **Workflow state machine** (`frappe/model/workflow.py`, exactly 460 lines) | Configurable approval chains on *every* entity | 0.5–1 | **TAKE — only affordable as metadata** |
| **Approval inbox + signed email links** (`workflow_action.py`; `[AUDIT]` 544 lines, not 470) | Phone approval by a non-logged-in proprietor. Real selling feature for SME owners. | 0.75–1 | **TAKE** |
| **Assignment rules** (round-robin / load-balance / weighted / field) | Auto-routing to ToDos | 0.5 | **TAKE — fix the missing lock on `last_user`** |
| **Notification engine** (`[AUDIT]` 1,000 lines, not 600) | Kills the endless "email me when X" backlog | 0.75 | **TAKE — structured filters default, expression hatch narrow** |
| **Webhooks** (Jinja payload, HMAC, DB-persisted retry `[5m,30m,2h,5h,10h,10h]`, sweeper) | Every customer integration (Tally, IRP, transporter, WhatsApp) becomes a config row | 0.75–1 | **TAKE — prevents per-customer forks** |
| **Auto Repeat** (recurring docs) | Monthly AMC invoices, recurring job cards | 0.75 + long bug tail | **DEFER to v2** |
| **Virtual doctypes** (93 lines, `virtual_doctype.py`) | Tally / GSTN / MES appear as first-class entities with full UI | 0.25 | **TAKE — enormous value per line** |
| **Client Script slot** (29 lines + concat in `desk/form/meta.py:150-185`) | "Make this field red when…" absorbed without a release. No security boundary crossed. | **1 day** | **TAKE — literally one day** |
| **Job queue plumbing** (enqueue-after-commit, dedup by namespaced id, deadlock retry on 1213/1205) | Correctness under concurrent GL/stock posting | 0.5 | **TAKE — copy near-verbatim, MIT** |
| **Scheduler as DB rows** (cron, singleton file lock, per-tenant sha1 offset) | Ops retimes a job without a deploy | 0.5–0.75 | **TAKE — but see the live bug in section 6.5** |
| **Rate limiting** (duration-billed global window + per-endpoint decorator, 181 lines) | One tenant's monstrous report cannot starve the rest | 0.25 | **TAKE** |
| **Generic FORM renderer** (form/ 28,014 LOC, 48 controls) | Every entity gets a form free | 9–15 `[E]` | **REJECT for the 40 core screens; keep as fallback for customer-added fields and long-tail masters** |
| **Child-table grid** (grid.js 1,817 + grid_row.js 1,679 = 3,496 LOC; **zero `paste` handlers**) | Inline child editing | 3–4 to rebuild | **REJECT — buy AG Grid / Handsontable, drive columns from metadata** |
| **Visual print format builder** (55 files, 11,021 LOC Vue + 975 resolver + 1,139 Typst emitter) | Drag-drop layout. Still beta. | 6–9 `[E]` | **REJECT — demo feature; nobody lays out their own GST invoice** |
| **Server Script sandbox** (`safe_exec.py` 1,033 lines) | Customer-authored Python | unbounded (permanent CVE liability) | **REJECT outright — section 7.7** |
| **Multi-database abstraction** (regex-rewrites rendered SQL, `postgres/database.py:880`) | "Portability" | negative | **REJECT — PostgreSQL only** |
| **Singles as EAV** (`document.py:1035` DELETE-then-per-field-INSERT) | Settings storage | 0 | **REJECT — typed settings table or JSONB** |
| **Dynamic Link polymorphism** (reverse map = `SELECT DISTINCT` over full table, 12h cache) | Party = Customer / Supplier / Employee | 0 | **REJECT — party supertype or per-target nullable FKs with real constraints** |
| **Hand-rolled ALTER differ** (string comparison of `'decimal(21,9)'`, JSON-vs-longtext hack) | "No migration files" | 1.5–2 | **REJECT — Alembic / EF Core autogenerate. Same DX, a decade of other people's bug fixes.** |

---

## 4. The customization story — the commercially decisive section

For Indian manufacturing SMEs sold through implementation partners, **this is the product.** Every customer wants an extra field on Sales Invoice for their GST sub-classification, an extra approval step on Work Order, a renamed label, a hidden tab. The question is not whether we support that. It is whether supporting it costs us a branch per customer.

### 4.1 How Frappe makes it survive upgrade

Four overlay tables, disjoint from the shipped schema:

| Customer action | Lands in | Mechanism |
|---|---|---|
| Add a field | `tabCustom Field` | `Meta.add_custom_fields()`; `CustomField.on_update` → `frappe.db.updatedb(self.dt)` → real ALTER TABLE |
| Relabel / hide / make mandatory / change precision | `tabProperty Setter` | `apply_property_setters()` → `d.set(ps.property, cast(ps.property_type, ps.value))` |
| Restrict a permission | `tabCustom DocPerm` | `set_custom_permissions()` — **replaces** shipped perms wholesale |
| Add UI validation | `Client Script` row | concatenated into `__js`, shipped to the browser |
| Add server logic | `Server Script` row | `safe_exec` — **we reject this** |

On `bench migrate`, `frappe/modules/import_file.py:import_doc` performs a **destructive** reload — `delete_old_doc()` then `doc.insert()` — gated by an md5 `migration_hash` on the DocType (`import_file.py:129-137`, `continue` on match). The shipped DocType row and its DocFields are wiped and recreated from the JSON file. **The customer's customizations are untouched because they were never in that table.** The next meta load replays the overlay.

That is the whole trick: **upgrade rewrites the base layer, customizations live in a disjoint layer, and the merge happens at read time on every read.**

### 4.2 How much of our commercial proposition depends on it

**Most of it.** Concretely:

- **Without it:** one branch per customer. Every "add a field" is a ticket, a migration, a deploy, and a permanent divergence. At 30 customers you are maintaining 30 forks and can no longer ship a release. This is how ERP vendors die.
- **With it:** a partner adds the field in production, at the customer site, at 11pm, without us. Our next release still migrates them. That is what makes an implementation-partner channel possible at all — and the partner channel is how you reach Indian manufacturing SMEs at any scale.
- **Second-order:** `export_customizations(module, doctype, sync_on_migrate=True)` (`frappe/modules/utils.py:69-120`) lets a consultancy package one engagement into a redistributable vertical app — textiles, foundry, pharma. That is the partner business model in fifty lines, and it turns partners from a cost centre into a distribution channel.

**Assessment: the overlay is the highest-value thing in this entire scout, and among the cheapest (2–3 engineer-months). If we build only one metadata subsystem, build this one.**

### 4.3 The three flaws Frappe ships with — fix them now; they are impossible to fix later

**(i) No overlay layering — silent data loss.** The Property Setter key is `(doc_type, field_name, property)` and `validate()` deletes any prior row on insert (`property_setter.py:44-45`). App-shipped and customer-authored customizations share one namespace. On migrate, `sync_customizations` calls a bare `doc.insert()` for Property Setters (`modules/utils.py:208-215`), so **an app-shipped setter silently destroys the customer's own Customize Form change. No conflict, no warning, no log entry.** Audit-verified in source. Give overlays a layer/owner dimension so app and customer patches occupy different slots and conflicts are *detectable*.

**(ii) Permission overlays are destructive, and the source says so.** `# TODO/XXX: Docperm have no "sync" as of now. They get OVERRIDDEN on sync.` — `frappe/modules/utils.py:216`, verbatim. And at read time, *any* Custom DocPerm row replaces the entire shipped permission set (`meta.py:646-663`). A customer who tweaked one role in 2021 has never received a permission fix since. For statutory / audit roles under Indian compliance this is a live exposure. **Merge, do not replace.**

**(iii) No provenance observability.** The effective definition of a field is: JSON on disk → DB DocType row → plus Custom Fields → patched by N Property Setters (possibly app *and* human) → reordered by `field_order` → perms swapped by Custom DocPerm → behaviour altered by a Client Script. Nothing in a stack trace tells you which layer made a field mandatory. Grep does not work; you must query four tables. Frappe has `is_system_generated` / `module` / `is_app_disabled` provenance flags (which is why `reset_customization()` can work at all) but **no "explain this field" tooling.** Build the inspector on day one — retrofitting observability onto a four-table merge is what makes these systems undebuggable at year three.

### 4.4 The bound on the no-fork promise, which the salesperson cannot see

You may only change the **91 enumerated properties** (`[AUDIT]` — 35 doctype + 56 docfield; the scout said 34 + 56 = 90). Fieldtype changes are confined to 9 whitelisted groups (`ALLOWED_FIELDTYPE_CHANGE`). `allow_property_change` (`customize_form.py:333-412`) hard-blocks: un-setting `reqd` on a standard field, un-setting `read_only`, enabling `allow_on_submit` where the app did not, setting `options` outside Read Only / HTML / Data, and making a standard field virtual. Core doctypes are excluded entirely (`custom_field.py:288-293`).

Real customer requests routinely fall outside this — and then require a fork anyway. **Be honest about the ceiling in the sales motion.**

### 4.5 Physical schema drift, forever

`CustomField.on_trash` deletes the metadata but **never drops the column** (`custom_field.py:227-251`). Orphan columns accumulate permanently; reclamation requires a human clicking `trim_table` (`customize_form.py:661`). MariaDB's 65,535-byte row limit is hit often enough that Frappe ships a bespoke error message with a docs link (`customize_form.py:245-253`). Additive-only DDL is the correct safety posture — but plan the reaper.

---

## 5. The audit-trail finding vs. Rule 11(g)

Per PHASE4, Rule 11(g) of the Companies (Accounts) Rules mandates an **audit trail with edit logs that cannot be disabled**. Frappe's `Version` doctype is excellent change-visibility UI and **is not a compliance-grade audit trail.**

### 5.1 What Version captures

`Document.save_version()` (`document.py:2034`) fires on every save where `meta.track_changes`. `get_diff()` walks `new.meta.fields` and emits one row `{ref_doctype, docname, data}` where `data` is JSON:

```
changed:     [[field, old, new]]
added:       [[table, row]]
removed:     [...]
row_changed: [[table, idx, rowname, [[field, old, new]]]]
data_import, updater_reference
```

Plus `impersonated_by` / `audit_user` from session (`version.py:43-47`). Values stored formatted; Link fields resolve to the target's title field. Child rows diffed row-by-row by name, with `_amended_from` handling for amendments. `name` and `docstatus` changes are appended so submit / cancel appear. Rendering is lazy — `onload()` builds `difflib.HtmlDiff(wrapcolumn=80)` only when viewed. Indexed on `(ref_doctype, docname)`. **260 lines, exactly.**

### 5.2 What it misses — all eight independently verified

| # | Gap | Evidence | Rule 11(g) impact |
|---|---|---|---|
| 1 | **Creation is not versioned.** `for_insert()` returns False unless `flags.updater_reference` is set (data import only) | `version.py:61-64` | **Fatal.** No initial-state record; you must replay diffs backwards from current state. |
| 2 | **Deletion destroys the trail.** `delete_references("Version", doctype, name, "ref_doctype", "docname")` hard-deletes every Version row | `frappe/model/delete_doc.py:495` (exact line, audit-verified) | **Fatal.** Delete the document, the audit log goes with it. |
| 3 | **No actor in the payload.** Relies on the row's own `owner` / `creation`; the diff is written by `version.insert(ignore_permissions=True)` inside the same transaction | `version.py` | **Fatal.** "Who changed it" is implicit, not recorded. |
| 4 | **No append-only enforcement, no hash chain, no sequence number.** Ordinary InnoDB rows | — | **Fatal.** Any DB-level actor can edit history undetectably. |
| 5 | **Subject to retention purges.** Registered with Log Settings `clear_log_table`, and present in `hooks.py` `user_data_fields` as `{"doctype": "Version", "strict": True}` for GDPR erasure | `log_settings.py`, `hooks.py` | **Fatal.** "Cannot be disabled" is contradicted by a config row. |
| 6 | Rich-text excluded from formatted diffing: `blacklisted_fields = ['Markdown Editor','Text Editor','Code','HTML Editor']` | `version.py:122` | Material for terms / notes on statutory documents. |
| 7 | Virtual fields skipped | `version.py:142` | Minor. |
| 8 | **Tracking is opt-in per doctype** (`track_changes`) and silently skipped under `flags.in_install` / `in_patch` / `ignore_version` | — | **Fatal.** Trivially disabled. |

### 5.3 Required hardening — build this before the first invoice

1. **Actor, session id, IP and impersonation chain inside the payload** — not inferred from the parent row.
2. **A snapshot row at insert.** Creation state is the baseline; without it the trail is unreadable.
3. **Append-only at the database level.** No `DELETE` or `UPDATE` grant for the application role on the audit table. A separate role for retention, exercised only by an out-of-band process with its own logging.
4. **No cascade on parent delete.** Deleting a document must *append* a deletion record, never remove history. Soft-delete statutory documents outright.
5. **Per-row hash chained to the previous row's hash**, scoped per (entity, id) or per tenant. Makes tampering detectable — which is what "cannot be disabled" means in practice.
6. **Tracking mandatory, not opt-in**, for every entity flagged statutory. No `ignore_version` escape hatch on those.
7. **Partition and archive from schema day one.** Version will dwarf the ledgers on an ERP posting thousands of stock/GL entries daily. Frappe's answer is "delete it", which directly conflicts with statutory retention.

**Cost: ~0.75 engineer-months on top of the 0.5 for the diff engine. Non-negotiable, and cheap for what it protects.**

**The compensating win:** because the diff walks the field registry, **customer-added fields are audited the moment they exist.** In typed code a custom field is invisible to the audit log until someone writes code. That property alone is worth more than the lines saved, and it is a genuine Rule 11(g) argument in a procurement conversation.

---

## 6. Multi-tenancy and scale

### 6.1 The finding: database-per-site, resolved from the Host header

Verified on disk:

- `frappe/installer.py:73` — `db_name = f"_{frappe.generate_hash(length=16)}"`, written into a per-site `site_config.json`
- `frappe/database/db_manager.py` — literal ``CREATE DATABASE `{target}` ``; Postgres adds `CREATE USER` + `GRANT ALL` (`postgres/setup_db.py`)
- `frappe/app.py:182` — `_site or request.headers.get('X-Frappe-Site-Name') or get_site_name(request.host)`
- `frappe/utils/__init__.py:686` (`[AUDIT]` — the scout said 576) — `get_site_name` is literally `hostname.split(':', 1)[0]`
- `frappe/__init__.py:372` — `connect()` builds a **fresh connection per request** from `local.conf`; `destroy()` (`:472`) closes it

**There is no `tenant_id` column anywhere in the query path.** Isolation is the database connection.

### 6.2 What that buys

- A query that forgets a tenant filter is not a breach — it is impossible. The entire class of cross-tenant leak is eliminated.
- Per-customer restore, export, offboarding and "give me my data" become a `pg_dump`. Under shared-schema these are slow, careful, error-prone extraction jobs.
- Provable to an SME's auditor: "your data is in its own database."

### 6.3 What it costs at hundreds of SME customers

**Table-count explosion.** `[AUDIT]` — the scout said 317 framework doctypes; the real count is 289–314 depending on how you count (excluding test_records: 289). Call it ~300 framework tables before any ERP layer. The "800–1500 for an ERP layer" figure is extrapolation with no ERPNext source in the checkout — treat as unverified. Even conservatively, 500 tenants × ~800 tables = **400,000 tables on one cluster.** `table_open_cache`, file descriptors, InnoDB data-dictionary memory and `information_schema` queries all degrade — and Frappe's own schema code hits `information_schema` on every schema op (`get_tables()`, `get_table_columns_description`, `get_column_index`). **Plan shards of 25–50 tenants per instance from day one.**

**Migration does not scale by construction.** `frappe/commands/site.py:738` is literally `for site in context.sites`, each running a full `SiteMigration.run()` under a bench-wide `filelock('bench_migrate', timeout=1)` (`migrate.py:281`). Serial, forward-only patches, no rollback, no canary, no batching. At 500 tenants the deploy window is measured in many hours. **Build the parallel migration orchestrator before tenant #20, not after.**

**Cross-tenant anything is an N-connection fan-out.** Usage analytics, fleet-wide search, a global admin console — all become orchestration problems.

**Meta cache thrash.** `ClientCache` (`frappe/utils/redis_wrapper.py:478-480`) is a process-global dict, `maxsize=1024`, 600s TTL, FIFO eviction, keys prefixed `db_name|` — **so all tenants share 1,024 slots.** With ~800 doctypes per tenant, a worker serving mixed tenant traffic re-materialises Meta from DB rows constantly. Frappe's real-world answer is worker affinity per site (separate benches), not a smarter cache. `[AUDIT]` — the "20ms vs 200ms p50" figure is unmeasured inference; the structural problem is real, the magnitude is not established.

**Tenant resolution is a trusted header.** `X-Frappe-Site-Name` (`app.py:183`) is safe **only if the reverse proxy strips it.** A misconfigured edge is a cross-tenant auth bypass. If we copy this, the proxy config is a security control, not an ops detail.

### 6.4 Verdict for our SaaS

**Keep database-per-tenant.** The isolation is worth it, per-customer restore is a real sales asset in Indian SME procurement, and it removes the single most dangerous bug class in multi-tenant ERP. But:

- Shard at 25–50 tenants per Postgres instance from the start.
- Build the migration orchestrator (parallel, staged, canary, rollback-capable) as a first-class service, budgeted at 3–4 engineer-months.
- Strip `X-Tenant`-style headers at the edge, explicitly and testably.
- Size the meta cache per-tenant, or pin tenants to workers. Measure meta-materialisation cost before committing to the metadata layer at all.

### 6.5 Two runtime patterns to copy, one to reject, one bug not to inherit

**Copy:** `ClientCache`'s invalidation design — Redis RESP3 client-side tracking plus pubsub on `__redis__:invalidate`, with the `_PLACEHOLDER_VALUE` race guard written before the Redis GET so a concurrent invalidation is detected and the value is *not* cached (`redis_wrapper.py:535,553,605`). Best engineering in the repo. Also: `gc.freeze()` before fork (`_optimizations.py:63,83` — two lines, real copy-on-write win), the `touched_tables.json` migration audit, kill-idle-connections and lowered `lock_wait_timeout` before DDL, and read-replica maintenance mode.

**Reject:** `frappe.local` as an ambient mutable global (`frappe/__init__.py:216`, proxies at `243-261`). It forbids async, forbids serving two tenants in one execution context, forbids cross-request connection pooling, and kills library embedding. `[AUDIT]` — werkzeug's `Local` is contextvar-backed in modern versions, so "async is impossible" is stronger than the code proves; but the architecture is prefork-only in practice. Get the same ergonomics (ambient context, no DI threading) from `contextvars` / `AsyncLocalStorage` and keep async on the table.

**A live bug, do not copy:** `scheduled_job_type.py:152-154` computes `next_execution`, adds `timedelta(minutes=maintenance_offset)` for Hourly/Daily Maintenance, then **returns a freshly recomputed value that discards the offset.** The per-site sha1 de-synchronisation offset (`:124`) is dead code. Audit-confirmed on disk.

---

## 7. Where the metadata approach breaks

### 7.1 Generic UI ceiling

Measured, audit-confirmed to the digit: form/ **28,014** LOC, ui/ **21,379**, views/ **17,152**, list/ **8,611**, model/ **2,604** JS, `frappe/desk/*.py` **21,142** — **~99,000 LOC**, excluding the ORM, permission engine and schema machinery it all depends on. `link.js` alone is 1,081 lines; `text_editor.js` 640; `report_view.js` 1,976; `list_view.js` 3,352; `reportview.py` 1,094 lines of *security-critical* field/filter validation.

The ceiling is not aesthetic, it is categorical. Four screen families are outside the model entirely:

- **Bulk data entry.** The grid is a DOM table, not a spreadsheet: **zero `paste` handlers exist in `grid.js` or `grid_row.js`** (grep-verified). No range select, no fill-down. Column resize disabled on mobile (`grid.js:548`). Keyboard model is TAB-on-last-column-creates-row (`grid_row.js:1287-1296`). Report-view inline edit is one `frappe.client.set_value` round-trip per cell (`report_view.js:769`). For a day's dispatches this is 20 minutes vs 2 hours.
- **POS / counter.** Assumes a full metadata download, a mouse, an online connection and a save-the-whole-doc lifecycle. No offline queue, no barcode-first loop (`barcode.js` is a 79-line field control). ERPNext's own POS is a hand-written page — that is the tell.
- **Mobile / shop floor.** Responsive-desktop, not mobile-designed. Forms are a vertical dump of every docfield in metadata order. The only mobile-aware primitive is Quick Entry, which bails out at `docfields.length > 7` (`quick_entry.js:110`).
- **Stateful operational screens** — job card with timer, machine queue, station QC capture. These are task UIs, not documents-with-fields. The engine gives you the CRUD behind them and nothing of the interaction.

There is **no way to override the layout algorithm for one doctype** short of writing a bespoke Page — at which point you are back to conventional code.

### 7.2 Type safety

None at the boundary. A field is a string key in `self.__dict__`; `get_valid_dict` coerces at runtime by consulting the fieldtype. The mitigation (`frappe/types/exporter.py`, 229 lines) generates `TYPE_CHECKING` stubs into controllers and its own docstring excludes custom fields and fieldtype changes — the exact case the engine exists for. Job methods are dotted-path strings resolved by `frappe.get_attr` at execution; rename one and jobs already sitting in Redis break at runtime, not at build.

### 7.3 Refactorability

Renaming a field is a data migration, not a rename. Fieldnames appear as strings in `depends_on` expressions, `fetch_from`, permission hook SQL, print formats, client scripts, reports, workflow conditions, assignment conditions and notification conditions — **none of which any compiler or IDE can follow.** `scrub_field_names` (`doctype.py:478`) auto-derives fieldnames from labels, so a label edit can silently change a column name. And `AssignmentRule.safe_eval` catches the resulting exception and downgrades it to an *orange msgprint* (`assignment_rule.py:208`) specifically so a broken rule does not block a save — **broken automation fails silently.** That is a support-cost multiplier.

### 7.4 Query performance

- **Full-row UPDATE on every save.** `db_update` (`base_document.py:848`) builds `SET` over the entire `get_valid_dict` with no dirty-diffing. A 120-column Sales Order rewrites all 120 for a one-field change — bloating WAL, defeating partial indexes, widening lock windows.
- **Per-row child writes.** `db_update_all` (`:893-899`) loops child rows, one statement each. A 500-line invoice is 500+ round-trips.
- **Quadratic child stitching.** `query_builder/utils.py:204-218` is literally `for row in result: for d in data: if str(d.parent) == str(row.name)`. 100 parents × 5,000 child rows = 500k string comparisons per page. Audit-confirmed verbatim.
- **Non-sargable permission predicates.** `add_user_permissions` emits `(ifnull(col,'')='' or col in (v1,…,vN))` per link field, ANDed. A Sales Invoice with 25 link fields and permissions on 8 gives 8 such predicates. On 10M rows this is the difference between 20ms and 40s.
- **Report row filtering happens *after* the query.** `get_filtered_data` (`query_report.py:901`) → `has_match` (`:948`) calls `frappe.db.exists(dt, cell_value)` **per cell per row** (`:1000`). Totals computed by SQL already include rows the user cannot see. Pagination is wrong. This is the honest failure mode: the framework cannot reason about SQL it did not write.
- **Default `order_by` is `modified desc`** (`query.py:1336`) — which is why the schema force-adds indexes on `modified` / `creation`. On 10M rows with any non-indexed filter it is a filesort over the whole matching set. The tell: `db.estimate_count()` reads `information_schema` row estimates cached 60 minutes because a true `COUNT(*)` is unusable. **The list view's record count is a lie by design.**
- **`Meta.check_if_large_table` (`meta.py:502`) exists purely to DISABLE UI features past 100k rows.** That is an admission in code that the generic paths do not scale.
- **Naming series `FOR UPDATE`** serialises every concurrent insert sharing a prefix for the whole transaction (section 2.6).

### 7.5 Referential integrity

**No foreign keys anywhere.** Links are `varchar(140)` validated by `_validate_links` at application level. Child tables carry `parent` / `parenttype` / `parentfield` with only `index parent(parent)` — no composite index, no FK. Dynamic Links are not validated at all, and their reverse map is rebuilt by `SELECT DISTINCT <field> FROM tab<doctype>` cached 12 hours (`dynamic_links.py:82`), with in-source comments conceding "results are cached and can possibly be outdated" and "cache miss can often be VERY expensive on large table". **Delete-protection consults that stale cache.** This produces real orphans in real production systems.

`[AUDIT]` fairness note: the module *does* evict on discovery of a new linked doctype (`invalidate_distinct_link_doctypes`, plus after-commit eviction), so the "acknowledged staleness" framing is slightly harsher than the code. The structural criticism — polymorphic references with zero referential integrity — stands unchanged.

### 7.6 Debuggability

The effective definition of a field is a merge across four tables plus two script layers, and nothing in a stack trace tells you which layer acted. Frappe built a dedicated `_debug_log` step-by-step permission explainer inside `has_permission` — **that logger is a symptom, not a feature.**

Cache coherence is by convention: correctness depends on every writer remembering `frappe.clear_cache(doctype=...)`, and `sync_customizations` uses `db_insert` / `db_update`, which bypass hooks entirely.

### 7.7 Security posture — the two things we will not ship

**Row-level access control by string concatenation.** `get_permission_query_conditions` splices hook-returned SQL verbatim (`db_query.py:1334`); `RawCriterion` (`query.py:2305`) fakes a pypika Term from a string. Server Scripts put user-authored SQL fragments into production WHERE clauses. Any bug is a cross-tenant data leak, not a 500.

**The Server Script sandbox is a containment boundary, not a permission boundary.** `safe_exec.py` (1,033 lines) is RestrictedPython plus a hand-maintained dunder/frame denylist. Inside it: `safe_get_all` forces `ignore_permissions=True` (`safe_exec.py:309-310`, verified); `frappe.db.set_value`, `get_doc`, `delete_doc` and `rename_doc` all run with full application rights; outbound HTTP uses **unfiltered** `make_get_request` in the exec namespace (`:575`) while only the *render* namespace gets the SSRF-filtered `make_safe_get_request` (`:472`). And the query-builder write guard is an `inspect.stack()` frame-index heuristic — `callstack[2].filename` must contain `<serverscript>` (`query_builder/utils.py:226-240`) — which **any indirection defeats**, yielding arbitrary UPDATE / DELETE. The whole feature is gated behind a `common_site_config.json` flag not settable from the UI, precisely because it cannot be safely exposed.

**We do not ship a customer-facing Python sandbox.** If customer-authored server logic becomes a requirement, run it out-of-process — separate container, its own DB credentials, an RPC surface we control — and price it as a separate product.

---

## 8. Recommended architecture for our build

### 8.1 The stack

- **PostgreSQL only.** Rejecting multi-DB deletes the regex-SQL-rewriting bug class outright (`postgres/database.py:880` textually rewrites rendered SQL; the in-tree comment on `modify_values` documents a real past data corruption). `[AUDIT]` — the "~2,000 lines saved" figure is inflated since you still need one dialect implementation; the bug-class elimination is the real win.
- **Typed domain models + Alembic (or EF Core) migrations.** Declarative desired-state schema, diff at deploy — the same "no migration files" DX with a decade of other people's bug fixes. Frappe's differ compares formatted strings like `'decimal(21,9)'` with an explicit MariaDB JSON-vs-longtext hack, has no down-migrations, and on truncation failure silently blanks values and retries once (`set_blank_values_to_default`).
- **All schema DDL in a separate migration process** that can never share a transaction with business writes. Schema-as-data structurally collides with transactional writes: `ImplicitCommitError` (`database.py:504`) fires when DDL follows a write in one transaction, and `MAX_WRITES_PER_TRANSACTION = 200_000` with `auto_commit_on_many_writes` **silently commits mid-bulk-operation**, destroying atomicity exactly during imports and year-end postings.
- **Real foreign keys everywhere. Composite indexes on child tables `(parent, parenttype, parentfield)`.** Non-negotiable.
- **Surrogate primary keys.** Frappe's entire link-title cache subsystem (`link_title_doctypes`, `show_title_field_in_link`, `fetch_link_title`) exists only because it uses business names as PKs. Use surrogate IDs and that subsystem disappears.
- **Every table carries the spine:** `id, tenant_id, created_at, created_by, updated_at, updated_by, docstatus, idx`.

### 8.2 Build order

**Phase A — months 0–2: foundations everything else assumes**

1. Fixed spine on every model. Docstatus lifecycle: draft / submitted / cancelled / amended, with per-field `allow_on_submit` and immutability after submit. **This is a day-one core-model decision** — GST invoices, e-way bills and stock ledger entries all require it, and workflow, audit and approvals all depend on it.
2. Field registry (entity → field metadata: name, type, label, precision, permission group). Typed models are the source of truth; the registry is derived at build time.
3. Audit trail, **hardened per section 5.3**, walking the registry. Append-only, hash-chained, actor-stamped, insert-snapshotted, no cascade.
4. Job queue plumbing copied near-verbatim from `frappe/utils/background_jobs.py` (MIT): fixed-entrypoint dispatcher with a data payload, `enqueue_after_commit`, dedup by namespaced `job_id`, deadlock retry on 1213/1205 with `sleep(retry+1)` and `retry < 5`.
5. Permission model: role × entity × right, `if_owner`, and a **small fixed set of NOT NULL scoping columns** (company, branch, warehouse, cost_center). NOT NULL by construction, so the strict / non-strict blank-means-allow footgun never exists. Compiled to typed parameterised predicates used identically by API, list, report and export paths — **one predicate path, never two.**

**Phase B — months 2–5: the overlay and the generic surface**

6. `field_extension` table (= Custom Field): additive DDL only, provenance-flagged, real ALTER via the migration process.
7. `property_override` table (= Property Setter) keyed `(entity, field, property, layer)` — **with the layer/owner dimension Frappe lacks**, so app and customer patches are distinguishable and conflicts detectable.
8. The **91-property allowlist copied verbatim** from `customize_form.py:732-830` plus the `allow_property_change` guard rules. MIT permits literal copying. This is a decade of support tickets for free — preserve the copyright notice and maintain an attributions file (Frappe's own repo-root `attributions.md` shows the pattern).
9. **"Explain this field" inspector.** Day one, not year two.
10. Generic REST/RPC CRUD over the registry, permission-enforced at the data layer. Invert Frappe's default: the permissioned call gets the short name; the bypass is a long, explicit, greppable `unsafe_query(reason=…)`.
11. Generic list view + saved views + filters + column picker + CSV/XLSX export.
12. Client Script slot (one day).

**Phase C — months 5–8: ship the invoice**

13. The ~40 core screens hand-built in React against the typed service layer: invoice entry, item master, BOM, work order, stock entry, GRN, payment.
14. GST invoice / delivery challan Jinja print formats + letterheads, rendered by **Chromium via Playwright** (one backend, not three). wkhtmltopdf is abandoned upstream; Typst's blocker list refuses custom CSS, HTML blocks and non-QR barcodes — i.e. exactly what a tax invoice uses.
15. Report contract `execute(filters) -> (columns, rows)`, **on-disk Python modules only**. Filter UI, export, totals, background execution and print come from the framework.
16. Webhooks: config row + Jinja payload + HMAC + DB-persisted retry log with the `[5m, 30m, 2h, 5h, 10h, 10h]` schedule and a sweeper. Retries survive Redis flushes and are replayable by support.

**Phase D — months 8–12: what makes it sellable at scale**

17. Workflow engine (state table, transition table, role gate, guarded expression, design-time graph validation, save-path re-validation). **Fix Frappe's gaps:** model the approver as a resolvable rule (role OR reporting-manager OR amount-band), and add escalation-on-timeout and delegation — SMEs where one owner approves everything will demand both within the first month.
18. Approval inbox (role-keyed rows, not user-keyed) + signed email approval links with state-and-mtime re-validation and a confirmation interstitial.
19. Notifications and assignment rules — **structured filters by default**; the expression escape hatch narrow and `safe_eval`-grade (NFKC-normalised, no lambda, no walrus, empty builtins).
20. Dashboards, charts, number cards.
21. Prepared Report background execution with the 15-second auto-promotion timer.
22. Virtual-entity escape hatch for Tally / GSTN / MES.
23. Migration orchestrator: parallel, sharded, staged, canary, rollback-capable. **Before tenant #20.**

### 8.3 What we deliberately do not build

| Not building | Instead |
|---|---|
| Generic form renderer for core screens | Hand-built React for the ~40 high-value screens; generic renderer only as fallback for customer-added fields and long-tail masters |
| Child-table grid from scratch | AG Grid Enterprise / Handsontable, columns driven from the field registry. Gets us paste, range select and fill-down — which Frappe does not have at all |
| Visual print format builder | Jinja templates as DB rows. Customers do not want to lay out a GST invoice; they want the one that passes audit |
| Server Script / Python sandbox | Bounded expression DSL for depends-on / mandatory-depends-on / fetch-from. Paid services for the rest |
| Query Report (stored SQL strings) | On-disk Python report modules only |
| Multi-database support | PostgreSQL |
| Hand-rolled ALTER differ | Alembic / EF Core autogenerate |
| Singles as EAV | Typed settings table or JSONB |
| Dynamic Link polymorphism | Party supertype table or per-target nullable FKs with real constraints |
| Integer permlevels | Named field groups with per-group role grants, enforced at **one** serialisation boundary |
| Own realtime / socket layer | Polling for year one. Fix only the room-naming convention now so the transport can be swapped later |
| Own APM / Recorder | OpenTelemetry + Postgres slow-query log. Keep only `trace_id` on every error record and honour an inbound request id — one field, huge support leverage |
| Own OAuth provider | Off-the-shelf. Keep only the session-carried `impersonated_by` / `audit_user` threaded into the audit trail |

### 8.4 MVP — what can be skipped entirely

For a first shippable billing-and-inventory product on ~15 core entities:

**Skip:** workflow engine, approval inbox, assignment rules, notifications, auto-repeat, dashboards, kanban / gantt / calendar / heatmap views, report builder and ad-hoc column picker, visual print builder, realtime, milestone tracking, prepared reports, virtual entities, and the generic form renderer entirely.

**Keep:** spine + docstatus lifecycle, hardened audit trail, typed models + migrations, permission predicates with fixed scoping columns, `field_extension` + `property_override` + allowlist + inspector, generic CRUD API, generic list view, Jinja print formats + PDF, hand-built core screens, job queue with after-commit semantics, webhooks.

**That is a 6-month MVP.** The engine hardens under real load before it generalises to 300 entities. If in month 4 the metadata layer is not carrying its weight, we still have a shippable product. If we build the engine first, we have neither.

---

## 9. Open questions for the owner

1. **Extension-field demand — how real is it, in numbers?** The entire ADAPT verdict rests on Indian SMEs genuinely needing per-tenant fields. If the true figure is "3 of our first 20 customers ask, and each wants the same 2 fields", the correct answer is a JSONB extras column and no overlay at all. **Get this number from 10 real prospects before Phase B starts.** It is the single highest-leverage piece of missing evidence in this entire scout.

2. **Partner channel — is it the go-to-market, or a nice-to-have?** If partners are the distribution strategy, `export_customizations`-style vertical packaging moves from Phase D to Phase B, and the overlay's layer/provenance model becomes a hard requirement rather than a nicety. If we sell and implement direct, most of section 4 downgrades.

3. **Rule 11(g) — what does our auditor actually accept?** The seven hardening items in 5.3 are my read of "cannot be disabled". Confirm with a CA whether a hash chain is expected or whether append-only grants plus a signed daily digest suffice. The cost difference is ~0.5 engineer-months; the compliance risk of guessing is not.

4. **Tenant count at 18 months — 50 or 500?** Database-per-tenant is right at both, but the sharding and migration-orchestrator investment (3–4 engineer-months) is premature at 50 and late at 500. This determines whether item 23 sits in Phase D or Phase B.

5. **Hosted or on-prem?** Frappe's error-fingerprint / Monitor infrastructure exists because self-hosted SME installs cannot phone home to Sentry. If a material share of customers is on-prem, we own our observability stack and the "use OpenTelemetry, skip Recorder" recommendation in 8.3 needs revisiting.

6. **Team shape.** The 6–9 month Phase A–C plan assumes 3–4 engineers including one senior enough to own the permission chokepoint. `reportview.py`'s 1,094 lines of field/filter validation exist because a metadata engine *necessarily* accepts client-specified fields and filters. **That validator is where a metadata ERP gets breached.** Do we have that person, and is an external security review before first customer budgeted?

7. **Do we accept the ceiling honestly in the sales motion?** The no-fork promise is bounded at 91 properties and 9 fieldtype-change groups, and the bound is invisible to a salesperson. Agree now on how we describe it, or we will sell a promise the architecture cannot keep.

8. **Literal code reuse — is counsel comfortable?** MIT permits lifting `background_jobs.py`, `rate_limiter.py`, `version.py`'s `get_diff`, the `customize_form.py` allowlist and the `ClientCache` invalidation design directly, with attribution. That is a genuine multi-month head start and the most actionable fact in this report. It needs a file-by-file provenance review to confirm no GPL ERPNext code has leaked into the framework repo (it does not appear to have — this checkout is the framework, not the app) and a maintained attributions file.

---

## Appendix — measurements that survived adversarial audit

Every figure below reproduced exactly on disk under independent audit. Use these; discard any number not on this list.

| Artifact | Measurement |
|---|---|
| `frappe/model/document.py` | 2,833 lines |
| `frappe/model/base_document.py` | 1,683 |
| `frappe/model/meta.py` | 1,113 |
| `frappe/core/doctype/doctype/doctype.py` | 2,199 |
| `frappe/database/query.py` | 2,578 |
| `frappe/model/db_query.py` | 1,688 |
| `frappe/permissions.py` | 969 |
| `frappe/share.py` | 289 |
| `frappe/database/schema.py` | 494 |
| `frappe/database/mariadb/schema.py` | 239 |
| `frappe/core/doctype/version/version.py` | **260** |
| `frappe/model/workflow.py` | **460** |
| `frappe/model/virtual_doctype.py` | 93 |
| `frappe/types/exporter.py` | 229 |
| `frappe/utils/safe_exec.py` | 1,033 |
| `frappe/desk/query_report.py` | 1,176 |
| `frappe/desk/reportview.py` | 1,094 |
| `frappe/custom/doctype/property_setter/property_setter.py` | 173 |
| `frappe/custom/doctype/customize_form/customize_form.py` | 859 |
| `frappe/custom/doctype/client_script/client_script.py` | 29 |
| `frappe/rate_limiter.py` | 181 |
| Desk JS: form/ \| ui/ \| views/ \| list/ \| model/ | 28,014 \| 21,379 \| 17,152 \| 8,611 \| 2,604 |
| `frappe/desk/*.py` | 21,142 |
| Print format builder (Vue) | 55 files, 11,021 lines |
| `ignore_permissions` references \| literal `=True` | **775 \| 580** |
| Form control classes | **48 files** (not 45 or 49) |
| Customizable properties | **35 doctype + 56 docfield = 91** (not 90) |
| Framework doctypes | **~289–314** (not 317) |
| Doctypes shipping imperative permission hooks | **24** (not "a dozen") |
| REST/RPC surface | **~2,300 lines** across 6 files (not 650) |
| Statutory content (GST / HSN / e-way / IRN) | **zero** — grep-verified |

**Corrections applied where scout and audit conflicted, all in the audit's favour:** API surface 650 → ~2,300; `meta.py` overlay 120 → ~220–250 lines; migrate/sync/import/utils 1,100 → 1,450 lines; `workflow_action.py` 470 → 544; `notification.py` 600 → 1,000; allowlist 90 → 91; controls 45 → 48; permission-hook doctypes 12 → 24; fieldtypes 43 → ~40; `get_site_name` line 576 → 686; `get_all` line 1302 → 1300. The citation `mariadb/schema.py:287` is **fabricated** — that file is 239 lines; the real code is `frappe/database/schema.py:344`. `sync_fixtures`' `DISALLOWED_FIXTURE_DOCTYPES` guard is on the **export** path, not import. `reset_customization` also excludes `naming_series` / `options`. `Meta.process()` also calls `check_if_large_table()`.

**All engineer-month figures in this document are experience-based priors, not measurements.** Two audits explicitly graded the cost sections `hand-wavy` on that basis. The line counts are exact; the durations are not. Re-derive anything that enters a funding decision.
