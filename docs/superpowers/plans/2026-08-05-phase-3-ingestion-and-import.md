# Phase 3 — Ingestion and Data Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** connected-account ingestion (email, calendar, call recordings) and guided CSV/spreadsheet import stop writing directly to Person/Company/custom-object records. Deterministic identity matching decides what is safe to write automatically; everything inferred, ambiguous, or AI-derived becomes a `Proposal`/`ProposalItem` batch through the Launch-1 gate. Custom-field-aware tool schemas let agents resolve tenant-defined field labels, option values, and relation targets instead of guessing.

**Architecture:** extends, never parallels, what already ships on `ai-write-approval`: `ProposalEntity`/`ProposalItemEntity` (core-schema TypeORM), `ProposalGateService`, `ProposalExecutionService`, `AiWritePolicyService`. This phase adds one new capability to the gate — `ProposalGateService.createFromExtraction()`, an idempotent, non-tool-dispatch entry point for background jobs (ingestion, import) that have no `ToolProviderContext` to call `evaluate()` with. Everything else reuses existing machinery: `CreateRecordService`/`UpdateRecordService`/`FindRecordsService` for both direct writes and proposal application, `GlobalWorkspaceOrmManager` + `buildSystemAuthContext` for background-job workspace access, the existing `MatchParticipantService`/`contact-creation-manager` deterministic sync path (extended, not replaced), and the existing `searm-front` spreadsheet-import wizard (extended with a server-side staging/execution backend it currently lacks).

**Tech Stack:** NestJS 10, TypeORM, PostgreSQL 16, BullMQ (`message-queue` module), GraphQL (code-first, metadata schema), Vercel AI SDK (`ai` package, already used by `ai-generate-text`), React 18 + Jotai/Recoil + Linaria, Nx, Jest.

**Spec:** `docs/superpowers/PRODUCT-CHARTER.md` (Phase 3 row, "Data import and quality" and "Inbox and meeting intelligence" acceptance narratives), `docs/superpowers/scouting/searm-anchors.md`, `docs/superpowers/scouting/relaticle-scout.md`, `docs/superpowers/scouting/crm-scout.md`.

**Working directory for all paths below:** `d:\Files\Vatsa\Projects\AI-CRM\searm`

## Which acceptance narratives this phase advances

- **"Data import and quality"** — all 5 steps. Step 1 (scan-before-write, infer mappings) → Tasks 6–7. Step 2 (review validation errors, duplicates, mappings, merge/skip/create) → Tasks 7–8. Step 3 (resumable idempotent row import) → Task 9. Step 4 (failed rows downloadable and retryable) → Task 10. Step 5 (imports never bypass approval for AI-derived changes) → Task 9's CANDIDATE-match branch.
- **"Inbox and meeting intelligence"** — all 4 steps. Step 1 (connected-account sync ingests mail, events, participants, recordings — already exists, extended not rebuilt) → Tasks 3–4. Step 2 (identity matching attaches known participants; ambiguous matches become proposals) → Tasks 2–3. Step 3 (agent extracts commitments/risks/job changes as sourced proposals) → Task 4 (job-title change only in this phase — see deliberately-cut table for the rest). Step 4 (approval updates records) → reuses Launch 1's `ProposalExecutionService` unmodified.
- **"Lead to qualified opportunity"** — step 2 only (deterministic email/domain/relationship matching prevents duplicates) → Task 2, consumed by Tasks 3, 4, 7, 9.
- Metadata-aware AI/MCP tool contract ("resolve custom-field labels, option values, relation fields, data types") → Task 5.

## What this phase depends on that does not yet exist

**Superseded by the program review — Phase 2 is now a hard dependency and ships first.** The original text of this section said Phase 2 was absent and that extraction proposals would carry provenance inline (a `reason` string quoting the source excerpt) with a migration to real `Evidence` links "later". The program sequencing decision is the opposite: **Phase 2 ships before Phase 3**, and Phase 3 writes real `Evidence` rows. Reasons:

1. The charter's **Evidence contract** — "facts are never written without traceable observations" — is violated by an LLM-extracted job-title change that produces no `Evidence` row. Shipping the inline version would ship a known contract violation and then pay to migrate it.
2. The inline version is *more* work, not less: it needs a bespoke `reason`-string provenance format that nothing else reads, and then a data migration.
3. Phase 2 already owns the vocabulary. `EvidenceSourceType` now carries `EMAIL_MESSAGE`, `CALL_RECORDING`, and `IMPORT_FILE` (added to `ai-research/types/evidence.type.ts` by the program review), and `EvidenceEntity.runId` / `FactEntity.runId` are nullable so a background worker with no `AgentRun` can record evidence.

What Phase 3 consumes from Phase 2, by exact signature:

- `EvidenceRecordingService.recordEvidence(params: RecordEvidenceParams): Promise<EvidenceEntity>` where `RecordEvidenceParams = { workspaceId: string; runId: string | null; objectNameSingular: string; recordId: string; sourceType: EvidenceSourceType; sourceLocator: string; extractor: string; observedAt?: Date; payload: { fieldName: string; value: unknown; snippet?: string } }`. It calls `FactDerivationService.deriveFact()` internally — Phase 3 never calls that directly.
- `FactLookupService.findCurrentFactIdsForFields(params: { workspaceId, objectNameSingular, recordId, fieldNames }): Promise<string[]>` — used by Task 1's `createFromExtraction` to attach `factIds` to background-job proposal items, exactly as `evaluate()` does for tool-dispatch items (Phase 2 Task 8).

`ProposalEntity.reason` is still added (Task 1) and still shown on the card, but as a human-readable summary — **not** as the provenance record. Provenance is `ProposalItemEntity.factIds` → `Fact.evidenceIds` → `Evidence.sourceLocator`, the same chain a research run produces.

## Global Constraints

Copied from the repo's `CLAUDE.md`, the Launch 1 plan, and this phase's brief. Every task's requirements implicitly include this section.

- **Named exports only.** No default exports anywhere.
- **No `any`.** Strict TypeScript enforced.
- **Types over interfaces**, except when extending a third-party interface.
- **String literal unions over enums**, except GraphQL enums (real TS enums registered with `registerEnumType`).
- **Functional components only** in `searm-front`.
- **File naming:** kebab-case with suffix — `.service.ts`, `.entity.ts`, `.dto.ts`, `.module.ts`, `.resolver.ts`, `.job.ts`, `.listener.ts`. Front components are PascalCase `.tsx`.
- **Comments:** short-form `//` only, no JSDoc blocks. Explain WHY, not WHAT.
- **Import order:** external libraries, then internal `@/` or `src/`, then relative.
- **Use `isDefined()` from `searm-shared/utils`** rather than hand-rolled null checks.
- **Services under 500 lines, components under 300 lines.**
- **Entity registration is automatic** — `core.datasource.ts` globs `engine/metadata-modules/**/*.entity.{ts,js}`. Do not add entities to any registry list.
- **Schema changes ship as instance commands**, not TypeORM migrations. Generate with `npx nx run searm-server:database:migrate:generate --name <name> --type fast`. Real precedent on disk: `packages/searm-server/src/database/commands/upgrade-version-command/2-28/2-28-instance-command-fast-1785950948000-add-ai-write-approval.ts` — a `@RegisteredInstanceCommand('2.28.0', <timestamp>)`-decorated class implementing `FastInstanceCommand` with raw-SQL `up`/`down`. Follow that exact shape.
- **Never gate reads.** `find_many`, `find_one`, `group_by` must pass through untouched.
- **Ingestion-derived and import-derived record CHANGES to existing records go through `ProposalGateService`** — either `.evaluate()` (agent tool calls) or the new `.createFromExtraction()` (background jobs) added in Task 1. New-record creation from an unambiguous deterministic match is not "AI-derived" and keeps using the existing direct-write path (see Task 2/3's EXACT-vs-CANDIDATE split) — this mirrors what SeaRM's `contact-creation-manager` already does today and the charter's phase-3 scope line ("Identity resolution ... so ingestion does not create duplicate people ... Ambiguous matches become proposals").
- **Custom objects are the only extension mechanism for business-specific records.** Nothing in this phase adds an industry-specific object; `ImportBatchEntity`/`ImportRowEntity` (Task 6) are platform infrastructure (core-schema TypeORM entities), not workspace objects, following the exact precedent of `ProposalEntity`/`ProposalItemEntity`.
- Lint and typecheck after each task: `npx nx lint:diff-with-main searm-server` (and `searm-front` for frontend tasks) and `npx nx typecheck searm-server` / `searm-front`.

## File Structure

**New — server**, identity resolution (`packages/searm-server/src/modules/match-participant/`):

| File | Responsibility |
| --- | --- |
| `services/identity-resolution.service.ts` | `IdentityResolutionService` — deterministic EXACT/CANDIDATE/NONE person and company matching |
| `services/__tests__/identity-resolution.service.spec.ts` | Unit tests |
| `services/participant-identity-proposal.service.ts` | Turns a CANDIDATE participant match into a `ProposalItem` |
| `services/__tests__/participant-identity-proposal.service.spec.ts` | Unit tests |
| `utils/normalize-person-display-name.util.ts` | Name normalization for candidate comparison |

**New — server**, structured extraction (`packages/searm-server/src/modules/structured-extraction/`, new module):

| File | Responsibility |
| --- | --- |
| `structured-extraction.module.ts` | Nest module wiring |
| `types/extracted-job-title-fact.type.ts` | LLM output shape |
| `services/structured-person-fact-extraction.service.ts` | Calls the LLM, resolves identity, builds proposal items |
| `services/__tests__/structured-person-fact-extraction.service.spec.ts` | Unit tests |
| `jobs/message-structured-extraction.job.ts` | Loads a message + participants, calls the service |
| `jobs/call-recording-structured-extraction.job.ts` | Loads a call recording + its calendar event's participants |
| `listeners/message-structured-extraction.listener.ts` | `message.created` → enqueue |
| `listeners/call-recording-structured-extraction.listener.ts` | `callRecording.updated` (COMPLETED transition) → enqueue |

**New — server**, custom-field-aware tool schema (`packages/searm-server/src/engine/core-modules/record-crud/`):

| File | Responsibility |
| --- | --- |
| `utils/describe-custom-field-for-tool-schema.util.ts` | Builds the description string injected into a custom field's zod schema |
| `utils/__tests__/describe-custom-field-for-tool-schema.util.spec.ts` | Unit tests |

**New — server**, guided import (`packages/searm-server/src/modules/guided-import/`, new module):

| File | Responsibility |
| --- | --- |
| `guided-import.module.ts` | Nest module wiring |
| `entities/import-batch.entity.ts` | `ImportBatchEntity` — one row per uploaded file |
| `entities/import-row.entity.ts` | `ImportRowEntity` — one row per staged CSV row |
| `types/import-batch-status.type.ts` | Status enums |
| `types/import-row-match-action.type.ts` | `CREATE` \| `UPDATE` \| `SKIP` \| `PROPOSE` |
| `services/import-match-resolution.service.ts` | Per-row identity resolution → match action |
| `services/import-validation.service.ts` | Per-field validation reusing `generateRecordPropertiesZodSchema` |
| `services/import-execution.service.ts` | Resumable, idempotent, per-row apply |
| `jobs/import-execution.job.ts` | Queue worker invoking the execution service |
| `dtos/import-batch.dto.ts` | GraphQL object types |
| `dtos/create-import-batch.input.ts` | Mutation input |
| `resolvers/import-batch.resolver.ts` | `createImportBatch`, `importBatch`, `prepareImportBatch` (Task 8), `importBatchPreview` (Task 8), `startImportBatch` (Task 9), `retryFailedImportRows` (Task 10) |
| `controllers/import-failed-rows.controller.ts` | `GET /rest/import/:importBatchId/failed-rows.csv` |

**Modified — server:**

| File | Change |
| --- | --- |
| `engine/metadata-modules/ai/ai-write-approval/entities/proposal.entity.ts` | Add `sourceKey: string \| null` column |
| `engine/metadata-modules/ai/ai-write-approval/services/proposal-gate.service.ts` | Add `createFromExtraction()` |
| `engine/metadata-modules/ai/ai-write-approval/services/__tests__/proposal-gate.service.spec.ts` | New test cases for `createFromExtraction()` |
| `engine/core-modules/record-crud/zod-schemas/record-properties.zod-schema.ts` | Route custom-field descriptions through the new describer |
| `modules/messaging/message-participant-manager/services/messaging-message-participant.service.ts` | After exact matching, hand unmatched participants to `ParticipantIdentityProposalService` |
| `modules/calendar/calendar-event-participant-manager/services/calendar-event-participant.service.ts` | Same, for calendar participants |
| `modules/match-participant/match-participant.module.ts` | Export the two new services |
| `engine/core-modules/message-queue/message-queue.constants.ts` | Add `importQueue = 'import-queue'` |
| `engine/metadata-modules/metadata-engine.module.ts` (or wherever `AiWriteApprovalModule` is imported — confirm at implementation time) | Register `StructuredExtractionModule`, `GuidedImportModule` |

**New — front** (`packages/searm-front/src/modules/object-record/spreadsheet-import/`):

| File | Responsibility |
| --- | --- |
| `hooks/useCreateImportBatch.ts` | Calls `createImportBatch`, polls status |
| `components/SpreadsheetImportFailedRowsBanner.tsx` | Shows failed-row count + CSV download link + retry button |
| `graphql/mutations/createImportBatch.ts`, `startImportBatch.ts`, `retryFailedImportRows.ts` | Mutation documents |
| `graphql/queries/importBatch.ts` | Query document |

**Modified — front:** `hooks/useOpenObjectRecordsSpreadsheetImportDialog.ts` — route `onSubmit` through the new backend batch instead of `useBatchCreateManyRecords` directly.

---

### Task 1: Non-agent proposal creation path

Every write gated so far originates from `ToolExecutorService.dispatch()`, which has a `ToolProviderContext` (`threadId`, `actorContext`) to key a batch on. Background jobs (ingestion, import) have neither. This task adds a second, idempotent entry point into the same `Proposal`/`ProposalItem` tables.

> **Program integration — two corrections.**
> 1. **`ProposalEntity` has no `reason` column today** (verified by reading `entities/proposal.entity.ts` on disk: `id`, `workspaceId`, `workspace`, `status`, `createdByActor`, `threadId`, `expiresAt`, `reviewedByUserWorkspaceId`, `reviewedAt`, `items`, `createdAt`, `updatedAt` — no `reason`). The `createFromExtraction` body below writes `reason`, which will not typecheck. This task therefore adds **two** columns, `sourceKey` and `reason`, in one migration. Steps 3 and 4 below reflect this.
> 2. **Idempotency layering.** `sourceKey` is *batch-level* idempotency for a background job that gets retried (this task). Phase 4 Task 6 adds *item-level* dedupe inside `evaluate()` for a retried agent tool call. They are different granularities on different entry points and neither replaces the other; do not merge them into one mechanism.
>
> **`proposal-gate.service.ts` merge order across phases:** Phase 2 Task 8 → **this task** → Phase 4 Tasks 2, 5, 6. This task only *adds a method*; it never edits `evaluate()`, so it merges cleanly in any order.
>
> **Review fix (I10) — `createFromExtraction` must consult `AiWritePolicyService`, the same as `evaluate()` does.** As originally written, this method created a proposal for every item unconditionally, so a workspace that set `person.jobTitle` (or `messageParticipant`/any object) to `FORBID` still got ingestion/import proposals for it — the write is gated by a human downstream, but the workspace's own "never touch this" instruction was silently ignored. `ProposalGateService` already injects `AiWritePolicyService` (used by `evaluate()` at `services/proposal-gate.service.ts:140-157`, verified on disk) and `AiWritePolicyTarget` (`types/ai-write-policy.type.ts`, verified) is `{ kind: 'record'; objectNameSingular: string; fieldNames: string[] }` for a record write, so no new constructor dependency is needed — just the same lookup `evaluate()` already does. Step 6 below resolves one policy per call and drops any item whose fields resolve to `FORBID`, and Step 1's tests cover both a full-suppression and a partial-suppression case.

**Files:**
- Modify: `packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval/entities/proposal.entity.ts`
- Modify: `packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval/services/proposal-gate.service.ts`
- Modify: `packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval/services/__tests__/proposal-gate.service.spec.ts`
- Create: an instance command (generated)

**Interfaces:**
- Consumes: `ProposalEntity`, `ProposalItemEntity`, `ProposalStatus`, `ProposalItemStatus`, `ProposalActionType`, `PROPOSAL_TTL_DAYS` (all already on disk, unchanged).
- Produces:
  - `ProposalEntity.sourceKey: string | null`
  - `type ExtractionProposalItemInput = { actionType: ProposalActionType; objectNameSingular: string; recordId: string | null; payload: Record<string, unknown>; baseline: Record<string, unknown> }`
  - `ProposalGateService.createFromExtraction(params: { workspaceId: string; sourceKey: string; reason: string; createdByActor: ActorMetadata; items: ExtractionProposalItemInput[] }): Promise<{ proposalId: string; itemIds: string[] } | null>` — consumed by Tasks 3, 4, 9.

- [ ] **Step 1: Write the failing tests**

Add to `services/__tests__/proposal-gate.service.spec.ts`, inside the existing `describe('ProposalGateService', ...)` block (reuse the `proposalRepository`/`proposalItemRepository` mocks already declared in that file — do not redeclare them):

```ts
describe('createFromExtraction', () => {
  const items = [
    {
      actionType: ProposalActionType.UPDATE_RECORD,
      objectNameSingular: 'person',
      recordId: 'record-1',
      payload: { jobTitle: 'VP Sales' },
      baseline: { jobTitle: 'Sales Manager' },
    },
  ];

  it('should return null and write nothing when there are no items', async () => {
    const result = await service.createFromExtraction({
      workspaceId: 'workspace-1',
      sourceKey: 'ingestion:message:msg-1',
      reason: 'Extracted from an email',
      createdByActor: {
        source: 'EMAIL' as never,
        workspaceMemberId: null,
        name: 'Message extraction',
        context: {},
      },
      items: [],
    });

    expect(result).toBeNull();
    expect(proposalRepository.save).not.toHaveBeenCalled();
  });

  it('should create a proposal and its items when no proposal exists for the sourceKey', async () => {
    proposalRepository.findOne.mockResolvedValue(null);

    const result = await service.createFromExtraction({
      workspaceId: 'workspace-1',
      sourceKey: 'ingestion:message:msg-1',
      reason: 'Extracted from an email',
      createdByActor: {
        source: 'EMAIL' as never,
        workspaceMemberId: null,
        name: 'Message extraction',
        context: {},
      },
      items,
    });

    expect(proposalRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        sourceKey: 'ingestion:message:msg-1',
        threadId: null,
      }),
    );
    expect(proposalItemRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        proposalId: 'proposal-1',
        actionType: ProposalActionType.UPDATE_RECORD,
        recordId: 'record-1',
      }),
    );
    expect(result).toEqual({ proposalId: 'proposal-1', itemIds: ['item-1'] });
  });

  it('should be idempotent on retry: return null and write nothing when a proposal already exists for the sourceKey', async () => {
    proposalRepository.findOne.mockResolvedValue({
      id: 'proposal-existing',
      sourceKey: 'ingestion:message:msg-1',
    });

    const result = await service.createFromExtraction({
      workspaceId: 'workspace-1',
      sourceKey: 'ingestion:message:msg-1',
      reason: 'Extracted from an email',
      createdByActor: {
        source: 'EMAIL' as never,
        workspaceMemberId: null,
        name: 'Message extraction',
        context: {},
      },
      items,
    });

    expect(result).toBeNull();
    expect(proposalItemRepository.save).not.toHaveBeenCalled();
  });

  // I10: this is an AI-originated write path — a workspace FORBID on the
  // touched object/field must suppress the proposal exactly as it suppresses
  // a tool-dispatch write through evaluate().
  it('should return null and write nothing when the workspace policy FORBIDs every item', async () => {
    proposalRepository.findOne.mockResolvedValue(null);
    aiWritePolicyService.getPolicy.mockResolvedValue({
      default: 'PROPOSE',
      overrides: { 'person.jobTitle': 'FORBID' },
    });

    const result = await service.createFromExtraction({
      workspaceId: 'workspace-1',
      sourceKey: 'ingestion:message:msg-1',
      reason: 'Extracted from an email',
      createdByActor: {
        source: 'EMAIL' as never,
        workspaceMemberId: null,
        name: 'Message extraction',
        context: {},
      },
      items,
    });

    expect(result).toBeNull();
    expect(proposalRepository.save).not.toHaveBeenCalled();
    expect(proposalItemRepository.save).not.toHaveBeenCalled();
  });

  it('should drop only the FORBIDden item and still create a proposal for the rest', async () => {
    proposalRepository.findOne.mockResolvedValue(null);
    aiWritePolicyService.getPolicy.mockResolvedValue({
      default: 'PROPOSE',
      overrides: { 'person.jobTitle': 'FORBID' },
    });

    const mixedItems = [
      ...items,
      {
        actionType: ProposalActionType.UPDATE_RECORD,
        objectNameSingular: 'person',
        recordId: 'record-2',
        payload: { phone: '+1 555 0100' },
        baseline: { phone: null },
      },
    ];

    const result = await service.createFromExtraction({
      workspaceId: 'workspace-1',
      sourceKey: 'ingestion:message:msg-2',
      reason: 'Extracted from an email',
      createdByActor: {
        source: 'EMAIL' as never,
        workspaceMemberId: null,
        name: 'Message extraction',
        context: {},
      },
      items: mixedItems,
    });

    expect(proposalItemRepository.save).toHaveBeenCalledTimes(1);
    expect(proposalItemRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ recordId: 'record-2' }),
    );
    expect(result).toEqual({ proposalId: 'proposal-1', itemIds: ['item-1'] });
  });
});
```

Add `const aiWritePolicyService = { getPolicy: jest.fn(), resolveMode: jest.fn() };` alongside the file's existing mocks if it is not already declared there — `evaluate()`'s own tests in this same spec file already construct the service with a real `AiWritePolicyService` instance in some blocks and a mock in others (verified: `services/__tests__/proposal-gate.service.spec.ts:53` comments *"The policy service is REAL here"*); reuse whichever the surrounding `describe('ProposalGateService', ...)` block already wires up rather than redeclaring a second one. Since `resolveMode` is a pure function, prefer letting the real `AiWritePolicyService.resolveMode` run against a mocked `getPolicy` — call `aiWritePolicyService.getPolicy.mockResolvedValue(...)` only, and let `resolveMode` execute for real, exercising a real seam instead of a second mock layer.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/searm-server && npx jest proposal-gate.service.spec
```

Expected: FAIL — `service.createFromExtraction is not a function`.

- [ ] **Step 3: Add the column**

In `entities/proposal.entity.ts`, add after the `threadId` column:

```ts
  // Idempotency key for proposals created outside a tool-call/thread context —
  // ingestion (format "ingestion:<sourceType>:<sourceId>") and import (format
  // "import:<importBatchId>:<rowNumber>"). A retried background job that finds
  // an existing row for the same key writes nothing a second time.
  @Column({ type: 'varchar', nullable: true })
  @Index()
  sourceKey: string | null;

  // Human-readable justification shown on the proposal card. Set by
  // background-job proposals (ingestion, import), which have no chat thread
  // to explain themselves from. Null for tool-dispatch proposals.
  @Column({ type: 'text', nullable: true })
  reason: string | null;
```

- [ ] **Step 4: Generate and fill the instance command**

```bash
npx nx run searm-server:database:migrate:generate --name add-proposal-source-key-and-reason --type fast
```

Open the generated file (follows the shape of `2-28-instance-command-fast-1785950948000-add-ai-write-approval.ts` — `@RegisteredInstanceCommand`, `FastInstanceCommand`, raw SQL). Fill `up`:

```sql
ALTER TABLE "core"."proposal" ADD COLUMN "sourceKey" varchar;
ALTER TABLE "core"."proposal" ADD COLUMN "reason" text;
CREATE INDEX "IDX_proposal_sourceKey" ON "core"."proposal" ("sourceKey");
```

And `down`:

```sql
DROP INDEX "core"."IDX_proposal_sourceKey";
ALTER TABLE "core"."proposal" DROP COLUMN "reason";
ALTER TABLE "core"."proposal" DROP COLUMN "sourceKey";
```

Read `packages/searm-server/docs/UPGRADE_COMMANDS.md` before editing. Never rewrite a committed command's `up`/`down`.

- [ ] **Step 5: Apply and verify**

```bash
npx nx run searm-server:database:migrate:prod
psql "$PG_DATABASE_URL" -c '\d core."proposal"'
```

Expected: `sourceKey` column present.

- [ ] **Step 6: Write the method**

Add to `services/proposal-gate.service.ts`, after the existing `evaluate()` method:

```ts
  // Background jobs (ingestion extraction, import) have no ToolProviderContext
  // to key a batch on, so this is a second entry point into the same tables —
  // not a parallel proposal system. Idempotent on sourceKey: a job retried by
  // BullMQ after a crash must not create a second proposal for the same source.
  async createFromExtraction(params: {
    workspaceId: string;
    sourceKey: string;
    reason: string;
    createdByActor: ActorMetadata;
    items: {
      actionType: ProposalActionType;
      objectNameSingular: string;
      recordId: string | null;
      payload: Record<string, unknown>;
      baseline: Record<string, unknown>;
    }[];
  }): Promise<{ proposalId: string; itemIds: string[] } | null> {
    const { workspaceId, sourceKey, reason, createdByActor, items } = params;

    if (items.length === 0) {
      return null;
    }

    const existing = await this.proposalRepository.findOne({
      where: { workspaceId, sourceKey },
    });

    if (isDefined(existing)) {
      return null;
    }

    // I10: an ingestion/import write is AI-originated the same way a tool
    // call is — a workspace FORBID must suppress it here too, not just on
    // the evaluate() path. Same lookup evaluate() makes at
    // services/proposal-gate.service.ts:140-146.
    const policy = await this.aiWritePolicyService.getPolicy(workspaceId);
    const allowedItems = items.filter((item) => {
      const mode = this.aiWritePolicyService.resolveMode(policy, {
        kind: 'record',
        objectNameSingular: item.objectNameSingular,
        fieldNames: Object.keys(item.payload),
      });

      return mode !== 'FORBID';
    });

    if (allowedItems.length === 0) {
      return null;
    }

    const expiresAt = new Date();

    expiresAt.setDate(expiresAt.getDate() + PROPOSAL_TTL_DAYS);

    const proposal = await this.proposalRepository.save({
      workspaceId,
      sourceKey,
      threadId: null,
      createdByActor,
      reason,
      status: ProposalStatus.PENDING,
      expiresAt,
    });

    const itemIds: string[] = [];

    for (const item of allowedItems) {
      // Same provenance attachment evaluate() does (Phase 2 Task 8), so a
      // background-job proposal is as citable in the review UI as an agent's.
      const factIds = isDefined(item.recordId)
        ? await this.factLookupService.findCurrentFactIdsForFields({
            workspaceId,
            objectNameSingular: item.objectNameSingular,
            recordId: item.recordId,
            fieldNames: Object.keys(item.payload),
          })
        : [];

      const savedItem = await this.proposalItemRepository.save({
        proposalId: proposal.id,
        actionType: item.actionType,
        objectNameSingular: item.objectNameSingular,
        recordId: item.recordId,
        payload: item.payload,
        baseline: item.baseline,
        factIds,
        status: ProposalItemStatus.PENDING,
      });

      itemIds.push(savedItem.id);
    }

    return { proposalId: proposal.id, itemIds };
  }
```

Add `import { type ActorMetadata } from 'searm-shared/types';` to the top of the file.

- [ ] **Step 7: Run the test to verify it passes**

```bash
cd packages/searm-server && npx jest proposal-gate.service.spec
```

Expected: PASS — all pre-existing tests plus the 5 new ones (I5: do not hard-code a baseline test count for a Launch-1 suite; verify the pre-existing count by running the suite before this step, not by trusting a number written during planning).

- [ ] **Step 8: Lint, typecheck, commit**

```bash
npx nx lint:diff-with-main searm-server
npx nx typecheck searm-server
git add packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval packages/searm-server/src/database
git commit -m "feat(ingestion): add non-agent proposal creation path"
```

---

### Task 2: Deterministic identity resolution service

The single reusable matcher for Tasks 3, 4, 7, and 9. Two-tier verdict, explainable at every tier: **EXACT** (safe to write automatically — already how SeaRM's `contact-creation-manager` behaves today), **CANDIDATE** (a real but unconfirmed signal — always becomes a proposal), **NONE** (no basis to link — caller decides create-vs-skip). Company matching is domain-only (SeaRM already treats `company.domainName` as a soft identity key — see `create-company.service.ts`). Person CANDIDATE matching requires **both** a company-domain match **and** a name match — never one alone — per the two-factor "guess the query, never the answer" principle documented in `docs/superpowers/scouting/crm-scout.md` §3.

**Files:**
- Create: `packages/searm-server/src/modules/match-participant/utils/normalize-person-display-name.util.ts`
- Create: `packages/searm-server/src/modules/match-participant/utils/__tests__/normalize-person-display-name.util.spec.ts`
- Create: `packages/searm-server/src/modules/match-participant/services/identity-resolution.service.ts`
- Create: `packages/searm-server/src/modules/match-participant/services/__tests__/identity-resolution.service.spec.ts`
- Modify: `packages/searm-server/src/modules/match-participant/match-participant.module.ts`

**Interfaces:**
- Consumes: `findPersonByPrimaryOrAdditionalEmail` (`utils/find-person-by-primary-or-additional-email.ts`, on disk), `addPersonEmailFiltersToQueryBuilder` (`utils/add-person-email-filters-to-query-builder.ts`, on disk), `getDomainNameFromHandle` (`src/modules/contact-creation-manager/utils/get-domain-name-from-handle.util.ts`, on disk), `extractDomainFromLink` (`src/modules/contact-creation-manager/utils/extract-domain-from-link.util.ts`, on disk), `GlobalWorkspaceOrmManager.getRepository`, `PersonWorkspaceEntity`, `CompanyWorkspaceEntity`.
- Produces:
  - `type IdentityMatch = { kind: 'EXACT'; recordId: string; matchedOn: string } | { kind: 'CANDIDATE'; recordId: string; explanation: string } | { kind: 'NONE' }`
  - `IdentityResolutionService.resolvePerson(params: { workspaceId: string; email: string; displayName?: string | null }): Promise<IdentityMatch>` — consumed by Tasks 3, 4, 7, 9.
  - `IdentityResolutionService.resolveCompany(params: { workspaceId: string; domain: string }): Promise<IdentityMatch>` — consumed by Tasks 7, 9.

- [ ] **Step 1: Write the failing test for the normalization util**

Create `utils/__tests__/normalize-person-display-name.util.spec.ts`:

```ts
import { normalizePersonDisplayName } from 'src/modules/match-participant/utils/normalize-person-display-name.util';

describe('normalizePersonDisplayName', () => {
  it('should lowercase and trim', () => {
    expect(normalizePersonDisplayName('  Ada Lovelace  ')).toBe('ada lovelace');
  });

  it('should collapse repeated whitespace', () => {
    expect(normalizePersonDisplayName('Ada   Lovelace')).toBe('ada lovelace');
  });

  it('should return an empty string for null or undefined', () => {
    expect(normalizePersonDisplayName(null)).toBe('');
    expect(normalizePersonDisplayName(undefined)).toBe('');
  });
});
```

- [ ] **Step 2: Run it, see it fail**

```bash
cd packages/searm-server && npx jest normalize-person-display-name.util.spec
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the util**

Create `utils/normalize-person-display-name.util.ts`:

```ts
export const normalizePersonDisplayName = (
  displayName: string | null | undefined,
): string => {
  if (!displayName) {
    return '';
  }

  return displayName.trim().toLowerCase().replace(/\s+/g, ' ');
};
```

- [ ] **Step 4: Run it, see it pass**

```bash
cd packages/searm-server && npx jest normalize-person-display-name.util.spec
```

Expected: PASS, 3 `it` blocks (the null/undefined block makes 2 assertions in one `it`, so `npx jest` reports 3 passing tests, not 4).

- [ ] **Step 5: Write the failing test for the service**

Create `services/__tests__/identity-resolution.service.spec.ts`:

```ts
import { Test, type TestingModule } from '@nestjs/testing';

import { GlobalWorkspaceOrmManager } from 'src/engine/searm-orm/global-workspace-datasource/global-workspace-orm.manager';
import { IdentityResolutionService } from 'src/modules/match-participant/services/identity-resolution.service';

describe('IdentityResolutionService', () => {
  let service: IdentityResolutionService;

  const personQueryBuilder = {
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn(),
  };
  const personRepository = {
    createQueryBuilder: jest.fn(() => personQueryBuilder),
    find: jest.fn(),
  };
  const companyRepository = { find: jest.fn(), findOne: jest.fn() };

  const globalWorkspaceOrmManager = {
    getRepository: jest.fn((_workspaceId: string, entity: unknown) => {
      return entity === 'company' ? companyRepository : personRepository;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    personQueryBuilder.getMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdentityResolutionService,
        {
          provide: GlobalWorkspaceOrmManager,
          useValue: globalWorkspaceOrmManager,
        },
      ],
    }).compile();

    service = module.get<IdentityResolutionService>(IdentityResolutionService);
  });

  describe('resolvePerson', () => {
    it('should return EXACT when the email matches an existing person', async () => {
      personQueryBuilder.getMany.mockResolvedValue([
        {
          id: 'person-1',
          emails: { primaryEmail: 'jane@acme.com', additionalEmails: [] },
          name: { firstName: 'Jane', lastName: 'Doe' },
          companyId: 'company-1',
        },
      ]);

      const match = await service.resolvePerson({
        workspaceId: 'workspace-1',
        email: 'jane@acme.com',
      });

      expect(match).toEqual({
        kind: 'EXACT',
        recordId: 'person-1',
        matchedOn: expect.stringContaining('email'),
      });
    });

    it('should return NONE when there is no email match and no displayName to compare', async () => {
      const match = await service.resolvePerson({
        workspaceId: 'workspace-1',
        email: 'unknown@acme.com',
      });

      expect(match).toEqual({ kind: 'NONE' });
    });

    it('should return CANDIDATE when the domain and the name both match an existing person under a different email', async () => {
      companyRepository.find.mockResolvedValue([
        { id: 'company-1', domainName: { primaryLinkUrl: 'https://acme.com' } },
      ]);
      personRepository.find.mockResolvedValue([
        {
          id: 'person-1',
          name: { firstName: 'Jane', lastName: 'Doe' },
          companyId: 'company-1',
        },
      ]);

      const match = await service.resolvePerson({
        workspaceId: 'workspace-1',
        email: 'jane.doe@acme.com',
        displayName: 'Jane Doe',
      });

      expect(match).toEqual({
        kind: 'CANDIDATE',
        recordId: 'person-1',
        explanation: expect.stringContaining('acme.com'),
      });
    });

    it('should return NONE when the domain matches but no person at that company has a matching name', async () => {
      companyRepository.find.mockResolvedValue([
        { id: 'company-1', domainName: { primaryLinkUrl: 'https://acme.com' } },
      ]);
      personRepository.find.mockResolvedValue([
        {
          id: 'person-1',
          name: { firstName: 'John', lastName: 'Smith' },
          companyId: 'company-1',
        },
      ]);

      const match = await service.resolvePerson({
        workspaceId: 'workspace-1',
        email: 'jane.doe@acme.com',
        displayName: 'Jane Doe',
      });

      expect(match).toEqual({ kind: 'NONE' });
    });

    it('should return NONE when the domain has no matching company at all', async () => {
      companyRepository.find.mockResolvedValue([]);

      const match = await service.resolvePerson({
        workspaceId: 'workspace-1',
        email: 'jane.doe@acme.com',
        displayName: 'Jane Doe',
      });

      expect(match).toEqual({ kind: 'NONE' });
    });
  });

  describe('resolveCompany', () => {
    it('should return EXACT when the domain matches an existing company', async () => {
      companyRepository.findOne.mockResolvedValue({
        id: 'company-1',
        domainName: { primaryLinkUrl: 'https://acme.com' },
      });

      const match = await service.resolveCompany({
        workspaceId: 'workspace-1',
        domain: 'acme.com',
      });

      expect(match).toEqual({
        kind: 'EXACT',
        recordId: 'company-1',
        matchedOn: expect.stringContaining('domain'),
      });
    });

    it('should return NONE when no company matches the domain', async () => {
      companyRepository.findOne.mockResolvedValue(null);

      const match = await service.resolveCompany({
        workspaceId: 'workspace-1',
        domain: 'unknown.com',
      });

      expect(match).toEqual({ kind: 'NONE' });
    });
  });
});
```

- [ ] **Step 6: Run it, see it fail**

```bash
cd packages/searm-server && npx jest identity-resolution.service.spec
```

Expected: FAIL — module not found.

- [ ] **Step 7: Write the service**

Create `services/identity-resolution.service.ts`:

```ts
import { Injectable } from '@nestjs/common';

import { isDefined } from 'searm-shared/utils';
import { ILike } from 'typeorm';

import { GlobalWorkspaceOrmManager } from 'src/engine/searm-orm/global-workspace-datasource/global-workspace-orm.manager';
import { extractDomainFromLink } from 'src/modules/contact-creation-manager/utils/extract-domain-from-link.util';
import { getDomainNameFromHandle } from 'src/modules/contact-creation-manager/utils/get-domain-name-from-handle.util';
import { addPersonEmailFiltersToQueryBuilder } from 'src/modules/match-participant/utils/add-person-email-filters-to-query-builder';
import { findPersonByPrimaryOrAdditionalEmail } from 'src/modules/match-participant/utils/find-person-by-primary-or-additional-email';
import { normalizePersonDisplayName } from 'src/modules/match-participant/utils/normalize-person-display-name.util';
import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { type CompanyWorkspaceEntity } from 'src/modules/company/standard-objects/company.workspace-entity';

export type IdentityMatch =
  | { kind: 'EXACT'; recordId: string; matchedOn: string }
  | { kind: 'CANDIDATE'; recordId: string; explanation: string }
  | { kind: 'NONE' };

@Injectable()
export class IdentityResolutionService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  // EXACT is SeaRM's existing deterministic rule (see
  // find-person-by-primary-or-additional-email.ts, used today by
  // MatchParticipantService and contact-creation-manager). CANDIDATE requires
  // BOTH a company-domain match AND a name match — one signal alone is a
  // different person who happens to share an attribute, not a weaker match.
  async resolvePerson(params: {
    workspaceId: string;
    email: string;
    displayName?: string | null;
  }): Promise<IdentityMatch> {
    const { workspaceId, email, displayName } = params;

    const personRepository =
      await this.globalWorkspaceOrmManager.getRepository<PersonWorkspaceEntity>(
        workspaceId,
        'person',
        { shouldBypassPermissionChecks: true },
      );

    const queryBuilder = addPersonEmailFiltersToQueryBuilder({
      queryBuilder: personRepository.createQueryBuilder('person'),
      emails: [email],
    });

    const candidatesByEmail = await queryBuilder
      .orderBy('person.createdAt', 'ASC')
      .getMany();

    const exactMatch = findPersonByPrimaryOrAdditionalEmail({
      people: candidatesByEmail,
      email,
    });

    if (isDefined(exactMatch)) {
      return {
        kind: 'EXACT',
        recordId: exactMatch.id,
        matchedOn: `email ${email} matches an email already on file for this person`,
      };
    }

    if (!displayName) {
      return { kind: 'NONE' };
    }

    const domain = getDomainNameFromHandle(email);

    if (!domain) {
      return { kind: 'NONE' };
    }

    const companyRepository =
      await this.globalWorkspaceOrmManager.getRepository<CompanyWorkspaceEntity>(
        workspaceId,
        'company',
        { shouldBypassPermissionChecks: true },
      );

    const companiesAtDomain = await companyRepository.find({
      where: { domainName: { primaryLinkUrl: ILike(`%${domain}%`) } },
    });

    const company = companiesAtDomain.find(
      (candidate) =>
        isDefined(candidate.domainName?.primaryLinkUrl) &&
        extractDomainFromLink(candidate.domainName.primaryLinkUrl) === domain,
    );

    if (!isDefined(company)) {
      return { kind: 'NONE' };
    }

    const peopleAtCompany = await personRepository.find({
      where: { companyId: company.id },
    });

    const normalizedIncomingName = normalizePersonDisplayName(displayName);

    const nameMatch = peopleAtCompany.find((person) => {
      const personDisplayName = [person.name?.firstName, person.name?.lastName]
        .filter(isDefined)
        .join(' ');

      return (
        normalizePersonDisplayName(personDisplayName) === normalizedIncomingName
      );
    });

    if (!isDefined(nameMatch)) {
      return { kind: 'NONE' };
    }

    return {
      kind: 'CANDIDATE',
      recordId: nameMatch.id,
      explanation: `"${displayName}" matches an existing person's name at company domain ${domain}, but arrived from a different email address (${email}). Confirm before merging.`,
    };
  }

  // Company identity has one real signal (domain) — no name-based CANDIDATE
  // tier, unlike person matching. A domain either matches or it doesn't.
  async resolveCompany(params: {
    workspaceId: string;
    domain: string;
  }): Promise<IdentityMatch> {
    const { workspaceId, domain } = params;

    const companyRepository =
      await this.globalWorkspaceOrmManager.getRepository<CompanyWorkspaceEntity>(
        workspaceId,
        'company',
        { shouldBypassPermissionChecks: true },
      );

    const company = await companyRepository.findOne({
      where: { domainName: { primaryLinkUrl: ILike(`%${domain}%`) } },
    });

    if (
      !isDefined(company) ||
      !isDefined(company.domainName?.primaryLinkUrl) ||
      extractDomainFromLink(company.domainName.primaryLinkUrl) !== domain
    ) {
      return { kind: 'NONE' };
    }

    return {
      kind: 'EXACT',
      recordId: company.id,
      matchedOn: `domain ${domain} matches this company's domainName`,
    };
  }
}
```

- [ ] **Step 8: Run it, see it pass**

```bash
cd packages/searm-server && npx jest identity-resolution.service.spec
```

Expected: PASS, 7 tests.

If `GlobalWorkspaceOrmManager.getRepository`'s exact overload signature differs from `(workspaceId, 'person' | 'company', options)`, match the real signature used elsewhere in `match-participant.service.ts` (already on disk) and adjust the mock's `entity === 'company'` check to match how the real second argument is typed.

- [ ] **Step 9: Wire the module**

In `match-participant.module.ts`, add both new services:

```ts
import { Module } from '@nestjs/common';

