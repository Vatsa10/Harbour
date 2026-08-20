# AI-Native CRM Consolidation Plan

## Decision

**Twenty is the technical winner and target repository.** It has the largest implemented feature surface, the strongest extensible data model, the only complete visual workflow engine, the broadest integration system, and the best path from a small workspace to enterprise deployment.

This is a capability port, not a Git merge. The four projects have unrelated histories and incompatible stacks:

| Repository | Stack | Best role |
| --- | --- | --- |
| `twenty` | NestJS, React, PostgreSQL, Redis, Nx | Target platform and system of record |
| `crm` | NestJS, Next.js, Prisma, durable Eve agent | Autonomous research and evidence design |
| `crmkit` | Go, SQLite/PostgreSQL, HTTP/MCP | Agent-safe API semantics and compact deployment ideas |
| `relaticle` | Laravel, Filament, PostgreSQL, Redis | Approval-gated AI writes, custom-field-aware tools, and guided imports |

Code must be reimplemented against Twenty's metadata, permission, audit, workflow, and UI contracts. Directly copying services or database models would create a second CRM inside the first.

## Scorecard

Scores are based on code present in the local repositories, not marketing claims. Each score is out of 5.

| Capability | Weight | Twenty | Relaticle | CRM | crmkit |
| --- | ---: | ---: | ---: | ---: | ---: |
| CRM breadth | 20 | 5.0 | 3.5 | 2.5 | 3.0 |
| Workflow automation | 15 | 5.0 | 2.0 | 2.5 | 1.5 |
| AI-native operation | 15 | 4.0 | 4.5 | 5.0 | 4.0 |
| Enterprise and tenancy | 15 | 5.0 | 4.0 | 3.0 | 3.0 |
| Extensibility | 10 | 5.0 | 4.0 | 2.5 | 3.0 |
| Integrations and APIs | 10 | 5.0 | 3.5 | 3.0 | 3.5 |
| End-user UI | 5 | 5.0 | 4.0 | 4.0 | 0.0 |
| Test depth and maturity | 5 | 5.0 | 4.5 | 2.5 | 3.0 |
| Operational simplicity | 5 | 3.5 | 3.5 | 3.0 | 5.0 |
| **Weighted result** | **100** | **96** | **72** | **62** | **57** |

Twenty's local `HEAD` contains more than 3,200 test files, a metadata-driven object platform, dashboards, layouts, messaging/calendar sync, workflow triggers and branching actions, apps, APIs, SSO/2FA, billing, localization, and enterprise modules. That breadth is not practical to recreate in one of the smaller systems.

## Master feature list

Legend: **Keep** is already a Twenty strength; **Port** is a differentiator to implement in Twenty; **App** should be an installable solution rather than hard-coded core behavior.

### CRM foundation

| Feature | Best source | Target treatment | Priority |
| --- | --- | --- | --- |
| People, companies, opportunities, tasks, notes, activities | Twenty | Keep and standardize as shared CRM primitives | P0 |
| Metadata-defined custom objects and relations | Twenty | Keep | P0 |
| Custom fields and field types | Twenty + Relaticle | Keep Twenty's metadata model; port AI schema discovery and validation | P1 |
| Table, board, calendar, dashboard, and record views | Twenty | Keep | P0 |
| Custom record layouts and widgets | Twenty | Keep | P0 |
| Search, filters, sorts, groups, pagination | Twenty | Keep; add agent-optimized representation | P1 |
| Spreadsheet/CSV import | Twenty + Relaticle | Keep Twenty import; port guided mapping, inference, relationship matching, failed-row review | P1 |
| Export and backup | Relaticle + crmkit | Add scheduled export/backup app and portable data contract | P2 |
| Dedupe and identity resolution | crm + crmkit | Port deterministic matching, provenance, safe upsert, and merge review | P1 |
| Audit trail and field diffs | Twenty + crmkit | Keep Twenty events; expose consistent actor/principal and field diff API | P1 |
| Soft delete, restore, retention | Twenty | Keep; require AI confirmation policy for destructive actions | P1 |

### Sales and relationship management

