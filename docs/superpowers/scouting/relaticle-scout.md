# Relaticle Scout Report

Repo: `d:/Files/Vatsa/Projects/AI-CRM/relaticle` (Laravel 12 + Filament 4 + Livewire + PostgreSQL/SQLite, `Relaticle\CustomFields` package for EAV custom fields, `laravel/ai` for tool-calling chat)

Purpose: extract **design** (data model, control flow, UX flow, decisions) for the three named differentiators, so SeaRM can reimplement equivalent capability without opening this repo again. No PHP is portable — this is translation material only.

Scope note on the third target: relaticle's "approval-gated AI proposal batches" is graded only for what it does **differently or better** than SeaRM's already-built Launch 1 (`ProposalEntity`/`ProposalItemEntity`, `ProposalGateService`, `ProposalExecutionService`, per-workspace `AiWritePolicyService`). The concept itself is not re-argued.

---

## Part 1 — Custom-field-aware AI tools (HIGH VALUE — this is relaticle's best asset)

### 1.1 The core problem it solves

SeaRM's Launch 1 tool layer (`ToolExecutorService`) gates *any* write regardless of field-level correctness — it does not stop the AI from **proposing** an invalid value (wrong type, unknown option, wrong shape). Relaticle solves a narrower, complementary problem: **teach the model the exact shape of each tenant's custom fields, and hard-reject anything that doesn't match** before a proposal is ever created. This is upstream of approval — bad proposals never reach a human reviewer.

### 1.2 Data model