import { IdentityResolutionService } from 'src/modules/match-participant/services/identity-resolution.service';
import { MatchParticipantService } from 'src/modules/match-participant/match-participant.service';

@Module({
  imports: [],
  providers: [MatchParticipantService, IdentityResolutionService],
  exports: [MatchParticipantService, IdentityResolutionService],
})
export class MatchParticipantModule {}
```

(`ParticipantIdentityProposalService` is added to this same module in Task 3 — do not add it yet, it does not exist until then.)

- [ ] **Step 10: Lint, typecheck, commit**

```bash
npx nx lint:diff-with-main searm-server
npx nx typecheck searm-server
git add packages/searm-server/src/modules/match-participant
git commit -m "feat(identity): add deterministic person and company identity resolution"
```

---

### Task 3: Ambiguous participant identity becomes a proposal

`MatchParticipantService` already runs EXACT matching for every new message/calendar participant and leaves `personId` null when nothing matches. This task adds a second pass: for participants still unmatched after that, ask `IdentityResolutionService` for a CANDIDATE, and if found, propose linking `personId` — a plain `UPDATE_RECORD` on the `messageParticipant`/`calendarEventParticipant` object, which already works generically through `UpdateRecordService`. No new `ProposalActionType` is needed.

**Files:**
- Create: `packages/searm-server/src/modules/match-participant/services/participant-identity-proposal.service.ts`
- Create: `packages/searm-server/src/modules/match-participant/services/__tests__/participant-identity-proposal.service.spec.ts`
- Modify: `packages/searm-server/src/modules/messaging/message-participant-manager/services/messaging-message-participant.service.ts`
- Modify: `packages/searm-server/src/modules/calendar/calendar-event-participant-manager/services/calendar-event-participant.service.ts`
- Modify: `packages/searm-server/src/modules/match-participant/match-participant.module.ts`
- Modify: `packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval/ai-write-approval.module.ts` (export `ProposalGateService` already happens — confirm `MatchParticipantModule` can import it without a cycle; see Step 6)

**Interfaces:**
- Consumes: `IdentityResolutionService.resolvePerson` (Task 2), `ProposalGateService.createFromExtraction` (Task 1).
- Produces: `ParticipantIdentityProposalService.reviewUnmatchedParticipants(params: { participants: { id: string; handle: string | null; displayName: string | null }[]; objectMetadataName: 'messageParticipant' | 'calendarEventParticipant'; workspaceId: string }): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `services/__tests__/participant-identity-proposal.service.spec.ts`:

```ts
import { Test, type TestingModule } from '@nestjs/testing';

import { ProposalGateService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-gate.service';
import { IdentityResolutionService } from 'src/modules/match-participant/services/identity-resolution.service';
import { ParticipantIdentityProposalService } from 'src/modules/match-participant/services/participant-identity-proposal.service';

describe('ParticipantIdentityProposalService', () => {
  let service: ParticipantIdentityProposalService;

  const identityResolutionService = { resolvePerson: jest.fn() };
  const proposalGateService = { createFromExtraction: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ParticipantIdentityProposalService,
        {
          provide: IdentityResolutionService,
          useValue: identityResolutionService,
        },
        { provide: ProposalGateService, useValue: proposalGateService },
      ],
    }).compile();

    service = module.get<ParticipantIdentityProposalService>(
      ParticipantIdentityProposalService,
    );
  });

  it('should do nothing when there are no unmatched participants', async () => {
    await service.reviewUnmatchedParticipants({
      participants: [],
      objectMetadataName: 'messageParticipant',
      workspaceId: 'workspace-1',
    });

    expect(identityResolutionService.resolvePerson).not.toHaveBeenCalled();
  });

  it('should skip a participant with no handle', async () => {
    await service.reviewUnmatchedParticipants({
      participants: [{ id: 'participant-1', handle: null, displayName: 'Jane' }],
      objectMetadataName: 'messageParticipant',
      workspaceId: 'workspace-1',
    });

    expect(identityResolutionService.resolvePerson).not.toHaveBeenCalled();
  });

  it('should propose linking personId when a CANDIDATE match is found', async () => {
    identityResolutionService.resolvePerson.mockResolvedValue({
      kind: 'CANDIDATE',
      recordId: 'person-1',
      explanation: '"Jane Doe" matches an existing person at acme.com',
    });

    await service.reviewUnmatchedParticipants({
      participants: [
        {
          id: 'participant-1',
          handle: 'jane.doe@acme.com',
          displayName: 'Jane Doe',
        },
      ],
      objectMetadataName: 'messageParticipant',
      workspaceId: 'workspace-1',
    });

    expect(proposalGateService.createFromExtraction).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        sourceKey: 'ingestion:messageParticipant:participant-1',
        items: [
          expect.objectContaining({
            actionType: 'UPDATE_RECORD',
            objectNameSingular: 'messageParticipant',
            recordId: 'participant-1',
            payload: { personId: 'person-1' },
            baseline: { personId: null },
          }),
        ],
      }),
    );
  });

  it('should not create a proposal for an EXACT or NONE result', async () => {
    identityResolutionService.resolvePerson.mockResolvedValue({ kind: 'NONE' });

    await service.reviewUnmatchedParticipants({
      participants: [
        { id: 'participant-1', handle: 'nobody@acme.com', displayName: null },
      ],
      objectMetadataName: 'messageParticipant',
      workspaceId: 'workspace-1',
    });

    expect(proposalGateService.createFromExtraction).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it, see it fail**

```bash
cd packages/searm-server && npx jest participant-identity-proposal.service.spec
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the service**

Create `services/participant-identity-proposal.service.ts`:

```ts
import { Injectable } from '@nestjs/common';

import { FieldActorSource } from 'searm-shared/types';
import { isDefined } from 'searm-shared/utils';

import { ProposalActionType } from 'src/engine/metadata-modules/ai/ai-write-approval/types/proposal-status.type';
import { ProposalGateService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-gate.service';
import { IdentityResolutionService } from 'src/modules/match-participant/services/identity-resolution.service';

@Injectable()
export class ParticipantIdentityProposalService {
  constructor(
    private readonly identityResolutionService: IdentityResolutionService,
    private readonly proposalGateService: ProposalGateService,
  ) {}

  // Called after MatchParticipantService's exact-match pass with whatever is
  // still unmatched. A CANDIDATE result becomes a one-item proposal linking
  // personId — the record contract is satisfied for free because
  // messageParticipant/calendarEventParticipant are ordinary workspace
  // objects and UPDATE_RECORD already works generically for any object.
  async reviewUnmatchedParticipants(params: {
    participants: {
      id: string;
      handle: string | null;
      displayName: string | null;
    }[];
    objectMetadataName: 'messageParticipant' | 'calendarEventParticipant';
    workspaceId: string;
  }): Promise<void> {
    const { participants, objectMetadataName, workspaceId } = params;

    for (const participant of participants) {
      if (!isDefined(participant.handle)) {
        continue;
      }

      const match = await this.identityResolutionService.resolvePerson({
        workspaceId,
        email: participant.handle,
        displayName: participant.displayName,
      });

      if (match.kind !== 'CANDIDATE') {
        continue;
      }

      await this.proposalGateService.createFromExtraction({
        workspaceId,
        sourceKey: `ingestion:${objectMetadataName}:${participant.id}`,
        reason: match.explanation,
        createdByActor: {
          source: FieldActorSource.EMAIL,
          workspaceMemberId: null,
          name: 'Participant identity matching',
          context: {},
        },
        items: [
          {
            actionType: ProposalActionType.UPDATE_RECORD,
            objectNameSingular: objectMetadataName,
            recordId: participant.id,
            payload: { personId: match.recordId },
            baseline: { personId: null },
          },
        ],
      });
    }
  }
}
```

- [ ] **Step 4: Run it, see it pass**

```bash
cd packages/searm-server && npx jest participant-identity-proposal.service.spec
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Hook into message participant creation**

In `modules/messaging/message-participant-manager/services/messaging-message-participant.service.ts`, add the constructor dependency and call the new service after the existing `matchParticipants` call:

```ts
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly matchParticipantService: MatchParticipantService<MessageParticipantWorkspaceEntity>,
    private readonly participantIdentityProposalService: ParticipantIdentityProposalService,
  ) {}
```

and, immediately after the existing `await this.matchParticipantService.matchParticipants({...})` call inside `saveMessageParticipants`:

```ts
        const createdParticipantIds = (createdParticipants.raw ?? []).map(
          (participant: MessageParticipantWorkspaceEntity) => participant.id,
        );
        const stillUnmatched = await messageParticipantRepository.find({
          where: { id: In(createdParticipantIds), personId: IsNull() },
        });

        await this.participantIdentityProposalService.reviewUnmatchedParticipants(
          {
            participants: stillUnmatched.map((participant) => ({
              id: participant.id,
              handle: participant.handle,
              displayName: participant.displayName,
            })),
            objectMetadataName: 'messageParticipant',
            workspaceId,
          },
        );
```

Add `IsNull` to the existing `import { In } from 'typeorm';` line (`import { In, IsNull } from 'typeorm';`) and add:

```ts
import { ParticipantIdentityProposalService } from 'src/modules/match-participant/services/participant-identity-proposal.service';
```

- [ ] **Step 6: Hook into calendar event participant creation**

In `modules/calendar/calendar-event-participant-manager/services/calendar-event-participant.service.ts`, add the same constructor dependency:

```ts
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly matchParticipantService: MatchParticipantService<CalendarEventParticipantWorkspaceEntity>,
    @InjectMessageQueue(MessageQueue.contactCreationQueue)
    private readonly messageQueueService: MessageQueueService,
    private readonly participantIdentityProposalService: ParticipantIdentityProposalService,
  ) {}
```

and, immediately after the existing `await this.matchParticipantService.matchParticipants({...})` call inside `upsertAndDeleteCalendarEventParticipants` (the block ending at line ~183):

```ts
        const savedParticipantIds = savedParticipants.map(
          (participant) => participant.id,
        );
        const stillUnmatched = await calendarEventParticipantRepository.find({
          where: { id: Any(savedParticipantIds), personId: IsNull() },
        });

        await this.participantIdentityProposalService.reviewUnmatchedParticipants(
          {
            participants: stillUnmatched.map((participant) => ({
              id: participant.id,
              handle: participant.handle,
              displayName: participant.displayName,
            })),
            objectMetadataName: 'calendarEventParticipant',
            workspaceId,
          },
        );
```

Add `IsNull` to the existing `import { Any } from 'typeorm';` line and add the same `ParticipantIdentityProposalService` import.

Both modified services now depend on `ProposalGateService` transitively (through `ParticipantIdentityProposalService`). `MatchParticipantModule` must import `AiWriteApprovalModule` — do this in Step 7. `MessageParticipantManagerModule` and `CalendarEventParticipantManagerModule` already import `MatchParticipantModule` (verify at implementation time by opening those two `.module.ts` files; if either does not, add the import — this is required for `MatchParticipantService` injection to have worked before this task, so it should already be present).

- [ ] **Step 7: Wire the module**

In `match-participant.module.ts`:

```ts
import { Module } from '@nestjs/common';

import { AiWriteApprovalModule } from 'src/engine/metadata-modules/ai/ai-write-approval/ai-write-approval.module';
import { IdentityResolutionService } from 'src/modules/match-participant/services/identity-resolution.service';
import { MatchParticipantService } from 'src/modules/match-participant/match-participant.service';
import { ParticipantIdentityProposalService } from 'src/modules/match-participant/services/participant-identity-proposal.service';

