# Capability Coverage Audit

**Date:** 2026-08-17 · **Method:** every row of `docs/superpowers/plans/2026-08-05-phases-2-5-program.md` §6
(plus one row from §5) checked against the code actually on disk at
`d:/Files/Vatsa/Projects/AI-CRM/twenty` by grepping for the named symbol, opening the file, and confirming the
symbol has a production caller. **The program table was not trusted.** Where a claim and the disk disagree, the
disk wins and the row is marked accordingly.

**Result: 101 rows audited — 47 SHIPPED, 52 CUT, 2 MISSING.**

`CUT` here means "deliberately not built", covering both the program's `CUT`-with-a-trigger rows and its `N/A`
rows (reference-only, or already solved by existing Twenty infrastructure); §6's own framing is that every
capability is either built by a named task or in the not-built column, so both collapse to one verified status.
Verification for a CUT row is the *absence* of the symbol, spot-checked — not merely the absence of a claim.

| Status | Count | Meaning |
| --- | --- | --- |
| **SHIPPED** | 47 | Claimed BUILT / ALREADY EXISTS / RESOLVED, and a file on disk proves it |
| **CUT** | 52 | Claimed CUT or N/A, and verified absent (or verified as pre-existing Twenty infrastructure) |
| **MISSING** | 2 | **Claimed built, not found on disk** |

---

## The MISSING rows

### M1 — Phase 3 Task 4: structured extraction from ingested email and call content

| | |
| --- | --- |
| **Source repo** | `crm-scout.md` row 25 ("Email/calendar ingestion models"), reinforced by program §2 conflict **C4** and §7 *Inbox and meeting intelligence* step 3 |
| **Claimed disposition** | **BUILT** — "P3 T3, T4 — Twenty already has messaging/calendar; nothing new modelled". C4 states Phase 3 Task 4 "now calls `EvidenceRecordingService.recordEvidence({ ..., runId: null, sourceType: 'EMAIL_MESSAGE' \| 'CALL_RECORDING' })` before proposing, and Task 1's `createFromExtraction` attaches real `factIds` via `FactLookupService`." §8's Evidence-contract row calls this hole "Closed by C4." |
| **Verified status** | **MISSING** |

**Evidence of absence.** The module shell exists and contains nothing but the privacy toggle:

```
packages/twenty-server/src/modules/structured-extraction/
  structured-extraction.module.ts
  services/ai-extraction-exclusion.service.ts
  services/__tests__/ai-extraction-exclusion.service.spec.ts
```

That is the complete contents. There is no extraction service, no message/calendar listener, no queue job, no
LLM call, no schema for the extracted claim.

Four independent greps confirm it:

1. **`recordEvidence` has exactly one production caller**, and it is the agent's own chat tool — not an
   ingestion path:
   `packages/twenty-server/src/engine/core-modules/tool/tools/record-evidence-tool/record-evidence-tool.ts:50`.
   Nothing under `modules/messaging/`, `modules/calendar/`, or `modules/structured-extraction/` calls it.