Custom fields live in `Relaticle\CustomFields` package tables, referenced through `App\Models\CustomField`:
- `custom_fields`: `id`, `tenant_id`, `entity_type` (company/people/opportunity/task/note), `name`, `code` (snake_case machine key, unique per tenant+entity_type), `type` (e.g. `text`, `textarea`, `select`, `multi-select`, `radio`, `checkbox-list`, `toggle-buttons`, `number`, `currency`, `date`, `date-time`, `boolean`(toggle), `email`, `phone`, `link`, `file-upload`, `record`, `rich-editor`, `markdown-editor`), `active` (bool), `system_defined` (bool — seeded/protected fields the AI may never touch), `sort_order`, `validation_rules` (jsonb array of rule descriptors, e.g. `{"name":"required"}`), `lookup_type` (non-null when the field is backed by a relation lookup, not raw options).
- `custom_field_options`: `id`, `custom_field_id`, `name` (label) — for choice-type fields.
- `custom_field_values`: polymorphic (`entity_type`, `entity_id`) EAV row, one physical column per data type (`string_value`, `text_value`, `integer_value`, `float_value`, `json_value`, `boolean_value`, `date_value`, `datetime_value`) selected via `CustomFieldValue::getValueColumn($type)`.
- A `FieldDataType` enum (`STRING`, `TEXT`, `NUMERIC`, `FLOAT`, `BOOLEAN`, `DATE`, `DATE_TIME`, `SINGLE_CHOICE`, `MULTI_CHOICE`, `FILE`) is the semantic layer above the ~13 raw `type` strings — multiple raw types (`select`/`radio`/`toggle-buttons`) all map to `SINGLE_CHOICE`, etc. This is the key abstraction: **AI-tool code never branches on raw type, only on `FieldDataType`.**
- A `FieldTypeDefinitionInterface`/`FieldManager` registry (from the CustomFields package) is the single source of truth mapping raw type → `FieldDataType`, validation rules, and whether the type `acceptsArbitraryValues` (email/phone/link accept free-form strings even though they're modeled as "multi-choice"-shaped arrays).

Files: `app/Models/CustomField.php`, `Relaticle\CustomFields\Enums\FieldDataType`, `Relaticle\CustomFields\FieldTypeSystem\FieldManager`.

### 1.3 How the AI is told about fields (schema injection, not documentation)

`packages/Chat/src/Services/Tools/CustomFieldsSchemaDescriber.php` — `describe(Team, entityType): string`. Every `create`/`update` tool schema (`BaseWriteCreateTool::schema()`, `BaseWriteUpdateTool::schema()`) calls this **at tool-schema-build time** (i.e. per request, not cached at boot) and injects the result as the natural-language `description` of the tool's `custom_fields` JSON-object parameter. Concretely, for a tenant with an `industry` (single-choice) and `close_probability` (number) field on `opportunity`, the LLM sees:

```
Available custom fields for this entity. Keys MUST be one of these codes. Values MUST match the documented format.

- industry (single-choice, one of: "SaaS", "Fintech", "Healthcare")
- close_probability (integer)

Only include codes you want to set. Omit fields you do not want to change.
```

Per-type hints are baked in per `FieldDataType` (`formatHint()`): dates get `YYYY-MM-DD`, datetimes get an ISO-8601 example, multi-choice gets "array of label strings", and the three `acceptsArbitraryValues` raw types (`email`/`phone`/`link`) get "array of email/phone/URL strings" even though their `FieldDataType` is choice-shaped. **The model is always given option *labels*, never option IDs** — IDs are an internal implementation detail translated at validation time (see 1.4). This is the single most reusable idea here: schema-as-prose generated fresh per tenant per request, keyed to a name the LLM can literally copy back.

This scales — a workspace with zero custom fields gets `'No custom fields are defined for this entity type.'` instead of an empty object description, so the model doesn't hallucinate fields into existence.

**SeaRM gap this fills:** SeaRM's metadata-aware tool contract (charter §"Metadata-aware AI and MCP tools") says the AI must "resolve custom-field-labels, option values, relation fields, data types" — this is the concrete algorithm for doing that inside a tool-call schema string, not just a `find_many` result.

### 1.4 How invalid values are stopped (the two-stage translate-then-validate pipeline)

`packages/Chat/src/Services/Tools/CustomFieldsRequestValidator.php` — `validate(User, entityType, rawCustomFields): CustomFieldsValidationResult{cleanFields, error}`. Runs **before** any proposal is built (both create and update tools call it inline in `handle()`, and `ProposalEditor` calls it again on edit, so editing a proposal re-validates rather than trusting the client).

Two-stage pipeline:
1. **`translateLabels()`** — for every submitted `custom_fields.<code>`, load the tenant's `CustomField` (scoped by `tenant_id` + `entity_type` + `active()`), resolve its `FieldDataType`. If it's a real choice field (not `acceptsArbitraryValues`, not `lookup_type`-backed): look up the label the model sent (case-sensitive exact match against `options.name`) in an `optionsByLabel` keyed collection. **Unknown label → immediate typed error**, e.g. `custom_fields.industry option "Fin-Tech" is not one of the configured choices.` — no fuzzy matching, no silent coercion. Multi-choice values must be arrays; single-choice values must be string/int; wrong shape is its own distinct error message. On success, label is rewritten to the option's internal ID — **the boundary between "what the LLM speaks" (labels) and "what the DB stores" (IDs) is exactly this function.**
2. **Rule-based validation** — the translated (ID-based) payload is run through the *same* `ValidCustomFields` Laravel validation rule the MCP tools and the Filament admin UI use (`new ValidCustomFields($teamId, $entityType, isUpdate: true)->toRules($cleanFields)`), via `Validator::make(['custom_fields' => $cleanFields], $rules)`. This reuses the one canonical rule-set for required-ness, type coercion, cross-field uniqueness, etc. — the AI path is not a parallel, potentially-drifting validator; it is the identical code path a human form submission uses.

Any failure returns a single string error (all Laravel validator messages joined by `; `) which the tool returns to the model as `{"error": "..."}`. The model sees the failure and can retry with a corrected value in the same turn — **this is a fast, in-conversation correction loop that happens before a proposal exists**, distinct from and complementary to SeaRM's approval-time rejection.

**Design principle worth keeping verbatim:** validate at the *edge* of the AI boundary using the exact same rule engine the rest of the app uses. Never write a second, AI-specific validator that can drift from the human-facing one.

### 1.5 Discovery tools (how the AI finds out what fields/values exist without guessing)

`packages/Chat/src/Tools/CustomField/ListCustomFieldsTool.php` — read-only tool, `description()` explicitly tells the model to call this "to answer 'what custom fields do I have' and to find a field's entity_type + code before proposing an update or adding options." Returns per field: `entity_type`, `name`, `code`, `type`, `active`, `system_defined`, `options` (label array). Explicitly notes system-defined fields are immutable via chat. This is the "list" half of the create/update/list schema-discovery triad every admin-style AI surface needs.

### 1.6 Schema-admin tools are proposals too (fields are AI-writable, gated the same way core records are)

> **DEFER row — archived in full below.** This is a CUT capability in the
> program plan, so the detail here is the whole surviving record. Files:
> `packages/Chat/src/Tools/CustomField/{Create,Update,AddCustomFieldOptions,ListCustomFields}Tool.php`
> (propose side) and `app/Actions/CustomFields/{CreateCustomField,UpdateCustomField,AddCustomFieldOptions}.php`
> (apply side).

Three tools let the AI **propose changes to the schema itself**, not just record values — a capability SeaRM's charter doesn't explicitly call out.

**The structural decision: every guard is written twice, deliberately.** Each check exists in the *tool* (pre-proposal, returns `{"error": "..."}` to the model so it can self-correct in-turn and no `PendingAction` row is ever created) and again in the *Action* (at apply time, `abort_unless(... 403/422)`). The tool copy is for fast conversational feedback; the Action copy is the authority, because the Action is also reachable from the MCP surface and from a proposal approved minutes later under changed conditions. **Neither is redundant: the tool copy prevents a bad proposal existing, the Action copy prevents a stale one applying.**

#### `CreateCustomFieldTool` → `CreateCustomField`

- **Owner gate:** `$user->ownsTeam($user->currentTeam)`. In the tool it returns a *helpful* error — "Only team owners can create custom field definitions. I can guide you to the Custom Fields settings page if you want to ask your team owner to do this." — rather than a bare denial. A non-owner never gets a pending item at all.
- **Type allowlist** (`CreateCustomField::ALLOWED_TYPES`, 17 entries):
  `text, number, email, phone, link, textarea, checkbox, checkbox-list, date, date-time, select, multi-select, tags-input, toggle, toggle-buttons, radio, color-picker`.
  **Excluded from AI creation:** `file-upload`, `record`, `rich-editor`, `markdown-editor`, `currency`. The exclusion rule is "types with no clean textual representation in a tool call" — a relation (`record`) needs a target-object picker, `currency` needs a currency code alongside the amount, the rich editors need document structure. Not offered beats accepted-and-mishandled. The allowlist is interpolated **into the tool's own JSON-schema description** (`"The field type. Allowed: {...}. NOT allowed: file-upload, record, rich-editor, markdown-editor, currency."`), so the model is told the rule before it guesses, not after.
- **Entity allowlist** (`VALID_ENTITY_TYPES`): `company, people, opportunity, task, note`.
- **Choice-type coherence, both directions:** a choice type (`CHOICE_TYPES` = `select, multi-select, radio, checkbox-list, toggle-buttons`) with zero options is rejected, *and* a non-choice type with a non-empty `options` array is also rejected. The second half matters — it catches the model bolting options onto a `text` field.
- **Caps:** `chat.max_custom_fields_per_entity` (default 50, `CHAT_MAX_CUSTOM_FIELDS_PER_ENTITY`) and `chat.max_field_options` (default 50, `CHAT_MAX_FIELD_OPTIONS`). Counted with `withoutGlobalScope(CustomFieldsActivableScope::class)` — **inactive fields still count against the cap**, so "deactivate 50 fields then create 50 more" is not an escape hatch.
- **Code generation:** `code` is optional; when omitted, `CodeGenerator::generateUniqueFieldCode($name, $entityType)` derives a unique snake_case key. The model is not asked to invent machine keys.
- **`sort_order`** is `max(sort_order) + 1` for that tenant+entity, computed outside the transaction and written inside it. New fields land at the end of the form, never reshuffling an existing layout.
- The create itself runs in a `DB::transaction` with the tenant id pinned via `TenantContextService::setTenantId($teamId)` in a `try/finally` that restores the previous tenant id — the chat job runs outside a normal tenant-scoped request, so tenancy is established explicitly and unwound explicitly.

#### `UpdateCustomFieldTool` → `UpdateCustomField`

Rename and activate/deactivate **only**. The implementation is literally an `array_filter` down to `['name', 'active']`; there is no code path that can change `type`, `options`, `validation_rules`, or `lookup_type`.

- `abort_if($field->isSystemDefined(), 422)` — seeded/protected fields are immutable via chat.
- **`type` is not changeable, at all, by anyone, through this path.** Changing a field's data type after values exist means deciding what happens to every stored value; that is not a decision an approval card can carry, so it is not offered. Deactivate-and-recreate is the sanctioned migration.

#### `AddCustomFieldOptionsTool` → `AddCustomFieldOptions`

Append-only option growth. Cannot remove or rename existing options (destructive schema edits stay human-only, through the regular Filament UI, where the consequences for existing values are visible).

- Rejects any field whose `type` is not in `CHOICE_TYPES`, with the allowed list named in the error.
- Cap check is on the **sum**: `existingCount + count($newOptions) > maxOptions` → reject. Existing options are counted `withoutGlobalScopes()` so soft-hidden options still occupy budget.
- New options get `max(sort_order) + 1 + $index`, appended in submitted order.
- Accepts either `"Label"` or `{"name": "Label"}` per entry — tolerant input shape, single stored shape.

#### The decision worth keeping

Schema mutation via AI is real but deliberately *narrow*: **create / rename / deactivate / append-options**, and nothing else. The shape of the guardrail is the transferable part — an allowlist of types the AI may create (chosen by "can this be expressed cleanly in a tool call"), an allowlist of target entities, permission checked **pre-proposal** rather than only pre-apply, caps counted against inactive rows too, and every destructive operation (delete field, change type, remove option, rename option) simply absent from the tool surface rather than gated behind a stronger approval. A capability you did not expose cannot be mis-approved.

### 1.7 The proposal-side field renderer (schema-aware diff UI, not raw JSON)

`packages/Chat/src/Services/Tools/ProposalFieldSchemaDescriber.php` — separate from the tool-schema describer above; this one runs **after** a proposal is created, to produce the structured per-field editor the frontend renders in the diff/approval card. For each field it emits `{code, label, kind, value, options?, required}` where `kind` is a small UI-oriented enum (`text`/`textarea`/`select`/`multiselect`/`toggle`/`date`/`number`/`link`) derived from the same `FieldDataType` mapping — **not** the raw 13 `type` strings, so the frontend only ever needs ~7 editor components regardless of how many custom-field types the backend supports. Choice fields carry both the raw option `id` and `label` so the UI can edit-in-place without a second round trip, and file-upload/record/lookup fields are explicitly excluded (`isDeferred()`) from the editable proposal surface — they're shown read-only or omitted, because chat-based editing of a file or relation isn't attempted.

**SeaRM gap this fills:** Launch 1's diff UI needs "a custom component either way" per the design doc (`WidgetType`/`WidgetContentRenderer`). This describer is the concrete algorithm for *what* that component needs to know per field — kind, current/proposed value, options-for-choice, required-ness — decoupled from SeaRM's actual field-type enum. Recommend porting this shape (not code) directly into the `ProposalItem` diff renderer's design.

### BUILD NOW / DEFER verdict — Custom-field-aware AI tools

| Item | Verdict | Reason |
|---|---|---|
| Per-tenant, per-request schema-as-prose string injected into tool parameter descriptions | **BUILD NOW** | Directly closes the charter's "resolve custom-field labels/option values/relation fields/data types" requirement; cheap to build against SeaRM's metadata service; no dependency on anything not yet built |
| Label-in/ID-out translation boundary for choice fields | **BUILD NOW** | Same reasoning; prevents the AI from ever needing to know or guess internal option UUIDs |
| Reuse the same validation rule-set the human UI uses, at the AI-tool boundary | **BUILD NOW** | Prevents validator drift; SeaRM already has field-level validation for human writes — the design is "call it from the tool layer too," not "build a new one" |
| Discovery tool telling model "call list-fields before propose" | **BUILD NOW** | Small, high leverage; belongs in the same tool family as `find_many`/schema reads already promised in the charter |
| `kind`-bucketed (not raw-type) diff-field descriptor for the approval UI | **BUILD NOW** (as design input to the ProposalItem diff renderer) | SeaRM's diff UI needs exactly this decoupling; keeps the UI from growing one branch per SeaRM field type |
| AI-proposable custom-field CRUD (create/rename/deactivate/append-options) with owner-only + type-denylist + per-tenant caps | **DEFER** — **fully documented, §1.6** | Verdict unchanged: schema mutation is a materially bigger trust surface than record mutation (it changes what *future* writes even mean); SeaRM's proposal/policy system needs to prove itself on record writes first. Trigger to build: once `AiWritePolicyService` overrides are used in practice for record fields, extend the same override key format (`<object>.<field>`) to metadata-mutation tool IDs. §1.6 now records everything needed to rebuild it: the 17-entry type allowlist and the rule that chose it, the 5-entry entity allowlist, the both-directions choice/options coherence check, caps counted `withoutGlobalScope` so deactivation is not an escape hatch, `sort_order` append semantics, the explicit tenant pin/unpin, and the deliberate duplication of every guard across tool (pre-proposal, model-correctable error) and Action (at-apply authority). |
| Full custom-field type taxonomy (13 raw types → `FieldDataType`) | **N/A — reference only** | SeaRM has its own field-type system; only the *pattern* (canonical semantic enum insulating AI code from raw type sprawl) is portable, not the enum values |

---

## Part 2 — Guided import review (HIGH VALUE — richest, most novel subsystem in the repo)

Package: `packages/ImportWizard`. A five-step Livewire wizard (`upload → mapping → review → preview → (execute)`) backed by a per-import SQLite scratch database (one file per import job) plus a Postgres `imports`/`failed_import_rows` pair for durable state. This is materially more sophisticated than a typical CSV importer — worth the most detailed treatment in this report.

### 2.1 Architecture: why a per-import SQLite store

`packages/ImportWizard/src/Store/ImportStore.php` creates a dedicated SQLite file per import (not a shared Postgres staging table). Every uploaded row becomes an `import_rows` row: `row_number`, `raw_data` (JSON), `corrections` (JSON — user's manual per-value fixes), `skipped` (JSON — user's manual per-value "don't import this cell"), `validation` (JSON — computed per-column errors), `relationships` (JSON — resolved relationship matches), `match_action` (create/update/skip), `matched_id`, `processed` (bool). Column mutations during review (`updateMappedValue`, `skipValue`, `undoCorrection`) are raw SQL `json_set`/`json_remove` against this file via `Illuminate\Database\Connection` — cheap, disposable, no impact on the tenant's real Postgres connection pool while a human is iterating over possibly 100k+ rows. This is a reusable architectural decision independent of the specific field/entity logic: **stage the whole import in a disposable per-job store; only touch the tenant's real database during the final execute phase.**

Design translation for SeaRM (Nx/NestJS/Postgres): equivalent would be a per-import staging table (or Redis/temp schema) rather than SQLite-per-file, but the principle — never let iterative review write to workspace-scoped production tables — should carry over directly.

### 2.2 Field-mapping inference (`MappingStep` + `DataTypeInferencer`)

Three-pass auto-map on wizard entry (`MappingStep::autoMap()`), each pass skipping columns the prior pass already mapped:
1. **Header-name guessing** (`autoMapByHeaders`) — `ImportFieldCollection::guessFor($header)` matches CSV header text against each field's `guess()` list (aliases + the field's own label/code, plus singular/plural forms via `Str::singular`). Deterministic, no ML.
2. **Entity-link guessing** (`autoMapEntityLinks`) — matches headers against `EntityLink::matchesHeader()` for relationship columns (e.g. a `Company` CSV header when importing People), picks the entity link's `getHighestPriorityMatcher()` (see 2.3).
3. **Data-type inference from sample values** (`inferDataTypes` → `DataTypeInferencer::infer()`) — for every still-unmapped header, pulls up to 10 sample values, and **votes**: each value is classified (email/phone/URL via Laravel validation rules, date via Laravel's `date` rule, currency via a regex on currency symbols, number via `is_numeric`, else `text`), the majority type wins if it clears a **50% confidence floor**, and if the top type is `text` the column is left unmapped (there is no useful field to guess for free text). If confidence is `>= 0.8` the winning type is matched against the tenant's actual configured custom fields of that `FieldDataType` (`getSuggestedFieldsForType` queries live `CustomField` rows), so suggestions are always fields that exist for this tenant, never a generic "this looks like an email" hallucination. **The detection rule set itself is not hardcoded** — it's built dynamically at runtime from `FieldManager::getFieldTypes()`, so any new custom-field type the CustomFields package defines automatically participates in inference with zero code change to `DataTypeInferencer`.

This inference design — sample-and-vote with a confidence floor, source rules derived from the live field-type registry rather than hardcoded, suggestions filtered to fields the tenant actually has — is a strong reusable pattern for SeaRM's own "infer mapping from CSV headers + sample values" requirement (charter: "Import scans before writing and infers field and relationship mappings").

### 2.3 Relationship matching / duplicate detection (`EntityLink`, `MatchableField`, `MatchResolver`, `EntityLinkResolver`)

Two distinct but related matching concerns:

**(a) Row-level duplicate detection ("is this CSV row an existing record?")** — `MatchableField` (`Data/MatchableField.php`) declares, per importer, which columns can identify an existing record (e.g. People: email, then phone, then name, ranked by `priority`), each carrying a `MatchBehavior`: `MatchOnly` (update-or-skip, never create), `MatchOrCreate` (update if found, else create), `Create` (always create, no lookup — explicit opt-out of dedup for that column). `BaseImporter::getMatchFieldForMappedColumns()` picks the **highest-priority matchable field that's actually mapped** in this import — so if the user mapped both email and phone, email (typically higher priority) wins as the identity key.

`MatchResolver::resolve()` runs once after mapping is confirmed (dispatched as a Bus batch job so it doesn't block the UI): extracts all distinct values for the matched source column directly via SQLite `json_extract`, batch-resolves them against the real tenant database (`EntityLinkResolver::batchResolve`, one query for potentially thousands of distinct values, not N+1), and bulk-writes `match_action`/`matched_id` back onto every `import_rows` row sharing that value. Unmatched rows get `Skip` (for `MatchOnly`) or `Create` (for `MatchOrCreate`). This is a real **duplicate-detection pass** distinct from the general dedup SeaRM may already have on record creation — it runs pre-execute, is visible to the user for correction in the Review step, and is deterministic (exact/case-insensitive value match, not fuzzy).

**(b) Cross-entity relationship linking ("what Company does this Person row belong to?")** — `EntityLink` (`Data/EntityLink.php`) models a relationship the import can either match-to-existing or auto-create, with its own `MatchBehavior` per matcher. Storage happens through a small strategy interface (`EntityLinkStorageInterface`, three implementations: `ForeignKeyStorage`, `MorphToManyStorage`, `CustomFieldValueStorage`) — the importer code doesn't care whether "Company" is a foreign key column, a many-to-many pivot, or a `record`-type custom field; it calls `link->getStorageStrategy()->store(...)` uniformly. `EntityLinkResolver::resolveViaCustomField()` even special-cases matching against **JSON-array-valued custom fields** (multi-select "record" links) with driver-specific SQL (`json_each` for SQLite, `jsonb_array_elements_text` for Postgres, `JSON_TABLE` for MySQL) to search inside the array without loading every row into PHP. During execution (`ExecuteImportJob::resolveGroupedMatches`), relationship targets are **deduplicated within the same import run** via an in-memory `createdRecords` map keyed `"{linkKey}:{lowercased name}"` — so if 50 People rows all say `Company: "Acme Inc"` and none exist yet, exactly one Company row is created and all 50 People link to it, not 50 duplicate Companies.

**Design principle worth keeping:** separate "does this row already exist" (MatchableField/MatchResolver, own-entity identity) from "does this row's *related* entity already exist" (EntityLink/EntityLinkResolver, cross-entity identity) — they have different matchers, different behaviors, and different storage strategies, and conflating them is where most importer implementations get muddled. Also worth keeping: intra-batch dedup for auto-created related records, and a pluggable storage-strategy interface so relationship "shape" (FK vs pivot vs EAV-array) is abstracted from the resolution/matching logic.

### 2.4 Validation error surfacing (`ColumnValidator`, `ValidationError`, Review step UX)

Validation happens **per unique value**, not per row — `ReviewStep` groups the store by distinct values per selected column (`uniqueValuesFor`), each with a count of how many rows share it, so a reviewer sees "this exact bad value appears in 340 rows" once, not 340 times. `ColumnValidator::validate(ColumnData, value)` dispatches on the target field's `FieldDataType` (date/number/boolean/single-choice/multi-choice-predefined/multi-choice-arbitrary/text), returning a typed `ValidationError` (`ValidationError.php`) that's either a flat `message` or, for multi-value fields (email/phone/multi-select), **per-item errors** (`itemErrors: {item => reason}`) so a comma-separated cell like `"a@b.com, not-an-email"` shows exactly which sub-value is bad. Validation for every column runs **asynchronously** as Laravel queue-batch jobs (`ValidateColumnJob`, one per column) so a 100-column, 100k-row CSV doesn't block the UI; `ReviewStep::checkProgress()` polls batch completion and the UI shows a per-column spinner (`isSelectedColumnValidating`) plus per-column pass/fail badges (`columnErrorStatuses`, itself Livewire-cached for 60s to avoid re-scanning on every poll tick).

Filtering/sorting the review table (`ReviewFilter` enum, `SortField`/`SortDirection`) lets a reviewer jump straight to "show me only the values with errors," sorted by how many rows are affected — triage by blast radius, not by row order.

**SeaRM translation:** this is the concrete UX/data-model answer to the charter's "Users review validation errors, duplicates, mappings, and merge/skip/create rules" step. The specific ideas worth preserving: (1) group by distinct value with row-count, not per-row; (2) per-item errors for multi-value cells, not just per-cell; (3) async background validation with progress polling so large files don't block; (4) filter/sort by error density.

### 2.5 Per-value corrections, skip, and choice-value inline editing

Within Review, a user can, per distinct bad value: **correct** it (`updateMappedValue` — writes to a `corrections` JSON map keyed by the original raw value, re-validates the corrected value immediately, and if the field is a comma-separated arbitrary-multi-choice field, returns granular per-item errors back to the Livewire component for inline display), **skip** it (`skipValue` — marks that value's cells as intentionally blank, distinct from leaving it invalid), or **undo** a correction (`undoCorrection`, re-validates the original raw value). `ImportRow::getFinalValue()` (referenced from `ExecuteImportJob::buildDataFromRow`) is presumably the resolution order: correction (if present) → raw value (if not skipped) → null. For multi-choice-predefined fields the UI additionally offers a **choice picker** (`choiceOptions` computed prop) rather than free text, so corrections into an enum field can't introduce a second invalid value.

Correction/skip apply to **the distinct value**, not the row — since values were grouped, fixing `"united states"` → `"United States"` once fixes every row that had that exact string. This amortizes the cost of a systemic bad-data pattern (e.g. inconsistent casing across an entire column) into one correction instead of N.

### 2.6 Preview step

`Livewire/Steps/PreviewStep.php` (not fully read, but referenced throughout) sits between Review and execution — final human confirmation of the resolved create/update/skip counts and, per `MappingStep::continueAction()`, an explicit **confirmation modal warning about duplicate creation risk** when no matchable/identity field was mapped at all ("Avoid creating duplicate records" — names the specific matchable fields the entity supports and lets the user go back or proceed anyway). This is a good UX beat: **warn about the specific, named risk (not a generic "are you sure") only when the risk is real** (no identity column mapped), and name exactly which columns would fix it.

### 2.7 Execution: resumable, chunked, idempotent-by-row (`ExecuteImportJob`)

Single queued job (`#[Backoff([10,30])] #[Timeout(300)] #[Tries(3)]`), but internally resumable at row granularity:
- Processes only `where processed = false` rows, `chunkById(500, ...)` — so a job retry after a timeout/crash **skips already-completed rows** rather than re-running the whole import. This is the charter's "resumable idempotent job" requirement, concretely implemented as a `processed` boolean flag per row plus chunked, checkpointed writes (`flushProcessedRows` marks a chunk done only after its DB writes succeed).
- Each row's actual mutation (`processRow`) runs inside its own `DB::transaction` — one row's failure never rolls back siblings.
- **Intra-import Create→Update promotion**: `matchableValueCache` (in-memory, normalized-lowercased-value → new record ID) — if row 1 creates a Person by email and row 400 in the *same import* has the identical email (both were independently resolved to `Create` because neither matched an *existing* DB record before the import started), row 400 is silently promoted to `Update` against the record row 1 just created, rather than creating a duplicate. This closes a real gap that a naive "resolve matches once up front" design has: **the import's own newly-created rows must also participate in dedup, not just pre-existing DB rows.**
- Failures are per-row and non-fatal to the batch: caught, counted (`results['failed']++`), and written to a **`failed_import_rows`** Postgres table (`id`, `import_id`, `team_id`, `data` — the original raw row as JSON, `validation_error` — truncated exception message) via `FailedImportRow` model, auto-pruned after one month (`MassPrunable`). The whole job only rethrows/marks `Failed` status on an *unrecoverable* exception outside the per-row try/catch (e.g. DB connection loss), and even then flushes whatever failed-row data it collected first.
- Custom-field values and "promoted to tag option" values are batched and flushed per 500-row chunk via `upsert()` (not per-row inserts) — a real perf-relevant detail for large imports with many custom fields per record.
- **Format-aware value conversion per column** at execute time (`convertCustomFieldValue`): the same column can have a per-mapping `DateFormat`/`NumberFormat` chosen during mapping (e.g. `DD/MM/YYYY` vs `MM/DD/YYYY`), applied only now, not during earlier validation (validation only checks *parseability* for the chosen format, execution does the actual parse+store).

### 2.8 Failed-row handling and retry (charter: "Failed rows stay downloadable and retryable")

`packages/ImportWizard/src/Http/Controllers/DownloadFailedRowsController.php` — streams a CSV (`response()->streamDownload`, `lazyById(100)` cursor so memory stays flat regardless of failure count) reconstructing the **original column headers plus an appended "Import Error" column** carrying that row's specific exception message, so the user gets back exactly the file they'd need to fix-and-reupload, self-documenting per row. Auth-checked against the requesting user's current team matching the import's `team_id` (tenant isolation on the download endpoint itself, not just the query).

Note: this repo's "retry" is re-upload-the-corrected-CSV, not an in-place per-row retry button — worth flagging as a possible improvement opportunity for SeaRM rather than a design to copy verbatim (an in-place "fix this row and re-run just this row" UI would be strictly nicer, and SeaRM's per-row processed/failed data model here supports it).

### 2.9 Explicit "not worth porting" items inside ImportWizard

- **SQLite-per-import-as-a-file** as the literal storage mechanism — SeaRM/Postgres should use a staging table or scoped temp schema instead; the *pattern* (disposable staging store, never touch production tables until execute) is what's valuable, not the file-based SQLite implementation.
- **`CleanupImportsCommand`** — now read in full (`packages/ImportWizard/src/Commands/CleanupImportsCommand.php`) and **recorded to completion here, so the DEFER row needs nothing further from the repo.** `php artisan import:cleanup --hours=24 --completed-hours=2`, three sweeps:
  1. **Terminal imports** (`Completed`/`Failed`, `updated_at` older than `--completed-hours`, default 2h): destroy the store, **keep the `Import` row**. The audit record and the `failed_import_rows` outlive the bulky staging artifact by a long way — two different retention clocks for two different kinds of data.
  2. **Abandoned imports** (any non-terminal status older than `--hours`, default 24h): destroy the store **and delete the `Import` row**. A wizard someone walked away from mid-mapping has no audit value.
  3. **Orphaned directories** — scan `storage/app/imports/*`, and for any directory whose id has no `Import` row, delete it. This third sweep carries the only non-obvious decision in the file, and it is a real race: `ImportStore::create()` writes the directory **before** the `Import` row commits, so a *recent* orphan is an in-flight import, and deleting it pulls the SQLite file out from under a running job (which then fails with "readonly database"). The guard is therefore an age check on the directory's own mtime against the same `--hours` cutoff, plus a `rescue(...)` around `File::lastModified()` because the directory can vanish between being listed and being stat'd when a concurrent import finishes and destroys its own store.

  **Transferable rule, independent of SQLite:** a garbage collector for staging artifacts must never treat "no parent row yet" as "orphaned" — it must additionally require the artifact to be older than the longest plausible create-to-commit window, and must tolerate the artifact disappearing underneath it.
- The five hardcoded importer subclasses (`CompanyImporter`, `PeopleImporter`, `OpportunityImporter`, `TaskImporter`, `NoteImporter`) are entity-specific field/link declarations for *relaticle's* fixed schema — SeaRM's importer would declare mappings against its own metadata-driven object system instead, so these classes are reference only, not portable structure.

### BUILD NOW / DEFER verdict — Guided import review

| Item | Verdict | Reason |
|---|---|---|
| Disposable per-import staging store (never write to production tables until execute) | **BUILD NOW** | Directly required by charter Phase 3 ("Imports ... create traceable proposals with no duplicate writes"); this is the mechanism that makes review-before-write possible at all |
| Three-pass mapping inference: header-guess → entity-link-guess → sample-value-vote-with-confidence-floor, sourced from the live field-type registry | **BUILD NOW** | Matches charter's "infers field and relationship mappings" almost verbatim; the confidence-floor + tenant-filtered-suggestions design avoids false-positive auto-mapping |
| Separate MatchableField (own-row identity) vs EntityLink (related-row identity) matching, each with its own MatchBehavior (MatchOnly/MatchOrCreate/Create) | **BUILD NOW** | Core duplicate-detection mechanism the charter calls for; the own-vs-related distinction avoids the most common importer design bug |
| Storage-strategy abstraction (FK / pivot / EAV-array) behind one interface for relationship writes | **BUILD NOW** | SeaRM has its own relation-storage shapes (relation fields, many-to-many); same abstraction need applies |
| Group validation errors by distinct value with row-count, async per-column validation with progress UI, per-item errors for multi-value cells | **BUILD NOW** | Concrete UX answer to charter's "review validation errors ... " step; scales to large files |
| Per-value correction/skip (not per-row), with re-validation on edit and choice-picker for enum fields | **BUILD NOW** | Same file, large leverage-to-effort ratio |
| Intra-import Create→Update dedup promotion (new rows matching each other, not just existing DB rows) | **BUILD NOW** | Closes a real correctness gap; cheap to implement as an in-memory cache during the execute pass |
| Row-granular resumable/idempotent execution (`processed` flag, chunked checkpointing, per-row transactions) | **BUILD NOW** | Directly the charter's "resumable idempotent job" requirement |
| Failed-row capture with original-row-plus-error CSV re-download | **BUILD NOW** | Directly the charter's "failed rows stay downloadable and retryable" requirement |
| Format-aware per-column date/number parsing chosen at mapping time, applied at execute time | **BUILD NOW** | Small but real correctness feature (avoids MM/DD vs DD/MM ambiguity bugs), cheap to include alongside the mapping step |
| In-place "retry just this failed row" (rather than re-upload-the-CSV) | **NOT WORTH PORTING** (was DEFER) | Reclassified: **this is not a relaticle capability and never was** — it was a note about something relaticle *lacks*, mistakenly filed in a triage table of things to extract. There is nothing in the repo to archive, so deleting the repo loses nothing. The idea (per-row fix-and-rerun, which the `processed`/`failed_import_rows` model would support) is a SeaRM product backlog item, not a scouting finding, and should live in the backlog rather than here. |
| SQLite-file-per-import as literal mechanism | **N/A — reference only** | Superseded by whatever staging mechanism SeaRM's Postgres-only stack uses; only the "disposable staging, not production tables" principle transfers |
| Scheduled cleanup of stale import artifacts | **DEFER** — **fully documented, §2.9** | Verdict unchanged (build once a staging mechanism exists), but the row is now self-contained: three sweeps with two different retention clocks (artifact 2h, abandoned-wizard 24h, `Import` row kept for terminal imports), and the one real subtlety — the orphan sweep must age-gate on the artifact's own mtime because the directory is written *before* the parent row commits, and must tolerate the artifact vanishing mid-scan. |

---

## Part 3 — Approval-gated AI proposal batches: what relaticle does *differently* from Launch 1

Per instructions, the concept is not re-litigated (SeaRM already has `Proposal`/`ProposalItem`, `ProposalGateService`, `ProposalExecutionService`, per-workspace `AiWritePolicyService`). Below is only what relaticle's `PendingAction` design (`packages/Chat/src/Services/PendingActionService.php`, `ProposalEditor.php`, `Models/PendingAction.php`, `Enums/PendingActionOperation.php`/`PendingActionStatus.php`) does **differently**, each rated for whether Launch 1 should absorb it.

### 3.1 Per-item batch resolution with partial-progress durability (biggest genuine difference)

Launch 1's `ProposalExecutionService.approve()` is validate-then-apply for a *selected subset* of items in one call, but is silent on whether that "apply" step is one transaction or many. Relaticle is explicit and deliberate: whole-batch `approve()` **refuses to run at all** on a batch proposal (`throw_if(($pendingAction->action_data['_batch'] ?? false) === true, ...)`) — batches *must* resolve one item at a time via `approveItem($pendingAction, $user, $index)` / `rejectItem(...)`, **each in its own transaction**, so a later item's failure never rolls back an earlier item's already-committed write. The proposal stays `Pending` until every item has a recorded outcome (`items[index] = {status, id}` accumulated in `result_data`), then `finalizeBatchIfComplete()` sets the parent to `Approved` (if any item succeeded) or `Rejected` (if the user rejected every item) and stores the aggregate `ids`/`count`.

This is a real, considered tradeoff against Launch 1's design doc, which explicitly rejected true cross-item atomicity "on cost" (record-crud services accept no external transaction manager) but didn't fully specify what replaces it. Relaticle's answer — **per-item transactions, per-item durable status, idempotent re-resolution (`isset($items[index])` short-circuits a re-run of an already-resolved item)** — is a concrete, tested (`approveItem`/`rejectItem` both have this idempotency guard baked in, not bolted on) pattern Launch 1 can adopt directly for its batch-of-items-per-agent-run model, since Launch 1 already batches "six tool calls in one turn... one reviewable change set."

**Recommend absorbing:** make `ProposalExecutionService.approve()`'s per-item apply loop each run in its own transaction (it may already do this via "Apply sequentially through the existing record-crud services" — worth confirming at implementation time) and make partial-batch failure durable/idempotent the same way: an item that already applied should never be re-applied on a retried approve call.

### 3.2 Duplicate-proposal collapsing across job retries (idempotency-by-content, not just by-key)

`createProposal()` has an explicit guard, commented in detail: an AI chat turn is itself retried (429/529/503 from the provider) at the *job* level, which means the same tool call gets re-emitted and would otherwise insert a second identical proposal. Relaticle collapses this by looking for an existing `PENDING` proposal in the same conversation with matching `action_class`/`operation`/`entity_type` **and byte-identical `action_data`** (`first(fn ($existing) => $existing->action_data === $actionData)`), returning the existing row instead of inserting a duplicate. Deliberately scoped to `PENDING` only — an already-approved/rejected proposal never silently absorbs a fresh, legitimately-new request.

Launch 1's design doesn't mention this failure mode at all — it's plausible NestJS's job/queue retry semantics differ enough that this doesn't apply identically, but the *general risk* (an AI agent's own retry/backoff logic re-emitting an identical tool call and creating duplicate proposals) is real regardless of stack and worth an explicit design decision either way, not silence.

**Recommend absorbing:** add an idempotency check to Launch 1's proposal-opening path — same run/thread + same tool + byte-identical payload + still-`PENDING` collapses to the existing item/proposal, rather than trusting `threadId`-keyed batching alone to prevent this (batching by thread doesn't prevent *duplicate items within* that batch from a re-emitted call).