@Module({
  imports: [AiWriteApprovalModule],
  providers: [
    MatchParticipantService,
    IdentityResolutionService,
    ParticipantIdentityProposalService,
  ],
  exports: [
    MatchParticipantService,
    IdentityResolutionService,
    ParticipantIdentityProposalService,
  ],
})
export class MatchParticipantModule {}
```

If Nest reports a circular dependency at boot (`AiWriteApprovalModule` → `RecordCrudModule` → ... → back to a messaging module), wrap the import in `forwardRef(() => AiWriteApprovalModule)` on this side — same known, bounded fix Launch 1's plan used for its own module wiring.

- [ ] **Step 8: Run the surrounding suites for regressions**

```bash
cd packages/searm-server && npx jest messaging-message-participant.service
cd packages/searm-server && npx jest calendar-event-participant.service
```

Expected: PASS. If either existing spec constructs its service directly (not through Nest's `Test.createTestingModule`), add a `ParticipantIdentityProposalService` mock with `reviewUnmatchedParticipants: jest.fn()`.

- [ ] **Step 9: Lint, typecheck, commit**

```bash
npx nx lint:diff-with-main searm-server
npx nx typecheck searm-server
git add packages/searm-server/src/modules/match-participant packages/searm-server/src/modules/messaging packages/searm-server/src/modules/calendar
git commit -m "feat(identity): propose linking ambiguous participant matches"
```

---

### Task 4: Structured extraction from message and call-recording content

> **Program integration — this task consumes Phase 2's Evidence pipeline.** Add `EvidenceRecordingService` (from `AiResearchModule`) to this service's constructor and to `StructuredExtractionModule`'s imports. Every extracted claim is written as `Evidence` **before** the proposal is created; `recordEvidence()` calls `FactDerivationService.deriveFact()` internally, so the `Fact` exists by the time `createFromExtraction` runs and `FactLookupService` attaches its id to the proposal item. Extend the unit test in Step 2 with: *"should record evidence for each extracted fact before creating the proposal"* (assert `evidenceRecordingService.recordEvidence` called once per EXACT-matched fact, with `sourceType: 'EMAIL_MESSAGE'` for a message and `'CALL_RECORDING'` for a recording, and with `runId: null`), and *"should not record evidence when the identity match is not EXACT"*.

Scoped to one fact type — a person's job title changing — because it is low-risk (single field, single `ProposalActionType.UPDATE_RECORD`, targets only records `IdentityResolutionService` already confirms EXACT), and it proves the whole pipeline end to end: LLM extraction → identity resolution → **evidence recording → fact derivation** → non-agent proposal creation → existing approval UI. Broader extraction (commitments, risks, next actions as `Task` records) is deliberately cut — see the cut table.

**Files:**
- Create: `packages/searm-server/src/modules/structured-extraction/structured-extraction.module.ts`
- Create: `packages/searm-server/src/modules/structured-extraction/types/extracted-job-title-fact.type.ts`
- Create: `packages/searm-server/src/modules/structured-extraction/services/structured-person-fact-extraction.service.ts`
- Create: `packages/searm-server/src/modules/structured-extraction/services/__tests__/structured-person-fact-extraction.service.spec.ts`
- Create: `packages/searm-server/src/modules/structured-extraction/jobs/message-structured-extraction.job.ts`
- Create: `packages/searm-server/src/modules/structured-extraction/jobs/call-recording-structured-extraction.job.ts`
- Create: `packages/searm-server/src/modules/structured-extraction/listeners/message-structured-extraction.listener.ts`
- Create: `packages/searm-server/src/modules/structured-extraction/listeners/call-recording-structured-extraction.listener.ts`
- Modify: `packages/searm-server/src/engine/metadata-modules/connected-account/entities/connected-account.entity.ts` (Owner Decision 3 — add `excludeFromAiExtraction`)
- Create: an instance command (generated) for the `excludeFromAiExtraction` column

**Interfaces:**
- Consumes: `IdentityResolutionService.resolvePerson` (Task 2), `ProposalGateService.createFromExtraction` (Task 1), `AiModelRegistryService.resolveModelForAgent` (`src/engine/metadata-modules/ai/ai-models/services/ai-model-registry.service.ts`, on disk, synchronous), `AiBillingService.calculateAndBillUsage` (`src/engine/metadata-modules/ai/ai-billing/services/ai-billing.service.ts`, on disk), `FindRecordsService.execute` (on disk), `generateObject` from `'ai'` (Vercel AI SDK, already a dependency — `generateText` from the same package is used in `ai-generate-text.controller.ts`).
- Produces: `StructuredPersonFactExtractionService.extractJobTitleChanges(params: { workspaceId: string; sourceType: 'message' | 'call-recording'; sourceId: string; text: string; participantEmails: string[] }): Promise<void>`.

- [ ] **Step 1: Write the type**

Create `types/extracted-job-title-fact.type.ts`:

```ts
export type ExtractedJobTitleFact = {
  personEmail: string;
  newJobTitle: string;
  excerpt: string;
};
```

- [ ] **Step 2: Write the failing test**

Create `services/__tests__/structured-person-fact-extraction.service.spec.ts`:

```ts
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AiBillingService } from 'src/engine/metadata-modules/ai/ai-billing/services/ai-billing.service';
import { AiModelRegistryService } from 'src/engine/metadata-modules/ai/ai-models/services/ai-model-registry.service';
import { EvidenceRecordingService } from 'src/engine/metadata-modules/ai/ai-research/services/evidence-recording.service';
import { ProposalGateService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-gate.service';
import { FindRecordsService } from 'src/engine/core-modules/record-crud/services/find-records.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { IdentityResolutionService } from 'src/modules/match-participant/services/identity-resolution.service';
import { StructuredPersonFactExtractionService } from 'src/modules/structured-extraction/services/structured-person-fact-extraction.service';

jest.mock('ai', () => ({ generateObject: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { generateObject } = jest.requireMock('ai');

describe('StructuredPersonFactExtractionService', () => {
  let service: StructuredPersonFactExtractionService;

  const identityResolutionService = { resolvePerson: jest.fn() };
  const proposalGateService = { createFromExtraction: jest.fn() };
  const findRecordsService = { execute: jest.fn() };
  const aiModelRegistryService = {
    resolveModelForAgent: jest.fn(() => ({ model: 'fake-model' })),
  };
  const aiBillingService = { calculateAndBillUsage: jest.fn() };
  const evidenceRecordingService = { recordEvidence: jest.fn() };
  const workspaceRepository = {
    findOne: jest.fn(() => ({ id: 'workspace-1', fastModel: 'model-1' })),
  };
  // N4: getRepositoryToken(WorkspaceEntity) — no connection-name argument.
  // Verified against every existing @InjectRepository(WorkspaceEntity) call
  // site (e.g. create-company-and-contact.service.ts:45): none passes a
  // second connection-name argument, so the token is the plain, unqualified
  // one. Do not add 'core' — that would produce a different token than the
  // constructor's decorator resolves to and the provider would not match.

  beforeEach(async () => {
    jest.clearAllMocks();
    aiModelRegistryService.resolveModelForAgent.mockReturnValue({
      model: 'fake-model',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StructuredPersonFactExtractionService,
        {
          provide: IdentityResolutionService,
          useValue: identityResolutionService,
        },
        { provide: ProposalGateService, useValue: proposalGateService },
        { provide: FindRecordsService, useValue: findRecordsService },
        { provide: AiModelRegistryService, useValue: aiModelRegistryService },
        { provide: AiBillingService, useValue: aiBillingService },
        {
          provide: getRepositoryToken(WorkspaceEntity),
          useValue: workspaceRepository,
        },
        {
          provide: EvidenceRecordingService,
          useValue: evidenceRecordingService,
        },
      ],
    })
      .overrideProvider(AiModelRegistryService)
      .useValue(aiModelRegistryService)
      .compile();

    service = module.get<StructuredPersonFactExtractionService>(
      StructuredPersonFactExtractionService,
    );
  });

  it('should do nothing when the model reports no facts', async () => {
    generateObject.mockResolvedValue({
      object: { facts: [] },
      usage: { inputTokens: 10, outputTokens: 5 },
    });

    await service.extractJobTitleChanges({
      workspaceId: 'workspace-1',
      sourceType: 'message',
      sourceId: 'msg-1',
      text: 'Just checking in.',
      participantEmails: ['jane@acme.com'],
    });

    expect(proposalGateService.createFromExtraction).not.toHaveBeenCalled();
  });

  it('should skip a fact whose person is not an EXACT identity match', async () => {
    generateObject.mockResolvedValue({
      object: {
        facts: [
          {
            personEmail: 'jane@acme.com',
            newJobTitle: 'VP Sales',
            excerpt: 'I just got promoted to VP Sales',
          },
        ],
      },
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    identityResolutionService.resolvePerson.mockResolvedValue({
      kind: 'CANDIDATE',
      recordId: 'person-1',
      explanation: 'unconfirmed',
    });

    await service.extractJobTitleChanges({
      workspaceId: 'workspace-1',
      sourceType: 'message',
      sourceId: 'msg-1',
      text: 'I just got promoted to VP Sales',
      participantEmails: ['jane@acme.com'],
    });

    expect(proposalGateService.createFromExtraction).not.toHaveBeenCalled();
  });

  it('should propose an UPDATE_RECORD when the job title changed for an EXACT match', async () => {
    generateObject.mockResolvedValue({
      object: {
        facts: [
          {
            personEmail: 'jane@acme.com',
            newJobTitle: 'VP Sales',
            excerpt: 'I just got promoted to VP Sales',
          },
        ],
      },
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    identityResolutionService.resolvePerson.mockResolvedValue({
      kind: 'EXACT',
      recordId: 'person-1',
      matchedOn: 'email match',
    });
    findRecordsService.execute.mockResolvedValue({
      success: true,
      message: 'ok',
      result: { records: [{ id: 'person-1', jobTitle: 'Sales Manager' }] },
    });

    await service.extractJobTitleChanges({
      workspaceId: 'workspace-1',
      sourceType: 'message',
      sourceId: 'msg-1',
      text: 'I just got promoted to VP Sales',
      participantEmails: ['jane@acme.com'],
    });

    expect(proposalGateService.createFromExtraction).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        sourceKey: 'ingestion:message:msg-1',
        items: [
          expect.objectContaining({
            actionType: 'UPDATE_RECORD',
            objectNameSingular: 'person',
            recordId: 'person-1',
            payload: { jobTitle: 'VP Sales' },
            baseline: { jobTitle: 'Sales Manager' },
          }),
        ],
      }),
    );
  });

  // C8 / program integration: evidence must be recorded before the proposal
  // is created, for exactly the EXACT-matched fact, with the source type the
  // sourceType param maps to.
  it('should record evidence for each extracted fact before creating the proposal', async () => {
    generateObject.mockResolvedValue({
      object: {
        facts: [
          {
            personEmail: 'jane@acme.com',
            newJobTitle: 'VP Sales',
            excerpt: 'I just got promoted to VP Sales',
          },
        ],
      },
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    identityResolutionService.resolvePerson.mockResolvedValue({
      kind: 'EXACT',
      recordId: 'person-1',
      matchedOn: 'email match',
    });
    findRecordsService.execute.mockResolvedValue({
      success: true,
      message: 'ok',
      result: { records: [{ id: 'person-1', jobTitle: 'Sales Manager' }] },
    });

    await service.extractJobTitleChanges({
      workspaceId: 'workspace-1',
      sourceType: 'message',
      sourceId: 'msg-1',
      text: 'I just got promoted to VP Sales',
      participantEmails: ['jane@acme.com'],
    });

    expect(evidenceRecordingService.recordEvidence).toHaveBeenCalledTimes(1);
    expect(evidenceRecordingService.recordEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        runId: null,
        objectNameSingular: 'person',
        recordId: 'person-1',
        sourceType: 'EMAIL_MESSAGE',
        sourceLocator: 'message:msg-1',
        payload: expect.objectContaining({
          fieldName: 'jobTitle',
          value: 'VP Sales',
        }),
      }),
    );
    // recordEvidence must run before the proposal is created, or
    // createFromExtraction's factLookupService.findCurrentFactIdsForFields
    // call would race the Fact this Evidence derives.
    expect(
      evidenceRecordingService.recordEvidence.mock.invocationCallOrder[0],
    ).toBeLessThan(
      proposalGateService.createFromExtraction.mock.invocationCallOrder[0],
    );
  });

  it('should use CALL_RECORDING as the evidence source type for a call-recording source', async () => {
    generateObject.mockResolvedValue({
      object: {
        facts: [
          {
            personEmail: 'jane@acme.com',
            newJobTitle: 'VP Sales',
            excerpt: 'I just got promoted to VP Sales',
          },
        ],
      },
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    identityResolutionService.resolvePerson.mockResolvedValue({
      kind: 'EXACT',
      recordId: 'person-1',
      matchedOn: 'email match',
    });
    findRecordsService.execute.mockResolvedValue({
      success: true,
      message: 'ok',
      result: { records: [{ id: 'person-1', jobTitle: 'Sales Manager' }] },
    });

    await service.extractJobTitleChanges({
      workspaceId: 'workspace-1',
      sourceType: 'call-recording',
      sourceId: 'call-1',
      text: 'I just got promoted to VP Sales',
      participantEmails: ['jane@acme.com'],
    });

    expect(evidenceRecordingService.recordEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: 'CALL_RECORDING',
        sourceLocator: 'call-recording:call-1',
      }),
    );
  });

  it('should not record evidence when the identity match is not EXACT', async () => {
    generateObject.mockResolvedValue({
      object: {
        facts: [
          {
            personEmail: 'jane@acme.com',
            newJobTitle: 'VP Sales',
            excerpt: 'I just got promoted to VP Sales',
          },
        ],
      },
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    identityResolutionService.resolvePerson.mockResolvedValue({
      kind: 'CANDIDATE',
      recordId: 'person-1',
      explanation: 'unconfirmed',
    });

    await service.extractJobTitleChanges({
      workspaceId: 'workspace-1',
      sourceType: 'message',
      sourceId: 'msg-1',
      text: 'I just got promoted to VP Sales',
      participantEmails: ['jane@acme.com'],
    });

    expect(evidenceRecordingService.recordEvidence).not.toHaveBeenCalled();
  });

  it('should skip a fact whose value already matches the current record', async () => {
    generateObject.mockResolvedValue({
      object: {
        facts: [
          {
            personEmail: 'jane@acme.com',
            newJobTitle: 'VP Sales',
            excerpt: 'Still VP Sales here',
          },
        ],
      },
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    identityResolutionService.resolvePerson.mockResolvedValue({
      kind: 'EXACT',
      recordId: 'person-1',
      matchedOn: 'email match',
    });
    findRecordsService.execute.mockResolvedValue({
      success: true,
      message: 'ok',
      result: { records: [{ id: 'person-1', jobTitle: 'VP Sales' }] },
    });

    await service.extractJobTitleChanges({
      workspaceId: 'workspace-1',
      sourceType: 'message',
      sourceId: 'msg-1',
      text: 'Still VP Sales here',
      participantEmails: ['jane@acme.com'],
    });

    expect(proposalGateService.createFromExtraction).not.toHaveBeenCalled();
  });

  it('should bill usage for the extraction call', async () => {
    generateObject.mockResolvedValue({
      object: { facts: [] },
      usage: { inputTokens: 10, outputTokens: 5 },
    });

    await service.extractJobTitleChanges({
      workspaceId: 'workspace-1',
      sourceType: 'message',
      sourceId: 'msg-1',
      text: 'Just checking in.',
      participantEmails: ['jane@acme.com'],
    });

    expect(aiBillingService.calculateAndBillUsage).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run it, see it fail**

```bash
cd packages/searm-server && npx jest structured-person-fact-extraction.service.spec
```

Expected: FAIL — module not found.

- [ ] **Step 4: Write the service**

Before writing the implementation, open `src/engine/metadata-modules/ai/ai-generate-text/controllers/ai-generate-text.controller.ts` (already read in full during planning) to confirm `AiModelRegistryService.resolveModelForAgent({ modelId })` and `AiBillingService.calculateAndBillUsage(modelId, billingInput, workspaceId, operationType, agentId, userWorkspaceId)` signatures still match what is written below — both were verified on disk at planning time. `@InjectRepository(WorkspaceEntity)` takes no connection-name argument (N4, verified against `create-company-and-contact.service.ts:45` and 70+ other call sites) — the block below uses it exactly that way.

Create `services/structured-person-fact-extraction.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { generateObject } from 'ai';
import { FieldActorSource } from 'searm-shared/types';
import { isDefined } from 'searm-shared/utils';
import { type Repository } from 'typeorm';
import { z } from 'zod';

import { UsageOperationType } from 'src/engine/core-modules/usage/enums/usage-operation-type.enum';
import { FindRecordsService } from 'src/engine/core-modules/record-crud/services/find-records.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { buildSystemAuthContext } from 'src/engine/searm-orm/utils/build-system-auth-context.util';
import { AiBillingService } from 'src/engine/metadata-modules/ai/ai-billing/services/ai-billing.service';
import { AiModelRegistryService } from 'src/engine/metadata-modules/ai/ai-models/services/ai-model-registry.service';
import { EvidenceRecordingService } from 'src/engine/metadata-modules/ai/ai-research/services/evidence-recording.service';
import { ProposalActionType } from 'src/engine/metadata-modules/ai/ai-write-approval/types/proposal-status.type';
import { ProposalGateService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-gate.service';
import { IdentityResolutionService } from 'src/modules/match-participant/services/identity-resolution.service';

const extractedFactsSchema = z.object({
  facts: z.array(
    z.object({
      personEmail: z
        .string()
        .email()
        .describe('Must be one of the participant emails provided, never invented.'),
      newJobTitle: z
        .string()
        .describe('Only report this if the text explicitly states a new job title or promotion.'),
      excerpt: z
        .string()
        .describe('The verbatim sentence from the source text that supports this claim.'),
    }),
  ),
});

@Injectable()
export class StructuredPersonFactExtractionService {
  private readonly logger = new Logger(StructuredPersonFactExtractionService.name);

  constructor(
    private readonly identityResolutionService: IdentityResolutionService,
    private readonly proposalGateService: ProposalGateService,
    private readonly findRecordsService: FindRecordsService,
    private readonly aiModelRegistryService: AiModelRegistryService,
    private readonly aiBillingService: AiBillingService,
    private readonly evidenceRecordingService: EvidenceRecordingService,
    // No connection-name argument — matches every other
    // @InjectRepository(WorkspaceEntity) call site on disk (N4).
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
  ) {}

  async extractJobTitleChanges(params: {
    workspaceId: string;
    sourceType: 'message' | 'call-recording';
    sourceId: string;
    text: string;
    participantEmails: string[];
  }): Promise<void> {
    const { workspaceId, sourceType, sourceId, text, participantEmails } = params;

    if (text.trim().length === 0 || participantEmails.length === 0) {
      return;
    }

    const workspace = await this.workspaceRepository.findOne({
      where: { id: workspaceId },
    });

    if (!isDefined(workspace)) {
      return;
    }

    const registeredModel = this.aiModelRegistryService.resolveModelForAgent({
      modelId: workspace.fastModel,
    });

    const result = await generateObject({
      model: registeredModel.model,
      schema: extractedFactsSchema,
      system:
        'You extract only explicit, stated job-title changes from CRM communication ' +
        'text. Never infer, guess, or extrapolate. If nothing is explicitly stated, ' +
        'return an empty facts array. personEmail must be exactly one of the given ' +
        'participant emails.',
      prompt: `Participant emails: ${participantEmails.join(', ')}\n\nText:\n${text}`,
    });

    await this.aiBillingService.calculateAndBillUsage(
      workspace.fastModel,
      { usage: result.usage },
      workspaceId,
      UsageOperationType.AI_WORKFLOW_TOKEN,
    );

    const facts = result.object.facts.filter((fact) =>
      participantEmails.includes(fact.personEmail),
    );

    if (facts.length === 0) {
      return;
    }

    const items: {
      actionType: ProposalActionType;
      objectNameSingular: string;
      recordId: string | null;
      payload: Record<string, unknown>;
      baseline: Record<string, unknown>;
    }[] = [];
    const excerpts: string[] = [];

    for (const fact of facts) {
      const match = await this.identityResolutionService.resolvePerson({
        workspaceId,
        email: fact.personEmail,
      });

      // Only an EXACT identity match may have its own record updated.
      // A CANDIDATE fact has nowhere confirmed to land — it is dropped, not
      // proposed against a guess. This never creates a new Person: extraction
      // updates known records, it does not originate them.
      if (match.kind !== 'EXACT') {
        continue;
      }

      const currentRecord = await this.readCurrentJobTitle(
        workspaceId,
        match.recordId,
      );

      if (!isDefined(currentRecord) || currentRecord.jobTitle === fact.newJobTitle) {
        continue;
      }

      // Program integration: the observation is persisted as first-class
      // Evidence before anything is proposed. recordEvidence() derives the
      // Fact internally (Phase 2 Task 2), so by the time createFromExtraction
      // runs, FactLookupService can attach real factIds to the item — the
      // charter's Evidence contract, not a reason-string approximation.
      await this.evidenceRecordingService.recordEvidence({
        workspaceId,
        runId: null,
        objectNameSingular: 'person',
        recordId: match.recordId,
        sourceType:
          sourceType === 'message' ? 'EMAIL_MESSAGE' : 'CALL_RECORDING',
        sourceLocator: `${sourceType}:${sourceId}`,
        extractor: 'structured-person-fact-extraction',
        payload: {
          fieldName: 'jobTitle',
          value: fact.newJobTitle,
          snippet: fact.excerpt,
        },
      });

      items.push({
        actionType: ProposalActionType.UPDATE_RECORD,
        objectNameSingular: 'person',
        recordId: match.recordId,
        payload: { jobTitle: fact.newJobTitle },
        baseline: { jobTitle: currentRecord.jobTitle },
      });
      excerpts.push(fact.excerpt);
    }

    if (items.length === 0) {
      return;
    }

    await this.proposalGateService.createFromExtraction({
      workspaceId,
      sourceKey: `ingestion:${sourceType}:${sourceId}`,
      reason: `Extracted from ${sourceType}: "${excerpts.join('" / "')}"`,
      createdByActor: {
        source:
          sourceType === 'message' ? FieldActorSource.EMAIL : FieldActorSource.CALENDAR,
        workspaceMemberId: null,
        name: 'Structured content extraction',
        context: {},
      },
      items,
    });
  }

  private async readCurrentJobTitle(
    workspaceId: string,
    personId: string,
  ): Promise<{ jobTitle: string | null } | null> {
    const output = await this.findRecordsService.execute({
      objectName: 'person',
      filter: { id: { eq: personId } },
      limit: 1,
      select: ['jobTitle'],
      shouldBuildEffectiveSelectFields: true,
      authContext: buildSystemAuthContext(workspaceId),
      rolePermissionConfig: { shouldBypassPermissionChecks: true },
    });

    if (!output.success) {
      this.logger.warn(`Could not read jobTitle for person ${personId}`);

      return null;
    }

    const records = (output.result as { records?: { jobTitle: string | null }[] })
      ?.records;

    return records?.[0] ?? null;
  }
}
```

- [ ] **Step 5: Run it, see it pass**

```bash
cd packages/searm-server && npx jest structured-person-fact-extraction.service.spec
```

Expected: PASS — all 8 `it` blocks (the 5 original plus C8's 3 evidence-recording tests).

- [ ] **Step 6: Write the message listener and job**

Create `jobs/message-structured-extraction.job.ts`:

```ts
import { Scope } from '@nestjs/common';

import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { GlobalWorkspaceOrmManager } from 'src/engine/searm-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/searm-orm/utils/build-system-auth-context.util';
import { StructuredPersonFactExtractionService } from 'src/modules/structured-extraction/services/structured-person-fact-extraction.service';
import { type MessageWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message.workspace-entity';

export type MessageStructuredExtractionJobData = {
  workspaceId: string;
  messageId: string;
};

@Processor({ queueName: MessageQueue.aiQueue, scope: Scope.REQUEST })
export class MessageStructuredExtractionJob {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly structuredPersonFactExtractionService: StructuredPersonFactExtractionService,
  ) {}

  @Process(MessageStructuredExtractionJob.name)
  async handle(data: MessageStructuredExtractionJobData): Promise<void> {
    const { workspaceId, messageId } = data;
    const authContext = buildSystemAuthContext(workspaceId);

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const messageRepository =
        await this.globalWorkspaceOrmManager.getRepository<MessageWorkspaceEntity>(
          workspaceId,
          'message',
          { shouldBypassPermissionChecks: true },
        );

      const message = await messageRepository.findOne({
        where: { id: messageId },
        relations: ['messageParticipants'],
      });

      if (!message) {
        return;
      }

      const participantEmails = (message.messageParticipants ?? [])
        .map((participant) => participant.handle)
        .filter((handle): handle is string => typeof handle === 'string');

      await this.structuredPersonFactExtractionService.extractJobTitleChanges({
        workspaceId,
        sourceType: 'message',
        sourceId: messageId,
        text: [message.subject, message.text].filter(Boolean).join('\n\n'),
        participantEmails,
      });
    }, authContext);
  }
}
```

Create `listeners/message-structured-extraction.listener.ts`:

```ts
import { Injectable } from '@nestjs/common';

import {
  type ObjectRecordCreateEvent,
} from 'searm-shared/database-events';

import { OnDatabaseBatchEvent } from 'src/engine/api/graphql/graphql-query-runner/decorators/on-database-batch-event.decorator';
import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';
import {
  MessageStructuredExtractionJob,
  type MessageStructuredExtractionJobData,
} from 'src/modules/structured-extraction/jobs/message-structured-extraction.job';
import { type MessageWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message.workspace-entity';

@Injectable()
export class MessageStructuredExtractionListener {
  constructor(
    @InjectMessageQueue(MessageQueue.aiQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {}

  @OnDatabaseBatchEvent('message', DatabaseEventAction.CREATED)
  async handleCreatedEvent(
    payload: WorkspaceEventBatch<ObjectRecordCreateEvent<MessageWorkspaceEntity>>,
  ) {
    for (const event of payload.events) {
      if (!event.properties.after.text && !event.properties.after.subject) {
        continue;
      }

      await this.messageQueueService.add<MessageStructuredExtractionJobData>(
        MessageStructuredExtractionJob.name,
        { workspaceId: payload.workspaceId, messageId: event.recordId },
      );
    }
  }
}
```

- [ ] **Step 7: Write the call-recording listener and job**

Create `jobs/call-recording-structured-extraction.job.ts`:

```ts
import { Scope } from '@nestjs/common';

import { isDefined } from 'searm-shared/utils';

import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { GlobalWorkspaceOrmManager } from 'src/engine/searm-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/searm-orm/utils/build-system-auth-context.util';
import { StructuredPersonFactExtractionService } from 'src/modules/structured-extraction/services/structured-person-fact-extraction.service';
import { type CallRecordingWorkspaceEntity } from 'src/modules/call-recording/standard-objects/call-recording.workspace-entity';
import { type CalendarEventParticipantWorkspaceEntity } from 'src/modules/calendar/common/standard-objects/calendar-event-participant.workspace-entity';

export type CallRecordingStructuredExtractionJobData = {
  workspaceId: string;
  callRecordingId: string;
};

@Processor({ queueName: MessageQueue.aiQueue, scope: Scope.REQUEST })
export class CallRecordingStructuredExtractionJob {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly structuredPersonFactExtractionService: StructuredPersonFactExtractionService,
  ) {}

  @Process(CallRecordingStructuredExtractionJob.name)
  async handle(data: CallRecordingStructuredExtractionJobData): Promise<void> {
    const { workspaceId, callRecordingId } = data;
    const authContext = buildSystemAuthContext(workspaceId);

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const callRecordingRepository =
        await this.globalWorkspaceOrmManager.getRepository<CallRecordingWorkspaceEntity>(
          workspaceId,
          'callRecording',
          { shouldBypassPermissionChecks: true },
        );

      const callRecording = await callRecordingRepository.findOne({
        where: { id: callRecordingId },
        relations: ['calendarEvent', 'calendarEvent.calendarEventParticipants'],
      });

      if (!isDefined(callRecording) || !isDefined(callRecording.summary?.markdown)) {
        return;
      }

      const participantEmails = (
        callRecording.calendarEvent?.calendarEventParticipants ??
        ([] as CalendarEventParticipantWorkspaceEntity[])
      )
        .map((participant) => participant.handle)
        .filter((handle): handle is string => typeof handle === 'string');

      await this.structuredPersonFactExtractionService.extractJobTitleChanges({
        workspaceId,
        sourceType: 'call-recording',
        sourceId: callRecordingId,
        text: callRecording.summary?.markdown ?? '',
        participantEmails,
      });
    }, authContext);
  }
}
```

Create `listeners/call-recording-structured-extraction.listener.ts`:

```ts
import { Injectable } from '@nestjs/common';

import { type ObjectRecordUpdateEvent } from 'searm-shared/database-events';

import { OnDatabaseBatchEvent } from 'src/engine/api/graphql/graphql-query-runner/decorators/on-database-batch-event.decorator';
import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';
import { CallRecordingStatus } from 'src/modules/call-recording/common/enums/call-recording-status.enum';
import { type CallRecordingWorkspaceEntity } from 'src/modules/call-recording/standard-objects/call-recording.workspace-entity';
import {
  CallRecordingStructuredExtractionJob,
  type CallRecordingStructuredExtractionJobData,
} from 'src/modules/structured-extraction/jobs/call-recording-structured-extraction.job';

@Injectable()
export class CallRecordingStructuredExtractionListener {
  constructor(
    @InjectMessageQueue(MessageQueue.aiQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {}

  @OnDatabaseBatchEvent('callRecording', DatabaseEventAction.UPDATED)
  async handleUpdatedEvent(
    payload: WorkspaceEventBatch<ObjectRecordUpdateEvent<CallRecordingWorkspaceEntity>>,
  ) {
    for (const event of payload.events) {
      const becameCompleted =
        event.properties.before.status !== CallRecordingStatus.COMPLETED &&
        event.properties.after.status === CallRecordingStatus.COMPLETED;

      if (!becameCompleted || !event.properties.after.summary?.markdown) {
        continue;
      }

      await this.messageQueueService.add<CallRecordingStructuredExtractionJobData>(
        CallRecordingStructuredExtractionJob.name,
        { workspaceId: payload.workspaceId, callRecordingId: event.recordId },
      );
    }
  }
}
```

- [ ] **Step 8: Add the queue and wire the module**

In `engine/core-modules/message-queue/message-queue.constants.ts`, confirm `aiQueue = 'ai-queue'` is already present (verified on disk during planning — no change needed here).

Create `structured-extraction.module.ts`:

```ts
import { Module } from '@nestjs/common';

import { AiBillingModule } from 'src/engine/metadata-modules/ai/ai-billing/ai-billing.module';
import { AiModelsModule } from 'src/engine/metadata-modules/ai/ai-models/ai-models.module';
import { AiResearchModule } from 'src/engine/metadata-modules/ai/ai-research/ai-research.module';
import { AiWriteApprovalModule } from 'src/engine/metadata-modules/ai/ai-write-approval/ai-write-approval.module';
import { RecordCrudModule } from 'src/engine/core-modules/record-crud/record-crud.module';
import { MatchParticipantModule } from 'src/modules/match-participant/match-participant.module';
import { CallRecordingStructuredExtractionJob } from 'src/modules/structured-extraction/jobs/call-recording-structured-extraction.job';
import { MessageStructuredExtractionJob } from 'src/modules/structured-extraction/jobs/message-structured-extraction.job';
import { CallRecordingStructuredExtractionListener } from 'src/modules/structured-extraction/listeners/call-recording-structured-extraction.listener';
import { MessageStructuredExtractionListener } from 'src/modules/structured-extraction/listeners/message-structured-extraction.listener';
import { StructuredPersonFactExtractionService } from 'src/modules/structured-extraction/services/structured-person-fact-extraction.service';

@Module({
  imports: [
    AiWriteApprovalModule,
    AiModelsModule,
    AiBillingModule,
    // C8 / program integration: StructuredPersonFactExtractionService
    // injects EvidenceRecordingService, which AiResearchModule exports
    // (Phase 2 Task 5 — verified against that plan's own module wiring,
    // since AiResearchModule does not exist on disk yet at Phase 3 planning
    // time, consistent with Phase 2 being a hard, first-shipped dependency).
    AiResearchModule,
    RecordCrudModule,
    MatchParticipantModule,
  ],
  providers: [
    StructuredPersonFactExtractionService,
    MessageStructuredExtractionJob,
    CallRecordingStructuredExtractionJob,
    MessageStructuredExtractionListener,
    CallRecordingStructuredExtractionListener,
  ],
})
export class StructuredExtractionModule {}
```

Confirm the exact module names `AiBillingModule`/`AiModelsModule` and their export lists by opening `ai-billing.module.ts`/`ai-models.module.ts` before wiring — both were listed but not opened line-by-line during planning. Register `StructuredExtractionModule` in whichever module aggregates the other `modules/messaging`/`modules/calendar` feature modules (confirm at implementation time — likely `app.module.ts` or a `modules.module.ts` barrel; grep for where `MessagingModule`/`CalendarModule` are imported and add a sibling import).

> **Program integration (Owner Decision 3, I11) — per-connected-account exclusion toggle.** Message text and call-recording summaries are sent to `workspace.fastModel` with no redaction. The owner decision accepts that exposure by default but requires a workspace to be able to opt a specific mailbox or calendar out of it. `ConnectedAccountEntity` (`engine/metadata-modules/connected-account/entities/connected-account.entity.ts`, verified on disk: core-schema TypeORM entity, columns include `handle`, `provider`, `userWorkspaceId`, `visibility`, no existing boolean toggle) gets one new column, and both listeners check it before enqueueing. This is real code, not a note — Steps 9 and 10 below.

- [ ] **Step 9: Add the exclusion column**

```bash
npx nx run searm-server:database:migrate:generate --name add-connected-account-exclude-from-ai-extraction --type fast
```

In `entities/connected-account.entity.ts`, add after `visibility`:

```ts
  // Owner Decision 3: message/call-recording content is sent to
  // workspace.fastModel for structured extraction (Task 4) with no
  // redaction. A workspace that does not want a specific mailbox or
  // calendar's content to leave the platform sets this true and every
  // extraction job for that account's messages/recordings is skipped
  // before any LLM call is made — not just gated on the resulting write.
  @Column({ type: 'boolean', nullable: false, default: false })
  excludeFromAiExtraction: boolean;
```

Fill the generated instance command's `up`/`down` (same shape as Task 1 Step 4):

```sql
-- up
ALTER TABLE "core"."connectedAccount" ADD COLUMN "excludeFromAiExtraction" boolean NOT NULL DEFAULT false;
-- down
ALTER TABLE "core"."connectedAccount" DROP COLUMN "excludeFromAiExtraction";
```

Add a settings mutation is explicitly cut here — this task ships the column and the enforcement; a UI toggle to set it is deliberately out of scope (see cut table) because Settings → Accounts is not otherwise touched by this phase. Set it via `updateConnectedAccount` if that mutation's input already accepts arbitrary column updates (confirm at implementation time), otherwise via direct SQL/admin panel until a UI is scoped.

- [ ] **Step 10: Enforce it in both listeners before enqueueing**

Both listeners fire on the *workspace* schema (`message`/`callRecording` are workspace entities) but the exclusion flag lives on the *core* schema (`ConnectedAccountEntity`), so each listener needs a lightweight core-schema lookup — resolved through the intermediate core-schema channel entity, not a second workspace query. `MessageChannelEntity.connectedAccountId` and `CalendarChannelEntity.connectedAccountId` are both verified on disk (`engine/metadata-modules/message-channel/entities/message-channel.entity.ts:168`, `engine/metadata-modules/calendar-channel/entities/calendar-channel.entity.ts:126`), and the workspace-schema association rows carry the channel id (`MessageChannelMessageAssociationWorkspaceEntity.messageChannelId`, `CalendarChannelEventAssociationWorkspaceEntity.calendarChannelId`, both verified on disk).

Add to `listeners/message-structured-extraction.listener.ts`:

```ts
  constructor(
    @InjectMessageQueue(MessageQueue.aiQueue)
    private readonly messageQueueService: MessageQueueService,
    // eslint-disable-next-line searm/prefer-workspace-scoped-repository
    @InjectRepository(MessageChannelMessageAssociationEntity)
    private readonly messageChannelMessageAssociationRepository: Repository<MessageChannelMessageAssociationEntity>,
    // eslint-disable-next-line searm/prefer-workspace-scoped-repository
    @InjectRepository(MessageChannelEntity)
    private readonly messageChannelRepository: Repository<MessageChannelEntity>,
    // eslint-disable-next-line searm/prefer-workspace-scoped-repository
    @InjectRepository(ConnectedAccountEntity)
    private readonly connectedAccountRepository: Repository<ConnectedAccountEntity>,
  ) {}

  @OnDatabaseBatchEvent('message', DatabaseEventAction.CREATED)
  async handleCreatedEvent(
    payload: WorkspaceEventBatch<ObjectRecordCreateEvent<MessageWorkspaceEntity>>,
  ) {
    for (const event of payload.events) {
      if (!event.properties.after.text && !event.properties.after.subject) {
        continue;
      }

      if (
        await this.isExcludedFromAiExtraction(payload.workspaceId, event.recordId)
      ) {
        continue;
      }

      await this.messageQueueService.add<MessageStructuredExtractionJobData>(
        MessageStructuredExtractionJob.name,
        { workspaceId: payload.workspaceId, messageId: event.recordId },
      );
    }
  }

  // Association rows are workspace-schema (messageChannelMessageAssociation
  // has no direct connectedAccountId); channel and connected-account rows
  // are core-schema. Three lookups, all cheap by primary key, done once per
  // message before enqueueing — never inside the job itself, so an excluded
  // account never reaches the LLM call at all.
  private async isExcludedFromAiExtraction(
    workspaceId: string,
    messageId: string,
  ): Promise<boolean> {
    const association = await this.messageChannelMessageAssociationRepository.findOne(
      { where: { messageId, workspaceId } as never },
    );

    if (!isDefined(association)) {
      return false;
    }

    const channel = await this.messageChannelRepository.findOne({
      where: { id: association.messageChannelId },
    });

    if (!isDefined(channel)) {
      return false;
    }

    const connectedAccount = await this.connectedAccountRepository.findOne({
      where: { id: channel.connectedAccountId },
    });

    return connectedAccount?.excludeFromAiExtraction ?? false;
  }
```

Add the corresponding imports (`InjectRepository` from `@nestjs/typeorm`, `Repository` from `typeorm`, `isDefined` from `searm-shared/utils`, `MessageChannelMessageAssociationEntity`/`MessageChannelEntity`/`ConnectedAccountEntity` from their entity files). Note `MessageChannelMessageAssociation` here is the **workspace**-schema entity (`modules/messaging/common/standard-objects/message-channel-message-association.workspace-entity.ts`) queried through `GlobalWorkspaceOrmManager`, not `@InjectRepository` — confirm which repository-access pattern the surrounding listener code already uses for workspace-schema reads (this file's `message` queries elsewhere in this task use `GlobalWorkspaceOrmManager.getRepository`, so match that, not a core `@InjectRepository`) and adjust the association lookup to that pattern; `messageChannelRepository`/`connectedAccountRepository` stay `@InjectRepository` because those two are core-schema.

Add the mirror check to `listeners/call-recording-structured-extraction.listener.ts`, resolving through `CalendarChannelEventAssociationWorkspaceEntity.calendarChannelId` → `CalendarChannelEntity.connectedAccountId` → `ConnectedAccountEntity.excludeFromAiExtraction` the same way, keyed off the call recording's `calendarEventId`.

Add to both spec files: *"should skip enqueueing when the connected account has excludeFromAiExtraction set"* (mock the association/channel/connected-account lookups to return `excludeFromAiExtraction: true`, assert `messageQueueService.add` / the job's queue call is not made) and *"should enqueue as normal when the account does not opt out"*.

- [ ] **Step 11: Run the full new suite plus regressions**

```bash
cd packages/searm-server && npx jest structured-extraction
```

Expected: PASS.

- [ ] **Step 12: Lint, typecheck, commit**

```bash
npx nx lint:diff-with-main searm-server
npx nx typecheck searm-server
git add packages/searm-server/src/modules/structured-extraction packages/searm-server/src/engine/metadata-modules/connected-account packages/searm-server/src/database
git commit -m "feat(ingestion): extract job-title changes from messages and call recordings as proposals, with a per-connected-account exclusion toggle"
```

---

### Task 5: Custom-field-aware AI tool schema

SeaRM's `generateRecordPropertiesZodSchema` (`engine/core-modules/record-crud/zod-schemas/record-properties.zod-schema.ts`, on disk) already turns `SELECT`/`MULTI_SELECT` options into a `z.enum()` of option **values** and already validates at the same edge every write goes through (a bad enum value hard-fails Zod parsing before the tool executes) — this already substantially satisfies the "resolve option values" half of the charter's metadata-aware tool requirement, and it is reused, not rebuilt. Two real gaps remain: (1) custom fields with no `field.description` give the model no context beyond a camelCase key, and select/relation fields don't tell the model the human-readable **label** for a value or which object a relation targets; (2) there is no lightweight, read-permission-gated (not `DATA_MODEL`-permission-gated, unlike `MetadataToolProvider`) way for an agent to ask "what custom fields does this object have" before it opens a create/update tool's full schema.

**Files:**
- Create: `packages/searm-server/src/engine/core-modules/record-crud/utils/describe-custom-field-for-tool-schema.util.ts`
- Create: `packages/searm-server/src/engine/core-modules/record-crud/utils/__tests__/describe-custom-field-for-tool-schema.util.spec.ts`
- Modify: `packages/searm-server/src/engine/core-modules/record-crud/zod-schemas/record-properties.zod-schema.ts`

**Interfaces:**
- Consumes: `FlatFieldMetadata` (on disk), `FieldMetadataType` (on disk), `WorkspaceManyOrAllFlatEntityMapsCacheService.getOrRecomputeManyOrAllFlatEntityMaps` (on disk, used identically by `database-tool.provider.ts`), `getFlatFieldsFromFlatObjectMetadata` (on disk).
- Produces:
  - `describeCustomFieldForToolSchema(field: FlatFieldMetadata, relationTargetLabel?: string): string` — the only public product of this task. The discovery-tool half was cut by the program review; see the note at Step 7.

- [ ] **Step 1: Write the failing test for the describer**

Create `utils/__tests__/describe-custom-field-for-tool-schema.util.spec.ts`:

```ts
import { FieldMetadataType } from 'searm-shared/types';

import { describeCustomFieldForToolSchema } from 'src/engine/core-modules/record-crud/utils/describe-custom-field-for-tool-schema.util';

const baseField = {
  name: 'industry',
  label: 'Industry',
  type: FieldMetadataType.SELECT,
  description: null,
  isCustom: true,
  isNullable: true,
  options: null,
} as never;

describe('describeCustomFieldForToolSchema', () => {
  it('should return the existing description unchanged when one is set', () => {
    const field = { ...baseField, description: 'The lead source industry.' };

    expect(describeCustomFieldForToolSchema(field)).toBe(
      'The lead source industry.',
    );
  });

  it('should list label/value pairs for a SELECT field with no description', () => {
    const field = {
      ...baseField,
      options: [
        { value: 'SAAS', label: 'SaaS' },
        { value: 'FINTECH', label: 'Fintech' },
      ],
    };

    const description = describeCustomFieldForToolSchema(field);

    expect(description).toContain('Industry');
    expect(description).toContain('SaaS (value: "SAAS")');
    expect(description).toContain('Fintech (value: "FINTECH")');
  });

  it('should describe a MULTI_SELECT field as accepting several values', () => {
    const field = {
      ...baseField,
      type: FieldMetadataType.MULTI_SELECT,
      options: [{ value: 'A', label: 'A label' }],
    };

    expect(describeCustomFieldForToolSchema(field)).toContain(
      'one or more of',
    );
  });

  it('should point a RELATION field at the target object and instruct a lookup first', () => {
    const field = {
      ...baseField,
      type: FieldMetadataType.RELATION,
      options: null,
    };

    const description = describeCustomFieldForToolSchema(field, 'opportunity');

    expect(description).toContain('opportunity');
    expect(description).toContain('find_one_opportunity');
  });

  it('should fall back to a plain label-based description for other custom field types with no description', () => {
    const field = { ...baseField, type: FieldMetadataType.TEXT, options: null };

    expect(describeCustomFieldForToolSchema(field)).toBe(
      'Custom field "Industry".',
    );
  });
});
```

- [ ] **Step 2: Run it, see it fail**

```bash
cd packages/searm-server && npx jest describe-custom-field-for-tool-schema.util.spec
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the util**

Create `utils/describe-custom-field-for-tool-schema.util.ts`:

```ts
import { FieldMetadataType } from 'searm-shared/types';
import { isDefined } from 'searm-shared/utils';

import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';

// SeaRM already turns SELECT/MULTI_SELECT options into a zod enum of VALUES
// and validates against it at the same edge every write goes through — that
// half of the charter's "resolve option values" requirement is already
// solved and is not rebuilt here. This only fills what a field.description-less
// custom field is missing: the human-readable label behind each value, and,
// for relations, which object the ID belongs to.
export const describeCustomFieldForToolSchema = (
  field: Pick<
    FlatFieldMetadata,
    'name' | 'label' | 'type' | 'description' | 'options'
  >,
  relationTargetLabel?: string,
): string => {
  if (isDefined(field.description) && field.description.length > 0) {
    return field.description;
  }

  if (
    field.type === FieldMetadataType.SELECT ||
    field.type === FieldMetadataType.MULTI_SELECT
  ) {
    const options = (field.options ?? []) as { value: string; label: string }[];

    if (options.length === 0) {
      return `Custom field "${field.label}".`;
    }

    const optionList = options
      .map((option) => `${option.label} (value: "${option.value}")`)
      .join(', ');

    const cardinality =
      field.type === FieldMetadataType.MULTI_SELECT
        ? 'one or more of'
        : 'exactly one of';

    return `Custom field "${field.label}". Pass ${cardinality}: ${optionList}.`;
  }

  if (
    field.type === FieldMetadataType.RELATION ||
    field.type === FieldMetadataType.MORPH_RELATION
  ) {
    if (!isDefined(relationTargetLabel)) {
      return `Custom field "${field.label}". This is a relation — the value must be the UUID of an existing target record.`;
    }

    return (
      `Custom field "${field.label}", linking to ${relationTargetLabel}. ` +
      `If you don't already know the target record's ID, call find_one_${relationTargetLabel} ` +
      `or find_many_${relationTargetLabel}s first to look it up — never guess an ID.`
    );
  }

  return `Custom field "${field.label}".`;
};
```

- [ ] **Step 4: Run it, see it pass**

```bash
cd packages/searm-server && npx jest describe-custom-field-for-tool-schema.util.spec
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Wire it into schema generation**

In `zod-schemas/record-properties.zod-schema.ts`, add the import:

```ts
import { describeCustomFieldForToolSchema } from 'src/engine/core-modules/record-crud/utils/describe-custom-field-for-tool-schema.util';
```

Replace the tail of the `forEach` body — the block starting `if (field.name === 'position') { ... } else if (field.description) { fieldSchema = fieldSchema.describe(field.description); }` — with:

```ts
    if (field.name === 'position') {
      fieldSchema = z.union([
        z.number(),
        z.literal('first'),
        z.literal('last'),
      ]);

      fieldSchema = fieldSchema.describe(
        'Use "first" to insert at the top, "last" for the bottom, or a number for explicit ordering. Leave empty to place at the top (recommended).',
      );
    } else if (field.isCustom) {
      fieldSchema = fieldSchema.describe(
        describeCustomFieldForToolSchema(field),
      );
    } else if (field.description) {
      fieldSchema = fieldSchema.describe(field.description);
    }
```

This only changes behavior for `field.isCustom === true` fields — every standard-object field keeps its exact current schema, so this is additive, not a regression risk to existing tool-calling behavior. The `relationTargetLabel` argument is intentionally omitted here: `objectMetadata.fields` in this file's scope does not carry the resolved target object label (only `relationTargetObjectMetadataId`), and resolving it would require threading `flatObjectMetadataMaps` through `generateRecordPropertiesZodSchema`'s call chain — a larger, riskier change than this task's KISS budget allows. The relation case above degrades gracefully to the ID-only description when `relationTargetLabel` is omitted; wiring the fully resolved label through is deliberately cut (see cut table).

- [ ] **Step 6: Run the existing schema-generation regression suite**

```bash
cd packages/searm-server && npx jest record-properties.zod-schema
cd packages/searm-server && npx jest generate-update-record-input-schema
cd packages/searm-server && npx jest generate-create-record-input-schema
```

Expected: PASS — these suites exercise standard fields (`field.isCustom` false), which take the unchanged `else if (field.description)` branch.

- [ ] **Step 7: (CUT by the program review) — metadata discovery is Phase 4's**

> **Program integration — duplicate collapsed.** The original Steps 7–11 built a new `DescribeCustomFieldsToolProvider` exposing one `describe_custom_fields_<object>` tool **per object**. That duplicates metadata discovery, which Phase 4 Task 8 already owns, and it inflates the tool catalog by one entry per object on top of the CRUD tools `database-tool.provider.ts` already generates per object.
>
> The real gap this plan correctly identified is **not** "there is no discovery tool" — `get_object_metadata` exists — it is that `MetadataToolProvider.isAvailable()` hard-gates the entire provider behind `PermissionFlagType.DATA_MODEL` (verified on disk), so an agent with record-read permission but no schema-admin permission cannot discover custom fields at all.
>
> That gap is now closed inside **Phase 4 Task 8**, which was extended to: (a) relax `MetadataToolProvider.isAvailable()` to also admit a role with any object read permission, and (b) permission-scope both `ObjectMetadataToolsFactory` and `FieldMetadataToolsFactory` output to the objects and fields that role can actually read, annotated with `permittedOperations`. One tool, correctly scoped, instead of N new ones.
>
> **Nothing is lost from this plan:** Steps 1–6 above (the `describeCustomFieldForToolSchema` describer wired into `generateRecordPropertiesZodSchema`) are the genuinely novel, relaticle-derived part and they stay. `get_object_metadata` returns each field's `description`, which for a custom field is now the enriched, label-and-option-bearing string Step 5 produces — so the discovery answer improves for free.
>
> **Files removed from this task:** `tools/describe-custom-fields-tool.provider.ts`, `tools/__tests__/describe-custom-fields-tool.provider.spec.ts`, and the `tool-provider.module.ts` registration line in this plan's File Structure table.


- [ ] **Step 8: Lint, typecheck, commit** (I12: steps were numbered 1–7 then jumped to a stale "Step 12" — the cut Step 7 above absorbed the original Steps 7–11, so this is Step 8, not 12)

```bash
npx nx lint:diff-with-main searm-server
npx nx typecheck searm-server
git add packages/searm-server/src/engine/core-modules/record-crud
git commit -m "feat(tools): describe custom fields for agent tool schemas"
```

---

### Task 6: Guided import staging entities and batch creation

Per `docs/superpowers/scouting/relaticle-scout.md` §2.1: stage the whole import in a disposable store; only touch production tables at execute time. SeaRM's stack is Postgres-only (no per-import SQLite file, unlike the scouted reference) — the staging store is two new core-schema tables, following the exact `ProposalEntity`/`ProposalItemEntity` precedent (plain TypeORM entities, not workspace objects — this is platform infrastructure, never customer-visible as a CRM record).

**Files:**
- Create: `packages/searm-server/src/modules/guided-import/types/import-batch-status.type.ts`
- Create: `packages/searm-server/src/modules/guided-import/entities/import-batch.entity.ts`
- Create: `packages/searm-server/src/modules/guided-import/entities/import-row.entity.ts`
- Create: an instance command (generated)
- Create: `packages/searm-server/src/modules/guided-import/dtos/import-batch.dto.ts`
- Create: `packages/searm-server/src/modules/guided-import/dtos/create-import-batch.input.ts`
- Create: `packages/searm-server/src/modules/guided-import/resolvers/import-batch.resolver.ts`
- Create: `packages/searm-server/src/modules/guided-import/resolvers/__tests__/import-batch.resolver.spec.ts`
- Create: `packages/searm-server/src/modules/guided-import/guided-import.module.ts`

**Interfaces:**
- Produces: `ImportBatchEntity`, `ImportRowEntity`, `ImportBatchStatus`, `ImportRowStatus`, `ImportRowMatchAction` — consumed by Tasks 7, 8, 9, 10. GraphQL `createImportBatch(input: CreateImportBatchInput!): ImportBatchDTO!`.

- [ ] **Step 1: Write the status types**

Create `types/import-batch-status.type.ts`:

```ts
export enum ImportBatchStatus {
  // Rows staged, mapping already confirmed by the frontend wizard.
  PENDING = 'PENDING',
  // Task 8's validation pass has run; every row has a matchAction and a
  // validationErrors verdict.
  READY = 'READY',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum ImportRowStatus {
  PENDING = 'PENDING',
  PROCESSED = 'PROCESSED',
  FAILED = 'FAILED',
}

// CREATE/UPDATE: EXACT identity match or no match at all — safe to write
// directly, same as a human filling the form by hand. PROPOSE: a CANDIDATE
// identity match — the row becomes a ProposalItem instead. SKIP: the
// reviewer excluded the row (or mapping produced no writable fields).
export enum ImportRowMatchAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  PROPOSE = 'PROPOSE',
  SKIP = 'SKIP',
}
```

- [ ] **Step 2: Write the entities**

Create `entities/import-batch.entity.ts`, following the shape of `proposal.entity.ts` (on disk):

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn,
} from 'typeorm';

import { ImportBatchStatus } from 'src/modules/guided-import/types/import-batch-status.type';
import type { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

@Entity({ name: 'importBatch', schema: 'core' })
export class ImportBatchEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: false, type: 'uuid' })
  @Index()
  workspaceId: string;

  @ManyToOne('WorkspaceEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspaceId' })
  workspace: Relation<WorkspaceEntity>;

  @Column({ type: 'varchar' })
  objectNameSingular: string;

  @Column({ type: 'varchar' })
  fileName: string;

  @Column({ type: 'varchar', default: ImportBatchStatus.PENDING })
  @Index()
  status: ImportBatchStatus;

  // Column key (CSV header) -> object field name. Set once mapping is
  // confirmed (Task 7), read at execution time (Task 9).
  @Column({ type: 'jsonb', nullable: true })
  mappingConfig: Record<string, string> | null;

  @Column({ type: 'int', default: 0 })
  totalRows: number;

  @Column({ type: 'int', default: 0 })
  processedRows: number;

  @Column({ type: 'int', default: 0 })
  createdRowCount: number;

  @Column({ type: 'int', default: 0 })
  updatedRowCount: number;

  @Column({ type: 'int', default: 0 })
  proposedRowCount: number;

  @Column({ type: 'int', default: 0 })
  skippedRowCount: number;

  @Column({ type: 'int', default: 0 })
  failedRowCount: number;

  @Column({ type: 'uuid', nullable: true })
  createdByUserWorkspaceId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
```

Create `entities/import-row.entity.ts`:

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn,
} from 'typeorm';

import { ImportBatchEntity } from 'src/modules/guided-import/entities/import-batch.entity';
import {
  ImportRowMatchAction,
  ImportRowStatus,
} from 'src/modules/guided-import/types/import-batch-status.type';

@Entity({ name: 'importRow', schema: 'core' })
@Index(['importBatchId', 'status'])
export class ImportRowEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: false, type: 'uuid' })
  @Index()
  importBatchId: string;

  @ManyToOne(() => ImportBatchEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'importBatchId' })
  importBatch: Relation<ImportBatchEntity>;

  @Column({ type: 'int' })
  rowNumber: number;

  // The uploaded row, keyed by original CSV header, before mapping.
  @Column({ type: 'jsonb' })
  rawData: Record<string, unknown>;

  // rawData translated through mappingConfig into object field names. Set by
  // Task 7's mapping step.
  @Column({ type: 'jsonb', nullable: true })
  mappedData: Record<string, unknown> | null;

  @Column({ type: 'varchar', nullable: true })
  matchAction: ImportRowMatchAction | null;

  @Column({ type: 'uuid', nullable: true })
  matchedRecordId: string | null;

  // Per-field validation errors, e.g. { "email": "not a valid email" }. Empty
  // object means the row passed validation. Null means not yet validated.
  @Column({ type: 'jsonb', nullable: true })
  validationErrors: Record<string, string> | null;

  @Column({ type: 'varchar', default: ImportRowStatus.PENDING })
  status: ImportRowStatus;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  processedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
```

- [ ] **Step 3: Generate and fill the instance command**

```bash
npx nx run searm-server:database:migrate:generate --name add-guided-import --type fast
```

Fill `up`:

```sql
CREATE TABLE "core"."importBatch" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" uuid NOT NULL,
  "objectNameSingular" varchar NOT NULL,
  "fileName" varchar NOT NULL,
  "status" varchar NOT NULL DEFAULT 'PENDING',
  "mappingConfig" jsonb,
  "totalRows" int NOT NULL DEFAULT 0,
  "processedRows" int NOT NULL DEFAULT 0,
  "createdRowCount" int NOT NULL DEFAULT 0,
  "updatedRowCount" int NOT NULL DEFAULT 0,
  "proposedRowCount" int NOT NULL DEFAULT 0,
  "skippedRowCount" int NOT NULL DEFAULT 0,
  "failedRowCount" int NOT NULL DEFAULT 0,
  "createdByUserWorkspaceId" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "PK_importBatch" PRIMARY KEY ("id"),
  CONSTRAINT "FK_importBatch_workspace" FOREIGN KEY ("workspaceId")
    REFERENCES "core"."workspace"("id") ON DELETE CASCADE
);
CREATE INDEX "IDX_importBatch_workspaceId" ON "core"."importBatch" ("workspaceId");
CREATE INDEX "IDX_importBatch_status" ON "core"."importBatch" ("status");

CREATE TABLE "core"."importRow" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "importBatchId" uuid NOT NULL,
  "rowNumber" int NOT NULL,
  "rawData" jsonb NOT NULL,
  "mappedData" jsonb,
  "matchAction" varchar,
  "matchedRecordId" uuid,
  "validationErrors" jsonb,
  "status" varchar NOT NULL DEFAULT 'PENDING',
  "errorMessage" text,
  "processedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "PK_importRow" PRIMARY KEY ("id"),
  CONSTRAINT "FK_importRow_importBatch" FOREIGN KEY ("importBatchId")
    REFERENCES "core"."importBatch"("id") ON DELETE CASCADE
);
CREATE INDEX "IDX_importRow_importBatchId" ON "core"."importRow" ("importBatchId");
CREATE INDEX "IDX_importRow_importBatchId_status" ON "core"."importRow" ("importBatchId", "status");
```

And `down`:

```sql
DROP TABLE "core"."importRow";
DROP TABLE "core"."importBatch";
```

- [ ] **Step 4: Apply and verify**

```bash
npx nx run searm-server:database:migrate:prod
psql "$PG_DATABASE_URL" -c '\d core."importBatch"' -c '\d core."importRow"'
```

- [ ] **Step 5: Write the DTOs**

Create `dtos/create-import-batch.input.ts`:

```ts
import { Field, InputType } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-type-json';

@InputType()
export class CreateImportBatchInput {
  @Field(() => String)
  objectNameSingular: string;

  @Field(() => String)
  fileName: string;

  // One element per row, keyed by original CSV header — kept verbatim so a
  // failed row can be re-exported in the format the user re-uploads (Task 10).
  @Field(() => [GraphQLJSON])
  rawRows: Record<string, unknown>[];

  // Same rows, index-aligned with rawRows, already translated into SeaRM
  // object-field shape by the existing frontend mapping wizard
  // (buildRecordFromImportedStructuredRow — on disk today, already handles
  // composite fields: emails, address, fullName, links, currency, phones).
  // The backend does not re-derive this: duplicating composite-field
  // translation server-side would be a second, divergent implementation of
  // logic that already works. See Task 7.
  @Field(() => [GraphQLJSON])
  mappedRows: Record<string, unknown>[];

  // header -> object field name, for display only (the "how did this file
  // map" summary shown in the review step).
  @Field(() => GraphQLJSON)
  columnMapping: Record<string, string>;
}
```

Create `dtos/import-batch.dto.ts`:

```ts
import { Field, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';

import { ImportBatchStatus } from 'src/modules/guided-import/types/import-batch-status.type';

registerEnumType(ImportBatchStatus, { name: 'ImportBatchStatus' });

@ObjectType('ImportBatch')
export class ImportBatchDTO {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  objectNameSingular: string;

  @Field(() => String)
  fileName: string;

  @Field(() => ImportBatchStatus)
  status: ImportBatchStatus;

  @Field(() => Int)
  totalRows: number;

  @Field(() => Int)
  processedRows: number;

  @Field(() => Int)
  createdRowCount: number;

  @Field(() => Int)
  updatedRowCount: number;

  @Field(() => Int)
  proposedRowCount: number;

  @Field(() => Int)
  skippedRowCount: number;

  @Field(() => Int)
  failedRowCount: number;
}
```

- [ ] **Step 6: Write the failing resolver test**

Create `resolvers/__tests__/import-batch.resolver.spec.ts`:

```ts
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ImportBatchEntity } from 'src/modules/guided-import/entities/import-batch.entity';
import { ImportRowEntity } from 'src/modules/guided-import/entities/import-row.entity';
import { ImportBatchResolver } from 'src/modules/guided-import/resolvers/import-batch.resolver';

describe('ImportBatchResolver', () => {
  let resolver: ImportBatchResolver;

  const importBatchRepository = { save: jest.fn(), findOne: jest.fn() };
  const importRowRepository = { insert: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    importBatchRepository.save.mockImplementation(async (entity) => ({
      ...entity,
      id: 'batch-1',
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportBatchResolver,
        {
          provide: getRepositoryToken(ImportBatchEntity, 'core'),
          useValue: importBatchRepository,
        },
        {
          provide: getRepositoryToken(ImportRowEntity, 'core'),
          useValue: importRowRepository,
        },
      ],
    }).compile();

    resolver = module.get<ImportBatchResolver>(ImportBatchResolver);
  });

  it('should create a PENDING batch and stage every row', async () => {
    const result = await resolver.createImportBatch(
      {
        objectNameSingular: 'person',
        fileName: 'contacts.csv',
        rawRows: [{ Email: 'a@example.com' }, { Email: 'b@example.com' }],
        mappedRows: [
          { emails: { primaryEmail: 'a@example.com' } },
          { emails: { primaryEmail: 'b@example.com' } },
        ],
        columnMapping: { Email: 'emails.primaryEmail' },
      },
      { id: 'workspace-1' } as never,
      'user-workspace-1',
    );

    expect(importBatchRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        objectNameSingular: 'person',
        fileName: 'contacts.csv',
        status: 'PENDING',
        totalRows: 2,
        createdByUserWorkspaceId: 'user-workspace-1',
      }),
    );
    expect(importRowRepository.insert).toHaveBeenCalledWith([
      expect.objectContaining({
        importBatchId: 'batch-1',
        rowNumber: 1,
        rawData: { Email: 'a@example.com' },
        mappedData: { emails: { primaryEmail: 'a@example.com' } },
      }),
      expect.objectContaining({
        importBatchId: 'batch-1',
        rowNumber: 2,
        rawData: { Email: 'b@example.com' },
        mappedData: { emails: { primaryEmail: 'b@example.com' } },
      }),
    ]);
    expect(result.id).toBe('batch-1');
    expect(result.totalRows).toBe(2);
  });

  it('should reject an empty file', async () => {
    await expect(
      resolver.createImportBatch(
        {
          objectNameSingular: 'person',
          fileName: 'empty.csv',
          rawRows: [],
          mappedRows: [],
          columnMapping: {},
        },
        { id: 'workspace-1' } as never,
        'user-workspace-1',
      ),
    ).rejects.toThrow();

    expect(importBatchRepository.save).not.toHaveBeenCalled();
  });

  it('should reject mismatched rawRows/mappedRows lengths', async () => {
    await expect(
      resolver.createImportBatch(
        {
          objectNameSingular: 'person',
          fileName: 'contacts.csv',
          rawRows: [{ Email: 'a@example.com' }],
          mappedRows: [],
          columnMapping: {},
        },
        { id: 'workspace-1' } as never,
        'user-workspace-1',
      ),
    ).rejects.toThrow();

    expect(importBatchRepository.save).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Run it, see it fail**

```bash
cd packages/searm-server && npx jest import-batch.resolver.spec
```

Expected: FAIL — module not found.

- [ ] **Step 8: Write the resolver**

Create `resolvers/import-batch.resolver.ts`:

```ts
import { BadRequestException, UseGuards } from '@nestjs/common';
import { Args, Mutation } from '@nestjs/graphql';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { type FlatWorkspace } from 'src/engine/core-modules/workspace/types/flat-workspace.type';
import { AuthUserWorkspaceId } from 'src/engine/decorators/auth/auth-user-workspace-id.decorator';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { CreateImportBatchInput } from 'src/modules/guided-import/dtos/create-import-batch.input';
import { ImportBatchDTO } from 'src/modules/guided-import/dtos/import-batch.dto';
import { ImportBatchEntity } from 'src/modules/guided-import/entities/import-batch.entity';
import { ImportRowEntity } from 'src/modules/guided-import/entities/import-row.entity';
import { ImportBatchStatus } from 'src/modules/guided-import/types/import-batch-status.type';

@UseGuards(WorkspaceAuthGuard)
@MetadataResolver()
export class ImportBatchResolver {
  constructor(
    // eslint-disable-next-line searm/prefer-workspace-scoped-repository
    @InjectRepository(ImportBatchEntity, 'core')
    private readonly importBatchRepository: Repository<ImportBatchEntity>,
    // eslint-disable-next-line searm/prefer-workspace-scoped-repository
    @InjectRepository(ImportRowEntity, 'core')
    private readonly importRowRepository: Repository<ImportRowEntity>,
  ) {}

  @Mutation(() => ImportBatchDTO)
  async createImportBatch(
    @Args('input') input: CreateImportBatchInput,
    @AuthWorkspace() workspace: FlatWorkspace,
    @AuthUserWorkspaceId() userWorkspaceId: string,
  ): Promise<ImportBatchDTO> {
    if (input.rawRows.length === 0) {
      throw new BadRequestException('Cannot import an empty file.');
    }

    if (input.rawRows.length !== input.mappedRows.length) {
      throw new BadRequestException(
        'rawRows and mappedRows must be the same length.',
      );
    }

    const batch = await this.importBatchRepository.save({
      workspaceId: workspace.id,
      objectNameSingular: input.objectNameSingular,
      fileName: input.fileName,
      status: ImportBatchStatus.PENDING,
      mappingConfig: input.columnMapping,
      totalRows: input.rawRows.length,
      createdByUserWorkspaceId: userWorkspaceId,
    });

    await this.importRowRepository.insert(
      input.rawRows.map((row, index) => ({
        importBatchId: batch.id,
        rowNumber: index + 1,
        rawData: row,
        mappedData: input.mappedRows[index],
      })),
    );

    return batch as unknown as ImportBatchDTO;
  }
}
```

- [ ] **Step 9: Run it, see it pass**

```bash
cd packages/searm-server && npx jest import-batch.resolver.spec
```

Expected: PASS, 2 tests.

- [ ] **Step 10: Wire the module**

Create `guided-import.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ImportBatchEntity } from 'src/modules/guided-import/entities/import-batch.entity';
import { ImportRowEntity } from 'src/modules/guided-import/entities/import-row.entity';
import { ImportBatchResolver } from 'src/modules/guided-import/resolvers/import-batch.resolver';

@Module({
  imports: [TypeOrmModule.forFeature([ImportBatchEntity, ImportRowEntity], 'core')],
  providers: [ImportBatchResolver],
})
export class GuidedImportModule {}
```

(Tasks 7–10 add more providers and imports to this module as they land — do not remove anything already here.)

Register `GuidedImportModule` in whichever module aggregates other core-schema feature modules (the same place `AiWriteApprovalModule` is registered — confirm at implementation time).

- [ ] **Step 11: Lint, typecheck, commit**

```bash
npx nx lint:diff-with-main searm-server
npx nx typecheck searm-server
git add packages/searm-server/src/modules/guided-import packages/searm-server/src/database
git commit -m "feat(import): add guided import staging entities and batch creation"
```

---

### Task 7: Per-row identity match resolution

Mapping inference is already solved client-side (see Task 6's rationale) — the backend capability genuinely missing is duplicate detection: deciding, per staged row, whether it matches an existing record. This reuses `IdentityResolutionService` from Task 2 exactly as Tasks 3/4 do — same EXACT/CANDIDATE/NONE verdict, same explainability, same rule (a CANDIDATE never writes silently).

**Files:**
- Create: `packages/searm-server/src/modules/guided-import/services/import-match-resolution.service.ts`
- Create: `packages/searm-server/src/modules/guided-import/services/__tests__/import-match-resolution.service.spec.ts`
- Modify: `packages/searm-server/src/modules/guided-import/guided-import.module.ts`

**Interfaces:**
- Consumes: `IdentityResolutionService.resolvePerson` / `.resolveCompany` (Task 2), `ImportRowEntity`/`ImportBatchEntity` (Task 6).
- Produces: `ImportMatchResolutionService.resolveBatch(importBatchId: string): Promise<void>` — consumed by Task 8's `prepareImportBatch` orchestration.

- [ ] **Step 1: Write the failing test**

Create `services/__tests__/import-match-resolution.service.spec.ts`:

```ts
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { IdentityResolutionService } from 'src/modules/match-participant/services/identity-resolution.service';
import { ImportBatchEntity } from 'src/modules/guided-import/entities/import-batch.entity';
import { ImportRowEntity } from 'src/modules/guided-import/entities/import-row.entity';
import { ImportMatchResolutionService } from 'src/modules/guided-import/services/import-match-resolution.service';

describe('ImportMatchResolutionService', () => {
  let service: ImportMatchResolutionService;

  const importBatchRepository = { findOne: jest.fn() };
  const importRowRepository = { find: jest.fn(), save: jest.fn() };
  const identityResolutionService = {
    resolvePerson: jest.fn(),
    resolveCompany: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    importBatchRepository.findOne.mockResolvedValue({
      id: 'batch-1',
      workspaceId: 'workspace-1',
      objectNameSingular: 'person',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportMatchResolutionService,
        {
          provide: getRepositoryToken(ImportBatchEntity, 'core'),
          useValue: importBatchRepository,
        },
        {
          provide: getRepositoryToken(ImportRowEntity, 'core'),
          useValue: importRowRepository,
        },
        {
          provide: IdentityResolutionService,
          useValue: identityResolutionService,
        },
      ],
    }).compile();

    service = module.get<ImportMatchResolutionService>(
      ImportMatchResolutionService,
    );
  });

  it('should mark a row CREATE when there is no identity match', async () => {
    importRowRepository.find.mockResolvedValue([
      {
        id: 'row-1',
        mappedData: { emails: { primaryEmail: 'new@acme.com' } },
      },
    ]);
    identityResolutionService.resolvePerson.mockResolvedValue({ kind: 'NONE' });

    await service.resolveBatch('batch-1');

    expect(importRowRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'row-1',
        matchAction: 'CREATE',
        matchedRecordId: null,
      }),
    );
  });

  it('should mark a row UPDATE with the matched id on an EXACT match', async () => {
    importRowRepository.find.mockResolvedValue([
      {
        id: 'row-1',
        mappedData: { emails: { primaryEmail: 'jane@acme.com' } },
      },
    ]);
    identityResolutionService.resolvePerson.mockResolvedValue({
      kind: 'EXACT',
      recordId: 'person-1',
      matchedOn: 'email match',
    });

    await service.resolveBatch('batch-1');

    expect(importRowRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'row-1',
        matchAction: 'UPDATE',
        matchedRecordId: 'person-1',
      }),
    );
  });

  it('should mark a row PROPOSE on a CANDIDATE match, never UPDATE silently', async () => {
    importRowRepository.find.mockResolvedValue([
      {
        id: 'row-1',
        mappedData: {
          emails: { primaryEmail: 'jane.doe@acme.com' },
          name: { firstName: 'Jane', lastName: 'Doe' },
        },
      },
    ]);
    identityResolutionService.resolvePerson.mockResolvedValue({
      kind: 'CANDIDATE',
      recordId: 'person-1',
      explanation: 'name and domain match, different email',
    });

    await service.resolveBatch('batch-1');

    expect(importRowRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'row-1',
        matchAction: 'PROPOSE',
        matchedRecordId: 'person-1',
      }),
    );
  });

  it('should mark a row SKIP when it has no usable identity field at all', async () => {
    importRowRepository.find.mockResolvedValue([
      { id: 'row-1', mappedData: {} },
    ]);

    await service.resolveBatch('batch-1');

    expect(identityResolutionService.resolvePerson).not.toHaveBeenCalled();
    expect(importRowRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'row-1', matchAction: 'CREATE' }),
    );
  });

  it('should default to CREATE for objects identity resolution does not cover', async () => {
    importBatchRepository.findOne.mockResolvedValue({
      id: 'batch-1',
      workspaceId: 'workspace-1',
      objectNameSingular: 'opportunity',
    });
    importRowRepository.find.mockResolvedValue([
      { id: 'row-1', mappedData: { name: 'New Deal' } },
    ]);

    await service.resolveBatch('batch-1');

    expect(identityResolutionService.resolvePerson).not.toHaveBeenCalled();
    expect(identityResolutionService.resolveCompany).not.toHaveBeenCalled();
    expect(importRowRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'row-1', matchAction: 'CREATE' }),
    );
  });
});
```

- [ ] **Step 2: Run it, see it fail**

```bash
cd packages/searm-server && npx jest import-match-resolution.service.spec
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the service**