2. **The `EMAIL_MESSAGE` and `CALL_RECORDING` evidence source types have zero producers.** They are declared in
   `engine/metadata-modules/ai/ai-research/types/evidence.type.ts:8-9` with deliberate `WEAK` strengths and are
   referenced nowhere else in `src/`. Phase 2 was edited specifically to add them (per §10's Phase 2 row); the
   consumer that justified the edit was never written.
3. **`ProposalCreationService.createFromExtraction` has exactly one production caller**, the guided-import
   PROPOSE branch (`modules/guided-import/services/import-execution.service.ts:272`) — and that call passes
   **no `factIds` and records no `Evidence`**, so even the one live extraction-proposal path is un-sourced.
   Every other caller is its own spec file.
4. **`AiExtractionExclusionService` — the per-connected-account exclusion toggle built for this feature under
   Owner Decision 3 — has zero consumers.** It is provided and exported by
   `structured-extraction.module.ts:19-20`, that module is registered in `modules/modules.module.ts:6`, and no
   file injects the service. Its migration shipped
   (`database/commands/upgrade-version-command/2-28/2-28-instance-command-fast-1786100000000-add-connected-account-exclude-from-ai-extraction.ts`).
   **A privacy gate shipped in front of a feature that does not exist** — which is exactly the signature of a
   task reported done from its easiest sub-step.

**What *did* ship from Phase 3's ingestion work:** Task 3 (participant identity → proposals) is real and wired
into both ingestion pipelines —
`modules/match-participant/services/participant-identity-proposal.service.ts`, injected by
`modules/messaging/message-participant-manager/services/messaging-message-participant.service.ts:18` and
`modules/calendar/calendar-event-participant-manager/services/calendar-event-participant.service.ts:43`.
The row is marked MISSING because it claims **T3 and T4**; only T3 exists.

**Consequence for the contract audit.** §8's **Evidence contract** row reads "Satisfied for provenance … Every
`Fact` in the product is now created by `FactDerivationService` from an `Evidence` row; there is no other
creation path." That sentence is true but vacuous for ingestion: no ingestion path creates a Fact *at all*,
because no ingestion path extracts anything. The hole C4 identified was not closed by building the fix — it was
closed by not building the feature. §8 should read "not applicable: the extraction that would have violated the
contract was never written."

---

### M2 — `EvidenceSourceTypeGraphQL` (the GraphQL mirror enum)

| | |
| --- | --- |
| **Source** | Program **§5 component ownership**, repair-pass row **I27** (not a scout capability — a component §6's rows depend on) |
| **Claimed disposition** | **Owned by Phase 2 Task 11.** "the GraphQL mirror enum registered `@registerEnumType(…, { name: 'EvidenceSourceType' })`, consumed wherever `pendingProposals { items { facts { evidence { sourceType } } } }` is queried … **Must carry all seven `EvidenceSourceType` members, not a subset** — a mismatch here throws at query time rather than at compile time." |
| **Verified status** | **MISSING — and deliberately superseded, which the program document does not record.** |

**Evidence of absence.** No `registerEnumType` call anywhere under
`engine/metadata-modules/ai/` names `EvidenceSourceType`. The four that exist are `WorkspaceSetupChatOutcome`,
`AgentTaskStatus`, and `ProposalStatus`/`ProposalItemStatus`/`ProposalActionType`
(`ai-write-approval/dtos/proposal.dto.ts:10-12`).

**What shipped instead**, with an in-code rationale
(`ai-write-approval/dtos/proposal.dto.ts:14-15, 33-34`):

```ts
// A fact and its primary evidence, flattened. sourceType and strength are
// String, not GraphQL enums: EvidenceSourceType is a seven-member string
// union …
@Field(() => String, { nullable: true })
sourceType: string | null;
```

The queried shape also differs from the one §5 documents: the front end reads a **flat** `facts { … sourceType }`
projection (`twenty-front/src/modules/settings/ai-approvals/graphql/queries/pendingProposals.ts:20-25`,
rendered at `components/ProposalDiffTable.tsx:194-201`), not the nested `facts { evidence { sourceType } }` §5
describes — consistent with the Phase 2 over-engineering cut recorded in §9 ("replace with a single
`ProposalItemDTO.facts` resolve field returning a flat projection").

This is the *good* kind of miss: the implementation chose a simpler, mismatch-proof design and the risk I27
raised (enum member drift throwing at query time) is structurally eliminated. It is listed as MISSING because
**a named component with a named owner does not exist and no document records the substitution** — the next
person to read §5 will go looking for an enum that was consciously rejected.

---

## Verified-partial notes (not MISSING — the program already declares these)

Recorded so they are not mistaken for undetected gaps:

- **No workflow template prompt calls `create_agent_task`.** `grep -c create_agent_task` over
  `modules/workflow/workflow-templates/constants/workflow-templates.const.ts` returns **0**; the three templates
  (`RESEARCH_BRIEF`, `FOLLOW_UP_DIGEST`, `ACCOUNT_MONITORING`) are present and the tool exists
  (`engine/core-modules/tool/tools/create-agent-task-tool/`), but nothing wires them together. §7 already calls
  this out twice as "Partial (repair pass, I26)". Confirmed accurate.
- **`AgentRunEntity.workflowRunId` exists but is never written.** The column is on the entity
  (`ai-research/entities/agent-run.entity.ts:46`) exactly as §6's C14 row specifies, so the row's claim is
  satisfied; but every `workflowRunId` producer on disk belongs to the workflow runner/trigger services, and the
  agent-task run job never populates it. The charter's "workflow link" is therefore structurally available and
  functionally empty.
- **`Fact.freshness` is claimed CUT but actually shipped**, as `FactEntity.lastObservedAt`
  (`ai-research/entities/fact.entity.ts:79`), a real denormalized `timestamptz`. C14 resolved this as "CUT,
  derive from `Evidence.observedAt`". The implementation is better than the claim; the table understates it.
  Counted SHIPPED.

---

## Full audit table

Legend — **Verified**: `SHIPPED` (file proves it) · `CUT` (verified absent / pre-existing) · `MISSING`.

### From `crm-scout.md` — 15 SHIPPED, 11 CUT, 1 MISSING

| # | Capability | Claimed | Verified | Proof / trigger |
| --- | --- | --- | --- | --- |
| 1 | Lease-based claim (time lease, attempts-on-claim) | BUILT P2 T5 | **SHIPPED** | `ai-research/services/agent-task.service.ts:98` `claimDueTasks` — `FOR UPDATE SKIP LOCKED`, `attempts < maxAttempts`, `leasedUntil` CAS |
| 2 | Two-lane dispatch (direct vs LLM-session) | CUT | CUT | One task kind exists; no `kind` discriminator on `AgentTaskEntity`. Trigger: a second task kind |
| 3 | Attempts-capped + explicit exhaustion | BUILT P2 T5 | **SHIPPED** | `agent-task.service.ts:214` `failTask`; `:168` reaper writes `'Abandoned after ' \|\| attempts \|\| ' attempts…'` |
| 4 | Real backoff on retry | BUILT P2 T5 | **SHIPPED** | `agent-task.service.ts:240` `computeAgentTaskBackoffMs(task.attempts)`, `constants/agent-task.const.ts` |
| 5 | Explicit task cancellation | BUILT P2 T5/T10 | **SHIPPED** | `agent-task.service.ts:244` `cancelTask`; `resolvers/agent-task.resolver.ts:72` `cancelAgentTask` mutation; `cancelledAt`/`cancelReason` columns |
| 6 | Idempotent upsert-scheduling on (kind, subject) | BUILT P2 T5/T3 | **SHIPPED** | `entities/agent-task.entity.ts:79` `idempotencyKey`; `agent-task.service.ts:45-49` pre-create lookup |
| 7 | Guarded completion (no stale overwrite) | BUILT P2 T5 | **SHIPPED** | `agent-task.service.ts:189` `completeTask`, `.andWhere('status = :leased')` |
| 8 | Weight table → noisy-OR → confidence bands | CUT | CUT | Two-tier `EvidenceStrength = STRONG \| WEAK` only (`types/evidence.type.ts`). Trigger: two tiers prove too coarse |
| 9 | `Evidence` first-class, separate from `Fact` | BUILT P2 T1 | **SHIPPED** | `ai-research/entities/evidence.entity.ts` + `fact.entity.ts`, two tables |
| 10 | Band-driven apply-vs-propose split | BUILT as propose-always | **SHIPPED** | `ai-write-approval/services/proposal-gate.service.ts` — auto-apply only via explicit `AUTO` policy override |
| 11 | Permanent dismissal memory | BUILT P2 T2/T9 | **SHIPPED** | `ai-research/services/fact.service.ts:110` `markDismissed`, called at `proposal-execution.service.ts:284` and `:370` (both rejection points) |
| 12 | Human-authorship supremacy | CUT (review) | CUT | No per-field authorship in Twenty; baseline + dismissal cover it. Trigger: reviewers report proposals over hand-typed values |
| 13 | Supersession-not-deletion history | BUILT P2 T2 | **SHIPPED** | `fact.entity.ts:82,85` `supersededAt` / `supersededByFactId`; `types/fact-status.type.ts` |
| 14 | Two-factor deterministic identity verdict | BUILT P3 T2 | **SHIPPED** | `modules/match-participant/services/identity-resolution.service.ts` (+ spec) |
| 15 | Record briefs | CUT | CUT | No brief entity or record-page panel. Trigger: a record-page brief surface is scoped |
| 16 | Workspace self-profile brief | CUT | CUT | Absent. Trigger: outreach/prep tasks need reusable org context |
| 17 | "DB reads free, vendor calls cost budget" | BUILT as step budget | **SHIPPED** | `ai-research/jobs/agent-task-run.job.ts:115` `maxSteps: task.budget`; `:130-148` names the cap in the outcome |
| 18 | Durable per-workspace/per-record cost ledger | BUILT P2 T4/T7 | **SHIPPED** | `agent-run.entity.ts:61-70` `elapsedMs`/`inputTokens`/`outputTokens`/`creditsUsedMicro`; written at `agent-task-run.job.ts:137-140` |
| 19 | `sensitiveWrite` — agent-forbidden actions | BUILT Launch 1 | **SHIPPED** | `ai-write-approval/services/ai-write-policy.service.ts`, `FORBID` mode; gate test "should forbid a write when the policy resolves to FORBID" |
| 20 | Priority at schedule time (+ per-kind table) | PARTIAL / CUT | **SHIPPED** (field) | `agent-task.entity.ts:51` `priority: number`. The per-kind table stays CUT — one kind exists |
| 21 | Relevance-scored CRM search | CUT | CUT | Twenty's record search unchanged. Trigger: agents report ranking unusable |
| 22 | Per-record `EnrichmentStatus` enum | CUT | CUT | No such enum; derived from `AgentTask`/`AgentRun`. Trigger: the join proves awkward in UI |
| 23 | Vendor-specific enrichment pipelines | CUT | CUT | No `research_*` vendor tools. Trigger: a vendor is chosen |
| 24 | `AgentConversation` session bookkeeping | CUT | CUT | Absent. Trigger: Twenty's agent framework proves to lack session continuation |
| 25 | **Email/calendar ingestion models** | **BUILT P3 T3, T4** | **MISSING** | **See M1.** T3 shipped; T4 (extraction → Evidence → proposal) does not exist |
| 26 | Suppression / do-not-contact lists | CUT | CUT | Absent. Trigger: outbound send workflows are built |
| 27 | `AppSetting` singleton | CUT | CUT | Absent. Trigger: never — single-tenant demo plumbing |

### From `relaticle-scout.md` — 12 SHIPPED, 27 CUT

| Capability | Claimed | Verified | Proof / trigger |
| --- | --- | --- | --- |
| Per-tenant schema-as-prose in tool parameter descriptions | BUILT P3 T5 | **SHIPPED** | `engine/core-modules/record-crud/utils/describe-custom-field-for-tool-schema.util.ts` (+ spec) |
| Label-in / ID-out for choice fields | BUILT (existing + P3 T5) | **SHIPPED** | `record-crud/zod-schemas/record-properties.zod-schema.ts` |
| Reuse the human validation rule-set at the AI-tool boundary | BUILT P3 T8 | **SHIPPED** | `guided-import/services/import-validation.service.ts:8,67` imports and calls `generateRecordPropertiesZodSchema` — literally the same schema |
| Discovery tool ("list fields before propose") | BUILT P4 T8 | **SHIPPED** | `tool-provider/providers/metadata-tool.provider.ts:33-47` — `isAvailable` returns true on `DATA_MODEL` **or** any object read permission |
| Fully resolved relation-target labels | CUT | CUT | Trigger: relation-field guesses prove unreliable |
| `kind`-bucketed diff-field descriptor for the approval UI | CUT | CUT | `ProposalDiffTable.tsx` renders a flat table. Trigger: reviewers report the diff is hard to read |
| AI-proposable custom-field / schema CRUD | CUT | CUT | Gate treats metadata writes as gated (test: "should gate a metadata write tool"). Trigger: policy overrides used in practice |
| Full custom-field type taxonomy | N/A | CUT | Twenty has its own field-type system |
| Disposable per-import staging store | BUILT P3 T6 | **SHIPPED** | `guided-import/entities/import-batch.entity.ts`, `import-row.entity.ts` |
| Header-name mapping inference | BUILT (reused) P3 T10 | **SHIPPED** | `twenty-front/src/modules/object-record/spreadsheet-import/hooks/useCreateImportBatch.ts` + `graphql/mutations/{create,prepare,start}ImportBatch.ts` |
| Sample-value type voting with a confidence floor | CUT | CUT | Trigger: header-only mapping leaves many columns unmapped |
| Server-side mapping-inference service | CUT (review, phantom) | CUT | Confirmed absent — no `import-mapping-inference.service.ts` anywhere |
| Own-row identity matching (`MatchableField`) | BUILT P3 T7 | **SHIPPED** | `guided-import/services/import-match-resolution.service.ts`; CREATE/UPDATE/PROPOSE/SKIP consumed at `import-execution.service.ts:147,257` |
| Cross-object entity-link resolution | CUT | CUT | Trigger: person→company linking errors observed |
| Storage-strategy abstraction for relation writes | CUT (review) | CUT | Inherited from `CreateRecordService`/`UpdateRecordService` |
| Group validation errors by distinct value; async per-column validation | CUT | CUT | Trigger: 10k+ row files, or fixing a systemic bad value once |
| Per-value correction / skip with re-validation | CUT | CUT | Same trigger |
| Intra-import Create→Update dedup promotion | CUT (review) | CUT | Trigger: a real import creates two records for one entity |
| Row-granular resumable, idempotent execution | BUILT P3 T9 | **SHIPPED** | `guided-import/services/import-execution.service.ts` — PENDING-only query is the resume mechanism |
| Failed-row capture + original-row-plus-error CSV | BUILT P3 T10 | **SHIPPED** | `guided-import/controllers/import-failed-rows.controller.ts` (+ spec) |
| SQLite-file-per-import | N/A | CUT | Mechanism only; the staging principle shipped |
| Scheduled cleanup of stale import artifacts | CUT (review) | CUT | No retention cron under `guided-import/`. Trigger: staging growth observed |
| Per-item transaction + durable per-item status | BUILT Launch 1 | **SHIPPED** | `ai-write-approval/services/proposal-execution.service.ts` |
| Idempotent re-resolution of an applied item (by claim) | BUILT Launch 1 | **SHIPPED** | `proposal-execution.service.ts` PENDING→APPLYING CAS. Residual crash-resume gap still open (§9) |
| Duplicate-proposal collapsing on exact retry | BUILT P4 T6 | **SHIPPED** | `proposal-gate.service.ts:221,544-561` `findDuplicatePendingItem`; specs at `:588,:617` |
| Near-duplicate "heads up" warning | CUT | CUT | Trigger: duplicate-adjacent proposals observed |
| Pre-approval in-place proposal editing | CUT | CUT | Trigger: reviewers reject-and-ask-again over one wrong field |
| Conversation-level supersession + resolution history | CUT | CUT | Trigger: persistent threads exist and the agent re-proposes resolved items |
| Direct-write (ungated) MCP tool suite | N/A — anti-pattern | CUT | `tool-executor.service.ts` routes MCP through the same gate |
| `WhoAmI` / `ListTeamMembers` / `GuideToPage` tools | N/A | CUT | Agent context already covers these |
| `AggregateCrm` / `GetCrmSummary` / `SearchCrm` tools | N/A | CUT | `find_many`/`group_by` cover them |
| AI credit/billing subsystem | N/A | CUT | `AiBillingService` is the system of record |
| Per-model `write_guard` (api vs prompt) | N/A | CUT | Twenty gates every write server-side |
| Chat rate limiting / stream cancellation / retry events | N/A | CUT | Infra hygiene |
| Chat message feedback (thumbs up/down) | CUT | CUT | Trigger: chat in production, product wants a quality signal |
| Per-provider prompt caching | N/A | CUT | Provider-level optimisation |
| Onboarding seed fixtures | N/A | CUT | Fixture data for another schema |
| `EntityLinkValidator` | N/A | CUT | Folded into import validation |
| Five hardcoded importer subclasses | N/A | CUT | Twenty's importer is metadata-driven |

### From `crmkit-scout.md` — 6 SHIPPED, 14 CUT

| § | Capability | Claimed | Verified | Proof / trigger |
| --- | --- | --- | --- | --- |
| 1.1 | Agent-safe error envelope | BUILT P4 T1–T4 | **SHIPPED** | `core-modules/tool/types/tool-failure.type.ts`; `tool/utils/build-tool-failure.util.ts` (+ spec); gate FORBID at `proposal-gate.service.ts`; funnel at `tool-provider/services/tool-executor.service.ts` and `tool-provider/utils/tool-error.util.ts`; MCP wire at `engine/api/mcp/services/mcp-tool-executor.service.ts`; end-to-end in `test/integration/graphql/suites/agent-api/agent-api-semantics.integration-spec.ts` |
| 1.2 | Confirmation-token semantics for destructive actions | BUILT P4 T5 | **SHIPPED** | `ai-write-approval/utils/build-delete-confirmation-token.util.ts` (+ spec); `proposal-gate.service.ts:171,188-190` emits `CONFIRMATION_REQUIRED` on the AUTO-policy delete path only |
| 1.3 | Email step-up escalation | CUT (review) | CUT | Verified absent: no `escalation_required`, no `stepUp` anywhere in `twenty-server/src`. Trigger: a workspace opts a high-risk *send* into AUTO |
| 1.4 | Optimistic concurrency (`version` + conditional write) | CUT (review) | CUT | `ProposalItem.baseline` re-check covers it; no agent-visible version protocol. Trigger: AUTO-policy writes become common enough to clobber human edits |
| 1.5 | Deterministic idempotent-create via upsert-on-natural-key | BUILT (3 mechanisms) | **SHIPPED** | `identity-resolution.service.ts` (P3 T2); `ProposalEntity.sourceKey` used at `import-execution.service.ts:273`; `findDuplicatePendingItem` (P4 T6) |
| 1.6 | Short opaque handle/ref indirection | CUT | CUT | Verified absent: no `recordAlias`/`shortHandle`. Trigger: token telemetry shows UUID verbosity is material |
| 1.7 | Plain-text-first content negotiation as transport | CUT | CUT | `compactToolOutput`/`stripEmptyValues` capture the saving at payload level |
| 1.8 | Cursor keyset pagination + explicit total | BUILT P4 T7 | **SHIPPED** | `record-crud/types/find-records-result.type.ts:4` `hasMore`; computed at `record-crud/services/find-records.service.ts:107,115` |
| 1.9 | Whitelisted free-text filter DSL | CUT | CUT | GraphQL typed filters parameterize by construction |
| 1.10 | OAuth 2.1 AS for MCP clients (PKCE, DCR) | ALREADY EXISTS + verified P4 T9 | **SHIPPED** | `engine/api/mcp/guards/mcp-auth.guard.ts` (RFC 9728 challenge); proven by `test/integration/graphql/suites/agent-api/mcp-oauth-scoping.integration-spec.ts` and `test/integration/ai/suites/mcp.controller.integration-spec.ts` |
| 1.11 | Per-workspace/per-user plan quotas pre-write | CUT | CUT | Twenty's billing/entitlements owns it. Trigger: a load test shows uncapped MCP volume from one OAuth client |
| 1.12 | Ticket entity and lifecycle | BUILT P5 T3 | **SHIPPED** | `twenty-apps/public/customer-support/src/objects/support-ticket.object.ts` + `support-queue.object.ts`, six relation fields, `indexes/support-ticket-status.index.ts` — a custom object, never core schema |
| 1.13 | Campaign entity (brief + deduped membership) | CUT (review) | CUT | Verified absent: no `campaigns` app under `twenty-apps/public/`. Trigger: Owner Decision 2, or immediately after Phase 5 proves the framework |
| 1.14 | Generic single-tool MCP `request` surface | N/A (split) | CUT | Rejected as a tool shape; per-tool MCP surface with annotations is what shipped |
| 1.15 | MCP `initialize` server-declared `instructions` | CUT (review) | CUT | `packages/twenty-server/docs/AGENT_API_CONTRACT.md` (P4 T12) is the equivalent. Trigger: a real external MCP client needs in-band guidance |
| 1.16 | Audit log with structured computed diffs | CUT (review) | CUT | `baseline` vs `payload` is the AI-change diff. Trigger: compliance asks for field-level before/after on non-AI writes |
| 1.17 | `on_behalf_of` delegated-principal axis | CUT (review) | CUT | Verified absent: no `onBehalfOf`/`representedPrincipal` in `twenty-server/src`. Trigger: a delegated-assistant mode |
| 1.18 | Timezone-aware read-time localization | N/A | CUT | Standard hygiene, already Twenty's problem |
| 1.19 | Dual SQLite/Postgres dialect abstraction | N/A | CUT | Architecture mismatch — permanent no |
| §3 | 12 explicitly-rejected items (OTP login, bearer-as-authority, quota subsystem, free-text assignee, internal-id/handle two-tier, …) | N/A | CUT | Each rejected in the scout with a reason; none re-opened, none found on disk |

### From `twenty-anchors.md` — 12 SHIPPED

| Charter entity / open item | Claimed | Verified | Proof |
| --- | --- | --- | --- |
| `AgentTask` (net new) | BUILT P2 T4/T5 | **SHIPPED** | `ai-research/entities/agent-task.entity.ts` — `core.agentTask`, lease/attempts/idempotencyKey/priority/budget/cancel |
| `AgentRun` (extend, don't duplicate) | BUILT P2 T4 | **SHIPPED** | `ai-research/entities/agent-run.entity.ts` — sibling entity, cost fields, `taskId` nullable |
| `Evidence` (net new) | BUILT P2 T1 | **SHIPPED** | `ai-research/entities/evidence.entity.ts` (`observedAt:60`, payload hash util at `utils/hash-evidence-payload.util.ts`) |
| `Fact` (net new) | BUILT P2 T1 | **SHIPPED** | `ai-research/entities/fact.entity.ts` — status, `hasConflict`, `evidenceIds`, `lastObservedAt`, supersession |
| `Proposal` | ALREADY EXISTS | **SHIPPED** | `ai-write-approval/entities/proposal.entity.ts` |
| `ProposalItem` + evidence-links field | BUILT Launch 1 + P2 T8 | **SHIPPED** | `proposal-item.entity.ts:73` `factIds`; migration `2-28/…-add-proposal-item-fact-ids.ts` |
| Open item: `ProposalStatus`/`ProposalItemStatus` values | RESOLVED | **SHIPPED** | `ai-write-approval/types/proposal-status.type.ts`, registered at `dtos/proposal.dto.ts:10-12` |
| Open item: `ActorMetadata` definition | RESOLVED | **SHIPPED** | Reused, not reinvented — `createdByActor: ActorMetadata` on `agent-task.entity.ts:98` and `proposal.entity.ts` |
| Open item: "approval executes atomically" | RESOLVED (trade-off) | **SHIPPED** | `proposal-execution.service.ts` — per-item durable status + PENDING→APPLYING claim, documented as not-one-transaction |
| Open item: app-manifest workflow templates | RESOLVED (no; closed by P4 T10) | **SHIPPED** | `modules/workflow/workflow-templates/resolvers/workflow-definition-install.resolver.ts` + `services/workflow-template.service.ts`; consumed by `twenty-apps/public/customer-support/src/utils/seed-workflow.util.ts` |
| Open item: server-side spreadsheet import | RESOLVED (none existed; P3 T6–T10 build it) | **SHIPPED** | `modules/guided-import/` — entities, resolver, validation, match resolution, execution job, failed-rows controller |
| Open item: `twenty-cli` vs `twenty-sdk` CLI | RESOLVED (`twenty-sdk`) | **SHIPPED** | `twenty-apps/public/customer-support/package.json:25` depends on `twenty-sdk@2.27.0`; build output under `.twenty/output/` |

### Repair-pass rows (§6 C14) — 2 SHIPPED

| Charter item | Claimed | Verified | Proof |
| --- | --- | --- | --- |
| `AgentRun`'s workflow link | BUILD in P2 T4 (repair pass) | **SHIPPED** (never populated) | `agent-run.entity.ts:46` `workflowRunId: string \| null`. No writer — see verified-partial notes |
| `Fact`'s freshness | CUT, derive from `Evidence.observedAt` | **SHIPPED** (claim understates) | `fact.entity.ts:79` `lastObservedAt: Date`, a real column — better than the resolution recorded |

### Program §5 component ownership (supplementary) — 1 MISSING

| Component | Claimed owner | Verified | Proof |
| --- | --- | --- | --- |
| `EvidenceSourceTypeGraphQL` | Phase 2 T11 | **MISSING** | See M2 — no such enum; `sourceType` ships as `String` with an in-code rationale |

---

## What the audit says about the program document

The table is **98% accurate**, which is a better result than the brief's framing anticipated. Two corrections
are needed and one framing change:

1. **§6 crm row 25 must be split.** "P3 T3, T4" is one row covering two tasks of which only one exists. Change
   the disposition to `PARTIAL — T3 BUILT, T4 NOT BUILT` and give T4 either an owner or a cut trigger. Today it
   is claimed as built and is neither.
2. **§8's Evidence-contract row overstates.** "Closed by C4 — Phase 3 now records `Evidence` before proposing"
   describes code that does not exist. The contract is satisfied only because the violating feature was never
   written; the guided-import PROPOSE path still creates proposals with no `Evidence` and no `factIds`.
3. **§5's `EvidenceSourceTypeGraphQL` row should be struck and replaced** with the flat-`String` projection that
   actually shipped, so the "must carry all seven members" warning does not send someone hunting for a rejected
   design.

The two other divergences found (`AgentRun.workflowRunId` present-but-unwritten, `Fact.freshness` shipped while
claimed cut) are recorded above rather than left to be rediscovered.