### 3.3 Fuzzy "you're about to create a near-duplicate" warning (soft, informational — not a hard block)

Separate from #3.2 (exact re-emission) and separate from the CRM-level duplicate-record detection SeaRM likely already has: `duplicateCreateWarning()` checks, at proposal-creation time, whether any other `Pending`/`Approved` create-proposal in the **same conversation, same entity type, within the last 15 minutes** has a record with the same (lowercased, trimmed) `name`/`title`. If so, it attaches a `display_data.duplicate_warning` string surfaced on the proposal card ("Heads up: 'Acme Inc' was already proposed or created a moment ago — approving this may create a duplicate.") — informational only, does not block approval. This is scoped intentionally narrow (conversation + entity + 15-minute window, exact-title match) to catch the specific real-world failure mode of a model re-proposing something because an earlier turn's continuation glitched, not to be a general dedup engine (that's the CRM's job, not chat's).

**Recommend absorbing (small, cheap):** Launch 1's diff UI could show an equivalent same-conversation-recent-title-collision warning on `ProposalItem` cards at low implementation cost, catching a distinct failure mode from #3.1/#3.2.

### 3.4 Pre-approval proposal editing without re-execution

> **DEFER row — archived in full below.** CUT in the program plan, so this is
> the surviving record. File: `packages/Chat/src/Services/ProposalEditor.php`
> (392 lines, one public method).

