# Product Charter — AI-Native Universal CRM

This is the governing document. Every plan, every task, and every implementation decision is judged against it. Where a plan and this charter disagree, the charter wins.

## The one-line product

**The open-source, evidence-first CRM where AI can research and operate, but every business fact and action is traceable, policy-controlled, and human-approved.**

The winning principle: **competitors sell autonomous agents; we sell accountable agents.**

## Base and sources

Built in `twenty` at verified clean commit `6e1c710`. Twenty remains the AGPL platform core for both cloud and self-hosted deployment.

**Do not Git-merge the other repositories.** Reimplement their differentiated capabilities against Twenty's metadata, permissions, workflows, audit trail, APIs, and UI.

| Source | Adopted capability |
| --- | --- |
| `twenty` | CRM core, custom objects, views, dashboards, workflow engine, apps, integrations, tenancy, SSO, permissions |
| `crm` | Durable autonomous research, evidence-backed facts, identity resolution, research budgets, agent briefs |
| `relaticle` | Approval-gated AI proposal batches, custom-field-aware AI tools, guided import review |
| `crmkit` | Agent-safe errors, OAuth/MCP access, deterministic API semantics, ticket/campaign workflow models |

**AI may research and draft freely. Every CRM mutation and outbound communication must become a proposal requiring explicit human approval.**

## Best-of-all-worlds, without bloat

The owner's requirement is that the product carry the best features of all four codebases. The owner's other stated requirement is KISS: simplicity beats complexity, and complexity is usually a crutch for missing product-market fit.

These are reconciled by **inventory completely, triage explicitly, drop nothing silently**:

1. Every capability worth having from every source repo appears in the inventory. Scouts do not pre-filter.
2. Each inventoried capability is then assigned one of exactly two dispositions in a plan:
   - **Build now** — with the tasks that build it.
   - **Deferred** — recorded in a "deliberately cut" table with the concrete trigger that would justify building it ("when users ask X more than once", "when outbound volume exceeds Y").
3. A capability that appears in neither list is a planning defect. Silent drops are forbidden.

This gives a complete map to market from, and a shippable first release.

## Preserve Twenty as the system of record

- Keep Twenty's workspace, role, field-permission, metadata, record CRUD, audit, dashboard, layout, search, import, connected-account, workflow, application, and deployment systems.
- Custom objects are the only extension mechanism for business-specific records. **Never add industry records to the core schema.**
- All customer-visible business functionality stays workspace-scoped and permission-checked.
- Cloud and self-hosted ship from the same codebase. Hosted billing and provisioning stay optional and never become a dependency of self-hosting.

## The AI trust layer

Platform entities, all workspace-scoped:

| Entity | Required behavior |
| --- | --- |
| `AgentTask` | Durable scheduled work: priority, record target, reason, lease, retry count, budget, idempotency key, cancellation |
| `AgentRun` | Execution status, workflow link, model/provider, transcript, elapsed time, token and cost usage, error details |
| `Evidence` | Immutable observation: source type, source locator, observed time, extractor, payload hash, strength, record links |
| `Fact` | Current or superseded sourced assertion: freshness, conflict state, field/value, evidence links |
| `Proposal` | Approval envelope: creator, run/workflow source, target records, status, expiry, reviewer |
| `ProposalItem` | Typed create/update/delete/send action: old value, proposed value, related evidence, validation result |

Where Twenty already implements one of these (it has `AgentRun`, turns, and cost accounting today), **extend it — do not build a parallel one.**

### The five non-negotiable contracts

1. **Record contract** — every action uses Twenty objects, fields, relations, and permissions.
2. **Execution contract** — all workflows and agents are versioned, idempotent, cancellable, leased, retryable, and budgeted.
3. **Evidence contract** — facts are never written without traceable observations.
4. **Proposal contract** — AI changes are visible diffs supporting approve, reject, expiry, supersession, and atomic batch execution.
5. **Principal contract** — audit entries distinguish authenticated user, represented user/team, workflow, agent, and integration.

A plan that violates any of these is rejected regardless of how well it reads.

### Platform APIs to expose

- Create, lease, complete, retry, and cancel agent tasks.
- Record evidence and derive facts **without directly mutating user records**.
- Create proposals and proposal items from agents, workflows, imports, or connected accounts.
- Approve or reject a proposal batch; approval executes through Twenty's ordinary record path and emits normal audit events.
- Query record history, evidence, facts, proposals, and agent runs by workspace and record.

