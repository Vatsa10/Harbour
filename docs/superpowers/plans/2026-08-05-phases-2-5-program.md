# Phases 2–5 Program: Sequencing, Ownership, and Coverage

**Status:** governing document for the four phase plans below. Where a phase plan and this document disagree, this document wins — the phase plans were authored independently and in parallel, and the conflicts they contained have been resolved *in their own text* by this review. This document records what was decided and why.

**The four plans:**

| Phase | Plan | Owner scope |
| --- | --- | --- |
| 2 | `docs/superpowers/plans/2026-08-05-phase-2-evidence-and-research.md` | Evidence, Fact, AgentTask, AgentRun, research runs |
| 3 | `docs/superpowers/plans/2026-08-05-phase-3-ingestion-and-import.md` | Identity resolution, ingestion extraction, guided import |
| 4 | `docs/superpowers/plans/2026-08-05-phase-4-agent-api-semantics.md` | Agent-safe failures, confirmation, discovery, workflow templates |
| 5 | `docs/superpowers/plans/2026-08-05-phase-5-vertical-apps.md` | Customer-support vertical as an installable application |

**Already on disk and unchanged by this review:** Launch 1 / Phase 1 (`2026-08-05-ai-write-approval.md`) — `ProposalEntity`, `ProposalItemEntity`, `ProposalGateService`, `ProposalExecutionService`, `AiWritePolicyService`, the `ToolExecutorService.dispatch()` gate, and the approval inbox UI. Every phase below extends these; none replaces them.

---

## 0. RESOLUTIONS (controller, 2026-08-06, owner asleep — all reversible, see OVERNIGHT-LOG.md)

Implementers: these are decided. Build to them. Do not re-open.

| # | Decision | Resolution |
| --- | --- | --- |
| 1 | Trust-layer entity shape | **(a) core-schema for all four** — with one added requirement: `Fact` must be reached only through a `FactService` boundary, never queried directly from Phase 3/4/5 code. Promotion to a standard object then stays a one-module change instead of a program-wide rewrite. |
| 2 | Phase 5 vertical | **(a) customer support first**, campaigns second, reusing the same layout. |
| 3 | Ingested content to third-party LLM | **(c) on, with a per-connected-account exclusion toggle.** Scope the day of work in Phase 3 Task 4. **Owner: this is the one resolution to confirm on waking — it is your privacy and legal exposure, not mine.** |
| 4 | Seeded default agent per workspace | **(b) yes**, bound to a read-broad / write-nothing-directly role. Every write is proposal-gated regardless. |
| 5 | Phase 3 vs Phase 4 ordering | **Moot — run both in parallel** per §4's wave plan. Tracks are agent capacity, not headcount. |
| 6 | Human-approval workflow action | **Stay out.** Reasoning in §1 is sound: 108 files for a new `WorkflowActionType`, and AI writes inside workflows are already gated. Re-open on the stated trigger. |

Rationale for 1, the only place I departed from the reconciler's recommendation by adding a constraint: the reconciler is right that `Fact` is the one entity a user would filter, chart, or trigger on, and right that the dashboard demo gets expensive under (a). But the Phase 2 exit gate is *"an end-to-end lead research workflow creates evidence, proposes changes, receives approval, updates records once, and survives retry/restart"* — not the dashboard. Paying 22 files of metadata registry now, for a surface that is not on the exit gate, is exactly the speculative complexity the charter's KISS rule forbids. The service boundary is the cheap hedge: it costs nothing today and collapses the reversal cost later, which is the actual risk the reconciler identified.

---

## 1. Owner decisions required

These are not engineering calls. Each changes what the product *is*, trades off the go-to-market wedge, or picks between two defensible architectures with different cost profiles. Nothing below has been decided silently; each has a recommendation and a default that ships if no decision is made.

### Decision 1 — Are the trust-layer entities core-schema tables or standard objects?

**Options.**
(a) **Core-schema TypeORM entities** — what all four plans assume today. `Evidence`, `Fact`, `AgentTask`, `AgentRun` live in the `core` schema alongside `Proposal`/`ProposalItem`. Cheap: one entity file plus one instance command each.
(b) **Standard workspace objects** — the same four entities defined as SeaRM standard objects.

**Trade-off.** Option (b) buys, *for free and permanently*: saved views and filters over research activity, record pages, global search, dashboards and charts over facts and costs, and — the load-bearing one — **`DATABASE_EVENT` workflow triggers on `Evidence` and `Fact`**. The charter names all of these: Phase 2's row says evidence must be "surfaced on record pages, chat, workflows, dashboards, search", and "Trust layer meets workflows" names an "evidence/fact trigger". Option (a) delivers none of them without bespoke work per surface, and the evidence/fact trigger is currently **cut in Phase 2 with no cheap path to un-cut it** (see §7). The anchors report (§7) measured standard objects as materially more expensive: per-workspace metadata rows, migration surface on every workspace, and a heavier read path.

**Recommendation.** Ship (a) as planned, but recognise that this is the decision that makes "dashboards show source, quality, freshness and AI cost" (narrative *Lead to qualified opportunity* step 8) and the evidence/fact workflow trigger expensive rather than free. If the demo that sells this product is *"look at the dashboard of what the AI believes and where it learned it"*, choose (b) for `Fact` alone — `Fact` is the only one of the four a user would ever filter, chart, or trigger on. `Evidence`, `AgentTask`, and `AgentRun` stay core-schema under either choice.

**Blocks:** Phase 2 Tasks 1 and 4 (entity shape and migration). Cheap to decide now, expensive to reverse after Phase 3 and 5 write against it.

### Decision 2 — Which vertical does Phase 5 build?