#### The `PendingAction` data model it operates on

```
id            ULID
team_id, user_id
conversation_id, message_id      nullable — ties the card to a chat turn
action_class                     FQCN of the Action that will apply it
operation                        enum create | update | delete
entity_type                      company | people | opportunity | task | note
action_data      jsonb           the clean, validated payload to apply
display_data     jsonb           the rendered review card (title/summary/fields[])
status           enum            pending | approved | rejected | expired | superseded
expires_at       datetime        set at creation, now()->addMinutes($expiryMinutes)
resolved_at      datetime?       when it left pending
result_data      jsonb?          per-item outcomes + created ids (see §3.1)
```

Batch proposals set `action_data['_batch'] = true` and carry
`action_data['records'][]` / `display_data['items'][]` as parallel arrays; a
single item is addressed by integer `$index` into both.

**The separation that makes editing possible at all: `action_data` is what will be executed, `display_data` is what the human sees, and they are rebuilt together from the same edit.** A design where the card renders directly off `action_data` cannot support edit-in-place, because there is nowhere to put the option *labels* the editor needs next to the option *ids* the executor needs.

#### `applyEdit(PendingAction, User, array $input, ?int $index)` — control flow

1. **Pin tenancy** — `TenantContextService::setTenantId($pendingAction->team_id)` inside a `try/finally` that restores the previous id. The editor runs from a Livewire request whose ambient tenant may differ from the proposal's.
2. **`DB::transaction` + `lockForUpdate()->findOrFail()`** — re-read the row under a row lock. Everything below operates on the locked copy, so a concurrent approve cannot interleave with an edit.
3. **`assertEditable()`**, three checks in this order:
   - `operation !== Create` → refuse. **Only create-proposals are editable.** Editing an update-proposal would mean editing a diff against a baseline that may have moved; editing a delete has no meaning.
   - pending-but-past-`expires_at` → **transition it to `Expired` right there** (`status`, `resolved_at`) and then throw "This action has expired". Lazy expiry: the edit attempt is what notices, so there is no dependency on the sweeper having run.
   - not pending → "This action has already been resolved".