Create `services/import-match-resolution.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isDefined } from 'searm-shared/utils';
import { Repository } from 'typeorm';

import { IdentityResolutionService } from 'src/modules/match-participant/services/identity-resolution.service';
import { getDomainNameFromHandle } from 'src/modules/contact-creation-manager/utils/get-domain-name-from-handle.util';
import { ImportBatchEntity } from 'src/modules/guided-import/entities/import-batch.entity';
import { ImportRowEntity } from 'src/modules/guided-import/entities/import-row.entity';
import { ImportRowMatchAction } from 'src/modules/guided-import/types/import-batch-status.type';

@Injectable()
export class ImportMatchResolutionService {
  constructor(
    private readonly identityResolutionService: IdentityResolutionService,
    // eslint-disable-next-line searm/prefer-workspace-scoped-repository
    @InjectRepository(ImportBatchEntity, 'core')
    private readonly importBatchRepository: Repository<ImportBatchEntity>,
    // eslint-disable-next-line searm/prefer-workspace-scoped-repository
    @InjectRepository(ImportRowEntity, 'core')
    private readonly importRowRepository: Repository<ImportRowEntity>,
  ) {}

  // Identity-aware dedup only exists for person/company today (Task 2's
  // scope). Every other object gets CREATE for every row — no worse than
  // today's spreadsheet import, which has no server-side dedup at all.
  async resolveBatch(importBatchId: string): Promise<void> {
    const batch = await this.importBatchRepository.findOne({
      where: { id: importBatchId },
    });

    if (!isDefined(batch)) {
      return;
    }

    const rows = await this.importRowRepository.find({
      where: { importBatchId },
    });

    for (const row of rows) {
      const { matchAction, matchedRecordId } = await this.resolveRow(
        batch.workspaceId,
        batch.objectNameSingular,
        row.mappedData ?? {},
      );

      await this.importRowRepository.save({
        ...row,
        matchAction,
        matchedRecordId,
      });
    }
  }

  private async resolveRow(
    workspaceId: string,
    objectNameSingular: string,
    mappedData: Record<string, unknown>,
  ): Promise<{
    matchAction: ImportRowMatchAction;
    matchedRecordId: string | null;
  }> {
    if (objectNameSingular === 'person') {
      const email = this.extractPersonEmail(mappedData);

      if (!isDefined(email)) {
        return { matchAction: ImportRowMatchAction.CREATE, matchedRecordId: null };
      }

      const displayName = this.extractPersonDisplayName(mappedData);
      const match = await this.identityResolutionService.resolvePerson({
        workspaceId,
        email,
        displayName,
      });

      return this.matchToRowVerdict(match);
    }

    if (objectNameSingular === 'company') {
      const domain = this.extractCompanyDomain(mappedData);

      if (!isDefined(domain)) {
        return { matchAction: ImportRowMatchAction.CREATE, matchedRecordId: null };
      }

      const match = await this.identityResolutionService.resolveCompany({
        workspaceId,
        domain,
      });

      return this.matchToRowVerdict(match);
    }

    return { matchAction: ImportRowMatchAction.CREATE, matchedRecordId: null };
  }

  private matchToRowVerdict(match: {
    kind: 'EXACT' | 'CANDIDATE' | 'NONE';
    recordId?: string;
  }): { matchAction: ImportRowMatchAction; matchedRecordId: string | null } {
    if (match.kind === 'EXACT') {
      return {
        matchAction: ImportRowMatchAction.UPDATE,
        matchedRecordId: match.recordId ?? null,
      };
    }

    if (match.kind === 'CANDIDATE') {
      return {
        matchAction: ImportRowMatchAction.PROPOSE,
        matchedRecordId: match.recordId ?? null,
      };
    }

    return { matchAction: ImportRowMatchAction.CREATE, matchedRecordId: null };
  }

  private extractPersonEmail(mappedData: Record<string, unknown>): string | null {
    const emails = mappedData.emails as
      | { primaryEmail?: string }
      | undefined;

    return emails?.primaryEmail ?? null;
  }

  private extractPersonDisplayName(
    mappedData: Record<string, unknown>,
  ): string | null {
    const name = mappedData.name as
      | { firstName?: string; lastName?: string }
      | undefined;

    if (!isDefined(name)) {
      return null;
    }

    return [name.firstName, name.lastName].filter(isDefined).join(' ') || null;
  }

  private extractCompanyDomain(
    mappedData: Record<string, unknown>,
  ): string | null {
    const domainName = mappedData.domainName as
      | { primaryLinkUrl?: string }
      | undefined;

    if (!isDefined(domainName?.primaryLinkUrl)) {
      return null;
    }

    return getDomainNameFromHandle(`x@${domainName.primaryLinkUrl.replace(/^https?:\/\//, '')}`);
  }
}
```

- [ ] **Step 4: Run it, see it pass**

```bash
cd packages/searm-server && npx jest import-match-resolution.service.spec
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Wire the module**