| Feature | Best source | Target treatment | Priority |
| --- | --- | --- | --- |
| Multiple pipelines and customizable stages | Twenty | Keep | P0 |
| Opportunity amount, currency, probability, close date | Twenty | Keep | P0 |
| Contact roles and record relationships | Twenty | Keep | P0 |
| Activity timeline | Twenty | Keep | P0 |
| Tasks, reminders, assignment, due/overdue views | Twenty + crmkit | Keep; add agent-friendly reminder/digest tool | P1 |
| Outreach count and last-outreach signals | crmkit | Port as computed fields/app logic | P1 |
| Gmail/Google Calendar sync | Twenty + crm | Keep Twenty sync; port evidence extraction and safe identity matching | P1 |
| IMAP/SMTP/CalDAV and connected accounts | Twenty | Keep | P0 |
| Email drafting/sending and calendar event creation | Twenty | Keep as workflow actions | P0 |
| Call recording and meeting intelligence | Twenty apps | Keep and expand through apps | P1 |

### Workflow automation

| Feature | Best source | Target treatment | Priority |
| --- | --- | --- | --- |
| Manual, database-event, cron, and webhook triggers | Twenty | Keep | P0 |
| Create, update, upsert, find, pick, delete record | Twenty | Keep | P0 |
| Filter and if/else branches | Twenty | Keep | P0 |
| Iterator/loop and delay | Twenty | Keep | P0 |
| HTTP request and code/logic function | Twenty | Keep | P0 |
| Form, email, and calendar actions | Twenty | Keep | P0 |
| AI-agent workflow action | Twenty | Keep; connect to evidence and approval layers | P1 |
| Durable task leasing and recovery | crm | Port `SKIP LOCKED` lease semantics, retry policy, budgets, and resumability | P1 |
| Workflow versions, run history, step logs, replay | Twenty | Keep; add AI evidence/run links | P1 |
| Human approval/rejection step | Relaticle | Port as a native workflow action and inbox | P1 |

### AI-native layer

| Feature | Best source | Target treatment | Priority |
| --- | --- | --- | --- |
| Global and record-context assistant | Twenty + Relaticle | Keep Twenty UI; port proposal cards and contextual write controls | P1 |
| Autonomous scheduled research | crm | Port as durable agent jobs | P1 |
| Evidence ledger with source strength | crm | Port as first-class records linked to facts and CRM records | P1 |
| No-guessing fact policy | crm | Port as validation and agent policy | P1 |
| Fact suggestions requiring human settlement | crm + Relaticle | Port into proposal/approval inbox | P1 |
| Record briefs and summaries | crm + Relaticle | Port with source citations and staleness metadata | P1 |
| Identity matching across email, employer, social, and history | crm | Port with deterministic rules and review queue | P1 |
| Company/person enrichment providers | crm + Twenty apps | Provider interface; optional apps with capability discovery | P1 |
| AI-readable custom-field schema | Relaticle | Port metadata descriptions, option-label resolution, coercion, and diffs | P1 |
| Batch AI proposals and all-or-nothing approval | Relaticle | Port | P1 |
| Record-level agent transcript and durable conversation | crm | Port into Twenty's AI chat/run history | P1 |
| Model/provider gateway and cost ledger | Relaticle + Twenty | Keep provider abstraction; add per-run/token/cost budget | P1 |
| Agent-safe compact text API | crmkit | Add optional `text/plain` representation; keep JSON/GraphQL canonical | P2 |
| Instructive machine-readable errors | crmkit | Port `code`, `message`, `hint`, `allowed`, and retry guidance | P1 |
| MCP/OAuth connector | crmkit + Relaticle | Build one generic metadata-aware tool plus curated safe tools | P1 |
| Safe two-step delete and step-up auth | crmkit | Port into AI policy layer, not ordinary human UI | P1 |
| Sandboxed tools with deny-by-default egress | crm | Integrate with logic-function/code execution boundaries | P1 |

### Team, security, and enterprise

| Feature | Best source | Target treatment | Priority |
| --- | --- | --- | --- |
| Workspaces, members, invitations | Twenty | Keep | P0 |
| Roles, permissions, field access | Twenty | Keep and enforce for every AI/tool path | P0 |
| API keys, OAuth, sessions, token revocation | Twenty + crmkit | Keep; add named agent principals and scoped tokens | P1 |
| SSO, 2FA, approved domains | Twenty | Keep | P0 |
| Secrets encryption and secure HTTP | Twenty | Keep | P0 |
| Rate limits, quotas, usage, billing | Twenty + Relaticle + crmkit | Keep; unify user, workflow, and agent metering | P1 |
| Impersonation and admin panel | Twenty | Keep with strict audit | P0 |
| Localization and time zones | Twenty + crmkit | Keep; require locale/timezone-safe tool output | P1 |
| Observability, metrics, logs, health checks | Twenty | Keep; add agent run and workflow SLOs | P1 |