4. **`resolveRecord()`** — for `_batch`, require `$index`, bounds-check it against `count($records)`, and validate the record is an array; four distinct error messages rather than one. For non-batch, `action_data` *is* the record.
5. **`splitInput()`** — partition the submitted `code => value` map into core fields (`ProposalCoreFields::isCore()` — the entity's title/name key, plus `account_owner_id` for company) and everything else, treated as custom-field codes.
6. **`validateCore()`** — title/name trimmed and required-non-empty (error text switches between "Title"/"Name" per entity); `account_owner_id` checked through `TeamMembersContext::memberFieldError()`, i.e. the assignee must be a real member of *this* team.
7. **`validateCustomFields()` — the ID↔label bridge, the subtle part.** §1.4's validator is the canonical one and it speaks **labels** (that's what the LLM emits). But the edit UI was handed **option ids** by §1.7's `ProposalFieldSchemaDescriber`, so that's what it posts back. `convertChoiceIdsToLabels()` walks the submitted map, loads the tenant's active `CustomField` rows for the submitted codes with `options`, and for each field that is a *real* choice field — `dataType->isChoiceField() && !acceptsArbitraryValues && lookup_type === null` — maps id → label (element-wise for `MULTI_CHOICE`). Everything else passes through untouched. **An id that matches no option is deliberately left as-is**, so the downstream validator rejects it with its normal "not one of the configured choices" message rather than the bridge silently swallowing it. Then the converted payload goes through the same `CustomFieldsRequestValidator` as §1.4, which translates labels back to ids and applies the shared rule-set.
8. **`rebuildRecord()` — per-key merge, never wholesale replace.** Only the codes present in the *edit* are touched:

   ```php
   foreach (array_keys($editedCustomFields) as $code) {
       if (array_key_exists($code, $cleanFields)) { $merged[$code] = $cleanFields[$code]; continue; }
       unset($merged[$code]);            // edited to empty/invalid → drop that one key
   }
   if ($merged === []) unset($record['custom_fields']);
   ```

   A custom field the reviewer did not touch survives the edit. A field edited to blank is removed **individually** — the whole `custom_fields` map is never cleared as a side effect. This is exactly the bug a naive `$record['custom_fields'] = $cleanFields` would introduce, and the code carries a comment saying so.