In `guided-import.module.ts`, add `MatchParticipantModule` to `imports` and `ImportMatchResolutionService` to `providers`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { MatchParticipantModule } from 'src/modules/match-participant/match-participant.module';
import { ImportBatchEntity } from 'src/modules/guided-import/entities/import-batch.entity';
import { ImportRowEntity } from 'src/modules/guided-import/entities/import-row.entity';
import { ImportMatchResolutionService } from 'src/modules/guided-import/services/import-match-resolution.service';
import { ImportBatchResolver } from 'src/modules/guided-import/resolvers/import-batch.resolver';

@Module({
  imports: [
    TypeOrmModule.forFeature([ImportBatchEntity, ImportRowEntity], 'core'),
    MatchParticipantModule,
  ],
  providers: [ImportBatchResolver, ImportMatchResolutionService],
})
export class GuidedImportModule {}
```

- [ ] **Step 6: Lint, typecheck, commit**

```bash
npx nx lint:diff-with-main searm-server
npx nx typecheck searm-server
git add packages/searm-server/src/modules/guided-import
git commit -m "feat(import): resolve per-row identity match action"
```

---

### Task 8: Validation before write, and a preview the reviewer can act on

Reuses the exact same field-level rules every other write path validates against — `generateRecordPropertiesZodSchema` (on disk, already reused unmodified by Task 5) — rather than a second, import-specific validator that could drift. Adds one required-field completeness check the generic schema's `.partial()` shape doesn't cover for CREATE rows.

**Files:**
- Create: `packages/searm-server/src/modules/guided-import/services/import-validation.service.ts`
- Create: `packages/searm-server/src/modules/guided-import/services/__tests__/import-validation.service.spec.ts`
- Create: `packages/searm-server/src/modules/guided-import/dtos/import-batch-preview.dto.ts`
- Modify: `packages/searm-server/src/modules/guided-import/resolvers/import-batch.resolver.ts` (add `prepareImportBatch` mutation, `importBatchPreview` query)
- Modify: `packages/searm-server/src/modules/guided-import/resolvers/__tests__/import-batch.resolver.spec.ts`
- Modify: `packages/searm-server/src/modules/guided-import/guided-import.module.ts`

**Interfaces:**
- Consumes: `generateRecordPropertiesZodSchema`, `ObjectMetadataForToolSchema` type (both on disk), `WorkspaceManyOrAllFlatEntityMapsCacheService` (on disk), `getFlatFieldsFromFlatObjectMetadata` (on disk), `ImportMatchResolutionService.resolveBatch` (Task 7).
- Produces: `ImportValidationService.validateBatch(importBatchId: string): Promise<void>` — consumed by Task 9 (a row must have `validationErrors: {}` to execute). GraphQL `prepareImportBatch(importBatchId: ID!): ImportBatch!`, `importBatchPreview(importBatchId: ID!): ImportBatchPreview!`.

- [ ] **Step 1: Write the failing test**

Create `services/__tests__/import-validation.service.spec.ts`:

```ts
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { WorkspaceManyOrAllFlatEntityMapsCacheService } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service';
import { ImportBatchEntity } from 'src/modules/guided-import/entities/import-batch.entity';
import { ImportRowEntity } from 'src/modules/guided-import/entities/import-row.entity';
import { ImportValidationService } from 'src/modules/guided-import/services/import-validation.service';