## Trust layer meets workflows and AI

Workflow extensions:

- **AI research action** — creates an `AgentTask`, links the `AgentRun`, returns only sourced output.
- **Human approval action** — pauses a workflow on a proposal, resumes only after approval or rejection.
- **Evidence/fact trigger** — fires on new material evidence, a conflict, stale data, or an approved proposal.
- **Agent-aware record CRUD action** — accepts approved proposal items only. Raw agent output can never write CRM fields.
- **Budget and retry controls** — failed tasks back off and never duplicate facts, notifications, or record changes.

Metadata-aware AI and MCP tools:

- Read and search records, views, history, workflows, and schema.
- Resolve custom-field labels, option values, relation fields, data types, and field-level permissions.
- Create proposals for record edits, relationship changes, emails, calendar events, tasks, and app records.
- Return machine-readable failures: `code`, `message`, `hint`, `allowed_actions`, `retryable`.
- Use OAuth-scoped agent credentials with workspace-limited access.
- Require confirmation-token semantics for AI-requested deletes. Human UI deletion behavior is unchanged.

## The end-to-end workflows the product must deliver

These are the acceptance narratives. A phase is only meaningful insofar as it moves one of these closer to working.

### Lead to qualified opportunity

1. Form, import, API, email, calendar, or app creates or updates person and company records.
2. Deterministic email/domain/relationship matching prevents duplicates.
3. A workflow creates a budgeted research task.
4. The agent collects internal history and optional enrichment data as evidence.
5. Strong non-conflicting observations create facts; weak or conflicting ones create proposal items.
6. A user approves the proposal batch.
7. Approved changes update records, create tasks, assign an owner, and open or advance an opportunity.
8. Dashboards show source, quality, conversion, freshness, and AI cost.

### Pipeline and follow-up

1. Stage change, inactivity, or close-date risk triggers a workflow.
2. The workflow evaluates related records and recent activity.
3. It creates tasks or an email/calendar proposal with evidence and a suggested next action.
4. The user approves outbound communication.
5. Delays schedule follow-up; replies or stage changes supersede stale work.
6. Audit history records user, workflow, agent, evidence, and approval.

### Inbox and meeting intelligence

1. Connected-account sync ingests mail, events, participants, recordings.
2. Identity matching attaches known participants; ambiguous matches become proposals.
3. The agent extracts commitments, risks, job changes, and next actions as sourced proposals.
4. Approval updates records, tasks, opportunities, and record briefs.

### Data import and quality

1. Import scans before writing and infers field and relationship mappings.
2. Users review validation errors, duplicates, mappings, and merge/skip/create rules.
3. A resumable idempotent job imports rows.
4. Failed rows stay downloadable and retryable.
5. Imports may create research tasks but never bypass approval for AI-derived changes.

### Autonomous account monitoring

1. Cron or event triggers create leased tasks for stale or high-value records.
2. Agents compare new observations against prior evidence under time, cost, and provider limits.
3. Material changes create proposals and notifications; unchanged records get refreshed observation metadata.
4. Failures retry with backoff and stay observable in run history.

## Delivery sequence

State verified **2026-08-17** against branch `ai-native-crm` at HEAD `807fc8a4aa`, by reading source and the task/review records on disk. **No exit gate is marked proven on the strength of a task report alone.** A gate is PROVEN only where a command was run and its output recorded.