9. **`displayBuilder->build()`** re-renders the card from the rebuilt record, seeded with `currentDisplayFields()` (the existing field list for this item) so field ordering and any read-only/deferred entries survive re-render.
10. **`persist()`** writes both `action_data` and `display_data` — spliced at `$index` for batches, wholesale otherwise — and `refresh()`es. **Status is untouched: the proposal is still `Pending`.** No Action is instantiated, no job is dispatched, no continuation is queued.

#### Why this matters

Launch 1's diff UI is approve / reject / deselect-items only. **A reviewer who spots one wrong value in an otherwise-good proposal has to reject the whole item and ask the agent to redo it** — which costs a model round trip, may produce a differently-wrong result, and trains reviewers to rubber-stamp rather than correct.

**Verdict unchanged (CUT; trigger: reviewers frequently reject-and-ask-again for a single wrong field).** If it is ever built, the four load-bearing decisions above are: create-only, lock-then-validate-then-persist inside one transaction with lazy expiry, the id→label→id round trip through the *one* canonical validator, and per-key merge of the custom-field map.

### 3.5 Supersession on new user message ("the user moved on")

> **DEFER row — archived in full below.** CUT in the program plan. Files:
> `packages/Chat/src/Services/PendingActionService.php` (~lines 400–560),
> `packages/Chat/src/Jobs/ProcessChatMessage.php` (lines 113–140, 308),
> `packages/Chat/src/Agents/CrmAssistant.php` (lines 233–250 prose, 380–420
> renderer), `packages/Chat/src/Enums/PendingActionStatus.php`.