describe('ImportValidationService', () => {
  let service: ImportValidationService;

  const importBatchRepository = { findOne: jest.fn() };
  const importRowRepository = { find: jest.fn(), save: jest.fn() };
  const flatEntityMapsCacheService = {
    getOrRecomputeManyOrAllFlatEntityMaps: jest.fn(),
  };

  const personObject = {
    id: 'object-1',
    nameSingular: 'person',
  };
  const jobTitleField = {
    id: 'field-1',
    objectMetadataId: 'object-1',
    name: 'jobTitle',
    label: 'Job Title',
    type: 'TEXT',
    isNullable: true,
    isCustom: false,
  };
  const emailsField = {
    id: 'field-2',
    objectMetadataId: 'object-1',
    name: 'emails',
    label: 'Emails',
    type: 'EMAILS',
    isNullable: false,
    isCustom: false,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    importBatchRepository.findOne.mockResolvedValue({
      id: 'batch-1',
      workspaceId: 'workspace-1',
      objectNameSingular: 'person',
    });
    flatEntityMapsCacheService.getOrRecomputeManyOrAllFlatEntityMaps.mockResolvedValue(
      {
        flatObjectMetadataMaps: {
          byUniversalIdentifier: { 'object-1': personObject },
        },
        flatFieldMetadataMaps: {
          byUniversalIdentifier: {
            'field-1': jobTitleField,
            'field-2': emailsField,
          },
        },
      },
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportValidationService,
        {
          provide: getRepositoryToken(ImportBatchEntity, 'core'),
          useValue: importBatchRepository,
        },
        {
          provide: getRepositoryToken(ImportRowEntity, 'core'),
          useValue: importRowRepository,
        },
        {
          provide: WorkspaceManyOrAllFlatEntityMapsCacheService,
          useValue: flatEntityMapsCacheService,
        },
      ],
    }).compile();

    service = module.get<ImportValidationService>(ImportValidationService);
  });

  it('should mark a valid row with an empty validationErrors object', async () => {
    importRowRepository.find.mockResolvedValue([
      {
        id: 'row-1',
        matchAction: 'CREATE',
        mappedData: { emails: { primaryEmail: 'jane@acme.com' }, jobTitle: 'VP' },
      },
    ]);

    await service.validateBatch('batch-1');

    expect(importRowRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'row-1', validationErrors: {} }),
    );
  });

  it('should flag a missing required field on a CREATE row', async () => {
    importRowRepository.find.mockResolvedValue([
      { id: 'row-1', matchAction: 'CREATE', mappedData: { jobTitle: 'VP' } },
    ]);

    await service.validateBatch('batch-1');

    expect(importRowRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'row-1',
        validationErrors: { emails: expect.stringContaining('required') },
      }),
    );
  });

  it('should not require a field to be present on an UPDATE row', async () => {
    importRowRepository.find.mockResolvedValue([
      {
        id: 'row-1',
        matchAction: 'UPDATE',
        matchedRecordId: 'person-1',
        mappedData: { jobTitle: 'VP' },
      },
    ]);

    await service.validateBatch('batch-1');

    expect(importRowRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'row-1', validationErrors: {} }),
    );
  });

  it('should skip validation for a SKIP row', async () => {
    importRowRepository.find.mockResolvedValue([
      { id: 'row-1', matchAction: 'SKIP', mappedData: {} },
    ]);

    await service.validateBatch('batch-1');

    expect(importRowRepository.save).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it, see it fail**

```bash
cd packages/searm-server && npx jest import-validation.service.spec
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the service**

Create `services/import-validation.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isDefined } from 'searm-shared/utils';
import { Repository } from 'typeorm';

import { generateRecordPropertiesZodSchema } from 'src/engine/core-modules/record-crud/zod-schemas/record-properties.zod-schema';
import { WorkspaceManyOrAllFlatEntityMapsCacheService } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service';
import { getFlatFieldsFromFlatObjectMetadata } from 'src/engine/api/graphql/workspace-schema-builder/utils/get-flat-fields-for-flat-object-metadata.util';
import { ImportBatchEntity } from 'src/modules/guided-import/entities/import-batch.entity';
import { ImportRowEntity } from 'src/modules/guided-import/entities/import-row.entity';
import { ImportRowMatchAction } from 'src/modules/guided-import/types/import-batch-status.type';

@Injectable()
export class ImportValidationService {
  constructor(
    private readonly flatEntityMapsCacheService: WorkspaceManyOrAllFlatEntityMapsCacheService,
    // eslint-disable-next-line searm/prefer-workspace-scoped-repository
    @InjectRepository(ImportBatchEntity, 'core')
    private readonly importBatchRepository: Repository<ImportBatchEntity>,
    // eslint-disable-next-line searm/prefer-workspace-scoped-repository
    @InjectRepository(ImportRowEntity, 'core')
    private readonly importRowRepository: Repository<ImportRowEntity>,
  ) {}

  async validateBatch(importBatchId: string): Promise<void> {
    const batch = await this.importBatchRepository.findOne({
      where: { id: importBatchId },
    });

    if (!isDefined(batch)) {
      return;
    }

    const { flatObjectMetadataMaps, flatFieldMetadataMaps } =
      await this.flatEntityMapsCacheService.getOrRecomputeManyOrAllFlatEntityMaps(
        {
          workspaceId: batch.workspaceId,
          flatMapsKeys: ['flatObjectMetadataMaps', 'flatFieldMetadataMaps'],
        },
      );

    const flatObject = Object.values(
      flatObjectMetadataMaps.byUniversalIdentifier,
    ).find((candidate) => candidate.nameSingular === batch.objectNameSingular);

    if (!isDefined(flatObject)) {
      return;
    }

    const fields = getFlatFieldsFromFlatObjectMetadata(
      flatObject,
      flatFieldMetadataMaps,
    );
    const objectMetadata = { ...flatObject, fields };
    // .partial() so UPDATE/PROPOSE rows (which only carry changed fields)
    // aren't penalized for omitting fields they are not touching. CREATE
    // rows' required-ness is enforced separately below, by design — reusing
    // this schema's own required/optional split would need
    // generateCreateRecordInputSchema, which additionally demands an `id`-less
    // shape per action type; checking isNullable directly here is simpler and
    // exercises the exact same field list.
    const schema = generateRecordPropertiesZodSchema(
      objectMetadata as never,
    ).partial();

    const rows = await this.importRowRepository.find({
      where: { importBatchId },
    });

    for (const row of rows) {
      if (row.matchAction === ImportRowMatchAction.SKIP) {
        continue;
      }

      const mappedData = row.mappedData ?? {};
      const parseResult = schema.safeParse(mappedData);
      const validationErrors: Record<string, string> = {};

      if (!parseResult.success) {
        for (const issue of parseResult.error.issues) {
          const fieldName = String(issue.path[0] ?? 'unknown');

          validationErrors[fieldName] = issue.message;
        }
      }

      if (row.matchAction === ImportRowMatchAction.CREATE) {
        for (const field of fields) {
          if (
            !field.isNullable &&
            field.name !== 'id' &&
            !isDefined(mappedData[field.name]) &&
            !isDefined(validationErrors[field.name])
          ) {
            validationErrors[field.name] = `${field.label} is required.`;
          }
        }
      }

      await this.importRowRepository.save({ ...row, validationErrors });
    }
  }
}
```

- [ ] **Step 4: Run it, see it pass**

```bash
cd packages/searm-server && npx jest import-validation.service.spec
```

Expected: PASS, 4 tests.

If `generateRecordPropertiesZodSchema`'s first parameter type (`ObjectMetadataForToolSchema`) rejects the flat-map-derived `objectMetadata` shape at the type level, this mirrors exactly what `database-tool.provider.ts` already does (`const objectMetadata = { ...flatObject, fields };` passed to the same generator family) — match its exact cast/shape rather than inventing a new one.

- [ ] **Step 5: Write the preview DTO**

Create `dtos/import-batch-preview.dto.ts`:

```ts
import { Field, Int, ObjectType } from '@nestjs/graphql';

@ObjectType('ImportBatchPreview')
export class ImportBatchPreviewDTO {
  @Field(() => Int)
  totalRows: number;

  @Field(() => Int)
  createCount: number;

  @Field(() => Int)
  updateCount: number;

  @Field(() => Int)
  proposeCount: number;

  @Field(() => Int)
  skipCount: number;

  @Field(() => Int)
  rowsWithErrorsCount: number;
}
```

- [ ] **Step 6: Add the failing resolver tests**

Add to `resolvers/__tests__/import-batch.resolver.spec.ts`:

```ts
describe('prepareImportBatch', () => {
  it('should run match resolution then validation and mark the batch READY', async () => {
    importBatchRepository.findOne.mockResolvedValue({
      id: 'batch-1',
      workspaceId: 'workspace-1',
      status: 'PENDING',
    });

    await resolver.prepareImportBatch('batch-1', { id: 'workspace-1' } as never);

    expect(matchResolutionService.resolveBatch).toHaveBeenCalledWith('batch-1');
    expect(validationService.validateBatch).toHaveBeenCalledWith('batch-1');
    expect(importBatchRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'batch-1', status: 'READY' }),
    );
  });
});

describe('importBatchPreview', () => {
  it('should count rows by matchAction and validation status', async () => {
    importRowRepository.count = jest.fn(
      ({ where }: { where: Record<string, unknown> }) => {
        if (where.matchAction === 'CREATE') return Promise.resolve(3);
        if (where.matchAction === 'UPDATE') return Promise.resolve(1);
        if (where.matchAction === 'PROPOSE') return Promise.resolve(1);
        if (where.matchAction === 'SKIP') return Promise.resolve(0);

        return Promise.resolve(2);
      },
    );
    importBatchRepository.findOne.mockResolvedValue({
      id: 'batch-1',
      workspaceId: 'workspace-1',
      totalRows: 5,
    });

    const preview = await resolver.importBatchPreview(
      'batch-1',
      { id: 'workspace-1' } as never,
    );

    expect(preview).toEqual({
      totalRows: 5,
      createCount: 3,
      updateCount: 1,
      proposeCount: 1,
      skipCount: 0,
      rowsWithErrorsCount: 2,
    });
  });
});
```

Add the two new mocks (`matchResolutionService`, `validationService`) to the `TestingModule` provider list already declared in this file, alongside the existing `ImportMatchResolutionService`/`ImportValidationService` providers.

- [ ] **Step 7: Run it, see it fail**

```bash
cd packages/searm-server && npx jest import-batch.resolver.spec
```

Expected: FAIL — `resolver.prepareImportBatch is not a function`.

- [ ] **Step 8: Extend the resolver**

Add to `resolvers/import-batch.resolver.ts` — constructor gains two dependencies and a `Not`/`IsNull` import for the error-count query:

```ts
  constructor(
    // eslint-disable-next-line searm/prefer-workspace-scoped-repository
    @InjectRepository(ImportBatchEntity, 'core')
    private readonly importBatchRepository: Repository<ImportBatchEntity>,
    // eslint-disable-next-line searm/prefer-workspace-scoped-repository
    @InjectRepository(ImportRowEntity, 'core')
    private readonly importRowRepository: Repository<ImportRowEntity>,
    private readonly importMatchResolutionService: ImportMatchResolutionService,
    private readonly importValidationService: ImportValidationService,
  ) {}
```

and two new operations:

```ts
  @Mutation(() => ImportBatchDTO)
  async prepareImportBatch(
    @Args('importBatchId') importBatchId: string,
    @AuthWorkspace() workspace: FlatWorkspace,
  ): Promise<ImportBatchDTO> {
    const batch = await this.importBatchRepository.findOne({
      where: { id: importBatchId, workspaceId: workspace.id },
    });

    if (!batch) {
      throw new BadRequestException('Import batch not found.');
    }

    await this.importMatchResolutionService.resolveBatch(importBatchId);
    await this.importValidationService.validateBatch(importBatchId);

    const readyBatch = await this.importBatchRepository.save({
      ...batch,
      status: ImportBatchStatus.READY,
    });

    return readyBatch as unknown as ImportBatchDTO;
  }

  @Query(() => ImportBatchPreviewDTO)
  async importBatchPreview(
    @Args('importBatchId') importBatchId: string,
    @AuthWorkspace() workspace: FlatWorkspace,
  ): Promise<ImportBatchPreviewDTO> {
    const batch = await this.importBatchRepository.findOne({
      where: { id: importBatchId, workspaceId: workspace.id },
    });

    if (!batch) {
      throw new BadRequestException('Import batch not found.');
    }

    const [createCount, updateCount, proposeCount, skipCount, rowsWithErrorsCount] =
      await Promise.all([
        this.importRowRepository.count({
          where: { importBatchId, matchAction: ImportRowMatchAction.CREATE },
        }),
        this.importRowRepository.count({
          where: { importBatchId, matchAction: ImportRowMatchAction.UPDATE },
        }),
        this.importRowRepository.count({
          where: { importBatchId, matchAction: ImportRowMatchAction.PROPOSE },
        }),
        this.importRowRepository.count({
          where: { importBatchId, matchAction: ImportRowMatchAction.SKIP },
        }),
        this.importRowRepository.count({
          where: { importBatchId, validationErrors: Not(Equal({})) },
        }),
      ]);

    return {
      totalRows: batch.totalRows,
      createCount,
      updateCount,
      proposeCount,
      skipCount,
      rowsWithErrorsCount,
    };
  }
```

Add imports: `Query` alongside the existing `Mutation` import, `ImportBatchPreviewDTO`, `ImportMatchResolutionService`, `ImportValidationService`, `ImportRowMatchAction`, `ImportBatchStatus`, `ImportRowEntity`, and `Equal, Not` from `typeorm`. The `validationErrors: Not(Equal({}))` filter is a placeholder for "not an empty jsonb object" — TypeORM's query-builder does not reliably express jsonb equality this way; **confirm at implementation time** by writing the count query with `importRowRepository.createQueryBuilder('row').where('row.importBatchId = :importBatchId', { importBatchId }).andWhere("row.validationErrors::text != '{}'").getCount()` instead if the `Not(Equal({}))` form fails against Postgres jsonb — this is the safer, more explicit form and should likely be used directly rather than attempted first.

- [ ] **Step 9: Run it, see it pass**

```bash
cd packages/searm-server && npx jest import-batch.resolver.spec
```

Expected: PASS, 6 tests (4 existing + 2 new).

- [ ] **Step 10: Wire the module**

Add `ImportValidationService` and `ImportBatchPreviewDTO`'s owning imports to `guided-import.module.ts`'s `providers` array.

- [ ] **Step 11: Lint, typecheck, commit**

```bash
npx nx lint:diff-with-main searm-server
npx nx typecheck searm-server
git add packages/searm-server/src/modules/guided-import
git commit -m "feat(import): validate rows before write and expose a preview summary"
```

---

### Task 9: Resumable, idempotent execution

CREATE and NONE-match rows are not "AI-derived" — they write directly through the same `CreateRecordService`/`UpdateRecordService` path a human's manual record creation uses, exactly like SeaRM's existing `contact-creation-manager` does today. PROPOSE rows (CANDIDATE identity matches) go through `ProposalGateService.createFromExtraction` — this is the concrete mechanism behind the charter's "Imports may create research tasks but never bypass approval for AI-derived changes" line. Resumability comes from querying only `ImportRowStatus.PENDING` rows on every run — a row already marked `PROCESSED` or `FAILED` is never touched again, so a retried BullMQ job after a crash picks up exactly where it left off.

> **Review fix (C7) — the importer must write with a real role and a real principal, not `{ shouldBypassPermissionChecks: false }`.** `RolePermissionConfig` (`engine/searm-orm/types/role-permission-config.ts`, verified on disk) is the closed union `{ shouldBypassPermissionChecks: true } | { unionOf: RoleId[] } | { intersectionOf: RoleId[] }` — `{ shouldBypassPermissionChecks: false }` is not a member and does not compile. The deeper problem the type error was masking: the importer ran under `buildSystemAuthContext` with no role and no `createdBy`/`updatedBy` actor, so every imported record was attributed to SYSTEM and the uploader's own field permissions were never enforced — a user who cannot write `person.jobTitle` could import a column into it. That breaks the charter's Record and Principal contracts.
>
> The fix is the same shape `ProposalExecutionService.buildApproverContext` already produces on disk (`services/proposal-execution.service.ts:355-418`, verified): look up the importing user's workspace member, resolve their role with `UserRoleService.getRoleIdForUserWorkspace`, build a real `authContext` with `buildUserAuthContext`, and pass `rolePermissionConfig: { unionOf: [roleId] }` plus `createdBy`/`updatedBy: actorMetadata` on every write. `ImportBatchEntity.createdByUserWorkspaceId` (Task 6) already carries the importing user's identity — this task is what finally reads it. Steps 1, 3, and 5 below are rewritten accordingly; `readBaseline`'s `{ shouldBypassPermissionChecks: true }` stays as-is (Launch 1's own `hasBaselineConflict` reads the baseline the same privileged way — the conflict check compares state, it does not attribute a write).

**Files:**
- Create: `packages/searm-server/src/modules/guided-import/services/import-execution.service.ts`
- Create: `packages/searm-server/src/modules/guided-import/services/__tests__/import-execution.service.spec.ts`
- Create: `packages/searm-server/src/modules/guided-import/jobs/import-execution.job.ts`
- Modify: `packages/searm-server/src/modules/guided-import/resolvers/import-batch.resolver.ts` (add `startImportBatch`)
- Modify: `packages/searm-server/src/modules/guided-import/resolvers/__tests__/import-batch.resolver.spec.ts`
- Modify: `packages/searm-server/src/engine/core-modules/message-queue/message-queue.constants.ts`
- Modify: `packages/searm-server/src/modules/guided-import/guided-import.module.ts`

**Interfaces:**
- Consumes: `CreateRecordService.execute` / `UpdateRecordService.execute` / `FindRecordsService.execute` (on disk, same signatures verified in Launch 1's `proposal-execution.service.ts`), `ProposalGateService.createFromExtraction` (Task 1), `ImportRowEntity`/`ImportBatchEntity` (Task 6), `UserRoleService.getRoleIdForUserWorkspace` (`engine/metadata-modules/user-role/user-role.service.ts:138`, verified), `buildUserAuthContext` and `fromUserEntityToFlat` (same utilities `ProposalExecutionService.buildApproverContext` uses, on disk), `WorkspaceCacheService.getOrRecompute` (on disk, used by `buildApproverContext` for `flatWorkspaceMemberMaps`).
- Produces: `ImportExecutionService.executeBatch(params: { workspaceId: string; importBatchId: string }): Promise<void>`. GraphQL `startImportBatch(importBatchId: ID!): ImportBatch!`.

- [ ] **Step 1: Write the failing test**

Create `services/__tests__/import-execution.service.spec.ts`:

```ts
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { CreateRecordService } from 'src/engine/core-modules/record-crud/services/create-record.service';
import { FindRecordsService } from 'src/engine/core-modules/record-crud/services/find-records.service';
import { UpdateRecordService } from 'src/engine/core-modules/record-crud/services/update-record.service';
import { ProposalGateService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-gate.service';
import { UserRoleService } from 'src/engine/metadata-modules/user-role/user-role.service';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/workspace-cache.service';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { ImportBatchEntity } from 'src/modules/guided-import/entities/import-batch.entity';
import { ImportRowEntity } from 'src/modules/guided-import/entities/import-row.entity';
import { ImportExecutionService } from 'src/modules/guided-import/services/import-execution.service';

describe('ImportExecutionService', () => {
  let service: ImportExecutionService;

  const importBatchRepository = { findOne: jest.fn(), save: jest.fn() };
  const importRowRepository = { find: jest.fn(), save: jest.fn() };
  const createRecordService = { execute: jest.fn() };
  const updateRecordService = { execute: jest.fn() };
  const findRecordsService = { execute: jest.fn() };
  const proposalGateService = { createFromExtraction: jest.fn() };
  const userRoleService = { getRoleIdForUserWorkspace: jest.fn() };
  const workspaceCacheService = { getOrRecompute: jest.fn() };
  const userWorkspaceRepository = { findOne: jest.fn() };
  const userRepository = { findOne: jest.fn() };

  const buildRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'row-1',
    importBatchId: 'batch-1',
    rowNumber: 1,
    mappedData: { emails: { primaryEmail: 'jane@acme.com' } },
    matchAction: 'CREATE',
    matchedRecordId: null,
    validationErrors: {},
    status: 'PENDING',
    ...overrides,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    importBatchRepository.findOne.mockResolvedValue({
      id: 'batch-1',
      workspaceId: 'workspace-1',
      objectNameSingular: 'person',
      createdByUserWorkspaceId: 'user-workspace-1',
      createdRowCount: 0,
      updatedRowCount: 0,
      proposedRowCount: 0,
      skippedRowCount: 0,
      failedRowCount: 0,
      processedRows: 0,
    });
    importBatchRepository.save.mockImplementation(async (entity) => entity);
    importRowRepository.save.mockImplementation(async (entity) => entity);
    proposalGateService.createFromExtraction.mockResolvedValue({
      proposalId: 'proposal-1',
      itemIds: ['item-1'],
    });
    userWorkspaceRepository.findOne.mockResolvedValue({
      id: 'user-workspace-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });
    userRepository.findOne.mockResolvedValue({
      id: 'user-1',
      firstName: 'Jane',
      lastName: 'Doe',
    });
    workspaceCacheService.getOrRecompute.mockResolvedValue({
      flatWorkspaceMemberMaps: {
        idByUserId: { 'user-1': 'workspace-member-1' },
        byId: { 'workspace-member-1': { id: 'workspace-member-1' } },
      },
    });
    userRoleService.getRoleIdForUserWorkspace.mockResolvedValue('role-1');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportExecutionService,
        { provide: CreateRecordService, useValue: createRecordService },
        { provide: UpdateRecordService, useValue: updateRecordService },
        { provide: FindRecordsService, useValue: findRecordsService },
        { provide: ProposalGateService, useValue: proposalGateService },
        { provide: UserRoleService, useValue: userRoleService },
        { provide: WorkspaceCacheService, useValue: workspaceCacheService },
        {
          provide: getRepositoryToken(UserWorkspaceEntity),
          useValue: userWorkspaceRepository,
        },
        {
          provide: getRepositoryToken(UserEntity),
          useValue: userRepository,
        },
        {
          provide: getRepositoryToken(ImportBatchEntity, 'core'),
          useValue: importBatchRepository,
        },
        {
          provide: getRepositoryToken(ImportRowEntity, 'core'),
          useValue: importRowRepository,
        },
      ],
    }).compile();

    service = module.get<ImportExecutionService>(ImportExecutionService);
  });

  it('should create a record for a CREATE row and mark it PROCESSED', async () => {
    importRowRepository.find.mockResolvedValue([buildRow()]);
    createRecordService.execute.mockResolvedValue({
      success: true,
      message: 'created',
      result: { record: { id: 'person-1' } },
    });

    await service.executeBatch({
      workspaceId: 'workspace-1',
      importBatchId: 'batch-1',
    });

    expect(createRecordService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        objectName: 'person',
        objectRecord: { emails: { primaryEmail: 'jane@acme.com' } },
      }),
    );
    expect(importRowRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'row-1', status: 'PROCESSED' }),
    );
  });

  // C7: the importing user's own role must gate the write, and the record
  // must be attributed to them, not to SYSTEM.
  it('should write CREATE and UPDATE rows under the importing user\'s role and name them as the actor', async () => {
    importRowRepository.find.mockResolvedValue([buildRow()]);
    createRecordService.execute.mockResolvedValue({
      success: true,
      message: 'created',
      result: { record: { id: 'person-1' } },
    });

    await service.executeBatch({
      workspaceId: 'workspace-1',
      importBatchId: 'batch-1',
    });

    expect(userRoleService.getRoleIdForUserWorkspace).toHaveBeenCalledWith({
      userWorkspaceId: 'user-workspace-1',
      workspaceId: 'workspace-1',
    });
    expect(createRecordService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        rolePermissionConfig: { unionOf: ['role-1'] },
        createdBy: expect.objectContaining({ name: 'Jane Doe' }),
      }),
    );
  });

  // C7: CreateRecordService enforces the passed rolePermissionConfig itself
  // (Launch 1, unmodified) — this asserts the import path surfaces that
  // refusal as a FAILED row rather than swallowing or bypassing it.
  it('should refuse a row whose target field the importing user cannot write', async () => {
    importRowRepository.find.mockResolvedValue([buildRow()]);
    createRecordService.execute.mockResolvedValue({
      success: false,
      message: 'Permission denied',
      error: 'You do not have permission to write person.jobTitle',
    });

    await service.executeBatch({
      workspaceId: 'workspace-1',
      importBatchId: 'batch-1',
    });

    expect(importRowRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'row-1',
        status: 'FAILED',
        errorMessage: expect.stringContaining('permission'),
      }),
    );
  });

  it('should update a record for an UPDATE row using matchedRecordId', async () => {
    importRowRepository.find.mockResolvedValue([
      buildRow({ matchAction: 'UPDATE', matchedRecordId: 'person-1' }),
    ]);
    updateRecordService.execute.mockResolvedValue({
      success: true,
      message: 'updated',
    });

    await service.executeBatch({
      workspaceId: 'workspace-1',
      importBatchId: 'batch-1',
    });

    expect(updateRecordService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        objectName: 'person',
        objectRecordId: 'person-1',
      }),
    );
    expect(importRowRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'row-1', status: 'PROCESSED' }),
    );
  });

  it('should create a proposal for a PROPOSE row rather than writing directly', async () => {
    importRowRepository.find.mockResolvedValue([
      buildRow({ matchAction: 'PROPOSE', matchedRecordId: 'person-1' }),
    ]);
    findRecordsService.execute.mockResolvedValue({
      success: true,
      message: 'ok',
      result: { records: [{ id: 'person-1', emails: { primaryEmail: 'old@acme.com' } }] },
    });

    await service.executeBatch({
      workspaceId: 'workspace-1',
      importBatchId: 'batch-1',
    });

    expect(createRecordService.execute).not.toHaveBeenCalled();
    expect(updateRecordService.execute).not.toHaveBeenCalled();
    expect(proposalGateService.createFromExtraction).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        sourceKey: 'import:batch-1:1',
      }),
    );
    expect(importRowRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'row-1', status: 'PROCESSED' }),
    );
  });

  it('should mark a row with validation errors FAILED without attempting a write', async () => {
    importRowRepository.find.mockResolvedValue([
      buildRow({ validationErrors: { emails: 'Emails is required.' } }),
    ]);

    await service.executeBatch({
      workspaceId: 'workspace-1',
      importBatchId: 'batch-1',
    });

    expect(createRecordService.execute).not.toHaveBeenCalled();
    expect(importRowRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'row-1',
        status: 'FAILED',
        errorMessage: expect.stringContaining('validation'),
      }),
    );
  });

  it('should mark a SKIP row PROCESSED without writing', async () => {
    importRowRepository.find.mockResolvedValue([buildRow({ matchAction: 'SKIP' })]);

    await service.executeBatch({
      workspaceId: 'workspace-1',
      importBatchId: 'batch-1',
    });

    expect(createRecordService.execute).not.toHaveBeenCalled();
    expect(importRowRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'row-1', status: 'PROCESSED' }),
    );
  });

  it('should isolate one row failure from the rest of the batch', async () => {
    importRowRepository.find.mockResolvedValue([
      buildRow({ id: 'row-1' }),
      buildRow({ id: 'row-2' }),
    ]);
    createRecordService.execute
      .mockRejectedValueOnce(new Error('duplicate key'))
      .mockResolvedValueOnce({
        success: true,
        message: 'created',
        result: { record: { id: 'person-2' } },
      });

    await service.executeBatch({
      workspaceId: 'workspace-1',
      importBatchId: 'batch-1',
    });

    expect(importRowRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'row-1',
        status: 'FAILED',
        errorMessage: 'duplicate key',
      }),
    );
    expect(importRowRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'row-2', status: 'PROCESSED' }),
    );
  });

  it('should not reprocess rows that are already PROCESSED or FAILED (resumability)', async () => {
    importRowRepository.find.mockResolvedValue([]);

    await service.executeBatch({
      workspaceId: 'workspace-1',
      importBatchId: 'batch-1',
    });

    expect(importRowRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'PENDING' }),
      }),
    );
    expect(createRecordService.execute).not.toHaveBeenCalled();
  });

  it('should mark the batch COMPLETED once every row has been processed', async () => {
    importRowRepository.find.mockResolvedValue([buildRow()]);
    createRecordService.execute.mockResolvedValue({
      success: true,
      message: 'created',
      result: { record: { id: 'person-1' } },
    });

    await service.executeBatch({
      workspaceId: 'workspace-1',
      importBatchId: 'batch-1',
    });

    expect(importBatchRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'batch-1', status: 'COMPLETED' }),
    );
  });
});
```

- [ ] **Step 2: Run it, see it fail**

```bash
cd packages/searm-server && npx jest import-execution.service.spec
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the service**