| Phase | Content | Exit gate | State |
| --- | --- | --- | --- |
| 0 — platform baseline | Clean branch, architecture tests for isolation/permissions/audit/proposals/evidence/agent execution, AGPL documentation, cloud and self-hosted environment contracts | Reproducible local and self-hosted startup, clean CI, documented contracts | **NOT PROVEN** — never run as a phase |
| 1 — trustworthy write path | Proposals, proposal items, approval inbox, expiry, rejection, batch execution, agent principals, metadata-aware tool schema, confirmation-gated deletes, principal-aware audit, diff review UI | No AI or workflow mutation can bypass workspace, record, field, approval, quota, or audit checks | **PROVEN for the bypass clause**, with two open write races |
| 2 — evidence and durable research | Evidence, facts, freshness, conflicts, agent tasks, leases, retries, budgets, runs, transcripts, cost accounting; ported research patterns, identity matching, enrichment, record briefs, scheduled rechecks; surfaced on record pages, chat, workflows, dashboards, search | An end-to-end lead research workflow creates evidence, proposes changes, gets approval, updates records once, and survives retry and restart | **GATE NEVER RUN** — half proven by a bespoke harness |
| 3 — ingestion and data quality | Email/calendar/meeting ingestion into evidence extraction and identity review; guided imports, failed-row handling, relationship mapping, dedupe and merge review; outreach, inactivity, and freshness signals | Imports and connected-account events create traceable proposals with no duplicate writes and no cross-workspace leaks | **GATE PROVEN**, but a third of the phase's content was never built |
| 4 — universal agent access | OAuth-backed MCP, metadata discovery, scoped read and proposal tools, compact agent output, stable tool contracts; workflow templates; self-hosting, API, MCP, admin, and security documentation | An external authorized agent can discover schema, read permitted records, create proposals, and receive actionable failures | **NOT PROVEN** — the *external* half is untested and the fix to a discovery leak is unrun |
| 5 — vertical application framework | Every vertical is an installable application: objects, views, dashboards, workflows, permissions, agent instructions, seed data, upgrade migration, uninstall | A new industry composes standard objects, relations, views, workflow templates, and agent policies **without changing the CRM core** | **PROVEN for structure; NOT PROVEN for install/upgrade/uninstall** |

### What each state rests on

**Phase 0 — NOT PROVEN.** There was never a Phase 0 execution; work began at Phase 1. No architecture-test suite for isolation/permissions/audit/proposals/evidence/agent execution exists under any name. Local startup was proven once, on 2026-08-08 at commit `9cdf25aa6c`: `/healthz` returned `{"status":"ok"}`, 161 routes mapped, zero `Nest can't resolve` lines. **That proof does not extend to HEAD** — two commits have landed since, `node_modules` is currently empty in the checkout, and neither commit has been booted, typechecked, or unit-tested. Self-hosted startup against the documented Neon/Upstash contract has never been attempted. CI has never run on this fork. `LICENSE` and Twenty's copyright headers are intact, but no AGPL distribution/attribution document has been written.

**Phase 1 — PROVEN for the bypass clause.** `ProposalGateService` is the first statement of `ToolExecutorService.dispatch()` and is a denylist, so an unclassified tool is gated by default. Reviewed twice (3 Criticals found, then a 4th by the fix wave; re-review `MERGE_READY` after independent mutation testing). The 2026-08-08 Phase 2 review re-proved gate coverage by live execution and found two later regressions — `create_one` and every outbound send threw instead of proposing, and the gate's `CONFIRMATION_REQUIRED` verdict was ignored so an AUTO-policy delete executed. Both are fixed on disk and covered by a mutation-tested integration suite (9/9 green). *Not proven:* the gate wording's **quota** and **audit** clauses were never separately tested. *Open:* no partial unique index on `proposal (workspaceId, threadId, status)` or on `proposal.sourceKey`, so concurrent agents can double-create; `SendEmailTool` carries no idempotency key.

**Phase 2 — GATE NEVER RUN.** The differentiating chain is real at the service and SQL layer, proven by execution in a purpose-built harness on a scratch database: agent → `record_evidence` → `Evidence` row → derived `Fact` → `ProposalItem.factIds` → citation projection, with cross-tenant isolation holding at the SQL layer, and lease re-claim after a killed worker proven by kill-and-watch. **The charter's gate is not that.** `agent-task-research.integration-spec.ts` (8 tests) has never passed; its only recorded run returned `FORBIDDEN` for all 8 against an unseeded database. Nothing has been observed over the GraphQL transport, through the cron→BullMQ→worker hop, or applying an approved change exactly once. There is also **no way for a user to start the loop**: no workflow template calls `create_agent_task`, and `AgentTask` has no front-end surface at all. No whole-phase re-review has run since the CHANGES_REQUESTED verdict.

**Phase 3 — GATE PROVEN; content incomplete.** All four gate clauses were proven against a real database after a full reset (traceable proposals from imports, traceable proposals from connected-account events, no duplicate writes on retry, no cross-workspace leaks). **But the gate's wording is narrower than the phase's content.** "Email/calendar/meeting ingestion into evidence extraction" does not exist: `modules/structured-extraction/` contains only the per-account privacy toggle, and that toggle has zero consumers — a privacy gate shipped in front of a feature that was never written. One integration test is honestly left red: approving a participant-identity proposal fails at apply time, so the ingestion loop proposes correctly and then cannot complete. The phase has had **no code review**.