#### Five statuses, not three

`PendingActionStatus = pending | approved | rejected | expired | superseded`.
The two terminal-without-a-decision states are distinct on purpose:
**`expired` means time ran out; `superseded` means the user moved on.** They
are surfaced differently to the model (below) and rendered differently in the
UI (`expired` and `superseded` share the grey colour but keep separate labels).

#### Three ways a pending proposal dies

1. **TTL sweep** — `PendingAction::query()->expired()` (scope: `status = pending AND expires_at < now()`) bulk-updated to `Expired` with `resolved_at = now()`. `expires_at` is set at creation as `now()->addMinutes($expiryMinutes)`.
2. **Lazy expiry at touch time** — any edit or approve attempt on a past-`expires_at` row transitions it itself (see §3.4 step 3). The sweep is a backstop, not the mechanism.
3. **Supersession** — `supersedePendingForConversation($conversationId)`:

   ```php
   DB::transaction(function () {
       $pending = PendingAction::where('conversation_id', $id)
           ->pending()->lockForUpdate()->get()->all();   // row locks first
       if ($pending === []) return [];
       $resolvedAt = now();                              // ONE timestamp for the batch
       foreach ($pending as $a) $a->update(['status' => Superseded, 'resolved_at' => $resolvedAt]);
       return $pending;                                  // pre-update copies, for the caller
   });
   ```

   Note the return value: the rows **as they were before the update**, so the caller can describe what it just cancelled without a second query.

#### Where supersession fires — two places, and the second is the interesting one

- `ProcessChatMessage::handle()`, **before the agent runs**: a new user message on this conversation cancels every unactioned proposal from the previous turn. It then broadcasts `PendingActionsSuperseded { conversationId, pendingActionIds[] }` on the private conversation channel, so the approval cards **disappear from the UI live** rather than lingering as clickable-but-dead affordances.
- `ProcessChatMessage::failed()`, **when the chat job dies**: same call. A proposal orphaned by a crashed turn is cancelled rather than left pending against a conversation whose assistant message never arrived. This is the non-obvious half — proposals are a side effect of a turn, so a failed turn must retract them.

#### Two distinct context blocks injected into the next model turn

Both are built from data, not from the model's memory. The whole point: **the model's belief about proposal state must not depend on the continuation having successfully journaled it.**

**`<superseded_proposals>`** — what was just cancelled by this very message. Its system-prompt rules are explicit about the failure mode it prevents:

> "their approval cards are GONE and can never be approved or rejected again. NEVER tell the user to approve or reject a superseded proposal, and never describe it as still pending or 'current'. If the user's new message is unrelated, just handle it; do not re-propose the cancelled operation. If the user's message asks to continue, resume, proceed, or confirm ('continue', 'resume', 'yes', 'go ahead', 'next'), they want to keep going: re-issue the appropriate write tool to create a FRESH proposal for the next step, then ask them to approve the new card."

That last clause is the one that makes supersession usable rather than merely safe: "yes, continue" after a superseded card must produce a **new** card, not a claim that the old one is still live.

**`<resolved_actions>`** — `resolvedSinceLastAssistantMessage($conversationId)`:

- selects this conversation's rows in `{approved, rejected, expired, superseded}` with `resolved_at NOT NULL`, **`resolved_at > (created_at of the latest assistant message)`** — i.e. exactly the decisions the replayed transcript cannot already reflect;
- `oldest('resolved_at')->limit(20)` — chronological, bounded so a long approval session cannot blow the context window;
- per row emits `{operation, entity_type, status, label, record_id, record_ids[]}`, where `label` is the first non-empty of `display_data.name`, `action_data.name`, `display_data.title`, `action_data.title` — falling back to `(unnamed)`;
- rendered as `- approved: create company "Acme Inc" (id: 01J…)`, with `(ids: a,b,c)` for a batch, and **no id part at all for rejected/expired/superseded** — the model is given an id only when there is a real record to build on.

The header lines are instructions, not just data: *"These proposals were already decided by the user. Do not re-propose them. Use an approved record id to continue any multi-step request still in progress."*

#### Why the block exists at all: the one-write-per-turn rule

This only makes sense next to the agent's other standing instruction — *"After ANY write tool call, STOP your turn immediately… the user must approve it before anything happens… If their request needs more steps, the user drives the next one."* Because a multi-step request is chopped into one-proposal-per-turn, **the id of the record created in step 1 is not in the transcript when step 2 runs** — approval happened out of band, after the assistant's last message. `<resolved_actions>` is the channel that carries it back. Without it, one-write-per-turn and multi-step requests are mutually incompatible.

Labels are passed through `PromptText` sanitisation (drops angle brackets) before interpolation, so a record named `<system>` cannot forge a prompt block.

#### Verdict

Launch 1's `expiresAt` expiry is time-based only; it has no "the user's next message implicitly abandons this" signal, no retraction on failed turn, and no mechanism feeding proposal-resolution history back into the agent's context.

**Verdict unchanged (CUT; trigger: multi-turn chat with persistent threads exists and users report the agent re-proposing resolved items).** But note the coupling: **if SeaRM ever adopts a one-write-per-turn stop rule, `<resolved_actions>` stops being a nicety and becomes a prerequisite.** The two ship together or not at all.

### BUILD NOW / DEFER verdict — Proposal-batch differences from relaticle