Create `services/import-execution.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { FieldActorSource, type ActorMetadata } from 'searm-shared/types';
import { isDefined } from 'searm-shared/utils';
import { Repository } from 'typeorm';

import { CreateRecordService } from 'src/engine/core-modules/record-crud/services/create-record.service';
import { FindRecordsService } from 'src/engine/core-modules/record-crud/services/find-records.service';
import { UpdateRecordService } from 'src/engine/core-modules/record-crud/services/update-record.service';
import { UserRoleService } from 'src/engine/metadata-modules/user-role/user-role.service';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/workspace-cache.service';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { fromUserEntityToFlat } from 'src/engine/core-modules/user/utils/from-user-entity-to-flat.util';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { buildUserAuthContext } from 'src/engine/core-modules/auth/utils/build-user-auth-context.util';
import { buildSystemAuthContext } from 'src/engine/searm-orm/utils/build-system-auth-context.util';
import { type RolePermissionConfig } from 'src/engine/searm-orm/types/role-permission-config';
import { type FlatWorkspace } from 'src/engine/workspace-manager/types/flat-workspace.type';
import { ProposalActionType } from 'src/engine/metadata-modules/ai/ai-write-approval/types/proposal-status.type';
import { ProposalGateService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-gate.service';
import { ImportBatchEntity } from 'src/modules/guided-import/entities/import-batch.entity';
import { ImportRowEntity } from 'src/modules/guided-import/entities/import-row.entity';
import {
  ImportBatchStatus,
  ImportRowMatchAction,
  ImportRowStatus,
} from 'src/modules/guided-import/types/import-batch-status.type';

// C7: the same shape ProposalExecutionService.buildApproverContext produces
// (services/proposal-execution.service.ts:355-418) — the importer needs its
// own copy because it has no ApproverContext type of its own and importing
// one from ai-write-approval would be a layering violation for a type this
// small. authContext carries the real user, so every write is attributed to
// them, not to SYSTEM; rolePermissionConfig enforces their real permissions.
type ImportActorContext = {
  authContext: WorkspaceAuthContext;
  rolePermissionConfig: RolePermissionConfig;
  actorMetadata: ActorMetadata;
};

@Injectable()
export class ImportExecutionService {
  private readonly logger = new Logger(ImportExecutionService.name);

  constructor(
    private readonly createRecordService: CreateRecordService,
    private readonly updateRecordService: UpdateRecordService,
    private readonly findRecordsService: FindRecordsService,
    private readonly proposalGateService: ProposalGateService,
    private readonly userRoleService: UserRoleService,
    private readonly workspaceCacheService: WorkspaceCacheService,
    // eslint-disable-next-line searm/prefer-workspace-scoped-repository
    @InjectRepository(UserWorkspaceEntity)
    private readonly userWorkspaceRepository: Repository<UserWorkspaceEntity>,
    // eslint-disable-next-line searm/prefer-workspace-scoped-repository
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    // eslint-disable-next-line searm/prefer-workspace-scoped-repository
    @InjectRepository(ImportBatchEntity, 'core')
    private readonly importBatchRepository: Repository<ImportBatchEntity>,
    // eslint-disable-next-line searm/prefer-workspace-scoped-repository
    @InjectRepository(ImportRowEntity, 'core')
    private readonly importRowRepository: Repository<ImportRowEntity>,
  ) {}

  // Only PENDING rows are ever fetched — a row already PROCESSED or FAILED
  // from an earlier, crashed run of this same job is never touched again.
  // That single WHERE clause is the entire resumability mechanism: no
  // separate "resume from checkpoint N" bookkeeping is needed.
  async executeBatch(params: {
    workspaceId: string;
    importBatchId: string;
  }): Promise<void> {
    const { workspaceId, importBatchId } = params;

    const batch = await this.importBatchRepository.findOne({
      where: { id: importBatchId },
    });

    if (!isDefined(batch)) {
      return;
    }

    // C7: resolve the importing user's own role and identity once per batch
    // — every row's write carries it, so permission enforcement and audit
    // attribution both name the human who uploaded the file, not SYSTEM.
    const importer = await this.buildImportActorContext(
      workspaceId,
      batch.createdByUserWorkspaceId,
    );

    const rows = await this.importRowRepository.find({
      where: { importBatchId, status: ImportRowStatus.PENDING },
      order: { rowNumber: 'ASC' },
    });

    let createdRowCount = batch.createdRowCount;
    let updatedRowCount = batch.updatedRowCount;
    let proposedRowCount = batch.proposedRowCount;
    let skippedRowCount = batch.skippedRowCount;
    let failedRowCount = batch.failedRowCount;

    for (const row of rows) {
      try {
        const outcome = await this.processRow(
          workspaceId,
          batch.objectNameSingular,
          importBatchId,
          row,
          importer,
        );

        // Persist this row's outcome before moving to the next row, so a
        // crash between two rows leaves the earlier one durably PROCESSED —
        // never re-run on retry.
        await this.importRowRepository.save({
          ...row,
          status: ImportRowStatus.PROCESSED,
          matchedRecordId: outcome.recordId ?? row.matchedRecordId,
          processedAt: new Date(),
        });

        if (outcome.kind === 'created') createdRowCount += 1;
        if (outcome.kind === 'updated') updatedRowCount += 1;
        if (outcome.kind === 'proposed') proposedRowCount += 1;
        if (outcome.kind === 'skipped') skippedRowCount += 1;
      } catch (error) {
        failedRowCount += 1;
        await this.importRowRepository.save({
          ...row,
          status: ImportRowStatus.FAILED,
          errorMessage: error instanceof Error ? error.message : String(error),
          processedAt: new Date(),
        });
        this.logger.warn(
          `Import row ${row.id} (batch ${importBatchId}) failed: ${error}`,
        );
      }
    }

    const remainingPending = await this.importRowRepository.count({
      where: { importBatchId, status: ImportRowStatus.PENDING },
    });

    await this.importBatchRepository.save({
      ...batch,
      createdRowCount,
      updatedRowCount,
      proposedRowCount,
      skippedRowCount,
      failedRowCount,
      processedRows: batch.totalRows - remainingPending,
      status:
        remainingPending === 0
          ? ImportBatchStatus.COMPLETED
          : ImportBatchStatus.RUNNING,
    });
  }

  private async processRow(
    workspaceId: string,
    objectNameSingular: string,
    importBatchId: string,
    row: ImportRowEntity,
    importer: ImportActorContext,
  ): Promise<{
    kind: 'created' | 'updated' | 'proposed' | 'skipped';
    recordId?: string;
  }> {
    if (row.matchAction === ImportRowMatchAction.SKIP) {
      return { kind: 'skipped' };
    }

    if (
      isDefined(row.validationErrors) &&
      Object.keys(row.validationErrors).length > 0
    ) {
      throw new Error(
        `Row failed validation: ${JSON.stringify(row.validationErrors)}`,
      );
    }

    const mappedData = row.mappedData ?? {};

    // C7: writes carry the importing user's own role and are attributed to
    // them as createdBy/updatedBy — the same rolePermissionConfig/actorMetadata
    // shape ProposalExecutionService.applyItem uses on approval
    // (services/proposal-execution.service.ts:479,510, verified). A user who
    // cannot write a field the CSV maps to that field now gets the same
    // permission error a manual create/update would produce, instead of a
    // silent SYSTEM-attributed write.
    if (row.matchAction === ImportRowMatchAction.CREATE) {
      const output = await this.createRecordService.execute({
        objectName: objectNameSingular,
        objectRecord: mappedData,
        authContext: importer.authContext,
        rolePermissionConfig: importer.rolePermissionConfig,
        createdBy: importer.actorMetadata,
        slimResponse: true,
      });

      if (!output.success) {
        throw new Error(output.error ?? output.message);
      }

      const record = (output.result as { record?: { id: string } })?.record;

      return { kind: 'created', recordId: record?.id };
    }

    if (row.matchAction === ImportRowMatchAction.UPDATE) {
      if (!isDefined(row.matchedRecordId)) {
        throw new Error('UPDATE row has no matchedRecordId.');
      }

      const output = await this.updateRecordService.execute({
        objectName: objectNameSingular,
        objectRecordId: row.matchedRecordId,
        objectRecord: mappedData,
        authContext: importer.authContext,
        rolePermissionConfig: importer.rolePermissionConfig,
        updatedBy: importer.actorMetadata,
        slimResponse: true,
      });

      if (!output.success) {
        throw new Error(output.error ?? output.message);
      }

      return { kind: 'updated', recordId: row.matchedRecordId };
    }

    // PROPOSE: the row matched an existing record only by a CANDIDATE signal
    // (Task 2/7) — never write it directly. Baseline is read the same way
    // Task 3/4's proposals capture it, so ProposalExecutionService's
    // conflict check at approval time is meaningful, not a no-op.
    if (!isDefined(row.matchedRecordId)) {
      throw new Error('PROPOSE row has no matchedRecordId.');
    }

    const baseline = await this.readBaseline(
      workspaceId,
      objectNameSingular,
      row.matchedRecordId,
      Object.keys(mappedData),
    );

    await this.proposalGateService.createFromExtraction({
      workspaceId,
      sourceKey: `import:${importBatchId}:${row.rowNumber}`,
      reason: `Row ${row.rowNumber} of the import matched an existing ${objectNameSingular} by name and company domain, but not by a confirmed identity field. Review before merging.`,
      createdByActor: {
        source: FieldActorSource.IMPORT,
        workspaceMemberId: null,
        name: 'Guided import',
        context: {},
      },
      items: [
        {
          actionType: ProposalActionType.UPDATE_RECORD,
          objectNameSingular,
          recordId: row.matchedRecordId,
          payload: mappedData,
          baseline,
        },
      ],
    });

    return { kind: 'proposed', recordId: row.matchedRecordId };
  }

  private async readBaseline(
    workspaceId: string,
    objectNameSingular: string,
    recordId: string,
    fieldNames: string[],
  ): Promise<Record<string, unknown>> {
    if (fieldNames.length === 0) {
      return {};
    }

    const output = await this.findRecordsService.execute({
      objectName: objectNameSingular,
      filter: { id: { eq: recordId } },
      limit: 1,
      select: fieldNames,
      shouldBuildEffectiveSelectFields: true,
      authContext: buildSystemAuthContext(workspaceId),
      rolePermissionConfig: { shouldBypassPermissionChecks: true },
    });

    if (!output.success) {
      return {};
    }

    const record = (output.result as { records?: Record<string, unknown>[] })
      ?.records?.[0];

    if (!isDefined(record)) {
      return {};
    }

    return Object.fromEntries(fieldNames.map((name) => [name, record[name]]));
  }

  // Same shape and same source lookups as
  // ProposalExecutionService.buildApproverContext
  // (services/proposal-execution.service.ts:355-418, verified on disk) —
  // duplicated rather than imported because that method is private and its
  // owning service is a different bounded context; this is the second of
  // exactly two places in the codebase that need it (the other being
  // approval), which does not justify extracting a shared util yet.
  private async buildImportActorContext(
    workspaceId: string,
    createdByUserWorkspaceId: string | null,
  ): Promise<ImportActorContext> {
    if (!isDefined(createdByUserWorkspaceId)) {
      // A batch with no recorded uploader cannot be safely attributed or
      // permission-checked — refuse rather than silently falling back to a
      // bypass context, which is exactly the C7 bug this fix removes.
      throw new Error(
        'ImportBatch has no createdByUserWorkspaceId; cannot execute without an importing user.',
      );
    }

    const userWorkspace = await this.userWorkspaceRepository.findOne({
      where: { id: createdByUserWorkspaceId, workspaceId },
    });

    if (!isDefined(userWorkspace)) {
      throw new Error(
        `Importing user workspace ${createdByUserWorkspaceId} not found`,
      );
    }

    const user = await this.userRepository.findOne({
      where: { id: userWorkspace.userId },
    });

    if (!isDefined(user)) {
      throw new Error(`Importing user ${userWorkspace.userId} not found`);
    }

    const { flatWorkspaceMemberMaps } =
      await this.workspaceCacheService.getOrRecompute(workspaceId, [
        'flatWorkspaceMemberMaps',
      ]);

    const workspaceMemberId = flatWorkspaceMemberMaps.idByUserId[user.id];
    const workspaceMember = isDefined(workspaceMemberId)
      ? flatWorkspaceMemberMaps.byId[workspaceMemberId]
      : undefined;

    if (!isDefined(workspaceMemberId) || !isDefined(workspaceMember)) {
      throw new Error(`Importing workspace member not found for user ${user.id}`);
    }

    const roleId = await this.userRoleService.getRoleIdForUserWorkspace({
      userWorkspaceId: createdByUserWorkspaceId,
      workspaceId,
    });

    return {
      authContext: buildUserAuthContext({
        workspace: { id: workspaceId } as FlatWorkspace,
        userWorkspaceId: createdByUserWorkspaceId,
        user: fromUserEntityToFlat(user),
        workspaceMemberId,
        workspaceMember,
      }),
      rolePermissionConfig: { unionOf: [roleId] },
      actorMetadata: {
        source: FieldActorSource.IMPORT,
        workspaceMemberId,
        name: [user.firstName, user.lastName].filter(Boolean).join(' '),
        context: {},
      },
    };
  }
}
```

- [ ] **Step 4: Run it, see it pass**

```bash
cd packages/searm-server && npx jest import-execution.service.spec
```

Expected: PASS — all 10 `it` blocks (the original 8 plus C7's role-attribution and permission-refusal tests).

- [ ] **Step 5: Write the job**

Create `jobs/import-execution.job.ts`:

```ts
import { Scope } from '@nestjs/common';

import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { GlobalWorkspaceOrmManager } from 'src/engine/searm-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/searm-orm/utils/build-system-auth-context.util';
import { ImportExecutionService } from 'src/modules/guided-import/services/import-execution.service';

export type ImportExecutionJobData = {
  workspaceId: string;
  importBatchId: string;
};

@Processor({ queueName: MessageQueue.importQueue, scope: Scope.REQUEST })
export class ImportExecutionJob {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly importExecutionService: ImportExecutionService,
  ) {}

  @Process(ImportExecutionJob.name)
  async handle(data: ImportExecutionJobData): Promise<void> {
    const { workspaceId, importBatchId } = data;
    const authContext = buildSystemAuthContext(workspaceId);

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      await this.importExecutionService.executeBatch({ workspaceId, importBatchId });
    }, authContext);
  }
}
```

- [ ] **Step 6: Add the queue**

In `engine/core-modules/message-queue/message-queue.constants.ts`, add to the `MessageQueue` enum, next to `aiStreamQueue`:

```ts
  importQueue = 'import-queue',
```

Confirm whether any central list of queue names needs a matching entry for the BullMQ driver to actually create the queue (grep for where `aiStreamQueue` or `contactCreationQueue` appears outside this file — if the BullMQ driver auto-registers every enum value, no further change is needed; if there is an explicit registration array, add `importQueue` to it).

- [ ] **Step 7: Add the failing resolver test**

Add to `resolvers/__tests__/import-batch.resolver.spec.ts`:

```ts
describe('startImportBatch', () => {
  it('should enqueue execution and mark the batch RUNNING when READY', async () => {
    importBatchRepository.findOne.mockResolvedValue({
      id: 'batch-1',
      workspaceId: 'workspace-1',
      status: 'READY',
    });

    await resolver.startImportBatch('batch-1', { id: 'workspace-1' } as never);

    expect(messageQueueService.add).toHaveBeenCalledWith(
      'ImportExecutionJob',
      { workspaceId: 'workspace-1', importBatchId: 'batch-1' },
    );
    expect(importBatchRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'batch-1', status: 'RUNNING' }),
    );
  });

  it('should refuse to start a batch that is not READY', async () => {
    importBatchRepository.findOne.mockResolvedValue({
      id: 'batch-1',
      workspaceId: 'workspace-1',
      status: 'PENDING',
    });

    await expect(
      resolver.startImportBatch('batch-1', { id: 'workspace-1' } as never),
    ).rejects.toThrow();

    expect(messageQueueService.add).not.toHaveBeenCalled();
  });
});
```

Add `const messageQueueService = { add: jest.fn() };` to the existing mock declarations and register it in the `TestingModule` against `MessageQueueService`'s injection token for `MessageQueue.importQueue` — match the exact `@InjectMessageQueue` token pattern used by other job-enqueuing tests already in this codebase (e.g. `tool-executor-gate.spec.ts` from Launch 1 does not enqueue a job, so instead follow the pattern in an existing messaging-module test that does, such as `messaging-message-list-fetch.cron.job.spec.ts` if it exists — grep for one before writing this mock).

- [ ] **Step 8: Run it, see it fail**

```bash
cd packages/searm-server && npx jest import-batch.resolver.spec
```

Expected: FAIL — `resolver.startImportBatch is not a function`.

- [ ] **Step 9: Extend the resolver**

Add to `resolvers/import-batch.resolver.ts` — constructor gains `MessageQueueService`:

```ts
    @InjectMessageQueue(MessageQueue.importQueue)
    private readonly messageQueueService: MessageQueueService,
```

and:

```ts
  @Mutation(() => ImportBatchDTO)
  async startImportBatch(
    @Args('importBatchId') importBatchId: string,
    @AuthWorkspace() workspace: FlatWorkspace,
  ): Promise<ImportBatchDTO> {
    const batch = await this.importBatchRepository.findOne({
      where: { id: importBatchId, workspaceId: workspace.id },
    });

    if (!batch || batch.status !== ImportBatchStatus.READY) {
      throw new BadRequestException(
        'Import batch must be prepared (READY) before it can start.',
      );
    }

    const runningBatch = await this.importBatchRepository.save({
      ...batch,
      status: ImportBatchStatus.RUNNING,
    });

    await this.messageQueueService.add<ImportExecutionJobData>(
      ImportExecutionJob.name,
      { workspaceId: workspace.id, importBatchId },
    );

    return runningBatch as unknown as ImportBatchDTO;
  }
```

Add the corresponding imports (`InjectMessageQueue`, `MessageQueue`, `MessageQueueService`, `ImportExecutionJob`, `type ImportExecutionJobData`).

- [ ] **Step 10: Run it, see it pass**

```bash
cd packages/searm-server && npx jest import-batch.resolver.spec
```

Expected: PASS, 8 tests (6 existing + 2 new).

- [ ] **Step 11: Wire the module**

Add `ImportExecutionService` and `ImportExecutionJob` to `guided-import.module.ts`'s `providers`, and `MessageQueueModule.forFeature([MessageQueue.importQueue])` (or the equivalent registration pattern used by `MessagingMessagesImportJob`'s owning module — confirm exact API by opening `message-import-manager.module.ts`) to `imports`.

C7's `ImportExecutionService` constructor also needs `UserRoleService` (module: `UserRoleModule`, `engine/metadata-modules/user-role/user-role.module.ts`), `WorkspaceCacheService` (module: `WorkspaceCacheModule`, confirm exact path against how `ProposalExecutionService`'s owning module — `ai-write-approval.module.ts` — imports it, since it injects the same service), and `TypeOrmModule.forFeature([UserWorkspaceEntity, UserEntity])` on the default connection (no connection-name argument, per N4) alongside the existing `TypeOrmModule.forFeature([ImportBatchEntity, ImportRowEntity], 'core')` registration from Task 6 Step 5. Add all three to `guided-import.module.ts`'s `imports`.

- [ ] **Step 12: Lint, typecheck, commit**

```bash
npx nx lint:diff-with-main searm-server
npx nx typecheck searm-server
git add packages/searm-server/src/modules/guided-import packages/searm-server/src/engine/core-modules/message-queue
git commit -m "feat(import): add resumable idempotent import execution"
```

---

### Task 10: Failed rows stay downloadable and retryable, and the frontend wizard drives the new backend

**Files:**
- Create: `packages/searm-server/src/modules/guided-import/controllers/import-failed-rows.controller.ts`
- Create: `packages/searm-server/src/modules/guided-import/controllers/__tests__/import-failed-rows.controller.spec.ts`
- Modify: `packages/searm-server/src/modules/guided-import/resolvers/import-batch.resolver.ts` (add `retryFailedImportRows`)
- Modify: `packages/searm-server/src/modules/guided-import/resolvers/__tests__/import-batch.resolver.spec.ts`
- Modify: `packages/searm-server/src/modules/guided-import/guided-import.module.ts`
- Create: `packages/searm-front/src/modules/object-record/spreadsheet-import/graphql/mutations/createImportBatch.ts`, `prepareImportBatch.ts`, `startImportBatch.ts`, `retryFailedImportRows.ts`
- Create: `packages/searm-front/src/modules/object-record/spreadsheet-import/graphql/queries/importBatch.ts`
- Create: `packages/searm-front/src/modules/object-record/spreadsheet-import/hooks/useCreateImportBatch.ts`
- Create: `packages/searm-front/src/modules/object-record/spreadsheet-import/components/SpreadsheetImportFailedRowsBanner.tsx`
- Modify: `packages/searm-front/src/modules/object-record/spreadsheet-import/hooks/useOpenObjectRecordsSpreadsheetImportDialog.ts`

**Interfaces:**
- Consumes: `ImportRowEntity`/`ImportBatchEntity` (Task 6), `createImportBatch`/`prepareImportBatch`/`startImportBatch` (Tasks 6, 8, 9).
- Produces: `GET /rest/import/:importBatchId/failed-rows.csv`, GraphQL `retryFailedImportRows(importBatchId: ID!): ImportBatch!`, front hook `useCreateImportBatch()`.

- [ ] **Step 1: Write the failing controller test**

Create `controllers/__tests__/import-failed-rows.controller.spec.ts`:

```ts
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ImportBatchEntity } from 'src/modules/guided-import/entities/import-batch.entity';
import { ImportRowEntity } from 'src/modules/guided-import/entities/import-row.entity';
import { ImportFailedRowsController } from 'src/modules/guided-import/controllers/import-failed-rows.controller';

describe('ImportFailedRowsController', () => {
  let controller: ImportFailedRowsController;

  const importBatchRepository = { findOne: jest.fn() };
  const importRowRepository = { find: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportFailedRowsController,
        {
          provide: getRepositoryToken(ImportBatchEntity, 'core'),
          useValue: importBatchRepository,
        },
        {
          provide: getRepositoryToken(ImportRowEntity, 'core'),
          useValue: importRowRepository,
        },
      ],
    }).compile();

    controller = module.get<ImportFailedRowsController>(
      ImportFailedRowsController,
    );
  });

  it('should stream a CSV with the original headers plus an Import Error column', async () => {
    importBatchRepository.findOne.mockResolvedValue({
      id: 'batch-1',
      workspaceId: 'workspace-1',
    });
    importRowRepository.find.mockResolvedValue([
      {
        rawData: { Email: 'bad-email' },
        errorMessage: 'Emails is required.',
      },
    ]);

    const response = {
      setHeader: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
    };

    await controller.downloadFailedRows(
      'batch-1',
      { id: 'workspace-1' } as never,
      response as never,
    );

    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/csv',
    );
    expect(response.write).toHaveBeenCalledWith(
      expect.stringContaining('Email'),
    );
    expect(response.write).toHaveBeenCalledWith(
      expect.stringContaining('Import Error'),
    );
    expect(response.write).toHaveBeenCalledWith(
      expect.stringContaining('bad-email'),
    );
    expect(response.end).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it, see it fail**

```bash
cd packages/searm-server && npx jest import-failed-rows.controller.spec
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the controller**

Create `controllers/import-failed-rows.controller.ts`. Confirm the exact guard/decorator combination against `ai-generate-text.controller.ts` (on disk — `@UseGuards(JwtAuthGuard, WorkspaceAuthGuard)`, `@AuthWorkspace()`) before implementing; this follows that precedent:

```ts
import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { type Response } from 'express';
import { Repository } from 'typeorm';

import type { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { JwtAuthGuard } from 'src/engine/guards/jwt-auth.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { ImportBatchEntity } from 'src/modules/guided-import/entities/import-batch.entity';
import { ImportRowEntity } from 'src/modules/guided-import/entities/import-row.entity';
import { ImportRowStatus } from 'src/modules/guided-import/types/import-batch-status.type';

@Controller('rest/import')
@UseGuards(JwtAuthGuard, WorkspaceAuthGuard)
export class ImportFailedRowsController {
  constructor(
    // eslint-disable-next-line searm/prefer-workspace-scoped-repository
    @InjectRepository(ImportBatchEntity, 'core')
    private readonly importBatchRepository: Repository<ImportBatchEntity>,
    // eslint-disable-next-line searm/prefer-workspace-scoped-repository
    @InjectRepository(ImportRowEntity, 'core')
    private readonly importRowRepository: Repository<ImportRowEntity>,
  ) {}

  @Get(':importBatchId/failed-rows.csv')
  async downloadFailedRows(
    @Param('importBatchId') importBatchId: string,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @Res() response: Response,
  ): Promise<void> {
    const batch = await this.importBatchRepository.findOne({
      where: { id: importBatchId, workspaceId: workspace.id },
    });

    if (!batch) {
      response.status(404).end();

      return;
    }

    const failedRows = await this.importRowRepository.find({
      where: { importBatchId, status: ImportRowStatus.FAILED },
      order: { rowNumber: 'ASC' },
    });

    response.setHeader('Content-Type', 'text/csv');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${batch.fileName}-failed-rows.csv"`,
    );

    const headers = new Set<string>();

    for (const row of failedRows) {
      Object.keys(row.rawData ?? {}).forEach((key) => headers.add(key));
    }

    const headerList = [...headers, 'Import Error'];

    response.write(headerList.map(this.escapeCsvCell).join(',') + '\n');

    for (const row of failedRows) {
      const cells = [...headers].map((header) =>
        this.escapeCsvCell(String((row.rawData ?? {})[header] ?? '')),
      );

      cells.push(this.escapeCsvCell(row.errorMessage ?? ''));
      response.write(cells.join(',') + '\n');
    }

    response.end();
  }

  private escapeCsvCell(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }

    return value;
  }
}
```

- [ ] **Step 4: Run it, see it pass**

```bash
cd packages/searm-server && npx jest import-failed-rows.controller.spec
```

Expected: PASS, 1 test.

- [ ] **Step 5: Add the retry mutation**

Add to `resolvers/__tests__/import-batch.resolver.spec.ts`:

```ts
describe('retryFailedImportRows', () => {
  it('should reset FAILED rows to PENDING and re-enqueue execution', async () => {
    importBatchRepository.findOne.mockResolvedValue({
      id: 'batch-1',
      workspaceId: 'workspace-1',
      status: 'COMPLETED',
    });
    importRowRepository.find.mockResolvedValue([
      { id: 'row-3', status: 'FAILED', errorMessage: 'boom' },
    ]);

    await resolver.retryFailedImportRows(
      'batch-1',
      { id: 'workspace-1' } as never,
    );

    expect(importRowRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'row-3',
        status: 'PENDING',
        errorMessage: null,
      }),
    );
    expect(importBatchRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'batch-1', status: 'RUNNING' }),
    );
    expect(messageQueueService.add).toHaveBeenCalledWith(
      'ImportExecutionJob',
      { workspaceId: 'workspace-1', importBatchId: 'batch-1' },
    );
  });
});
```

- [ ] **Step 6: Run it, see it fail**

```bash
cd packages/searm-server && npx jest import-batch.resolver.spec
```

Expected: FAIL — `resolver.retryFailedImportRows is not a function`.

- [ ] **Step 7: Extend the resolver**

Add to `resolvers/import-batch.resolver.ts`:

```ts
  @Mutation(() => ImportBatchDTO)
  async retryFailedImportRows(
    @Args('importBatchId') importBatchId: string,
    @AuthWorkspace() workspace: FlatWorkspace,
  ): Promise<ImportBatchDTO> {
    const batch = await this.importBatchRepository.findOne({
      where: { id: importBatchId, workspaceId: workspace.id },
    });

    if (!batch) {
      throw new BadRequestException('Import batch not found.');
    }

    const failedRows = await this.importRowRepository.find({
      where: { importBatchId, status: ImportRowStatus.FAILED },
    });

    for (const row of failedRows) {
      await this.importRowRepository.save({
        ...row,
        status: ImportRowStatus.PENDING,
        errorMessage: null,
      });
    }

    const runningBatch = await this.importBatchRepository.save({
      ...batch,
      status: ImportBatchStatus.RUNNING,
    });

    await this.messageQueueService.add<ImportExecutionJobData>(
      ImportExecutionJob.name,
      { workspaceId: workspace.id, importBatchId },
    );

    return runningBatch as unknown as ImportBatchDTO;
  }
```

Add `ImportRowStatus` to the existing type imports.

- [ ] **Step 8: Run it, see it pass**

```bash
cd packages/searm-server && npx jest import-batch.resolver.spec
```

Expected: PASS, 9 tests (8 existing + 1 new).

- [ ] **Step 9: Wire the module and register the controller**

Add `ImportFailedRowsController` to `guided-import.module.ts`'s `controllers` array (create the array if it does not exist yet). Register `GuidedImportModule` in the app's root REST-controller-aggregating module if controllers require separate registration from providers (confirm at implementation time — most NestJS apps register both through the same feature module import, so this is likely already covered once `GuidedImportModule` itself is imported per Task 6 Step 10's note).

- [ ] **Step 10: Frontend — GraphQL documents**

Create `graphql/mutations/createImportBatch.ts`:

```ts
import { gql } from '@apollo/client';