**Options.** (a) **Customer support** (what Phase 5 plans today: `supportTicket`, `supportQueue`, triage agent). (b) **Target-account campaigns** (crmkit §1.13's Campaign model: brief, deduped many-to-many membership, provenance).

**Trade-off.** The charter names both as vertical wave 1. But the stated go-to-market wedge is *"AI-native, open-source CRM for B2B teams that need trusted automation"*, with initial buyers being B2B sales teams, agencies, and consultancies. **Customer support is the vertical furthest from that buyer.** Target-account campaigns sit directly on it, and a campaign is the natural consumer of everything Phases 2–4 build: research a target list, produce evidence, propose outreach, approve the batch. Against that: support is the simpler, more self-contained proof that the *framework* works, which is what the Phase 5 exit gate actually asks for, and the campaign object model is less settled (crmkit's own Campaign has no outreach mechanism — its author flagged that as an unfinished feature, not a design).

**Recommendation.** Build support first as planned — the exit gate is "a new industry composes ... **without changing the CRM core**", and support proves that with the least new product design. Then build campaigns as vertical #2 immediately, reusing Phase 5's file layout and the one-call `seedWorkflow` helper. If instead the next thing that must happen is a demo to a design-partner sales team, swap the order; the plan is structured so only the manifest data changes.

**Blocks:** all of Phase 5.

### Decision 3 — Does ingested customer content go to a third-party LLM by default?

**Options.** (a) **Yes, on by default** — Phase 3 Task 4 as planned sends full message bodies and call-recording summaries to whatever model `workspace.fastModel` resolves to, with no redaction and no opt-out. (b) **Off by default**, enabled per workspace. (c) **On, with a per-connected-account exclusion toggle.**

**Trade-off.** This is the first place customer content that a human never typed into a chat box leaves the instance. The charter's own market analysis names the buyer fear as *"AI polluted our customer data or sent the wrong message"* and lists "privacy-conscious self-hosters" as an initial buyer segment. Option (a) is a materially different privacy posture from Launch 1's chat-only surface and is the kind of thing that shows up in a security review. Option (b) costs one policy flag and suppresses the feature for everyone who does not find the setting. Option (c) costs one boolean on the connected-account record plus a check in the listener.

**Recommendation.** (c). It is roughly a day of work, it is the answer a security reviewer wants, and it does not bury the feature. Phase 3's own risk section flags this exposure and explicitly says no code-level fix was scoped — this decision scopes one.

**Blocks:** Phase 3 Task 4's two listeners. Decide before Phase 3 starts, not after.

### Decision 4 — Does the product ship a seeded default agent per workspace?

**Options.** (a) **No** — Phase 4's workflow templates and Phase 5's workflows run an `AI_AGENT` step with `agentId` omitted, which executes an ad-hoc unconfigured agent. (b) **Yes** — every workspace gets one seeded `AgentEntity` ("CRM assistant") with a role, and every template references it.

**Trade-off.** Three plans currently depend on (a), and all three flag the same unverified assumption: that `AgentAsyncExecutorService.executeAgent({ agent: null, ... })` produces a *capable* agent with the standard tool catalog rather than a degraded no-tools fallback. Phase 2's risks note a related trap — an agent with no role assigned silently loses every registry tool, including `record_evidence`, and the run "succeeds" having done nothing. Option (b) removes both risks, makes agent permissions administrable in one place, and is what a user expects to find on first login. Its cost is a seeding path plus a decision about that agent's default role, which is a product decision about how much a fresh workspace's AI can see.

**Recommendation.** (b), with the seeded agent bound to a read-broad / write-nothing-directly role (every write is proposal-gated anyway). This is a small amount of work that removes the single most repeated risk across the four plans. It also changes what the product *is* on first login, which is why it is here and not in the risk section.

**Blocks:** Phase 4 Task 10 (three templates), Phase 5 Task 7 and Task 9.

### Decision 5 — If only one track can be staffed after Phase 2, is it Phase 3 or Phase 4?

**Options.** Phases 3 and 4 are genuinely independent (see §4) and can run in parallel. If they cannot: (a) **Phase 3 first** — identity resolution, ingestion-to-proposal, guided import. (b) **Phase 4 first** — agent-safe failures, confirmation tokens, permission-scoped discovery, workflow templates.

**Trade-off.** Phase 3 is by far the largest body of work in the program and is the one that makes the product *usable* — a CRM you cannot import into is not evaluable, and duplicate-free ingestion is the "trusted automation" claim made concrete. Phase 4 is smaller, closes the charter's own Phase 4 exit gate, and is what makes the product *demo-able to an AI-native audience* (an external agent connects over MCP and works). Phase 5 additionally now depends on one Phase 4 task (Task 10) and on nothing in Phase 3.

**Recommendation.** Phase 3, then Phase 4 — the charter's own order. Import and dedupe block evaluation by real buyers; external MCP access does not. But if the next milestone is a launch post or a partnership demo rather than a design-partner trial, invert it: Phase 4 is roughly a third of Phase 3's size and it unblocks Phase 5.

**Blocks:** staffing, not code.

### Decision 6 — Is the human-approval *workflow action* (pause/resume) in or out?

**Options.** (a) **Out** — the current state across all four plans; deferred with a trigger. (b) **In** — a `REQUEST_APPROVAL` workflow step that pauses a run on a proposal and resumes on approve/reject.

**Trade-off.** The charter names this explicitly under "Trust layer meets workflows". The plans' argument for cutting it is strong: every AI write inside a workflow's `AI_AGENT` step already becomes a proposal automatically, so the action adds nothing for AI-originated writes. It adds something only for *deterministic* steps a human wants to sign off on — "send this deterministic email blast only if someone approves" — which no planned feature produces. Building it means a new `WorkflowActionType` (measured at 108 files across three packages in this codebase) plus workflow-run suspend/resume semantics.

**Recommendation.** Stay out. Re-open when a customer asks to gate a deterministic (non-AI) workflow step on human approval. Recorded in Phase 4's cut table with that trigger.

**Blocks:** nothing today. Listed because the charter names it and silence would look like an oversight.

---

## 2. Conflicts found and how each was resolved

Every resolution below has been applied to the plan files. None is left as a "coordinate with Phase N" note.

| # | Conflict | Locations | Resolution (applied) |
| --- | --- | --- | --- |
| C1 | **`ProposalGateService.evaluate()` rewritten by three phases over overlapping regions.** Phase 4 Task 6's replacement block silently dropped Phase 2's `factIds` lookup, dropped `toolId`/`toolCategory` (which Launch 1's live code sets), and changed the baseline field source from `gateInput.baselineFieldNames` to `Object.keys(gateInput.payload)` — which disables staleness detection for every `delete_one`, whose payload is `{}` and whose baseline is `['updatedAt']`. | P2 T8 step 10; P3 T1; P4 T2 step 3; P4 T5; P4 T6 step 3 | **Launch 1 owns the file. A single merge order is fixed and written into both plans:** P2 T8 → P3 T1 → P4 T2 → P4 T5 → P4 T6. Phase 4 Task 6's replacement block was rewritten to preserve `baselineFieldNames`, `toolId`, `toolCategory`, and `factIds`, with an inline instruction for the Phase-2-not-shipped case. Phase 2 Task 8 carries the reciprocal note. **Repair pass (I25): this resolution is incomplete.** Phase 4 **Task 5** — one position earlier in the same fixed merge order — separately rewrites `buildGateInput` wholesale, and that rewrite independently destroys `target`, `toolId`, `toolCategory`, and `baselineFieldNames` and inverts the gate's denylist to an allowlist (this is **C9** in the adversarial review of the plan files, `2026-08-05-phases-2-5-plan-review.md`). The conflict analysis above audited the downstream block (Task 6) that this table fixed and did not look at the upstream one (Task 5) in the same merge order. **This C1 row must not be read as "the file's merge conflicts are resolved" until Phase 4 Task 5 is separately repaired per C9 — that repair is out of this document's scope (Phase 4's plan file), flagged here so the program document does not claim a false "resolved" status.** |
| C2 | **`ProposalEntity.reason` is written by Phase 3 but does not exist.** `createFromExtraction` saves `reason`; the live entity has no such column (verified by reading `proposal.entity.ts`). The plan would not typecheck. | P3 T1 step 6 vs. `entities/proposal.entity.ts` on disk | Phase 3 Task 1 now adds **two** columns in one migration — `sourceKey` *and* `reason` — with the entity diff and the SQL updated. |
| C3 | **Contradictory migration claim inside Phase 4.** Its File Structure promised an instance command adding `idempotencyKey`/`workspaceId` to `core.proposalItem`; Task 6 states no migration is needed and adds none. | P4 File Structure vs. P4 T6 | File Structure line struck. Task 6 is correct: the dedupe reuses the already-loaded proposal and needs no schema change. |
| C4 | **Two incompatible provenance models for the same fact.** Phase 2 defines `Evidence` → `Fact` → `ProposalItem.factIds`. Phase 3 declared Phase 2 absent and carried provenance inline as a `reason` string quoting the source excerpt, with a "migrate later" note. An LLM-extracted job-title change with no `Evidence` row violates the charter's Evidence contract outright. | P2 T1/T2/T8 vs. P3 header + T4 | **Phase 2 wins and becomes a hard dependency shipping first.** Phase 3 Task 4 now calls `EvidenceRecordingService.recordEvidence({ ..., runId: null, sourceType: 'EMAIL_MESSAGE' \| 'CALL_RECORDING' })` before proposing, and Task 1's `createFromExtraction` attaches real `factIds` via `FactLookupService`. Phase 2 was edited to make this possible: `EvidenceSourceType` gained `EMAIL_MESSAGE`/`CALL_RECORDING`/`IMPORT_FILE` with declared strengths, and `Evidence.runId`/`Fact.runId` became nullable for workers with no `AgentRun`. Phase 3's "migrate provenance later" cut row is struck. |
| C5 | **Two workflow-creation implementations.** Phase 4 Task 10 builds a server-side `WorkflowTemplateService` on verified services. Phase 5 Task 9 hand-rolled `createWorkflow` → query draft version → `updateWorkflowVersionTrigger` → N × `createWorkflowVersionStep` from an app's post-install hook, using mutation names its own risk section called "the single highest-risk piece of code in the plan". | P4 T10 vs. P5 T9 | **Phase 4 owns workflow creation.** Task 10 gained `WorkflowTemplateService.installDefinition({ definition, workspaceId, activate })` — idempotent by workflow name — plus a public `installWorkflowDefinition(input: InstallWorkflowDefinitionInput!): InstalledWorkflowTemplate!` mutation. Phase 5's `seed-workflow.util.ts` is now a ~30-line wrapper around that one call, and its highest-risk item is closed rather than flagged. New edge: **P5 T9 depends on P4 T10.** |
| C6 | **Two metadata-discovery mechanisms.** Phase 3 Task 5 built a new `describe_custom_fields_<object>` tool **per object**; Phase 4 Task 8 permission-scopes the existing `get_object_metadata`. Both answer "what fields does this object have". | P3 T5 steps 7–11 vs. P4 T8 | **Phase 4 owns metadata discovery.** Phase 3's real finding was kept and acted on: `MetadataToolProvider.isAvailable()` hard-gates the whole provider behind `PermissionFlagType.DATA_MODEL` (verified on disk), so a record-scoped agent cannot discover anything. Phase 4 Task 8 was extended with Steps 2b/5b to relax that check to *DATA_MODEL or any object read permission* and to permission-scope **both** `ObjectMetadataToolsFactory` and `FieldMetadataToolsFactory`. Phase 3 Task 5 keeps Steps 1–6 (the custom-field description enricher, the genuinely novel part) and drops the provider. Phase 4's cut row deferring field-metadata scoping is struck — relaxing availability makes it mandatory. |
| C7 | **Unverified workflow → `createAgentTask` path.** Phase 2 claimed a workflow would call `createAgentTask` over its generic HTTP-request action with an API key — never traced end to end — and this claim carried acceptance narrative *Lead to qualified opportunity* step 3. | P2 T10 | Claim struck. Phase 2 Task 3 gained Step 8: a `create_agent_task` **static tool**, built exactly like `record_evidence`, ungated for the same reason (it schedules work, it touches no record). Any workflow's `AI_AGENT` step can now schedule durable research with no new workflow machinery. The GraphQL mutation remains the path for humans, admin scripts, and external agents. One scheduling service, two front doors. |
| C8 | **Same-file edits with no ordering.** `message-queue.constants.ts` (P2 `agentTaskQueue`, P3 `importQueue`), `tool-provider.module.ts` (P2, P3, P4), `metadata-engine.module.ts` (P2, P3, P4), `proposal.dto.ts` (P2, P4). | four files | Additive in every case; no semantic conflict. Ordering is fixed by the phase order in §4 and recorded in the component ownership table (§5). Phase 3's `DescribeCustomFieldsToolProvider` registration line was removed from `tool-provider.module.ts` along with the tool (C6). |
| C9 | **`AgentTask.budget` stored but never enforced** — the Execution contract requires "budgeted", and the only real ceiling was the workspace-wide AI credit balance. | P2 T4/T5/T7 | Phase 2 Task 7 now passes `maxSteps: task.budget` into `AgentAsyncExecutorService.executeAgent` (one more optional parameter alongside the `threadId` one Task 6 already adds), with tests. The remaining per-task *dollar* cap keeps its cut row with a sharpened trigger. |
| C10 | **Phantom deliverable.** `services/import-mapping-inference.service.ts` appears in Phase 3's File Structure ("header-guess + sample-value type voting") and is built by no task; sample-value voting is separately in Phase 3's cut table. | P3 File Structure | Removed from File Structure and recorded as a cut. The frontend wizard's existing header mapping is what ships. |
| C11 | **Nine references to three deleted workflow templates** would have been left dangling by the template cut (§3). | P4 throughout | All updated: type union, catalog, service test, DTO key list, goal line, File Structure, API doc, success-criteria table, narrative mapping, risk text. |

---

## 3. Duplicates collapsed

Cutting duplicated work is the highest-value output of this review. Six collapses, in descending order of work removed.

| Duplicate | Owner after collapse | Work removed |
| --- | --- | --- |
| Workflow creation: Phase 5's hand-rolled 4-mutation sequence vs. Phase 4's `WorkflowTemplateService` | **Phase 4 Task 10** (+`installDefinition` + `installWorkflowDefinition` mutation) | ~120 lines of unverified GraphQL client code, plus the entire class of risk it carried, deleted from Phase 5. Every future vertical app gets workflow seeding for one mutation call. |
| Metadata/custom-field discovery: Phase 3's per-object `describe_custom_fields_<object>` tool vs. Phase 4's `get_object_metadata` scoping | **Phase 4 Task 8** | Two files, five plan steps, one module registration, and *one new tool per object* removed from the agent tool catalog. |
| `INBOX_PROCESSING` workflow template vs. Phase 3 Task 4's structured extraction | **Phase 3 Task 4** | A cron-polled, non-idempotent LLM pass over recent messages that would have double-proposed against the same messages Phase 3 processes event-driven with `sourceKey` idempotency and real `Evidence`. |
| `IMPORT_ASSISTANCE` workflow template vs. Phase 3 Tasks 7–8 | **Phase 3 Tasks 7–8** | An after-the-fact duplicate/missing-field sweep, where Phase 3 resolves identity and validates *before* the write. |
| `ENRICHMENT` workflow template vs. `RESEARCH_BRIEF` | **`RESEARCH_BRIEF`** | An identical template with a different trigger, which a user can change in the workflow builder after installing. |
| Provenance: Phase 3's inline `reason`-string source excerpts vs. Phase 2's `Evidence`/`Fact` | **Phase 2** | A bespoke provenance string format nothing else reads, plus the data migration Phase 3 had already scheduled to undo it. |

Two things that *look* like duplicates and are deliberately **not** collapsed:

- **`ProposalEntity.sourceKey` (P3 T1) vs. item dedupe in `evaluate()` (P4 T6).** Different granularity (batch vs. item) on different entry points (background job with no thread vs. agent tool call inside a thread). Neither prevents the other's failure mode. Both ship.
- **`create_agent_task` tool (P2 T3) vs. `createAgentTask` mutation (P2 T10).** Two front doors onto one `AgentTaskService.createTask`. The tool serves workflows and agents; the mutation serves humans, scripts, and external OAuth clients. No duplicated logic.

---

## 4. Dependency graph and execution order

### Hard edges

```
Launch 1 (on disk, in progress)
   │
   ├──> Phase 2  ── entire phase depends on ProposalGateService / ProposalItemEntity
   │       │
   │       ├──> Phase 3 Tasks 1, 4  (Evidence/Fact: recordEvidence, FactLookupService, factIds)
   │       │
   │       └──> Phase 4 Task 6      (must preserve the factIds lookup P2 T8 adds)
   │
   ├──> Phase 4  ── Tasks 1–9 depend only on Launch 1
   │       │
   │       └──> Phase 5 Task 9      (installWorkflowDefinition, from P4 Task 10)
   │
   └──> Phase 5 Task 11             (end-to-end proof needs a live ProposalGateService)

Phase 3  ⟂  Phase 4     (independent apart from the two soft edges below)
Phase 5 Tasks 1–8, 10  ⟂  everything  (pure app-manifest config, no core dependency)
```

### Soft edges (order affects quality, not compilation)

- **Phase 3 Task 5 → Phase 4 Task 8.** Task 5's enriched custom-field descriptions are what Task 8's scoped `get_object_metadata` returns. Either order compiles; Phase 3 first gives a better discovery answer on day one.
- **Phase 2 → Phase 4 Task 10's prompts.** Once `create_agent_task` exists, the three templates' prompts should tell the agent to use it. A one-line prompt edit, not a code change.
- **Phase 3 → Phase 5.** A support ticket auto-created from an inbound email needs Phase 3's ingestion. Phase 5 correctly cuts multi-channel ticket ingestion with exactly this trigger.

### Recommended execution order

| Wave | Work | Rationale |
| --- | --- | --- |
| **0** | Finish Launch 1. Settle Owner Decisions 1, 3, 4. | Decision 1 sets Phase 2's entity shape — deciding it after Phase 3 and 5 write against it is expensive. Decisions 3 and 4 are cheap now and awkward later. |
| **1** | **Phase 2, whole phase** (13 tasks). | Everything downstream that touches provenance depends on it, and it is the phase that makes the product's differentiator real. Nothing else can start on the Evidence contract. |
| **2 (parallel A)** | **Phase 3 Tasks 2, 5, 6, 7, 8, 9, 10** — identity resolution, custom-field descriptions, and the entire guided-import backend. | None of these touch Evidence/Fact. They can start **during Wave 1**, in parallel with Phase 2, by a second track. This is the single biggest parallelisation win in the program: seven of Phase 3's eleven tasks, including its largest (the import backend), have no Phase 2 dependency. |
| **2 (parallel B)** | **Phase 4 Tasks 1–5, 7, 8, 9** — the error envelope, confirmation tokens, `hasMore`, permission-scoped discovery, OAuth verification. | Depends only on Launch 1. Can start during Wave 1 by a third track. |
| **2 (parallel C)** | **Phase 5 Tasks 1–8, 10** — the entire app manifest: objects, fields, views, roles, agent, skill, dashboard, install hooks. | Zero dependency on any server work. A fourth track, or an app-focused engineer, can build this from day one. **Repair pass (I28):** accurate as of the fix that moved Task 8's `post-install.ts` write into Task 9 — Task 8 now only writes `uninstall.ts` and has no forward dependency. Before that fix, Task 8 could not typecheck in this wave. |
| **3** | **Phase 3 Tasks 1, 3, 4, 11** (need Phase 2's Evidence) and **Phase 4 Tasks 6, 10, 11, 12, 13** (Task 6 needs Phase 2 Task 8; Task 10 is the workflow-template service). | Joins the parallel tracks back to the Phase 2 output. |
| **4** | **Phase 5 Tasks 9 and 11** — workflow seeding (needs Phase 4 Task 10) and the end-to-end install/upgrade/uninstall proof (needs a live gate). | The last edge in the graph. |

**Critical path:** Launch 1 → Phase 2 Tasks 1–2 (Evidence/Fact) → Phase 2 Task 8 (`factIds`) → Phase 4 Task 6 → Phase 4 Task 10 → Phase 5 Task 9 → Phase 5 Task 11. Everything else has slack.

### Parallelisation summary

Genuinely independent, buildable simultaneously from day one by separate tracks:

- **Phase 5 Tasks 1–8 and 10** touch no file under `searm-server`, `searm-front`, or `searm-shared`. Zero merge risk against any other track. **Repair pass (I28): this is true of merge risk, not buildability.** Phase 5's Task 8 originally wrote `post-install.ts`, which imports Task 9's `seedNewTicketTriageWorkflow`/`seedSlaRiskSweepWorkflow` — and Task 9 depends on Phase 4 Task 10, which is Wave 3/4 work, not Wave 2. Task 8 could not complete (typecheck clean) in Wave 2 as originally scoped. **Fixed in the same repair pass that resolved I23 in Phase 5's plan file:** Task 8's `post-install.ts` write moved into Task 9, so Task 8 is now genuinely Wave-2-buildable (it only writes `uninstall.ts`, which has no cross-task dependency), and **Tasks 9 must be treated as Wave 4 work alongside Task 11**, not Wave 2 — Phase 5's own "Depends on" section already states this dependency; this row is corrected to match it rather than imply all of Tasks 1–10 are free of build-order dependency.
- **Phase 3's import backend (Tasks 6–10)** touches only new files under `modules/guided-import/` plus one frontend hook. Zero overlap with Phase 2 or Phase 4.
- **Phase 4 Tasks 1, 3, 4, 7** touch only `core-modules/tool/`, `tool-provider/`, `record-crud/`, and `api/mcp/` — no overlap with Phase 2's `ai-research/` or Phase 3's `guided-import/`.

The one genuinely serialised file is `proposal-gate.service.ts` (C1). Assign it to one engineer for the whole program, or apply the five diffs in the fixed order in a single dedicated pass.

---

## 5. Component ownership

One owner per component. A phase that needs a component consumes the owner's exact signature; no phase redefines another's.

| Component | Owner | Consumers | Exact interface |
| --- | --- | --- | --- |
| `ProposalEntity`, `ProposalItemEntity` | Launch 1 | all | Additive columns only: `factIds` (P2 T8), `sourceKey` + `reason` (P3 T1). No phase may change an existing column's type or nullability. |
| `ProposalGateService.evaluate()` | Launch 1 | P2, P4 | Merge order fixed in C1. `GateDecision = { kind:'ALLOW' } \| { kind:'FORBID'; failure: ToolFailure } \| { kind:'CONFIRMATION_REQUIRED'; failure: ToolFailure } \| { kind:'PROPOSED'; output: ToolOutput }` after Phase 4. |
| `ProposalGateService.createFromExtraction()` | **Phase 3 T1** | P3 T3, T4, T9 | `(params: { workspaceId: string; sourceKey: string; reason: string; createdByActor: ActorMetadata; items: { actionType: ProposalActionType; objectNameSingular: string; recordId: string \| null; payload: Record<string, unknown>; baseline: Record<string, unknown> }[] }) => Promise<{ proposalId: string; itemIds: string[] } \| null>` |
| `ProposalExecutionService` | Launch 1 | P2 T9 (dismissal on reject) | Unchanged control flow; P2 adds one call at each of the two existing rejection-marking points. |
| `EvidenceEntity`, `FactEntity`, `EvidenceSourceType`, `EVIDENCE_SOURCE_STRENGTH` | **Phase 2 T1** | P3 T4 | `runId` nullable on both entities. `EvidenceSourceType` includes `EMAIL_MESSAGE`/`CALL_RECORDING`/`IMPORT_FILE`; Phase 3 adds no new source type. |
| `EvidenceSourceTypeGraphQL` (repair pass, I27 — the GraphQL mirror enum registered `@registerEnumType(... , { name: 'EvidenceSourceType' })`, consumed wherever `pendingProposals { items { facts { evidence { sourceType } } } }` is queried) | **Phase 2 T11** | P2 T12 UI, any GraphQL client reading evidence source type cross-phase | Must carry all seven `EvidenceSourceType` members, not a subset — a mismatch here throws at query time rather than at compile time (this is C4 in the plan-file review; out of scope for this document to fix directly, listed here because component ownership must cover a type's wire projection, not just its TS definition). |
| `EvidenceRecordingService.recordEvidence()` | **Phase 2 T2** | P2 T3 tool, P3 T4 | `(params: RecordEvidenceParams) => Promise<EvidenceEntity>`, `RecordEvidenceParams = { workspaceId; runId: string \| null; objectNameSingular; recordId; sourceType; sourceLocator; extractor; observedAt?; payload: { fieldName; value; snippet? } }`. Calls `deriveFact` internally — nobody else calls `FactDerivationService`. |
| `FactLookupService` | **Phase 2 T8** | P2 T9/T11, P3 T1, P4 T6 | `findCurrentFactIdsForFields({ workspaceId, objectNameSingular, recordId, fieldNames }) => Promise<string[]>`, `findByIds(ids) => Promise<FactEntity[]>`, `markDismissed(ids) => Promise<void>` |
| `AgentTaskEntity`, `AgentRunEntity`, `AgentTaskService` | **Phase 2 T4/T5** | P2 T3 tool, P2 T7 worker, P2 T10 resolver | `createTask` is the only creation path. `budget` is a step cap, enforced by T7. |
| `AgentAsyncExecutorService.executeAgent()` | SeaRM (existing) | P2 T6/T7, P4 T10, P5 T9 | Exactly two optional parameters added by this program, both by Phase 2: `threadId?: string` (T6) and `maxSteps?: number` (T7). No other phase changes this signature. |
| `ToolFailure`, `buildToolFailure` | **Phase 4 T1** | P4 T2–T4; new tools in P2/P3 should return it | `{ code: ToolFailureCode; message: string; hint?: string; retryable: boolean; allowedActions?: string[] }` |
| Metadata discovery (`get_object_metadata`, `get_field_metadata`, `MetadataToolProvider.isAvailable`) | **Phase 4 T8** | agents; P3 T5 supplies the field descriptions it returns | `generateTools(context: ToolProviderContext)` on both factories; provider available on DATA_MODEL **or** any object read permission. |
| Custom-field tool-schema descriptions | **Phase 3 T5** | P4 T8's output, all CRUD tool schemas | `describeCustomFieldForToolSchema(field: FlatFieldMetadata, relationTargetLabel?: string): string` |
| `IdentityResolutionService` | **Phase 3 T2** | P3 T3, T4, T7, T9 | `resolvePerson` / `resolveCompany` → `EXACT \| CANDIDATE \| NONE` with `matchedOn` + `explanation`. Phase 2 explicitly cuts identity resolution; it calls this. |
| Workflow creation and templates | **Phase 4 T10** | P4 T11 UI, **P5 T9** | `WorkflowTemplateService.list()`, `.install({ key, workspaceId, activate })`, `.installDefinition({ definition, workspaceId, activate })` (idempotent by workflow name). GraphQL: `workflowTemplates`, `installWorkflowTemplate`, `installWorkflowDefinition`. |
| `ImportBatchEntity`, `ImportRowEntity`, guided import | **Phase 3 T6–T10** | frontend wizard | No other phase touches import. |
| `message-queue.constants.ts` | shared, additive | P2 adds `agentTaskQueue`; P3 adds `importQueue` and reuses existing `aiQueue` | Append only, in phase order. |
| `tool-provider.module.ts`, `metadata-engine.module.ts` | shared, additive | P2 (`AiResearchModule`), P3 (`StructuredExtractionModule`, `GuidedImportModule`), P4 (`WorkflowTemplatesModule`) | Append only, in phase order. |

---

## 6. Capability coverage — every inventoried item, one disposition each

The charter's triage rule: every capability from every scout report is either **built by a named task** or **recorded as cut with a concrete trigger**. Anything in neither is a planning defect. This table is the proof. Items marked **(program review)** were in neither column before this review and have been added to a plan.

### From `crm-scout.md` (durable research, evidence, identity, budgets, briefs)

| # | Capability | Disposition | Owner / trigger |
| --- | --- | --- | --- |
| 1 | Lease-based claim (time-based lease, attempts-on-claim) | BUILT | P2 T5 `claimDueTasks` |
| 2 | Two-lane dispatch (direct vs. LLM-session kinds) | CUT | P2 cut — when a second task kind exists |
| 3 | Attempts-capped + explicit exhaustion with human-readable outcome | BUILT | P2 T5 `failTask` |
| 4 | Real backoff on retry | BUILT | P2 T5 backoff formula |
| 5 | Explicit task cancellation | BUILT | P2 T5 `cancelTask`, T10 `cancelAgentTask` |
| 6 | Idempotent upsert-scheduling keyed on (kind, subject) | BUILT | P2 T5 `idempotencyKey`; P2 T3 tool derives one |
| 7 | Guarded completion (no stale overwrite) | BUILT | P2 T5 `completeTask` |
| 8 | Weight table → noisy-OR → confidence bands | CUT | P2 cut — when two-tier STRONG/WEAK proves too coarse |
| 9 | `Evidence` as a first-class entity separate from `Fact` | BUILT | P2 T1 |
| 10 | Band-driven apply-vs-propose split | BUILT (as propose-always) | P2 T8. Auto-apply is **permanently cut** — the Proposal contract forbids it regardless of confidence |
| 11 | Permanent dismissal memory | BUILT | P2 T2 dismissal check + T9 dismissal on reject |
| 12 | Human-authorship supremacy (never overwrite a hand-typed field) | CUT **(program review)** | P2 cut — SeaRM has no per-field authorship; baseline conflict + dismissal cover the dangerous cases. Build when reviewers report the agent proposing over hand-entered values |
| 13 | Supersession-not-deletion history | BUILT | P2 T2 |
| 14 | Two-factor deterministic identity verdict | BUILT | P3 T2 |
| 15 | Record briefs | CUT | P2 cut — when a record-page brief surface is scoped |
| 16 | Workspace self-profile brief | CUT | P2 cut — when outreach/prep tasks need reusable org context |
| 17 | "DB reads free, vendor calls cost budget" cost framing | BUILT (step budget) | P2 T7 `maxSteps: task.budget` **(program review)** |
| 18 | Durable per-workspace/per-record cost ledger | BUILT | P2 T4 `AgentRun.creditsUsedMicro`/`inputTokens`/`outputTokens`, T7 |
| 19 | `sensitiveWrite` — some actions agent-forbidden outright | BUILT | Launch 1 `AiWritePolicyService` `FORBID` mode |
| 20 | Priority set at schedule time via a static per-kind table | PARTIAL / CUT **(program review)** | `AgentTaskEntity.priority` BUILT (P2 T4); the per-kind *table* cut — one kind exists, so it would have one row |
| 21 | Relevance-scored CRM search | CUT | SeaRM already has record search — not a differentiator. Trigger: agents report SeaRM's search ranking is unusable for tool-driven lookup |
| 22 | Per-record `EnrichmentStatus` enum | CUT | Derive from `AgentTask`/`AgentRun` joins instead. Trigger: that join proves awkward in the UI |
| 23 | Vendor-specific enrichment pipelines (LinkedIn, Perplexity, logo/portrait) | CUT | More `research_*` tools behind the same pipeline, no new pattern. Trigger: a specific enrichment vendor is chosen |
| 24 | `AgentConversation` session-continuation bookkeeping | CUT | Coupled to a third-party session runtime. Trigger: SeaRM's agent framework proves to lack session continuation |
| 25 | Email/calendar ingestion models | BUILT (on SeaRM's existing entities) | P3 T3, T4 — SeaRM already has messaging/calendar; nothing new modelled |
| 26 | Suppression / do-not-contact lists | CUT | P3 cut — when outbound send workflows are built |
| 27 | `AppSetting` singleton (model selection, vendor keys) | CUT | SeaRM has workspace settings and connected-account credentials. Trigger: never — single-tenant demo plumbing |

### From `relaticle-scout.md` (custom-field-aware AI tools, guided import, proposal batches)

| Capability | Disposition | Owner / trigger |
| --- | --- | --- |
| Per-tenant schema-as-prose injected into tool parameter descriptions | BUILT | P3 T5 Steps 1–6 |
| Label-in / ID-out translation for choice fields | BUILT | Existing `generateRecordPropertiesZodSchema` enum-of-values + P3 T5's label annotations |
| Reuse the human validation rule-set at the AI-tool boundary | BUILT | P3 T8 (same zod schema every write path uses) |
| Discovery tool ("call list-fields before propose") | BUILT | **P4 T8** (absorbed from P3 T5 — see C6) |
| Fully resolved relation-target labels in tool descriptions | CUT | P3 cut — when agents' relation-field guesses prove unreliable |
| `kind`-bucketed diff-field descriptor for the approval UI | CUT | P3 cut — when reviewers report the raw-JSON diff is hard to read |
| AI-proposable custom-field/schema CRUD | CUT | P3 cut — when `AiWritePolicyService` overrides are used in practice for record fields |
| Full custom-field type taxonomy | N/A | Reference only — SeaRM has its own field-type system |
| Disposable per-import staging store | BUILT | P3 T6 (`ImportBatchEntity`/`ImportRowEntity`) |
| Header-name mapping inference | BUILT (reused) | Existing `searm-front` wizard, routed to the new backend in P3 T10 |
| Sample-value type voting with a confidence floor | CUT | P3 cut — when header-only mapping leaves many columns unmapped |
| Server-side mapping-inference service | CUT **(program review)** | Phantom deliverable in P3's File Structure, built by no task — removed (C10) |
| Own-row identity matching (`MatchableField`) | BUILT | P3 T7 (`CREATE`/`UPDATE`/`PROPOSE`/`SKIP`) |
| Cross-object entity-link resolution (`EntityLink`) | CUT | P3 cut — when person→company linking errors are observed |
| Storage-strategy abstraction for relation writes | CUT **(program review)** | P3 cut — inherited from `CreateRecordService`/`UpdateRecordService`, which already know each relation's storage shape |
| Group validation errors by distinct value; async per-column validation with progress | CUT | P3 cut — at 10k+ row files, or when users want to fix a systemic bad value once |
| Per-value correction / skip with re-validation | CUT | P3 cut — same trigger |
| Intra-import Create→Update dedup promotion | CUT **(program review)** | P3 cut — when a real import creates two records for one entity |
| Row-granular resumable, idempotent execution | BUILT | P3 T9 (PENDING-only query is the resume mechanism) |
| Failed-row capture + original-row-plus-error CSV | BUILT | P3 T10 (+ REST download endpoint) |
| Format-aware per-column date/number parsing | CUT **(program review)** | P3 cut — when an import mangles MM/DD or locale decimals |
| In-place "retry just this row" | CUT | P3 cut — when re-upload becomes painful |
| SQLite-file-per-import | N/A | Mechanism only; the "disposable staging" principle transfers and is built |
| Scheduled cleanup of stale import artifacts | CUT **(program review)** | P3 cut — when staging-table growth is observed |
| Per-item transaction + durable per-item status | BUILT | Launch 1 `ProposalExecutionService.applyClaimedProposal` — each item's status is persisted immediately after it applies |
| Idempotent re-resolution of an already-applied item | BUILT (by claim) | Launch 1's `PENDING → APPLYING` compare-and-swap claim makes a concurrent or repeated approve a no-op. **Residual:** a process crash mid-loop leaves the proposal in `APPLYING` with no resume path — cut, trigger: an approval is observed stuck in `APPLYING` in practice |
| Duplicate-proposal collapsing on exact retry | BUILT | P4 T6 |
| Near-duplicate "heads up" warning on proposal cards | CUT | P3 cut — when duplicate-adjacent proposals are observed |
| Pre-approval in-place proposal editing | CUT | Trigger: reviewers frequently reject-and-ask-again for a single wrong field instead of fixing one value |
| Conversation-level supersession + resolution history in agent context | CUT | Trigger: multi-turn chat with persistent threads exists and users report the agent re-proposing resolved items |
| Direct-write (ungated) MCP tool suite | N/A — anti-pattern | Explicitly rejected: SeaRM's MCP routes through the same gate as chat |
| `WhoAmI` / `ListTeamMembers` / `GuideToPage` tools | N/A | SeaRM's agent context already covers these |
| `AggregateCrm` / `GetCrmSummary` / `SearchCrm` tools | N/A | `find_many`/`group_by` cover them generically |
| AI credit/billing subsystem | N/A | SeaRM's `AiBillingService` is the system of record |
| Per-model `write_guard` (api vs. prompt) | N/A | SeaRM gates every write server-side regardless of provider — strictly safer |
| Chat rate limiting / stream cancellation / retry events | N/A | Infra hygiene, not a differentiator |
| Chat message feedback (thumbs up/down) | CUT | Trigger: chat is in production and product wants an AI-quality signal |
| Per-provider prompt caching | N/A | Provider-level cost optimisation, orthogonal |
| Onboarding seed fixtures | N/A | Fixture data shaped to another schema |
| `EntityLinkValidator` | N/A | Folded into the import validation disposition |
| Five hardcoded importer subclasses | N/A | SeaRM's importer is metadata-driven |

### From `crmkit-scout.md` (agent-safe API semantics, OAuth/MCP, ticket/campaign)

| § | Capability | Disposition | Owner / trigger |
| --- | --- | --- | --- |
| 1.1 | Agent-safe error envelope (`code`/`message`/`hint`/`retryable`/`allowed_actions`) | BUILT | P4 T1 (type + builder), T2 (gate FORBID), T3 (executor + registry funnel), T4 (MCP wire) |
| 1.2 | Confirmation-token semantics for destructive actions | BUILT | P4 T5 (AUTO-policy delete path; PROPOSE already stops at human review) |
| 1.3 | Email step-up escalation for high-risk non-CRUD actions | CUT **(program review)** | P4 cut — the approval gate is a stronger, in-product version. Trigger: a workspace opts a high-risk *send* into AUTO and wants out-of-band confirmation for it |
| 1.4 | Optimistic concurrency (`version` + conditional write) on the agent API | CUT **(program review)** | P4 cut — `ProposalItem.baseline` re-checked at approval already prevents stale-clobber without an agent-visible protocol. Trigger: AUTO-policy writes become common enough to clobber human edits |
| 1.5 | Deterministic idempotent-create via upsert-on-natural-key | BUILT (three mechanisms) | P3 T2 (identity resolution prevents the duplicate), P3 T1 (`sourceKey` batch idempotency), P4 T6 (item-level retry dedupe) |
| 1.6 | Short opaque handle/ref indirection for record ids | CUT | P4 cut — when token telemetry shows UUID verbosity is a material fraction of agent spend |
| 1.7 | Plain-text-first content negotiation as a transport | CUT | P4 cut — `compactToolOutput`/`stripEmptyValues` already capture the saving at payload level |
| 1.8 | Cursor keyset pagination + explicit total | BUILT | SeaRM already has stable `id`-tiebreaker ordering + `count`; P4 T7 adds the missing `hasMore` |
| 1.9 | Whitelisted free-text filter DSL | CUT | P4 cut — GraphQL's typed filters parameterize by construction |
| 1.10 | OAuth 2.1 AS for MCP clients (PKCE, dynamic registration) | ALREADY EXISTS + verified | SeaRM ships RFC 9728/8414/7591/7009, workspace-pinned, role-scoped; P4 T9 proves it end to end |
| 1.11 | Per-workspace/per-user plan quotas enforced pre-write | CUT | P4 cut — SeaRM's billing/entitlement system owns this. Trigger: a load test shows uncapped MCP volume from one OAuth client |
| 1.12 | Ticket entity and lifecycle | BUILT | P5 T3 (`supportTicket`, as a custom object — never core schema) |
| 1.13 | Campaign entity (brief + deduped membership + provenance) | CUT **(program review)** | P4 cut — it is objects + views + a workflow, i.e. vertical app #2. Trigger: Owner Decision 2, or immediately after Phase 5 proves the framework |
| 1.14 | Generic single-tool MCP `request` surface | N/A (split) | Rejected as a tool shape — SeaRM's per-tool MCP surface is strictly better for safety annotations. The allowlist-of-reachable-routes principle is already how the tool catalog works |
| 1.15 | MCP `initialize` server-declared `instructions` | CUT **(program review)** | P4 cut — `AGENT_API_CONTRACT.md` (P4 T12) is the equivalent. Trigger: a real external MCP client needs in-band guidance |
| 1.16 | Audit log with structured computed diffs | CUT **(program review)** | P4 cut — `baseline` vs. `payload` *is* a structured diff for every AI change, and SeaRM's timeline covers human changes. Trigger: a compliance requirement asks for field-level before/after on non-AI writes |
| 1.17 | `on_behalf_of` — delegated-principal axis | CUT **(program review)** | P4 cut — `ActorMetadata` already distinguishes agent/API/workflow/application/manual/system, which covers every principal this feature set produces. Trigger: a delegated-assistant mode where an agent acts *as* a named user |
| 1.18 | Timezone-aware read-time localization | N/A | Standard hygiene, already SeaRM's problem |
| 1.19 | Dual SQLite/Postgres dialect abstraction | N/A | Architecture mismatch |
| §3 | 12 explicitly-rejected items (OTP login, bearer-token-as-authority, quota subsystem, free-text assignee, internal-id/handle two-tier, etc.) | N/A | Each rejected in the scout with a reason; none re-opened here |

### From `searm-anchors.md` (charter trust-layer mapping and open items)

| Charter entity / item | Disposition | Owner |
| --- | --- | --- |
| `AgentTask` (net new) | BUILT | P2 T4, T5 |
| `AgentRun` (extend, don't duplicate) | BUILT | P2 T4 — sibling entity reusing `AiBillingService` and `AgentMessage` transcript machinery, per the anchors recommendation |
| `Evidence` (net new) | BUILT | P2 T1 |
| `Fact` (net new) | BUILT | P2 T1 |
| `Proposal` | ALREADY EXISTS | Launch 1 |
| `ProposalItem` + the missing evidence-links field | BUILT | Launch 1 + P2 T8 (`factIds`) |
| Open item: `ProposalStatus`/`ProposalItemStatus` enum values | RESOLVED | Read from disk during this review; all plans' diffs match the live enums |
| Open item: `ActorMetadata` definition | RESOLVED | Read from disk: `FieldActorSource` has `AGENT`, `API`, `WORKFLOW`, `APPLICATION`, `MANUAL`, `SYSTEM`, `WEBHOOK`, `EMAIL`, `CALENDAR`, `IMPORT`. No new principal type invented anywhere |
| Open item: "approval executes atomically" | RESOLVED | Read from disk: per-item durable status with a `PENDING→APPLYING` claim. Not one transaction — a deliberate, documented Launch 1 trade-off (see the relaticle table above) |
| Open item: do app manifests support workflow templates? | RESOLVED | No — confirmed by P5's exhaustive converter listing. Closed by P4 T10's `installWorkflowDefinition`, not by a new manifest unit |
| Open item: server-side spreadsheet import | RESOLVED | None exists — P3 T6–T10 build it |
| Open item: `searm-cli` vs. `searm-sdk` CLI | RESOLVED | P5 uses `searm-sdk`'s bundled CLI |

**Nothing in the four scout reports is now in neither column.** Twelve items were in neither before this review; each is marked **(program review)** above and has been written into the owning plan's cut table or task list.

**Repair pass (C14) — two charter-named capabilities were in neither column, and the claim above did not account for them because they come from the charter's trust-layer table, not the four scout reports:**

| Charter entity / item | Disposition | Owner / trigger |
| --- | --- | --- |
| `AgentRun`'s **workflow link** (charter: "Execution status, workflow link, model/provider, transcript, elapsed time, token and cost usage, error details") | BUILD, in Phase 2 Task 4 **(repair pass)** | Add `workflowRunId: string \| null` to `AgentRunEntity`. An `AI_AGENT` workflow step already knows the workflow run it executes inside (Phase 4 Task 10's `WorkflowActionType.AI_AGENT` step), so the executor can pass it through the same optional-parameter path §5's component-ownership row already uses for `threadId`/`maxSteps`. Out of scope for this document to edit Phase 2's plan file directly; recorded here so §8's contract audit is accurate until Phase 2 is repaired to match. |
| `Fact`'s **freshness** (charter: "Current or superseded sourced assertion: freshness, conflict state, field/value, evidence links") | CUT, with a trigger **(repair pass)** — Phase 2's success-criteria table currently claims this is "verified by Task 1 entity," which is false; `FactEntity` has only `createdAt`/`updatedAt`, no freshness concept | Derive freshness from the linked `Evidence.observedAt` (already on the entity per §5) rather than adding a field nothing populates independently — cheapest correct fix. Trigger to build a dedicated `Fact.freshness` field: a reviewer needs to sort/filter facts by freshness faster than `Evidence.observedAt` join allows. Out of scope for this document to edit Phase 2's plan file directly; recorded here so §8's contract audit is accurate until Phase 2 is repaired to match. |

---

## 7. Acceptance-narrative coverage

Each numbered step from the charter's five end-to-end narratives, mapped to the plan and task that makes it work. **Bold** marks a step no plan delivers.

### Lead to qualified opportunity

| Step | Delivered by |
| --- | --- |
| 1. Form/import/API/email/calendar/app creates or updates person and company | P3 T6–T10 (import), P3 T3 (email/calendar participants); form/API paths already exist in SeaRM |
| 2. Deterministic email/domain/relationship matching prevents duplicates | P3 T2 `IdentityResolutionService`, consumed by T3, T4, T7, T9 |
| 3. A workflow creates a budgeted research task | **Partial (repair pass, I26).** P2 T3 Step 8 builds the `create_agent_task` tool and P2 T7 enforces the budget as a step cap, but no Phase 4 Task 10 template prompt actually calls `create_agent_task` — the wiring is filed as a soft edge in §4 ("A one-line prompt edit, not a code change") and never written into any numbered task. The tool itself also does not compile as specified (C2 in the plan-file review) until Phase 2 Task 3 is repaired. Credited task-by-task, not end-to-end. |
| 4. The agent collects internal history and enrichment as evidence | P2 T3 `record_evidence` + P2 T7 worker |
| 5. Strong non-conflicting observations create facts; weak/conflicting become proposal items | P2 T2 (`FactDerivationService`) + P2 T8 (`factIds` on the item). Note: *all* facts route to proposals — auto-apply is permanently cut per the Proposal contract |
| 6. A user approves the proposal batch | Launch 1 `approveProposal`, now rendering citations (P2 T12) |
| 7. Approved changes update records, create tasks, assign an owner, advance an opportunity | Launch 1 `ProposalExecutionService` — the agent proposes each of these as ordinary record writes |
| 8. **Dashboards show source, quality, conversion, freshness, and AI cost** | **No plan.** P2 captures the data (`AgentRun` costs/tokens, `Fact` freshness/conflict) and cuts the dashboards with a trigger. Cheap only under Owner Decision 1(b) |

### Pipeline and follow-up

| Step | Delivered by |
| --- | --- |
| 1. Stage change / inactivity / close-date risk triggers a workflow | P4 T10 `FOLLOW_UP_DIGEST` (cron); P5 T9 `supportTicket.created` (database event) |
| 2. The workflow evaluates related records and recent activity | P4 T10's `AI_AGENT` step using existing `find_many`/`group_by` tools |
| 3. Creates tasks or an email/calendar proposal with evidence and a suggested next action | Launch 1's gate turns the agent's `send_email`/`create_calendar_event` calls into proposal items; P2 T8 attaches facts |
| 4. The user approves outbound communication | Launch 1 |
| 5. **Delays schedule follow-up; replies or stage changes supersede stale work** | **Partial.** `Fact` supersession is built (P2 T2) and proposals expire on TTL (Launch 1). But nothing supersedes a *pending proposal* when the underlying situation changes — that is relaticle's conversation-level supersession, cut with a trigger. A delay/wait workflow step exists in SeaRM and is untouched |
| 6. Audit history records user, workflow, agent, evidence, and approval | Launch 1 `createdByActor` + `reviewedByUserWorkspaceId`; P2 `factIds` → `Evidence`; SeaRM's own record audit for the applied write |

### Inbox and meeting intelligence

| Step | Delivered by |
| --- | --- |
| 1. Connected-account sync ingests mail, events, participants, recordings | SeaRM (existing), extended not rebuilt — P3 T3, T4 |
| 2. Identity matching attaches known participants; ambiguous matches become proposals | P3 T2 + T3 |
| 3. The agent extracts commitments, risks, job changes, and next actions as sourced proposals | **Partial by design.** P3 T4 builds *job changes* end to end with real `Evidence`; commitments/risks/next-actions are cut with the trigger "job-title extraction is validated in production and reviewers approve most of it — extend the same pipeline with a second schema" |
| 4. Approval updates records, tasks, opportunities, and record briefs | Launch 1 for records/tasks/opportunities. **Record briefs: no plan** — cut in P2 with a trigger |

### Data import and quality

| Step | Delivered by |
| --- | --- |
| 1. Import scans before writing and infers field and relationship mappings | P3 T6 (staging) + the existing frontend wizard's mapping, routed to the new backend (P3 T10) |
| 2. Users review validation errors, duplicates, mappings, and merge/skip/create rules | P3 T7 (match action) + T8 (validation + preview) |
| 3. A resumable idempotent job imports rows | P3 T9 |
| 4. Failed rows stay downloadable and retryable | P3 T10 |
| 5. Imports may create research tasks but never bypass approval for AI-derived changes | P3 T9's `PROPOSE` branch. Import-triggered research tasks are possible via P2's `create_agent_task` but no import task calls it — a deliberate omission, not a gap: the charter says *may* |

### Autonomous account monitoring

| Step | Delivered by |
| --- | --- |
| 1. Cron or event triggers create leased tasks for stale or high-value records | **Partial (repair pass, I26).** P4 T10 `ACCOUNT_MONITORING` (cron) is credited with its agent calling P2's `create_agent_task`, but — same gap as *Lead* step 3 — no template prompt actually names the tool, and the tool doesn't compile as specified until Phase 2 Task 3 is repaired (C2). P2 T7's dispatch cron leases and runs whatever tasks do get created. **The "for stale or high-value records" selection sweep is cut** in P2 — picking staleness thresholds is a product decision |
| 2. Agents compare new observations against prior evidence under time, cost, and provider limits | P2 T2 (supersession *is* new-vs-prior comparison) + P2 T7 (`maxSteps: task.budget`). Per-task *dollar* limits cut; workspace credit ceiling applies |
| 3. Material changes create proposals and notifications | Proposals: P2 T8. **Notifications: no plan** — cut in P2 (no notification primitive exists in SeaRM; same gap Launch 1 flagged) |
| 4. Failures retry with backoff and stay observable in run history | P2 T5 `failTask` + T4 `AgentRun` + T13 integration test |

### Steps no plan delivers — summary

1. **Dashboards over evidence/fact/cost** (*Lead* step 8) — data captured, surface not built. Materially cheaper under Owner Decision 1(b).
2. **Proposal supersession on situation change** (*Pipeline* step 5, partial) — TTL expiry only today.
3. **Record briefs** (*Inbox* step 4, partial) — the fact/evidence substrate is built; the narrative panel is not.
4. **In-app notification on a new proposal** (*Monitoring* step 3, partial) — no notification primitive exists in SeaRM.
5. **Stale/high-value record selection sweep** (*Monitoring* step 1, partial) — the lease/retry machinery exists; nothing decides *which* records to sweep.

All five are recorded in a cut table with a trigger. None is a silent drop. Items 1 and 4 are the two most likely to be asked for in a first customer demo.

---

## 8. Contract audit

| Contract | Verdict | Evidence |
| --- | --- | --- |
| **Record** — every action uses SeaRM objects, fields, relations, permissions | **Satisfied.** | Every write in every phase goes through `record-crud` services with the caller's `rolePermissionConfig`. `Evidence`/`Fact`/`AgentTask`/`AgentRun`/`ImportBatch`/`ImportRow` are platform tables, not business records. Phase 5 adds business records only as custom objects; its only touch on standard objects is relation pointers. |
| **Execution** — versioned, idempotent, cancellable, leased, retryable, budgeted | **Satisfied for status; one field still missing (repair pass, C14).** | Leased/retried/cancellable/idempotent: P2 T5. Budgeted: was a **hole** — `budget` was stored and never read; closed by P2 T7's `maxSteps: task.budget` (C9). Versioned: workflow versions are SeaRM's existing mechanism; `AgentTask` has no version concept and needs none — it carries its own immutable inputs. **`AgentRun`'s charter-named workflow link is not yet on the entity** — see §6 C14. Not a hole this review closes; recorded here so this row does not overstate the phase's current state. |
| **Evidence** — facts are never written without traceable observations | **Satisfied for provenance; `Fact.freshness` overstated (repair pass, C14).** | Was a **hole**: Phase 3 extracted a job-title fact from message text with no `Evidence` row, and shipped it as an accepted "migrate later" debt. Closed by C4 — Phase 3 now records `Evidence` before proposing, and Phase 2 is a hard dependency. Every `Fact` in the product is now created by `FactDerivationService` from an `Evidence` row; there is no other creation path. **Phase 2's success-criteria table separately claims `Fact.freshness` is delivered — it is not; see §6 C14 for the corrected disposition (derive from `Evidence.observedAt`).** |
| **Proposal** — visible diffs supporting approve, reject, expiry, supersession, atomic batch execution | **Satisfied, with one documented trade-off.** | Diffs/approve/reject/expiry: Launch 1 + P2 T12's citation row. Supersession: `Fact` supersession is built; *proposal* supersession is TTL-only (cut with a trigger — see narrative gap 2). "Atomic batch execution" is per-item-durable with a `PENDING→APPLYING` claim rather than one transaction — a deliberate Launch 1 trade-off (record-crud services accept no external transaction manager), documented, not accidental. |
| **Principal** — audit distinguishes authenticated user, represented user/team, workflow, agent, integration | **Satisfied for every principal the product produces.** | `FieldActorSource` (read from disk) covers `MANUAL`, `AGENT`, `WORKFLOW`, `API`, `APPLICATION`, `SYSTEM`, `WEBHOOK`, `EMAIL`, `CALENDAR`, `IMPORT`. `ProposalEntity.createdByActor` captures it, `reviewedByUserWorkspaceId` captures the approver, and the applied write is attributed to the approver through the ordinary record path. **"Represented user/team" has no producer** — no feature in Phases 1–5 has an agent acting as a named user. Cut in P4 with a delegation trigger (crmkit §1.17). |

---

## 9. Consolidated cut list

Everything this program deliberately does not build, with the trigger that would justify building it. This is the union of the four plans' cut tables plus the twelve items added by this review; the per-item detail lives in the owning plan's table.

**Cut by this review (previously planned, now removed):**

| Cut | Plan | Trigger to build |
| --- | --- | --- |
| `INBOX_PROCESSING` workflow template | P4 T10 | A polling fallback is needed for an ingestion path Phase 3 does not cover |
| `IMPORT_ASSISTANCE` workflow template | P4 T10 | Users ask to clean records that arrived through paths Phase 3 does not gate (API, Zapier, legacy imports) |
| `ENRICHMENT` workflow template | P4 T10 | Telemetry shows users installing `RESEARCH_BRIEF` and immediately re-triggering it on `person.created` |
| `describe_custom_fields_<object>` tool provider (2 files, 5 steps, N tools) | P3 T5 | `get_object_metadata`'s full-object payload proves too heavy for agents needing one object's custom fields |
| Hand-rolled workflow-creation client (~120 lines, 4 mutations) | P5 T9 | Never — replaced by one verified mutation |
| `pre-install.ts` no-op logic function | P5 T8 | The app needs to refuse installation on a real precondition |
| Server-side `import-mapping-inference.service.ts` (phantom) | P3 | Covered by the sample-value-voting cut row |
| Workflow→`createAgentTask` via HTTP-request action (unverified) | P2 T10 | Never — replaced by the `create_agent_task` tool |
| `idempotencyKey`/`workspaceId` migration on `proposalItem` (phantom) | P4 | Never — Task 6 needs no schema change |

**Cut and recorded with triggers (grouped; see the owning plan for the full row):**

- **Phase 2 (19 rows):** noisy-OR confidence bands; auto-applying a fact (permanent — contract-forbidden); AI-research workflow node; stale-record sweep; per-task dollar cap; two-lane dispatch; identity resolution (owned by P3); Evidence/Fact join table; DataLoader batching; chat-only evidence recording; proposal notifications; trust entities as standard objects (**Owner Decision 1**); workspace self-profile; record briefs; cost/quality dashboards; **evidence/fact workflow trigger** *(review)*; **evidence panel on the record page** *(review)*; **per-field human-authorship supremacy** *(review)*; **per-kind priority table** *(review)*; **`AgentRunEntity.transcript` + `summarizeAgentSteps` + its spec** *(over-engineering cut, this repair pass — SeaRM already persists a transcript through `AgentMessageEntity`, and no task in Phases 2–5 reads `AgentRun.transcript`; replace with `resultSummary` alone until a run-history UI is scoped)*; **`EvidenceLookupService` + `FactFieldsResolver` + `ProposalItemFieldsResolver` + two DTOs + two specs** *(over-engineering cut, this repair pass — the UI (P2 T12) only ever reads `fact.evidence[0]`; replace with a single `ProposalItemDTO.facts` resolve field returning a flat projection, one class, one resolver, no N+1 pair)*.
- **Phase 3 (19 rows):** sample-value voting; per-value correction UI; in-place row retry; cross-object entity links; extraction beyond job titles; AI-proposable schema CRUD; kind-bucketed diff descriptor; near-duplicate warning; content-equality proposal collapsing; resolved relation-target labels; calendar-description extraction; suppression lists; second BullMQ queue; **discovery tool** *(review)*; **storage-strategy abstraction** *(review)*; **intra-import dedup promotion** *(review)*; **format-aware date/number parsing** *(review)*; **staging-row retention job** *(review)*; and one row struck as **no longer cut** (Evidence/Fact provenance — now built).
- **Phase 4 (18 rows):** per-tool inline failure migration; Evidence-backed templates (until Phase 2 lands); record-id aliases; plain-text transport; filter DSL; confirmation tokens on PROPOSE deletes; per-tool OAuth scopes; MCP quota subsystem; request-approval workflow action (**Owner Decision 6**); three cut templates *(review)*; **`on_behalf_of`** *(review)*; **email step-up escalation** *(review)*; **optimistic concurrency `version`** *(review)*; **MCP `initialize` instructions** *(review)*; **structured audit diffs** *(review)*; **Campaign entity / campaigns vertical** *(review)*; and one row struck as **no longer cut** (field-metadata permission scoping — now built).
- **Phase 5 (11 rows):** declarative workflow manifest unit; `supportTicketComment`; `FIND_RECORDS`/`ITERATOR` bulk SLA sweep; row-level permission predicates; custom ticket console; multi-channel ticket ingestion; business-hours SLA calendars; CSAT; marketplace publishing; later vertical waves; **`pre-install` hook** *(review)*.
- **Scout-level defers with no owning plan** (recorded here, in §6): relevance-scored CRM search; `EnrichmentStatus` enum; vendor enrichment pipelines; session-continuation bookkeeping; `AppSetting` singleton; chat message feedback; pre-approval proposal editing; conversation-level proposal supersession; **crash-resume for a proposal stuck in `APPLYING`** *(review — Launch 1 follow-up)*.

---

## 10. What changed in each plan file

| Plan | Edits applied by this review |
| --- | --- |
| **Phase 2** | `EvidenceSourceType` gained `EMAIL_MESSAGE`/`CALL_RECORDING`/`IMPORT_FILE` with declared strengths; `Evidence.runId` and `Fact.runId` made nullable (entity, SQL, and `RecordEvidenceParams`); Task 3 gained Step 8 (`create_agent_task` tool) and a renumbered commit step; Task 7 gained budget enforcement via `maxSteps`; Task 8 gained the gate merge-order contract; Task 10's unverified HTTP-request claim struck; narrative mapping updated; 4 new cut rows; 1 cut row sharpened. |
| **Phase 3** | Header section rewritten — Phase 2 is now a hard dependency shipping first, with the exact consumed signatures; Task 1 adds the missing `reason` column plus the idempotency-layering note and the gate merge order; `createFromExtraction` now attaches `factIds`; Task 4 records real `Evidence` before proposing, with new test cases; Task 5 Steps 7–11 cut and replaced with the collapse rationale; 3 File Structure entries removed; 6 new cut rows, 1 struck; phase-dependency section rewritten. |
| **Phase 4** | Phantom migration line struck; Task 6's replacement block corrected to preserve `baselineFieldNames`, `toolId`, `toolCategory`, and `factIds`, with the merge-order note; Task 8 extended with Steps 2b/5b (provider availability + field-metadata scoping) and its rationale; Task 10 cut from six templates to three and gained `installDefinition` + `installWorkflowDefinition` (Step 5b); 9 dangling references repaired; 8 new cut rows, 1 struck. |
| **Phase 5** | Task 9's hand-rolled workflow client replaced by a one-mutation wrapper, with the step-shape change documented; the plan's highest risk closed rather than flagged; `pre-install` hook and its universal identifier cut; `Depends on` now names Phase 4 Task 10; headline finding rewritten; 2 new cut rows (1 collapsed as a duplicate, N8). **Second repair pass (this document's C11/C12/C13/I21–I24/N7 fixes, applied directly to the Phase 5 plan file):** `seedWorkflow`/`post-install.ts`/both workflow templates switched from `CoreApiClient` to `MetadataApiClient` (C11 — `installWorkflowDefinition` is metadata-schema-only); `app-default.role.ts` gained `permissionFlagUniversalIdentifiers: [SystemPermissionFlag.WORKFLOWS]` and Task 11 gained an install-time assertion that both workflows install as `ACTIVE` (C12); `WorkflowStepTemplate` gained real `id`/`valid`/`nextStepIds` fields, set with fixed UUIDs in both templates (C13); both workflow templates now resolve the triage agent's real row id via an unconditional metadata query instead of assuming it equals the manifest identifier (I21); Task 8 renumbered to start at Step 1 (I22); Task 8's `post-install.ts` write moved into Task 9 so no task-boundary commit is red (I23, and see the corresponding §4 fix, I28); the `canBeAssignedToAgents` question stayed open after a second code search, so Task 11 gained a fallback install-time assertion instead (I24); the `workspaceMember` risk was closed and its value written into Task 4 (N7). |
| **Launch 1** | Unchanged. It is mid-implementation and every other plan was made to consume its live signatures rather than the reverse. One follow-up is recorded in §9 (crash-resume for a proposal stuck in `APPLYING`). |