| Item | Verdict | Reason |
|---|---|---|
| Per-item transaction + durable per-item status + idempotent re-resolution for batch approve/reject | **BUILD NOW (fold into Launch 1's `ProposalExecutionService`)** | Directly strengthens Launch 1's own stated batch-apply behavior; low cost, closes a real partial-failure gap; should be resolved during Launch 1 implementation, not deferred |
| Duplicate-proposal collapsing on exact retry (same run/thread + tool + payload + still-pending) | **BUILD NOW (fold into Launch 1's gate-open logic)** | Same reasoning; prevents a known, cross-stack-agnostic failure mode (retry-driven duplicate proposals) that Launch 1's design is currently silent on |
| Same-conversation near-duplicate "heads up" warning on the diff card | **BUILD NOW (small addition to diff UI)** | Cheap, directly improves reviewer trust, no new entities needed — just a query + a UI string |
| Pre-approval in-place proposal editing (edit-then-approve without re-execution) | **DEFER** — **fully documented, §3.4** | Verdict unchanged (real UX gain, non-trivial surface — needs the same custom-field-aware re-validation Launch 1 scoped away). Trigger: reviewers frequently reject-and-ask-again for single-field mistakes. §3.4 now carries the full `PendingAction` shape, the ten-step `applyEdit` flow, and the four load-bearing decisions: create-proposals only; lock→validate→persist in one transaction with lazy expiry-on-touch; the id→label→id round trip so the *one* canonical validator is reused; and per-key merge of the custom-field map so untouched fields survive and a blanked field drops individually. |
| Conversation-level proposal supersession + resolution-history injected back into agent context | **DEFER** — **fully documented, §3.5** | Verdict unchanged (chat/agent-run layer, not the proposal layer). Trigger: multi-turn chat with persistent threads exists and users report the agent re-proposing resolved items. **One dependency now recorded that was not visible before:** this is not optional if SeaRM adopts a one-write-per-turn stop rule — the id of a record approved out of band is absent from the transcript, so `<resolved_actions>` is the only channel carrying it into the next turn. Also archived: the five-status enum, the second supersession call site (`failed()` — a crashed turn retracts its own proposals), the live `PendingActionsSuperseded` broadcast, and the `resolved_at > last assistant message` / `limit 20` selection rule. |

---

## Part 4 — Everything else scouted, explicitly dispositioned (no silent drops)

Per charter/prompt instruction: every capability judged **not** worth porting, with reason.

| Capability | Where | Verdict | Reason |
|---|---|---|---|
| MCP tool suite (`app/Mcp/Tools/**`) — Create/Update/Delete/Get/List per entity, plus attach/detach for polymorphic Note/Task links | `app/Mcp/Tools/` | **Not worth porting as-is** | These are direct (non-approval-gated!) MCP writes — architecturally the opposite of the charter's approval-gated mandate. Notably the *chat* tools (`packages/Chat/src/Tools/`) are the approval-gated ones; the MCP tools appear to be a separate, more permissive integration surface. SeaRM's MCP tool contract must route through the same `ToolExecutorService`/proposal gate as chat — do not use relaticle's direct-write MCP pattern as a model. Flagging the *existence* of this split (chat=gated, MCP=direct) as a smell worth avoiding in SeaRM, not a design to copy. |
| `WhoAmiTool`, `ListTeamMembersTool`, `GuideToPageTool` | MCP + Chat tool dirs | **Already-equivalent / trivial** | Identity/context/navigation helper tools — SeaRM's agent context (`actorContext`, `authContext`) already covers "who am I," and "guide user to a settings page" is a thin UI-navigation helper, not differentiated design. Not worth a dedicated inventory entry beyond this line. |
| `AggregateCrmTool`, `GetCrmSummaryTool`, `SearchCrmTool` | `packages/Chat/src/Tools/` | **Speculative / no unique design** | Read-only aggregation/search helpers scoped to relaticle's fixed 5-entity schema; SeaRM's `find_many`/`group_by` tools (already built per the Launch 1 design doc) cover equivalent ground generically. No novel algorithm here worth extracting. |
| AI credit/billing system (`AiCreditBalanceResource`, `tool_call_credit_bonus`, per-model `credit_multiplier`, plan-gating (`min_plan`)) | `packages/SystemAdmin`, `packages/Chat/config/chat.php` | **Architecture mismatch** | This is relaticle's own SaaS billing model bolted onto AI usage — orthogonal to CRM trust-layer design and belongs to SeaRM's existing billing system if/when SeaRM meters AI cost (charter already has "token and cost usage" on `AgentRun`). Not part of this scout's mandate. |
| Multi-provider model registry with per-model `write_guard: api|prompt` distinguishing providers that enforce "one write per turn" natively vs. rely on prompt+gate | `packages/Chat/config/chat.php` | **Worth a one-line note, not a build item** | Interesting observation: relaticle tracks, per model, whether the *provider* can be trusted to rate-limit tool calls per turn or whether it's prompt-only and must lean entirely on the server-side gate (never trust a model-side promise). SeaRM's `ProposalGateService` already treats every write as gated regardless of provider, which is strictly safer and makes this distinction moot — SeaRM's design is already better here. No action. |
| Chat rate limiting, stream cancellation, retry/backoff events (`ChatRateLimitTest`, `ChatCancellationTest`, `ChatStreamRetrying`) | `packages/Chat/src/Events`, tests | **Infra hygiene, not differentiator** | Standard LLM-streaming reliability concerns (rate limits, cancellation, backoff) — necessary engineering, not a named target capability, and not particular to relaticle's design. SeaRM's own chat/agent-run infra will need equivalent handling but there's no novel algorithm here to extract. |
| Chat message feedback (`ChatMessageFeedback`, thumbs up/down + admin dashboard widget) | `packages/Chat/src/Models/ChatMessageFeedback.php`, `packages/SystemAdmin` | **DEFER — fully documented in this cell; nothing further in the repo** | Trigger unchanged: once SeaRM has a chat surface in production and product wants an AI-quality signal. The entire design is one table: `chat_message_feedback { id ULID, team_id, user_id, conversation_id, message_id, rating, category?, comment?, model? }`, `rating ∈ {up, down}`, `category ∈ {inaccurate, did_not_follow, too_slow, other}`, plus a free-text `comment`. **The only decision worth keeping is the `model` column:** the model id is copied onto the feedback row at rating time rather than joined from the conversation later, so the quality signal stays attributable after the workspace switches default models or the conversation's model is renamed/retired — which is the whole reason to collect it. The fixed four-category taxonomy (separating "wrong" from "ignored my instruction" from "slow") is a reasonable starting vocabulary; the admin resource and stats widget are Filament scaffolding with no design content. |
| Per-provider prompt-caching config (`anthropic_prompt_caching`) | `packages/Chat/config/chat.php` | **Implementation detail** | Anthropic-specific cost optimization; applies identically regardless of source repo, not a design decision unique to relaticle. No action needed here — SeaRM's own Anthropic integration should do this regardless. |
| Onboarding seed fixtures referencing proposals (`packages/OnboardSeed/resources/fixtures/*/tasks/*_proposal.yaml`) | `packages/OnboardSeed` | **Not applicable** | Demo/seed data for relaticle's own onboarding flow; no design content, just fixture data shaped to relaticle's schema. |
| `EntityLinkValidator` (validates a raw CSV value against an entity-link mapping's target during Review, distinct from `ColumnValidator`) | `packages/ImportWizard/src/Support/EntityLinkValidator.php` | **Folded into Part 2, not separately dispositioned** | Not independently read in depth; its role (validate entity-link column values during review) is already captured in the Part 2 "guided import review" BUILD NOW disposition as part of the overall validation pipeline — no separate design content beyond what's in §2.4. |
| Five hardcoded importer subclasses' specific field lists (Company/People/Opportunity/Task/Note) | `packages/ImportWizard/src/Importers/*.php` | **Reference only, not portable** | Entity-specific to relaticle's fixed schema; SeaRM's metadata-driven object system means the *importer framework* (Part 2) is the portable asset, not any specific entity's field mapping. |

---

## Summary of BUILD NOW items by priority (cross-cutting)

Highest-leverage-per-effort, in rough implementation order for whoever picks this up:

1. **Custom-field schema-as-prose tool-description generator** + **label↔ID translation validator** reusing SeaRM's existing field validation rules (§1.3, §1.4) — directly closes a charter contract, no new entities needed, plugs into Launch 1's existing tool schema-building path.
2. **Duplicate-proposal collapsing on retry** + **per-item transactional batch apply with idempotent resolution** (§3.1, §3.2) — both are corrections to Launch 1's own in-flight design, cheap, should land before or alongside Launch 1 ships rather than as a follow-up.
3. **Guided import staging store + mapping inference + match/dedup resolver + async validation UX + resumable execution + failed-row CSV** (Part 2, whole) — this is Phase 3 work per the charter's delivery sequence, but the entire design is ready to hand to an implementation plan now; it's relaticle's single richest, most complete subsystem and the one with the most net-new value for SeaRM.
4. **`kind`-bucketed proposal field descriptor** for the diff-review UI (§1.7) and **near-duplicate warning on proposal cards** (§3.3) — small UI/UX additions layered onto whatever Launch 1 ships.

Everything else inventoried above is either already better in SeaRM's design, architecturally mismatched (direct-write MCP tools, billing), or genuinely deferred with a named trigger.

## Deferred-capability archive status

This report is the only surviving record of this codebase. Every DEFER row has been re-read against source and is now self-contained — a reader can rebuild the capability without reopening `relaticle`.

| DEFER row | Status | Where the full record lives |
|---|---|---|
| AI-proposable custom-field / schema CRUD | Deepened | §1.6 (allowlists, caps, double-guard tool/Action split) |
| Scheduled cleanup of stale import artifacts | Deepened | §2.9 (three sweeps, two retention clocks, orphan-directory race) |
| Pre-approval in-place proposal editing | Deepened | §3.4 (`PendingAction` schema + full `applyEdit` control flow) |
| Conversation-level supersession + resolution history | Deepened | §3.5 (five statuses, two fire sites, two context blocks, the one-write-per-turn coupling) |
| Chat message feedback | Deepened (in place) | Part 4 table row — the whole design is one table; recorded there |
| In-place "retry just this failed row" | **Reclassified: not worth porting** | Part 2 verdict table — never a relaticle capability; it was a note about a *gap*. Nothing to archive; the idea belongs in SeaRM's product backlog. |