export const CREATE_IMPORT_BATCH = gql`
  mutation CreateImportBatch($input: CreateImportBatchInput!) {
    createImportBatch(input: $input) {
      id
      status
      totalRows
    }
  }
`;
```

Create `graphql/mutations/prepareImportBatch.ts`, `startImportBatch.ts`, `retryFailedImportRows.ts` following the identical shape, each wrapping its resolver name with `importBatchId: ID!` as the sole argument and the same `ImportBatch` field selection (`id status totalRows createdRowCount updatedRowCount proposedRowCount skippedRowCount failedRowCount`).

Create `graphql/queries/importBatch.ts`:

```ts
import { gql } from '@apollo/client';

export const IMPORT_BATCH_PREVIEW = gql`
  query ImportBatchPreview($importBatchId: ID!) {
    importBatchPreview(importBatchId: $importBatchId) {
      totalRows
      createCount
      updateCount
      proposeCount
      skipCount
      rowsWithErrorsCount
    }
  }
`;
```

Run the front codegen so these documents get typed hooks:

```bash
cd packages/searm-front && npx nx run searm-front:graphql:generate
```

(Exact codegen command name confirmed by grepping `package.json`'s `scripts` for `graphql` before running — Launch 1's plan did not need this step since its GraphQL types were metadata-schema, not core-schema-through-front; confirm whether this repo's codegen covers core-schema operations like `pendingProposals` already does, since `ProposalDTO` is core-schema too and the front already queries it successfully per Launch 1 Task 7.)

- [ ] **Step 11: Frontend — the batch-driving hook**

Create `hooks/useCreateImportBatch.ts`:

```ts
import { useMutation } from '@apollo/client';

import { useApolloCoreClient } from '@/object-metadata/hooks/useApolloCoreClient';
import { CREATE_IMPORT_BATCH } from '@/object-record/spreadsheet-import/graphql/mutations/createImportBatch';
import { PREPARE_IMPORT_BATCH } from '@/object-record/spreadsheet-import/graphql/mutations/prepareImportBatch';
import { START_IMPORT_BATCH } from '@/object-record/spreadsheet-import/graphql/mutations/startImportBatch';

export const useCreateImportBatch = () => {
  const apolloCoreClient = useApolloCoreClient();
  const [createImportBatchMutation] = useMutation(CREATE_IMPORT_BATCH, {
    client: apolloCoreClient,
  });
  const [prepareImportBatchMutation] = useMutation(PREPARE_IMPORT_BATCH, {
    client: apolloCoreClient,
  });
  const [startImportBatchMutation] = useMutation(START_IMPORT_BATCH, {
    client: apolloCoreClient,
  });

  const runGuidedImport = async (params: {
    objectNameSingular: string;
    fileName: string;
    rawRows: Record<string, unknown>[];
    mappedRows: Record<string, unknown>[];
    columnMapping: Record<string, string>;
  }) => {
    const { data: createData } = await createImportBatchMutation({
      variables: { input: params },
    });
    const importBatchId = createData?.createImportBatch?.id;

    if (!importBatchId) {
      throw new Error('Failed to create import batch.');
    }

    await prepareImportBatchMutation({ variables: { importBatchId } });
    await startImportBatchMutation({ variables: { importBatchId } });

    return importBatchId;
  };

  return { runGuidedImport };
};
```

- [ ] **Step 12: Frontend — route the existing wizard through it**

In `hooks/useOpenObjectRecordsSpreadsheetImportDialog.ts`, replace the `onSubmit` body's write path. Keep the existing `createInputs` computation (`buildRecordFromImportedStructuredRow` over `data.validStructuredRows`) unchanged — that is exactly `mappedRows`. Add `const { runGuidedImport } = useCreateImportBatch();` alongside the other hooks at the top of `useOpenObjectRecordsSpreadsheetImportDialog`, and replace:

```ts
        try {
          await batchCreateManyRecords({
            recordsToCreate: createInputs,
            upsert: true,
          });
          await apolloCoreClient.refetchQueries({
            updateCache: (cache) => {
              cache.evict({ fieldName: objectMetadataItem.namePlural });
            },
          });
        } catch (error: any) {
          enqueueErrorSnackBar({
            apolloError: error,
          });
        }
```

with:

```ts
        try {
          await runGuidedImport({
            objectNameSingular,
            fileName: options?.fileName ?? `${objectNameSingular}-import.csv`,
            rawRows: data.validStructuredRows as never,
            mappedRows: createInputs,
            columnMapping: Object.fromEntries(
              spreadsheetImportFields.map((field) => [field.label, field.key]),
            ),
          });
          await apolloCoreClient.refetchQueries({
            updateCache: (cache) => {
              cache.evict({ fieldName: objectMetadataItem.namePlural });
            },
          });
        } catch (error: any) {
          enqueueErrorSnackBar({
            apolloError: error,
          });
        }
```

`useBatchCreateManyRecords` and its wiring stay in the file unused by this path but are not deleted — the `mutationBatchSize`/`abortController` machinery around it is Launch 1-adjacent UI progress-tracking that a future task may still want; removing it is out of this task's scope and risks an unrelated regression. `options?.fileName` does not exist on `SpreadsheetImportDialogOptions` today — confirm at implementation time whether the library exposes the uploaded file's name anywhere in `data`; if not, hardcode a generic name and note it as a follow-up UX polish item, not a blocker.

- [ ] **Step 13: Frontend — failed-rows banner**

Create `components/SpreadsheetImportFailedRowsBanner.tsx`:

```tsx
import { useLazyQuery, useMutation } from '@apollo/client';
import { useState } from 'react';

import { useApolloCoreClient } from '@/object-metadata/hooks/useApolloCoreClient';
import { IMPORT_BATCH_PREVIEW } from '@/object-record/spreadsheet-import/graphql/queries/importBatch';
import { RETRY_FAILED_IMPORT_ROWS } from '@/object-record/spreadsheet-import/graphql/mutations/retryFailedImportRows';
import { REACT_APP_SERVER_BASE_URL } from '~/config';

type SpreadsheetImportFailedRowsBannerProps = {
  importBatchId: string;
};

export const SpreadsheetImportFailedRowsBanner = ({
  importBatchId,
}: SpreadsheetImportFailedRowsBannerProps) => {
  const apolloCoreClient = useApolloCoreClient();
  const [preview, setPreview] = useState<{ rowsWithErrorsCount: number } | null>(
    null,
  );
  const [fetchPreview] = useLazyQuery(IMPORT_BATCH_PREVIEW, {
    client: apolloCoreClient,
    fetchPolicy: 'network-only',
    onCompleted: (data) => setPreview(data.importBatchPreview),
  });
  const [retryFailedRows] = useMutation(RETRY_FAILED_IMPORT_ROWS, {
    client: apolloCoreClient,
  });

  if (!preview) {
    fetchPreview({ variables: { importBatchId } });

    return null;
  }

  if (preview.rowsWithErrorsCount === 0) {
    return null;
  }

  return (
    <div>
      <span>{preview.rowsWithErrorsCount} row(s) failed to import.</span>
      <a
        href={`${REACT_APP_SERVER_BASE_URL}/rest/import/${importBatchId}/failed-rows.csv`}
      >
        Download failed rows
      </a>
      <button
        onClick={() => retryFailedRows({ variables: { importBatchId } })}
      >
        Retry failed rows
      </button>
    </div>
  );
};
```

This is a functional-not-styled first pass — the component's design (Linaria styling, placement in the import dialog's result step) is left for a follow-up polish task; the plan's KISS budget for Phase 3 is the data path, not visual design. Confirm `REACT_APP_SERVER_BASE_URL` is the correct existing constant for building a REST URL client-side by grepping for its use in another `searm-front` REST-calling component before citing it.

- [ ] **Step 14: Lint, typecheck, commit**

```bash
npx nx lint:diff-with-main searm-server
npx nx lint:diff-with-main searm-front
npx nx typecheck searm-server
npx nx typecheck searm-front
git add packages/searm-server/src/modules/guided-import packages/searm-front/src/modules/object-record/spreadsheet-import
git commit -m "feat(import): failed rows downloadable and retryable; wire the frontend wizard"
```

---

### Task 11: End-to-end integration test

Proves the guided-import path and the ingestion-extraction path against a real database, exercising exactly the charter's Phase 3 exit gate: "Imports and connected-account events create traceable proposals with no duplicate writes and no cross-workspace leaks."

**Files:**
- Create: `packages/searm-server/test/integration/graphql/suites/guided-import/import-batch.integration-spec.ts`
- Create: `packages/searm-server/test/integration/graphql/suites/structured-extraction/participant-identity-proposal.integration-spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–10.

- [ ] **Step 1: Write the guided-import integration test**

Create `test/integration/graphql/suites/guided-import/import-batch.integration-spec.ts`. Read `test/integration/graphql/suites/object-generated/tasks.integration-spec.ts` and Launch 1's `test/integration/graphql/suites/ai-write-approval/proposal-approval.integration-spec.ts` first and copy their harness imports and request-helper pattern verbatim — the global test client, auth token handling, and `makeGraphqlAPIRequest`-style helper must not be reinvented.

Build the suite around these operations:

```ts
const CREATE_IMPORT_BATCH = `
  mutation CreateImportBatch($input: CreateImportBatchInput!) {
    createImportBatch(input: $input) { id status totalRows }
  }
`;

const PREPARE_IMPORT_BATCH = `
  mutation PrepareImportBatch($importBatchId: ID!) {
    prepareImportBatch(importBatchId: $importBatchId) { id status }
  }
`;

const IMPORT_BATCH_PREVIEW = `
  query ImportBatchPreview($importBatchId: ID!) {
    importBatchPreview(importBatchId: $importBatchId) {
      totalRows createCount updateCount proposeCount skipCount rowsWithErrorsCount
    }
  }
`;

const START_IMPORT_BATCH = `
  mutation StartImportBatch($importBatchId: ID!) {
    startImportBatch(importBatchId: $importBatchId) { id status }
  }
`;

const PENDING_PROPOSALS = `
  query PendingProposals {
    pendingProposals { id status items { id actionType objectNameSingular recordId payload } }
  }
`;
```

**(I14) This step is intentionally left at the same fixture-and-assertion-list granularity Launch 1's own Task 8 integration test uses for its setup phase** — copy that test's literal harness calls (`createOnePersonMutation`/direct repository seeding, whichever it uses) for step 1's person/company setup rather than inventing a new fixture-building pattern; do not write this step from scratch. The GraphQL operations block above is real and complete; what remains implementer-supplied is the setup and polling glue, which must use the exact same request helper as every other test in this suite directory, not a new one.

Assertions, in order — each numbered step below is one `it()` block using the `CREATE_IMPORT_BATCH`/`PREPARE_IMPORT_BATCH`/`IMPORT_BATCH_PREVIEW`/`START_IMPORT_BATCH`/`PENDING_PROPOSALS` operations declared above, chained in a single top-level `describe('guided import', () => { ... })` since later steps depend on the batch id from step 2:

1. Create a person with email `existing@acme.com` and `jobTitle: 'Sales Manager'` at a company with `domainName: 'acme.com'` directly (setup, not under test) — same direct-creation helper Launch 1's `proposal-approval.integration-spec.ts` uses for its own record fixtures.
2. Call `CREATE_IMPORT_BATCH` with two rows: row A maps to `{ emails: { primaryEmail: 'existing@acme.com' }, jobTitle: 'VP Sales' }` (an EXACT email match against the setup person), row B maps to `{ emails: { primaryEmail: 'newperson@acme.com' } }` (no match at all). `expect(response.body.data.createImportBatch).toEqual(expect.objectContaining({ totalRows: 2, status: 'PENDING' }))`. Capture `importBatchId` from the response for every later call.
3. Call `PREPARE_IMPORT_BATCH`, then `IMPORT_BATCH_PREVIEW`. `expect(preview).toEqual(expect.objectContaining({ updateCount: 1, createCount: 1, proposeCount: 0, rowsWithErrorsCount: 0 }))`.
4. Call `START_IMPORT_BATCH`, then re-query the underlying `person` object directly (`FIND_MANY_PEOPLE`-style query, same pattern `object-generated/tasks.integration-spec.ts` uses to read back a written record) — the BullMQ job runs synchronously under the `sync.driver` test configuration (`core-modules/message-queue/drivers/sync.driver.ts`, verified on disk as the test-suite default), so no polling loop is needed, a single re-query after the mutation resolves is sufficient. `expect(existingPerson.jobTitle).toBe('VP Sales')` and `expect(newPerson).toBeDefined()` for the `newperson@acme.com` record.
5. Repeat steps 2–4 with a third `createImportBatch` call whose row maps `{ emails: { primaryEmail: 'existing.alt@acme.com' }, name: { firstName: 'Existing', lastName: 'Person' } }` (name matches the setup person, domain matches, email does not). `expect(preview.proposeCount).toBe(1)` after `PREPARE_IMPORT_BATCH`; after `START_IMPORT_BATCH`, `expect(pendingProposals.items.find((p) => p.sourceKey?.startsWith('import:'))).toBeDefined()` and re-read the setup person to assert `jobTitle` is still `'Sales Manager'` (nothing wrote directly).
6. Call `START_IMPORT_BATCH` again on the same `importBatchId` from step 5 (simulating a retried BullMQ job). `expect(pendingProposals.items.filter((p) => p.sourceKey === <the sourceKey captured in step 5>).length).toBe(1)` — idempotency, not a second proposal.

- [ ] **Step 2: Write the ingestion integration test**

Create `test/integration/graphql/suites/structured-extraction/participant-identity-proposal.integration-spec.ts`. Setup: a Person `Jane Doe` at a company with `domainName: 'acme.com'`. Resolve `MessagingMessageParticipantService` from the running Nest application context and call `saveMessageParticipants([{ messageId, handle: 'jane.doe@acme.com', displayName: 'Jane Doe', role: 'from' }], workspaceId)` directly — this is the exact code path a real inbound email import takes, minus the provider driver.

Assertions:

1. The created `messageParticipant` row's `personId` is initially `null` (no exact email match — the setup person's email is `jane@acme.com`, not `jane.doe@acme.com`).
2. `pendingProposals` returns one proposal whose single item has `actionType: 'UPDATE_RECORD'`, `objectNameSingular: 'messageParticipant'`, `payload: { personId: <setup person id> }`.
3. Approving that proposal via `approveProposal` (Launch 1's existing mutation) sets the `messageParticipant`'s `personId` to the setup person's id.

- [ ] **Step 3: Run both suites**

```bash
npx nx run searm-server:test:integration:with-db-reset
```

Expected: both new suites pass and no existing suite regresses.

- [ ] **Step 4: Full regression check**

```bash
npx nx test searm-server
npx nx test searm-front
npx nx lint:diff-with-main searm-server
npx nx lint:diff-with-main searm-front
npx nx typecheck searm-server
npx nx typecheck searm-front
```

Expected: all green.

- [ ] **Step 5: Manual end-to-end verification**

```bash
npx nx database:reset searm-server
yarn start
```

Sign in with "Continue with Email" and the prefilled credentials. Import a CSV of 10 people where 8 are new, 1 exactly matches an existing person by email, and 1 has a name/company match but a different email. Confirm: the wizard shows a preview with 8 create / 1 update / 1 propose; after starting, 9 records are written immediately and Settings → AI approvals shows one new pending proposal for the ambiguous row. Separately, connect a test mailbox (or seed a `message` record directly if no live provider is configured) from an address matching an existing person's name and company domain but a different email, and confirm a second pending proposal appears linking the message's participant.

- [ ] **Step 6: Commit**

```bash
git add packages/searm-server/test
git commit -m "feat(phase-3): add end-to-end ingestion and import integration coverage"
```

---

## Success criteria mapped to tasks

| Charter Phase 3 requirement | Verified by |
| --- | --- |
| Connected-account ingestion (email, calendar events, participants, call recordings) becomes proposals, not direct writes | Task 4 (message + call-recording content), Task 3 (participants), Task 11 integration step 2 |
| Deterministic email/domain/relationship matching prevents duplicate people and companies | Task 2 (EXACT/CANDIDATE/NONE), Task 3, Task 7, Task 9 |
| Ambiguous matches become proposals | Task 3 (participants), Task 4 (CANDIDATE facts dropped, never proposed against a guess), Task 9 (PROPOSE rows), Task 11 integration steps 5–6 |
| Import scans before writing and infers field and relationship mappings | Reused, not rebuilt — existing `searm-front` spreadsheet-import wizard (see Task 6/7 rationale); server-side staging in Task 6 |
| Users review validation errors, duplicates, mappings, and merge/skip/create rules before any write | Task 7 (match action), Task 8 (validation + preview), Task 10 (frontend wiring shows the preview before `startImportBatch`) |
| A resumable idempotent job imports rows | Task 9 — PENDING-only query is the resumability mechanism, tested explicitly |
| Failed rows stay downloadable and retryable | Task 10 |
| Imports may create research tasks but never bypass approval for AI-derived changes | Task 9's PROPOSE branch — never a direct write for a CANDIDATE match |
| No duplicate writes, no cross-workspace leaks (Phase 3 exit gate) | Task 1's `sourceKey` idempotency (Task 11 integration step 6), every new service scoping queries by `workspaceId` (Tasks 2, 3, 4, 7, 8, 9, 10) |
| Metadata-aware AI tools resolve custom-field labels, option values, relation targets | Task 5 |
| Identity matching is deterministic and explainable | Task 2 — every `IdentityMatch` carries `matchedOn`/`explanation`; no scoring, no LLM in the matching path itself |
| Ingestion-derived record changes go through `ProposalGateService` | Task 1 (`createFromExtraction`), used by Tasks 3, 4, 9 — no code path in this phase writes to an existing record outside a CANDIDATE/PROPOSE branch without going through it |

## Deliberately cut

| Cut | Trigger to build |
| --- | --- |
| Sample-value type voting for mapping inference (relaticle §2.2's confidence-floor voting layer) | The existing header-name-only mapping (already in `searm-front`) proves insufficient in practice — many columns stay unmapped despite recognizable data patterns |
| Per-value correction UI with row-count grouping, async per-column validation with progress polling (relaticle §2.4–2.5) | Import files large enough (10k+ rows) that the synchronous validation pass in Task 8 becomes noticeably slow, or users report wanting to fix a systemic bad value once instead of per-row |
| In-place "retry just this row" UI (vs. re-upload the failed-rows CSV) | Failed-row volume/frequency from real usage makes re-upload noticeably painful |
| Cross-object entity-link resolution (relaticle §2.3(b) — "what Company does this Person row belong to" as its own relationship-matching pass, independent from Task 7's own-record identity matching) | A workspace's import volume shows person-to-company linking errors are common; Task 7 already creates the Company via the existing `contact-creation-manager` domain-matching path when a Person's email domain is a work domain, which covers the common case |
| Structured extraction beyond job-title changes — commitments, risks, next actions as `Task`/`Opportunity` records (charter's "Inbox and meeting intelligence" step 3's full scope) | Job-title extraction (Task 4) is validated in production and reviewers approve most of what it proposes; extend the same pipeline (`StructuredPersonFactExtractionService`) with a second schema/target rather than a new pipeline |
| ~~Full `Evidence`/`Fact` provenance graph for extraction proposals~~ — **no longer cut.** The program review made Phase 2 a hard dependency shipping first; Task 4 now writes real `Evidence` and `createFromExtraction` attaches real `factIds` | n/a — built |
| Server-side `describe_custom_fields_<object>` discovery tool (original Task 5 Steps 7–11) | Collapsed into Phase 4 Task 8's permission-scoped `get_object_metadata`. Rebuild a dedicated tool only if `get_object_metadata`'s full-object payload proves too heavy for agents that only need one object's custom fields |
| Server-side mapping inference (`import-mapping-inference.service.ts`) | Was listed in this plan's File Structure but built by no task — a phantom deliverable, removed by the program review. The frontend wizard's existing header-name mapping is what ships; the sample-value voting layer keeps its own cut row above |
| Storage-strategy abstraction for relationship writes (relaticle Part 2) | Inherited from `CreateRecordService`/`UpdateRecordService`, which already know each relation field's storage shape. Build a separate abstraction only if a relation type is found that the record-crud services cannot write from a flat imported row |
| Intra-import Create→Update dedup promotion (two new rows in the *same file* matching each other) | Task 7 matches each row against the database, not against earlier rows in the same batch. Build when a real import is observed creating two records for one entity — the fix is an in-memory key cache in `ImportExecutionService`'s row loop, not a new service |
| Format-aware per-column date/number parsing chosen at mapping time | Inherited from the frontend wizard's existing parsing. Build when an import is observed mangling MM/DD vs DD/MM or locale decimal separators |
| Scheduled cleanup of stale `ImportBatch`/`ImportRow` staging rows | Standard retention job. Build when staging-table growth is actually observed, or when a retention policy is scoped for the platform as a whole |
| AI-proposable custom-field/schema CRUD (relaticle §1.6 — create/rename/deactivate/append-options via chat) | `AiWritePolicyService` overrides are used in practice for record fields; extend the same `<object>.<field>` override key format to metadata-mutation tool IDs |
| `kind`-bucketed proposal field descriptor for a schema-aware diff-review UI (relaticle §1.7) | Reviewers report the existing raw-JSON diff view (Launch 1) is hard to read for custom-field-heavy proposals |
| Near-duplicate "heads up" warning on proposal cards for near-simultaneous similar creates (relaticle §3.3) | Duplicate-adjacent proposals are observed in practice from retried or overlapping ingestion jobs |
| Duplicate-proposal collapsing by content-equality within the same thread (relaticle §3.2, beyond this phase's `sourceKey` exact-key idempotency) | Launch 1's own thread-based batching shows duplicate items appearing within one batch from a provider-level retry |
| Fully resolved relation-target labels in custom-field tool schema descriptions (Task 5's `relationTargetLabel` parameter, currently unwired) | An agent's relation-field guesses (even with the "look it up first" instruction) prove unreliable enough in practice to justify threading `flatObjectMetadataMaps` through `generateRecordPropertiesZodSchema`'s call chain |
| Calendar-event description-text extraction (only call-recording transcripts/summaries and message text are extraction sources in this phase) | Calendar `description` fields are observed in practice to carry meeting-content-equivalent detail (agendas, notes) worth extracting |
| Cross-workspace suppression lists / do-not-import allowlists | Outbound-adjacent import safety features are requested; this phase's scope is inbound data quality only |
| A dedicated `researchQueue`/second BullMQ queue split by ingestion-source type | The single `aiQueue` added in Task 4 shows contention between message extraction and call-recording extraction in practice |

## What this phase depends on from other phases

- **Launch 1 (Phase 1, `ai-write-approval`)** — hard dependency, already shipped on disk. Every proposal this phase creates uses `ProposalEntity`/`ProposalItemEntity`/`ProposalGateService`/`ProposalExecutionService` unmodified except for Task 1's additive `sourceKey` column and `createFromExtraction` method.
- **Phase 2 (`Evidence`/`Fact`/`AgentTask`/`AgentRun`)** — **hard dependency, ships first** (program review decision; see the superseded note at the top of this plan). Task 4 calls `EvidenceRecordingService.recordEvidence(...)`; Task 1's `createFromExtraction` calls `FactLookupService.findCurrentFactIdsForFields(...)`; `ProposalItemEntity.factIds` is a Phase 2 column. Tasks 2, 5, 6, 7, 8, 9, 10 have **no** Phase 2 dependency and can be built in parallel with Phase 2.
- **Phase 4 (agent API semantics)** — soft dependency, either order. Task 5's custom-field description enrichment is consumed by Phase 4 Task 8's permission-scoped `get_object_metadata`; neither blocks the other's tests.
- **SeaRM's existing, unmodified infrastructure** this phase extends rather than replaces: `contact-creation-manager` (deterministic Person/Company auto-creation from message/calendar sync — untouched), `MatchParticipantService` (exact-match participant linking — untouched, only extended with a second pass), `record-crud` services (`CreateRecordService`/`UpdateRecordService`/`FindRecordsService` — untouched, reused as-is by both direct writes and proposal application), the `searm-front` spreadsheet-import wizard (mapping/validation UI — untouched, its output is now routed to a new backend instead of `useBatchCreateManyRecords`), `ai-generate-text`/`ai-models`/`ai-billing` (LLM invocation and cost accounting — untouched, reused for structured extraction).

## Risks and unknowns

- **`GlobalWorkspaceOrmManager.getRepository`'s exact overload for string object names.** Used throughout this plan as `getRepository<T>(workspaceId, 'person' | 'company' | ..., options)`, matching `match-participant.service.ts` and `messaging-message-participant.service.ts` (both on disk). If the real signature differs for any specific object name, adjust the call site — this is a narrow, mechanical fix, not a design risk.
- **`WorkspaceManyOrAllFlatEntityMapsCacheService`'s exact map key names** (`byUniversalIdentifier` vs `byId`, and whether `flatObjectMetadataMaps`/`flatFieldMetadataMaps` entries carry every field this plan assumes — `nameSingular`, `labelSingular`, `icon`, `objectMetadataId`, `isCustom`, `options`). Verified once, against `database-tool.provider.ts`'s existing usage, but Tasks 5 and 8 both lean on the exact same shape holding for every object/field — if it doesn't, the fix is confirming the real field names and adjusting, not a redesign.
- **`aiQueue`'s auto-registration.** Confirmed the enum value exists on disk; not confirmed whether any BullMQ queues require an explicit registration step beyond the enum entry (Task 9's `importQueue` carries the same open question, flagged again there). If the driver auto-registers every `MessageQueue` value, no action is needed; if not, this is a one-line fix once the registration list is found.
- **Composite-field mapping correctness is entirely inherited from the existing frontend wizard.** This plan deliberately does not re-verify `buildRecordFromImportedStructuredRow`'s correctness for every composite field type (address, currency, links, phones) — it was read at a high level, not exhaustively tested against every field type during planning. If it has an existing bug for some field type, that bug now also affects the guided-import execution path, not just the old direct-write path. This is an acceptable inherited risk (the plan does not introduce it), but worth a targeted regression pass during Task 10 rather than assuming full correctness.
- **Message text and call-recording summaries may contain content the workspace does not want sent to a third-party LLM provider** (PII, contract terms, etc.). Task 4 sends full message/summary text to whatever model `workspace.fastModel` resolves to, with no redaction step. **Resolved by Owner Decision 3 (I11):** Task 4 Steps 9–10 add `ConnectedAccountEntity.excludeFromAiExtraction` and both listeners check it before enqueueing, so an opted-out connected account's content never reaches the LLM call at all — this is a code-level fix, now scoped, not a deferred follow-up. What remains genuinely out of scope: redaction/masking of content from accounts that are *not* opted out (full text still reaches the model for those), and any UI to set the toggle (see Task 4 Step 9's note — set via the mutation if it accepts arbitrary column updates, otherwise direct SQL/admin panel until a UI is scoped).
- **`ImportRowMatchAction.PROPOSE` rows' baseline can go stale between `prepareImportBatch` and `startImportBatch`** if a human edits the matched record in between — this is caught by `ProposalExecutionService`'s existing conflict detection at *approval* time (Launch 1, unmodified), not by anything in this phase, so it is closed, not open — noted here only so the reviewer of this plan does not need to re-derive that it's covered.
- **Per-row execution is not fully crash-atomic** (Task 9): the window between a successful `CreateRecordService.execute()` call and the row's status being persisted as `PROCESSED` is a real, accepted gap — a crash inside that window followed by a retry could create a duplicate record for a CREATE row. Closing this fully would need either a DB transaction spanning the workspace-schema write and the core-schema row update (two different TypeORM connections, not supported by the existing `record-crud` services per Launch 1's own design note on this exact limitation) or an idempotency key on `CreateRecordService` itself (which does not exist today). Accepted for the same reason Launch 1 accepted its own analogous gap on outbound sends: closing it is materially larger than this phase's budget, and the window is narrow in practice.