### Installable business solutions

| Solution | Best source | Target treatment | Priority |
| --- | --- | --- | --- |
| Customer support tickets, requester, assignee, conversation, SLA | crmkit | App built from custom objects and workflows | P2 |
| Marketing/target-account campaigns and memberships | crmkit | App | P2 |
| Fundraising pipeline | crmkit use-case | App/template | P2 |
| Event and conference follow-up | crmkit use-case | App/template | P2 |
| Competitive/market monitoring | crmkit + crm | App using autonomous research | P2 |
| Partner management | Twenty apps | App/template | P2 |
| Real estate | Twenty internal app | App/template after license review | P3 |

## End-to-end workflows

### 1. Lead capture to qualified opportunity

1. A form, import, API, email participant, or app creates/updates a person and company.
2. Deterministic identity resolution checks normalized email/domain and candidate matches.
3. The agent creates a research task with a budget and a lease.
4. Providers and internal email/calendar history produce evidence records.
5. Strong evidence creates facts; weak or conflicting evidence creates proposals.
6. A rep reviews one batch proposal with old/new values and sources.
7. Approved facts update the CRM through ordinary permission/audit services.
8. A scoring workflow assigns the lead, creates a task, and opens an opportunity.
9. Dashboards show conversion, source, response, and evidence freshness.

### 2. Sales pipeline and follow-up

1. Opportunity stage or activity changes trigger a workflow.
2. The workflow finds related people/company and evaluates amount, inactivity, and close date.
3. It branches by risk and either creates a task, drafts an email, or asks an agent for a recommended next action.
4. External communication remains draft/approval-gated unless an administrator explicitly allows autonomous sending.
5. Delay steps schedule follow-up; new replies cancel or supersede stale tasks.
6. Every action records the actor, the represented principal, the workflow run, and any AI evidence.

### 3. Inbox and meeting intelligence

1. Connected-account webhooks or polling ingest messages and events.
2. Participants are matched without guessing; unresolved identities enter a review queue.
3. Threads/events attach to the correct records.
4. The agent extracts commitments, risks, job changes, and next steps as sourced proposals.
5. Approval creates tasks, updates stages/fields, and refreshes the record brief.

### 4. Customer support

1. Email, form, or API creates a ticket app record linked to requester/company.
2. A workflow classifies urgency and category and proposes assignment.
3. SLA timers create warnings/escalations.
4. Replies and internal notes form the conversation timeline.
5. Resolution updates status, captures outcome, and schedules customer-success follow-up.

### 5. Target-account campaign

1. A user defines a campaign brief and acceptance criteria.
2. An agent searches existing records and researches candidates.
3. Candidates carry a source-backed inclusion reason and enter a review batch.
4. Approval attaches people/companies idempotently.
5. Workflows create sequenced tasks or drafts and stop on reply, opt-out, or conversion.
6. Campaign dashboards report coverage, activity, replies, qualified pipeline, and cost.

### 6. Data import and migration

1. Upload and scan occur before writes.
2. Type inference proposes field mappings and relationship keys.
3. Validation previews errors, duplicates, and cross-record links.
4. The user selects merge/skip/create rules.
5. A resumable background job imports idempotently.
6. Failed rows are downloadable and retryable; a complete audit links every result to the import run.

### 7. Autonomous account monitoring

1. A cron or record event creates leased research tasks for stale/high-value accounts.
2. The task declares available providers, spend/time limits, and data boundaries.
3. The agent compares new observations with prior evidence.
4. Material changes generate proposals and notifications; unchanged accounts receive a new freshness timestamp.
5. Failures retry with backoff and never duplicate facts or notifications.

## Target architecture

The new functionality should use five shared contracts:

1. **Record contract** — every feature uses Twenty objects/fields/relations and record permissions.
2. **Execution contract** — automation and autonomous work run as versioned workflow/agent runs with idempotency, leases, retry, cancellation, and budgets.
3. **Evidence contract** — an observation has a source, source locator, observed time, extractor, strength, and immutable payload hash. A fact references evidence and has freshness/status.
4. **Proposal contract** — every AI write can be represented as a typed batch diff that supports approve, reject, supersede, expiry, and all-or-nothing execution.
5. **Principal contract** — audit records distinguish the authenticated actor, represented human/team, workflow, agent, and originating integration.

Suggested platform entities:

- `AgentTask`: due time, lease, priority, attempt, budget, record target, reason.
- `AgentRun`: model/provider, workflow link, status, token/cost/time usage, transcript.
- `Evidence`: source type, locator, observation time, strength, payload hash, record target.
- `Fact`: field/value, evidence links, status, freshness, supersession.
- `Proposal`: creator/run, target, status, expiry, approval policy.
- `ProposalItem`: operation, field/relation, old value, new value, evidence links.

These should be workspace-scoped, permission-checked, searchable, auditable, and exposed through the same metadata/API layer as the rest of Twenty.

## Delivery order

### Phase 0 — protect the base

- Twenty was recloned with Windows long-path support and verified clean at commit `6e1c710a7d08ba40bf484e27c4785d9f64453554`; the failed checkout is preserved at `twenty-broken-20260804`.
- Decide distribution model and complete an AGPL/enterprise-file license review.
- Record a clean baseline for build, unit/integration tests, and critical browser flows.
- Freeze the five contracts above with architecture tests.

### Phase 1 — trustworthy AI write path

- Implement agent principal/scoped-token support.
- Implement proposal, proposal items, batch approval/rejection, expiry, and supersession.
- Make tools metadata/custom-field aware.
- Add instructive errors and two-step destructive actions.
- Enforce existing field/record permissions at proposal and execution time.

### Phase 2 — evidence and autonomous research

- Implement evidence/fact models and conflict/freshness rules.
- Implement durable agent tasks, leasing, retries, budgets, and run history.
- Port internal-history research, identity matching, enrichment providers, and record briefs.
- Link evidence and proposals into record pages, workflow runs, and AI chat.

### Phase 3 — ingestion and data quality

- Connect email/calendar ingestion to evidence extraction.
- Add duplicate review/merge and guided import relationship matching.
- Add outreach/staleness computed signals and scheduled data-quality workflows.

### Phase 4 — universal agent access

- Add OAuth MCP connector, metadata discovery, scoped tools, and optional compact text output.
- Add import, digest, backup, and inbox-sync skills/templates.
- Publish stable API/tool contracts and conformance tests.

### Phase 5 — business solution apps

- Ship support, campaigns, market monitoring, fundraising, and events as installable apps.
- Each app includes objects, views, dashboards, workflows, agent instructions, permissions, seed data, and uninstall/migration behavior.

## End-to-end definition of done

A merged feature is not complete until it includes all applicable layers:

- Workspace-scoped schema/metadata and forward migration.
- Authorization, field permissions, quotas, and tenant-isolation tests.
- Service/API path with idempotency, validation, audit, and instructive errors.
- UI for create/read/update, loading, empty, error, conflict, and mobile states.
- AI/MCP tool behavior with proposal/approval policy.
- Workflow trigger/action compatibility and run history.
- Import/export and deletion/retention behavior.
- Metrics, structured logs, health signals, and cost attribution.
- Unit, integration, workflow, browser, and migration tests.
- User, admin, developer, and self-hosting documentation.

## Risks and boundaries

- **Repository state:** The active `twenty` checkout is clean and complete with 27,375 tracked files and `core.longpaths=true`. The original failed checkout remains recoverable at `twenty-broken-20260804` and should only be removed after the owner no longer needs it.
- **Licensing:** `crm` and `crmkit` are MIT. Relaticle is AGPL-3.0. Twenty is primarily AGPL-3.0 and also contains explicitly marked commercially licensed files. Product distribution and source-availability obligations require legal review before consolidation.
- **Upstreamability:** Keep generic primitives in Twenty core. Ship vertical industries and provider-specific enrichment as apps so the platform remains maintainable.
- **Security:** AI must never bypass record/field permissions, tenant boundaries, confirmation policies, or audit. Tool execution and code steps require deny-by-default secrets and network access.
- **Data correctness:** Observations, facts, and suggestions are different states. An LLM confidence score is not evidence.