**Phase 4 — NOT PROVEN.** Nine integration tests pass with a recorded mutation check, covering role-scoped discovery, gated `create_one`, confirmation-gated delete, the `UNKNOWN_TOOL` failure envelope, and pagination. They ran in a throwaway worktree resolving services out of the app container — **not over the MCP/OAuth transport an external agent would use.** The suite that does test that transport, `mcp-oauth-scoping`, failed 2 of 4 on a genuine security regression: a role with zero object permissions was advertised the full 138-tool CRUD catalog. The fix is committed at HEAD but verified only by running one utility under `tsx`; its jest spec, the typecheck, and the integration suite were **not executed**. The phase's documentation half (self-hosting, admin, security) was not written; only `AGENT_API_CONTRACT.md` exists. The phase has had **no code review**.

**Phase 5 — structure PROVEN, behaviour NOT.** The customer-support app is 31 files with **zero edits** to `twenty-server`, `twenty-front`, `twenty-shared`, `twenty-sdk`, or `twenty-standard-application`, and the fix wave held that line rather than reaching into the core. That is the gate's core claim and it holds. The behavioural half does not: Task 11, the install/upgrade/uninstall proof, was never written — neither test file the brief names exists — and the workflow templates and post-install seeding have never been run against a live workspace. The review found 4 Criticals, all from a 15-version-stale SDK pin in the app template; 3 were fixed, 1 deliberately deferred, and no re-review followed. The phase also surfaced an upstream toolchain bug worth carrying: `twenty dev:build` prints "Build succeeded" while silently emitting an empty `logicFunctions` array.

Vertical waves after the framework exists: (1) customer support, target-account campaigns; (2) fundraising/nonprofit, events/conferences; (3) real estate, partner management, reusable templates.

The honest summary of the table above: **the product's differentiator is built and partially proven in isolation, and has never been demonstrated as a loop a user can drive.** See `docs/LAUNCH-READINESS.md`.

## Feature completion standard

A feature is complete only when it has:

- Forward-safe metadata/schema migration and workspace isolation.
- Authorization, field permissions, quotas, audit, idempotency, and retention behavior.
- API/tool and UI states for success, empty, loading, validation, conflict, approval, rejection, and failure.
- Workflow trigger and action compatibility, plus durable run history.
- Import/export and deletion behavior where relevant.
- Metrics, structured logs, health signals, error reporting, and agent-cost attribution.
- Unit, integration, workflow, browser, migration, multi-workspace, and self-hosted smoke tests.

## Market position

The market already has AI agents in CRM: Salesforce Agentforce (MCP/A2A, observability, governed actions), Zoho Zia agent studios and marketplace, Microsoft embedding agents across Dynamics. **"CRM with AI agents" is not a differentiator.**

The differentiator is the evidence → fact → proposal → approval chain, which is far stricter than chat, summaries, or uncontrolled automation. It answers the actual buyer fear: *"AI polluted our customer data or sent the wrong message."*

What makes it top-tier:

- Evidence attached to every AI claim, not a confidence score.
- A proposal inbox with field-level diffs, citations, approve/reject.
- Durable agent runs with budgets, retries, auditability, replayable context.
- Full permissions and tenant isolation applied to AI tools.
- Self-hosted open-source option for sovereignty-sensitive buyers.
- One horizontal core plus installable industry apps, not fragmented products.
- Workflows combining deterministic steps, AI work, and human gates.

**Go-to-market wedge:** *AI-native, open-source CRM for B2B teams that need trusted automation — not another chatbot over customer data.* Initial buyers: growing B2B sales and service companies (10–500 employees), agencies, consultancies, SaaS, relationship-heavy services, teams outgrowing spreadsheets or HubSpot/Pipedrive, and privacy-conscious self-hosters. Expand via vertical apps.

"For every business" is true architecturally and weak as marketing. Nobody buys everything; they buy an outcome. The architecture stays universal; the message stays narrow.

## Standing assumptions

- Twenty remains the direct AGPL base.
- The other three repos stay read-only reference implementations. Their Git histories and incompatible source are never merged.
- All industries ship through the vertical-app framework, never as hard-coded CRM modules.
- Human approval is mandatory for every AI-originated mutation and outbound communication.
