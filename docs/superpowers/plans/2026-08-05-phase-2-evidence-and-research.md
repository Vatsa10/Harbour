# Phase 2 — Evidence and Durable Research Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent can research a record, persist what it observed as immutable `Evidence`, derive `Fact` rows from that evidence, and turn strong or conflicting facts into `ProposalItem`s that a reviewer can approve — with the evidence and facts visible in the approval UI so the reviewer sees *why* a change was proposed, dated, and sourced. Work is scheduled durably via `AgentTask` (leased, retried with backoff, cancellable, budgeted) and executed via `AgentRun`, both new core-schema entities. Every record mutation still flows through the Launch 1 `ProposalGateService` — this phase adds evidence upstream of proposals, it does not add a second write path.

**Architecture:** Two new sibling entity groups under `engine/metadata-modules/ai/`: `ai-research` (Evidence, Fact, AgentTask, AgentRun, and the services/jobs that create and derive them) and an extension of the existing `ai-write-approval` module (Launch 1) to attach `factIds` to a `ProposalItem` at proposal-creation time, and to permanently dismiss a `Fact` when the reviewer rejects the item it produced. A durable `AgentTask` is claimed by a cron+queue-worker pair modeled directly on Twenty's own `messaging-message-list-fetch` cron/job pattern (compare-and-swap claim, no new locking primitive). The worker invokes Twenty's existing `AgentAsyncExecutorService.executeAgent()` — extended with one new optional `threadId` parameter so every tool call from one research run batches into one `Proposal`, exactly like one chat turn does today.

**Tech Stack:** NestJS 10, TypeORM, PostgreSQL 16, GraphQL (code-first, metadata schema), BullMQ (`message-queue` module), React 18 + Jotai + Linaria, Nx, Jest.

**Depends on:** Launch 1 (`docs/superpowers/plans/2026-08-05-ai-write-approval.md`) — `ProposalEntity`, `ProposalItemEntity`, `ProposalGateService`, `ProposalExecutionService`, `ToolExecutorService.dispatch()` gate, `AiWritePolicyService`. All of these exist in this checkout today. This plan extends them; it does not replace or duplicate them.

**Verified against commit `dba03d0907`** (`style(ai-write-approval): apply oxfmt to the fix-wave changes`), the head of the five-commit fix wave `c6e057906b..HEAD` that repaired Launch 1's DI wiring, policy resolution, and bulk payload replay. Every find-and-replace block, type, signature, import path, GraphQL operation, permission flag, decorator, and line number quoted below was re-read against that checkout, not carried over from an earlier revision of this plan. Where this plan quotes live code it quotes it verbatim with line numbers; where a quoted block does not match what you find on disk, **the disk wins** — stop and re-derive the edit rather than forcing the match.

**Working directory for all paths below:** `d:\Files\Vatsa\Projects\AI-CRM\twenty`

## Global Constraints

Copied from the repo's `CLAUDE.md`, the product charter, and Launch 1's own constraints. Every task's requirements implicitly include this section.

- **Named exports only.** No default exports anywhere.
- **No `any`.** Strict TypeScript enforced.
- **Types over interfaces**, except when extending a third-party interface.
- **String literal unions over enums**, except GraphQL enums (real TS enums registered with `registerEnumType`) — every status/kind type that crosses GraphQL in this plan is a real enum for that reason, matching `ProposalStatus`/`ProposalItemStatus`/`ProposalActionType` in Launch 1.
- **Functional components only** in `twenty-front`.
- **File naming:** kebab-case with suffix — `.service.ts`, `.entity.ts`, `.dto.ts`, `.module.ts`, `.resolver.ts`, `.job.ts`. Front components are PascalCase `.tsx`.
- **Comments:** short-form `//` only, no JSDoc blocks. Explain WHY, not WHAT.
- **Use `isDefined()` from `twenty-shared/utils`** rather than hand-rolled null checks.
- **Services under 500 lines, components under 300 lines.**
- **Entity registration is automatic** — `core.datasource.ts` globs `engine/metadata-modules/**/*.entity.{ts,js}`. Do not add entities to any registry list.
- **Schema changes ship as instance commands**, not TypeORM migrations. Generate with `npx nx run twenty-server:database:migrate:generate --name <name> --type fast`. Never rewrite a committed command's `up`/`down` — read `packages/twenty-server/docs/UPGRADE_COMMANDS.md` first.
- **Every AI-derived record mutation goes through `ProposalGateService`/`ProposalExecutionService`.** This phase never writes to a workspace object table directly from agent-derived data — `Evidence` and `Fact` are new *platform* tables (core schema), not a second path to CRM records.
- **Custom objects are the only extension mechanism for business-specific records.** Nothing in this plan is business-specific — `Evidence`/`Fact`/`AgentTask`/`AgentRun` are platform trust-layer entities, exactly the class of thing `Proposal`/`ProposalItem` already are, so they follow the same core-schema TypeORM entity pattern (§7 of the anchors report: core-schema entity is the correct, cheaper mechanism here — not a standard object, which the charter reserves for workspace-visible business records).
- **Agents report observations, never confidence.** `Evidence.strength` is computed server-side from a fixed `sourceType → strength` table (`ai-research/types/evidence.type.ts`), never supplied by the model. This is the single most important design decision ported from the `crm` scouting report — it is what makes strength auditable and ungameable.
- **`Fact` is reachable only through `FactService`** (program §0 Owner Decision 1). `FactEntity`'s repository is registered in `AiResearchModule`'s `TypeOrmModule.forFeature` and `TypeOrmModule` is **not** re-exported from that module, so no code in Phase 3/4/5 can inject `Repository<FactEntity>`. `FactDerivationService` is a provider of `AiResearchModule` and is **not exported** — it is derivation internals. The only exported fact surface is `FactService`. If `Fact` is later promoted to a standard object (the Decision 1 fork), one module changes, not the program.
- **Every task carries at least one test that exercises a real seam, not a doubled one.** Launch 1 shipped three Criticals behind a green suite because its specs mocked the exact seam that was broken (see `proposal-gate.service.spec.ts:53-55`, which uses the *real* `AiWritePolicyService` for precisely this reason). Follow that precedent: double the TypeORM repository, and use the real collaborating service. Where a task's only seam is the database, the real-seam coverage lives in Task 13's integration suite and the task names which step covers it.
- Lint and typecheck after each task: `npx nx lint:diff-with-main twenty-server` and `npx nx typecheck twenty-server`.
- **Test-count expectations are written as "all pre-existing tests plus the N new ones"** for any suite this plan extends. Launch 1's suites are larger than any absolute count a plan could hard-code (`proposal-gate.service.spec.ts` has 20 test declarations; `proposal-execution.service.spec.ts` has 22), and a hard-coded number invites an executor to "repair" a suite that was never broken.

## File Structure

**New — server, `ai-research` module** (all under `packages/twenty-server/src/engine/metadata-modules/ai/ai-research/`):

| File | Responsibility |
| --- | --- |
| `entities/evidence.entity.ts` | `EvidenceEntity` — immutable observation |
| `entities/fact.entity.ts` | `FactEntity` — sourced, supersedable assertion |
| `entities/agent-task.entity.ts` | `AgentTaskEntity` — durable leased scheduled work |
| `entities/agent-run.entity.ts` | `AgentRunEntity` — one execution of an `AgentTask` |
| `types/evidence.type.ts` | `EvidenceSourceType`, `EvidenceStrength`, `EVIDENCE_SOURCE_STRENGTH`, `EvidencePayload` |
| `types/fact-status.type.ts` | `FactStatus` enum |
| `types/agent-task-status.type.ts` | `AgentTaskStatus` enum |
| `types/agent-run-status.type.ts` | `AgentRunStatus` enum |
| `constants/agent-task.const.ts` | Lease duration, batch size, default budget/attempts, backoff formula |
| `constants/research-agent-prompts.const.ts` | System/user prompt builders for a research run |
| `utils/hash-evidence-payload.util.ts` | sha256 of an `EvidencePayload` |
| `services/evidence-recording.service.ts` | `recordEvidence()` — writes `Evidence`, triggers derivation |
| `services/fact-derivation.service.ts` | `deriveFact()` — deterministic strength/conflict/supersession/dismissal logic (module-internal, not exported) |
| `services/fact.service.ts` | **The only exported `Fact` boundary** (Decision 1): `findCurrentFactIdsForFields`, `markDismissed`, `findProposalItemFacts` |
| `services/agent-task.service.ts` | `createTask`/`claimDueTasks`/`reapAbandonedTasks`/`completeTask`/`failTask`/`cancelTask` |
| `services/research-agent.service.ts` | Resolves (and role-binds, idempotently) the seeded per-workspace research agent (Owner Decision 4) |
| `constants/research-agent.const.ts` | `RESEARCH_AGENT_UNIVERSAL_IDENTIFIER`, `RESEARCH_AGENT_ROLE_UNIVERSAL_IDENTIFIER` |
| `crons/jobs/agent-task-dispatch.cron.job.ts` | Claims due tasks, enqueues one worker job each |
| `crons/commands/agent-task-dispatch.cron.command.ts` | Registers the cron pattern |
| `jobs/agent-task-run.job.ts` | Worker: runs the agent, records the `AgentRun`, completes/fails the task |
| `dtos/agent-task.dto.ts` | `AgentTaskDTO` |
| `dtos/create-agent-task.input.ts` | `CreateAgentTaskInput` |
| `resolvers/agent-task.resolver.ts` | `agentTasks`, `createAgentTask`, `cancelAgentTask` |
| `ai-research.module.ts` | Nest module wiring |

**New — server, tool files** (under `packages/twenty-server/src/engine/core-modules/tool/tools/`):

| File | Responsibility |
| --- | --- |
| `record-evidence-tool/record-evidence-tool.schema.ts` | Zod input schema for the `record_evidence` tool |
| `record-evidence-tool/record-evidence-tool.ts` | `RecordEvidenceTool implements Tool` |
| `create-agent-task-tool/create-agent-task-tool.schema.ts` | Zod input schema for the `create_agent_task` tool |
| `create-agent-task-tool/create-agent-task-tool.ts` | `CreateAgentTaskTool implements Tool` |

**Modified — server, workspace bootstrap (Owner Decision 4):**

| File | Change |
| --- | --- |
| `engine/workspace-manager/twenty-standard-application/constants/standard-agent.constant.ts` | Add the `researcher` entry |
| `engine/workspace-manager/twenty-standard-application/utils/agent-metadata/create-standard-flat-agent-metadata.util.ts` | Add the `researcher` builder |
| `engine/workspace-manager/twenty-standard-application/constants/standard-role.constant.ts` | Add the `aiResearcher` entry |
| `engine/workspace-manager/twenty-standard-application/utils/role-metadata/create-standard-flat-role-metadata.util.ts` | Add the `aiResearcher` builder (`canBeAssignedToAgents: true`) |

**Modified — server, existing Launch 1 files:**

| File | Change |
| --- | --- |
| `engine/metadata-modules/ai/ai-write-approval/entities/proposal-item.entity.ts` | Add `factIds: string[]` jsonb column |
| `engine/metadata-modules/ai/ai-write-approval/services/proposal-gate.service.ts` | Ungate `record_evidence` and `create_agent_task`; look up current facts for the touched fields, attach `factIds` |
| `engine/metadata-modules/ai/ai-write-approval/services/proposal-execution.service.ts` | On reject, mark the backing facts `DISMISSED` |
| `engine/metadata-modules/ai/ai-write-approval/dtos/proposal.dto.ts` | Add `factIds: string[]` and the `ProposalItemFactDTO` flat projection to `ProposalItemDTO` |
| `engine/metadata-modules/ai/ai-write-approval/resolvers/proposal-item-fields.resolver.ts` (new file, same module) | `ProposalItemDTO.facts` resolve field — the single citation surface |
| `engine/metadata-modules/ai/ai-write-approval/ai-write-approval.module.ts` | Import `AiResearchModule`, register `ProposalItemFieldsResolver` |
| `engine/metadata-modules/ai/ai-agent-execution/services/agent-async-executor.service.ts` | Add optional `threadId` param, thread it into both tool-context builders |
| `engine/core-modules/tool-provider/providers/action-tool.provider.ts` | Register `record_evidence` |
| `engine/core-modules/tool-provider/tool-provider.module.ts` | Import `AiResearchModule` |
| `engine/core-modules/message-queue/message-queue.constants.ts` | Add `agentTaskQueue` |
| `database/commands/cron-register-all.command.ts` | Register the new cron command |
| `packages/twenty-front/src/modules/settings/ai-approvals/graphql/queries/pendingProposals.ts` | Select `factIds` and nested `facts { ... evidence { ... } }` |
| `packages/twenty-front/src/modules/settings/ai-approvals/components/ProposalDiffTable.tsx` | Render a "Why" citation line per diff row |

---

### Task 1: Evidence and Fact types, entities, and migration

`Evidence` is an immutable observation. `Fact` is a sourced, supersedable assertion derived from one or more `Evidence` rows. Neither writes to a CRM record — that only ever happens later, through `ProposalGateService`.

**Files:**
- Create: `packages/twenty-server/src/engine/metadata-modules/ai/ai-research/types/evidence.type.ts`
- Create: `packages/twenty-server/src/engine/metadata-modules/ai/ai-research/types/fact-status.type.ts`
- Create: `packages/twenty-server/src/engine/metadata-modules/ai/ai-research/entities/evidence.entity.ts`
- Create: `packages/twenty-server/src/engine/metadata-modules/ai/ai-research/entities/fact.entity.ts`
- Create: `packages/twenty-server/src/engine/metadata-modules/ai/ai-research/utils/hash-evidence-payload.util.ts`
- Test: `packages/twenty-server/src/engine/metadata-modules/ai/ai-research/utils/__tests__/hash-evidence-payload.util.spec.ts`
- Create: an instance command (generated — exact path produced by the generator)

**Interfaces:**
- Produces: `EvidenceEntity`, `FactEntity`, `EvidenceSourceType`, `EvidenceStrength`, `EVIDENCE_SOURCE_STRENGTH`, `EvidencePayload`, `FactStatus`, `hashEvidencePayload(payload: EvidencePayload): string`.

- [ ] **Step 1: Write the evidence types**

Create `types/evidence.type.ts`:

```ts
export type EvidenceSourceType =
  | 'CRM_RECORD'
  | 'CRM_ACTIVITY'
  | 'WEB_SEARCH'
  | 'MANUAL'
  // Phase 3 ingestion/import sources. Declared here, in the one owning table,
  // so Phase 3 never invents a parallel provenance vocabulary.
  | 'EMAIL_MESSAGE'
  | 'CALL_RECORDING'
  | 'IMPORT_FILE';

export type EvidenceStrength = 'STRONG' | 'WEAK';

// Deterministic, server-assigned strength per source type — never reported by
// the model. Our own CRM data and human input are STRONG; anything fetched
// from outside the CRM, or inferred by a model from unstructured text, is WEAK
// until proven otherwise by a second source.
export const EVIDENCE_SOURCE_STRENGTH: Record<
  EvidenceSourceType,
  EvidenceStrength
> = {
  CRM_RECORD: 'STRONG',
  CRM_ACTIVITY: 'STRONG',
  MANUAL: 'STRONG',
  // A file a human uploaded and mapped is a direct human assertion.
  IMPORT_FILE: 'STRONG',
  WEB_SEARCH: 'WEAK',
  // The message/recording itself is first-party, but the *claim* is model-
  // inferred from prose, so it must never silently supersede a STRONG fact.
  EMAIL_MESSAGE: 'WEAK',
  CALL_RECORDING: 'WEAK',
};

// What was actually observed. `value` is the raw claim; `snippet` is an
// optional short excerpt a reviewer can read without following the source.
export type EvidencePayload = {
  fieldName: string;
  value: unknown;
  snippet?: string;
};
```

- [ ] **Step 2: Write the fact status type**

Create `types/fact-status.type.ts`:

```ts
// Exposed through GraphQL (Task 11), so this is a real enum per the
// string-literal-unions-except-GraphQL-enums rule.
export enum FactStatus {
  CURRENT = 'CURRENT',
  SUPERSEDED = 'SUPERSEDED',
  DISMISSED = 'DISMISSED',
}
```

- [ ] **Step 3: Write the failing hash util test**

Create `utils/__tests__/hash-evidence-payload.util.spec.ts`:

```ts
import { hashEvidencePayload } from 'src/engine/metadata-modules/ai/ai-research/utils/hash-evidence-payload.util';

describe('hashEvidencePayload', () => {
  it('should produce the same hash for the same payload', () => {
    const payload = { fieldName: 'employeeCount', value: '500' };

    expect(hashEvidencePayload(payload)).toBe(hashEvidencePayload(payload));
  });

  it('should produce a different hash when the value differs', () => {
    const a = hashEvidencePayload({ fieldName: 'employeeCount', value: '500' });
    const b = hashEvidencePayload({ fieldName: 'employeeCount', value: '600' });

    expect(a).not.toBe(b);
  });

  it('should produce a 64-character hex sha256 digest', () => {
    const hash = hashEvidencePayload({ fieldName: 'x', value: 'y' });

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
cd packages/twenty-server && npx jest hash-evidence-payload.util.spec
```

Expected: FAIL — `Cannot find module '.../hash-evidence-payload.util'`.

- [ ] **Step 5: Write the util**

Create `utils/hash-evidence-payload.util.ts`:

```ts
import { createHash } from 'crypto';

import { type EvidencePayload } from 'src/engine/metadata-modules/ai/ai-research/types/evidence.type';

export const hashEvidencePayload = (payload: EvidencePayload): string =>
  createHash('sha256').update(JSON.stringify(payload)).digest('hex');
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
cd packages/twenty-server && npx jest hash-evidence-payload.util.spec
```

Expected: PASS, 3 tests.

- [ ] **Step 7: Write the evidence entity**

Create `entities/evidence.entity.ts`. Pattern copied from `ProposalEntity` (Launch 1), with one deliberate difference: no `@UpdateDateColumn` — no service in this plan ever calls `save()` on an existing `Evidence` row, only `insert`/first `save()`. That is what "immutable" means at the code level:

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
} from 'typeorm';

import {
  type EvidencePayload,
  type EvidenceSourceType,
  type EvidenceStrength,
} from 'src/engine/metadata-modules/ai/ai-research/types/evidence.type';
import type { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

// Immutable observation. No @UpdateDateColumn — nothing in this codebase
// ever updates an existing row, only inserts new ones, so "why did the agent
// propose this, dated Y, from source Z" is always answerable from data that
// was never edited after the fact.
@Entity({ name: 'evidence', schema: 'core' })
@Index('IDX_EVIDENCE_RECORD', [
  'workspaceId',
  'objectNameSingular',
  'recordId',
])
export class EvidenceEntity {
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

  @Column({ type: 'uuid' })
  recordId: string;

  // The AgentRun that produced this observation, when one exists. Nullable
  // because Phase 3's ingestion and import jobs are deterministic background
  // workers with no AgentRun — for those rows `sourceLocator` + `extractor`
  // carry the full traceability the Evidence contract requires. An agent-
  // produced observation must always set this.
  @Column({ type: 'uuid', nullable: true })
  @Index()
  runId: string | null;

  @Column({ type: 'varchar' })
  sourceType: EvidenceSourceType;

  // URL, record reference, or human-readable description of where this was seen.
  @Column({ type: 'text' })
  sourceLocator: string;

  @Column({ type: 'timestamptz' })
  observedAt: Date;

  // Tool/agent identifier that produced this row, e.g. "agent-run:<agentId>".
  @Column({ type: 'varchar' })
  extractor: string;

  @Column({ type: 'jsonb' })
  payload: EvidencePayload;

  // sha256 of payload — lets a duplicate observation be recognized without
  // re-parsing content.
  @Column({ type: 'varchar', length: 64 })
  payloadHash: string;

  // Deterministic, assigned server-side from sourceType. Never agent-reported.
  @Column({ type: 'varchar' })
  strength: EvidenceStrength;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
```

- [ ] **Step 8: Write the fact entity**

Create `entities/fact.entity.ts`:

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

import { type EvidenceStrength } from 'src/engine/metadata-modules/ai/ai-research/types/evidence.type';
import { FactStatus } from 'src/engine/metadata-modules/ai/ai-research/types/fact-status.type';
import type { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

@Entity({ name: 'fact', schema: 'core' })
@Index('IDX_FACT_CURRENT_LOOKUP', [
  'workspaceId',
  'objectNameSingular',
  'recordId',
  'fieldName',
  'status',
])
export class FactEntity {
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

  @Column({ type: 'uuid' })
  @Index()
  recordId: string;

  @Column({ type: 'varchar' })
  fieldName: string;

  @Column({ type: 'jsonb' })
  value: unknown;

  @Column({ type: 'varchar', default: FactStatus.CURRENT })
  status: FactStatus;

  // True when a differing value was observed in the same research run as
  // this fact's own evidence — a genuine contradiction, not a change over
  // time. Set on both facts in the pair.
  @Column({ type: 'boolean', default: false })
  hasConflict: boolean;

  @Column({ type: 'varchar' })
  strength: EvidenceStrength;

  // Evidence rows that support this fact. Grows on corroboration (same
  // value observed again); a new Fact row is only created when the value
  // itself changes.
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  evidenceIds: string[];

  // The run whose evidence most recently touched this fact. Null when the
  // most recent evidence came from a Phase 3 ingestion/import worker.
  @Column({ type: 'uuid', nullable: true })
  runId: string | null;

  // Freshness (charter trust-layer table). Not createdAt and not updatedAt:
  // this is when the *world* was observed, copied from the observing
  // Evidence.observedAt, so a fact corroborated today by a source dated last
  // year does not read as fresh. Corroboration advances it; supersession
  // starts a new row with its own value.
  @Column({ type: 'timestamptz' })
  lastObservedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  supersededAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  supersededByFactId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
```

- [ ] **Step 9: Generate the instance command**

```bash
npx nx run twenty-server:database:migrate:generate --name add-ai-research-evidence-and-fact --type fast
```

Open the generated file and fill `up`:

```sql
CREATE TABLE "core"."evidence" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" uuid NOT NULL,
  "objectNameSingular" varchar NOT NULL,
  "recordId" uuid NOT NULL,
  "runId" uuid,
  "sourceType" varchar NOT NULL,
  "sourceLocator" text NOT NULL,
  "observedAt" timestamptz NOT NULL,
  "extractor" varchar NOT NULL,
  "payload" jsonb NOT NULL,
  "payloadHash" varchar(64) NOT NULL,
  "strength" varchar NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "PK_evidence" PRIMARY KEY ("id"),
  CONSTRAINT "FK_evidence_workspace" FOREIGN KEY ("workspaceId")
    REFERENCES "core"."workspace"("id") ON DELETE CASCADE
);
CREATE INDEX "IDX_EVIDENCE_WORKSPACE_ID" ON "core"."evidence" ("workspaceId");
CREATE INDEX "IDX_EVIDENCE_RUN_ID" ON "core"."evidence" ("runId");
CREATE INDEX "IDX_EVIDENCE_RECORD" ON "core"."evidence" ("workspaceId", "objectNameSingular", "recordId");

CREATE TABLE "core"."fact" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" uuid NOT NULL,
  "objectNameSingular" varchar NOT NULL,
  "recordId" uuid NOT NULL,
  "fieldName" varchar NOT NULL,
  "value" jsonb NOT NULL,
  "status" varchar NOT NULL DEFAULT 'CURRENT',
  "hasConflict" boolean NOT NULL DEFAULT false,
  "strength" varchar NOT NULL,
  "evidenceIds" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "runId" uuid,
  "lastObservedAt" timestamptz NOT NULL,
  "supersededAt" timestamptz,
  "supersededByFactId" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "PK_fact" PRIMARY KEY ("id"),
  CONSTRAINT "FK_fact_workspace" FOREIGN KEY ("workspaceId")
    REFERENCES "core"."workspace"("id") ON DELETE CASCADE
);
CREATE INDEX "IDX_FACT_WORKSPACE_ID" ON "core"."fact" ("workspaceId");
CREATE INDEX "IDX_FACT_RECORD_ID" ON "core"."fact" ("recordId");
CREATE INDEX "IDX_FACT_CURRENT_LOOKUP" ON "core"."fact" ("workspaceId", "objectNameSingular", "recordId", "fieldName", "status");
```

And `down`:

```sql
DROP TABLE "core"."fact";
DROP TABLE "core"."evidence";
```

- [ ] **Step 10: Apply and verify**

```bash
npx nx run twenty-server:database:migrate:prod
psql "$PG_DATABASE_URL" -c '\d core."evidence"' -c '\d core."fact"'
```

Expected: both tables present with the columns above.

- [ ] **Step 11: Typecheck and commit**

```bash
npx nx typecheck twenty-server
git add packages/twenty-server/src/engine/metadata-modules/ai/ai-research packages/twenty-server/src/database
git commit -m "feat(ai-research): add evidence and fact entities"
```

---

### Task 2: Fact derivation — the evidence-to-fact pipeline

The core deterministic logic: given one new `Evidence` row, decide whether it corroborates the current fact, supersedes it, conflicts with it, or is suppressed because a human already dismissed this exact value. This is the smallest version of the `crm` repo's evidence-scoring pipeline that still makes strength, conflict, and supersession real — no noisy-OR combination, no weight table with a dozen tuned constants, no confidence bands. Two strength tiers, one comparison, one conflict rule, one dismissal check.

**Files:**
- Create: `packages/twenty-server/src/engine/metadata-modules/ai/ai-research/services/fact-derivation.service.ts`
- Create: `packages/twenty-server/src/engine/metadata-modules/ai/ai-research/services/evidence-recording.service.ts`
- Test: `packages/twenty-server/src/engine/metadata-modules/ai/ai-research/services/__tests__/fact-derivation.service.spec.ts`
- Test: `packages/twenty-server/src/engine/metadata-modules/ai/ai-research/services/__tests__/evidence-recording.service.spec.ts`

**Interfaces:**
- Consumes: `EvidenceEntity`, `FactEntity`, `FactStatus`, `EVIDENCE_SOURCE_STRENGTH`, `hashEvidencePayload` (Task 1).
- Produces:
  - `FactDerivationService.deriveFact(evidence: EvidenceEntity): Promise<FactEntity | null>` (`null` means the value was previously dismissed and was deliberately not re-proposed)
  - `EvidenceRecordingService.recordEvidence(params): Promise<EvidenceEntity>`

- [ ] **Step 1: Write the failing fact-derivation test**

Create `services/__tests__/fact-derivation.service.spec.ts`:

```ts
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { FactEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/fact.entity';
import { FactDerivationService } from 'src/engine/metadata-modules/ai/ai-research/services/fact-derivation.service';
import { FactStatus } from 'src/engine/metadata-modules/ai/ai-research/types/fact-status.type';

const buildEvidence = (overrides: Record<string, unknown> = {}) => ({
  id: 'evidence-1',
  workspaceId: 'workspace-1',
  objectNameSingular: 'company',
  recordId: 'record-1',
  runId: 'run-1',
  sourceType: 'CRM_RECORD',
  strength: 'STRONG',
  observedAt: new Date('2026-08-01T00:00:00.000Z'),
  payload: { fieldName: 'employeeCount', value: '500' },
  ...overrides,
} as never);

describe('FactDerivationService', () => {
  let service: FactDerivationService;

  // findOne answers the CURRENT lookup; find answers the dismissal lookup.
  // Two distinct methods rather than ordered mockResolvedValueOnce calls, so
  // reordering the two lookups in the service cannot silently pass.
  const factRepository = { findOne: jest.fn(), find: jest.fn(), save: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    factRepository.findOne.mockResolvedValue(null);
    factRepository.find.mockResolvedValue([]);
    factRepository.save.mockImplementation(async (entity) => ({
      id: entity.id ?? 'fact-new',
      ...entity,
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FactDerivationService,
        { provide: getRepositoryToken(FactEntity), useValue: factRepository },
      ],
    }).compile();

    service = module.get<FactDerivationService>(FactDerivationService);
  });

  it('should create a new CURRENT fact when none exists yet', async () => {
    const fact = await service.deriveFact(buildEvidence());

    expect(factRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        fieldName: 'employeeCount',
        value: '500',
        status: FactStatus.CURRENT,
        hasConflict: false,
        evidenceIds: ['evidence-1'],
        strength: 'STRONG',
        lastObservedAt: new Date('2026-08-01T00:00:00.000Z'),
      }),
    );
    expect(fact?.status).toBe(FactStatus.CURRENT);
  });

  it('should append to evidenceIds and advance freshness when the same value is corroborated', async () => {
    factRepository.findOne.mockResolvedValue({
      id: 'fact-1',
      value: '500',
      status: FactStatus.CURRENT,
      evidenceIds: ['evidence-0'],
      runId: 'run-0',
      lastObservedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    await service.deriveFact(buildEvidence({ id: 'evidence-2' }));

    expect(factRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'fact-1',
        evidenceIds: ['evidence-0', 'evidence-2'],
        lastObservedAt: new Date('2026-08-01T00:00:00.000Z'),
      }),
    );
  });

  it('should not move freshness backwards when an older observation corroborates', async () => {
    factRepository.findOne.mockResolvedValue({
      id: 'fact-1',
      value: '500',
      status: FactStatus.CURRENT,
      evidenceIds: ['evidence-0'],
      runId: 'run-0',
      lastObservedAt: new Date('2026-08-01T00:00:00.000Z'),
    });

    await service.deriveFact(
      buildEvidence({
        id: 'evidence-2',
        observedAt: new Date('2025-01-01T00:00:00.000Z'),
      }),
    );

    expect(factRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        lastObservedAt: new Date('2026-08-01T00:00:00.000Z'),
      }),
    );
  });

  it('should supersede the prior fact when a different value arrives from a later run', async () => {
    factRepository.findOne.mockResolvedValue({
      id: 'fact-1',
      value: '400',
      status: FactStatus.CURRENT,
      evidenceIds: ['evidence-0'],
      runId: 'run-0',
      lastObservedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    await service.deriveFact(buildEvidence({ runId: 'run-1' }));

    expect(factRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        value: '500',
        status: FactStatus.CURRENT,
        hasConflict: false,
      }),
    );
    expect(factRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'fact-1',
        status: FactStatus.SUPERSEDED,
      }),
    );
  });

  it('should mark both facts conflicted when a different value arrives from the same run', async () => {
    factRepository.findOne.mockResolvedValue({
      id: 'fact-1',
      value: '400',
      status: FactStatus.CURRENT,
      evidenceIds: ['evidence-0'],
      runId: 'run-1',
      lastObservedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    await service.deriveFact(buildEvidence({ runId: 'run-1' }));

    expect(factRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'fact-1', hasConflict: true }),
    );
    expect(factRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        value: '500',
        status: FactStatus.CURRENT,
        hasConflict: true,
      }),
    );
  });

  it('should not re-propose a value a human already dismissed', async () => {
    factRepository.find.mockResolvedValue([
      { id: 'fact-dismissed', value: '500', status: FactStatus.DISMISSED },
    ]);

    const fact = await service.deriveFact(buildEvidence());

    expect(fact).toBeNull();
    expect(factRepository.save).not.toHaveBeenCalled();
  });

  // I4(a): the dismissal check used to sit inside the "no CURRENT fact yet"
  // branch, so a dismissed value re-observed while any CURRENT fact existed
  // superseded it and re-proposed — the exact nag the feature prevents.
  it('should still suppress a dismissed value when a different CURRENT fact exists for the field', async () => {
    factRepository.findOne.mockResolvedValue({
      id: 'fact-1',
      value: '400',
      status: FactStatus.CURRENT,
      evidenceIds: ['evidence-0'],
      runId: 'run-0',
      lastObservedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    factRepository.find.mockResolvedValue([
      { id: 'fact-dismissed', value: '500', status: FactStatus.DISMISSED },
    ]);

    const fact = await service.deriveFact(buildEvidence({ runId: 'run-1' }));

    expect(fact).toBeNull();
    expect(factRepository.save).not.toHaveBeenCalled();
  });

  // I4(b): findOne with no value filter returned an arbitrary dismissed row,
  // so two dismissed values on one field made the check nondeterministic.
  it('should check every dismissed value for the field, not an arbitrary one', async () => {
    factRepository.find.mockResolvedValue([
      { id: 'fact-dismissed-a', value: '300', status: FactStatus.DISMISSED },
      { id: 'fact-dismissed-b', value: '500', status: FactStatus.DISMISSED },
    ]);

    const fact = await service.deriveFact(buildEvidence());

    expect(fact).toBeNull();
    expect(factRepository.save).not.toHaveBeenCalled();
  });

  it('should create the fact when a different value was dismissed', async () => {
    factRepository.find.mockResolvedValue([
      { id: 'fact-dismissed-a', value: '300', status: FactStatus.DISMISSED },
    ]);

    const fact = await service.deriveFact(buildEvidence());

    expect(fact?.status).toBe(FactStatus.CURRENT);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/twenty-server && npx jest fact-derivation.service.spec
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the fact derivation service**

Create `services/fact-derivation.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isDefined } from 'twenty-shared/utils';
import { Repository } from 'typeorm';

import { type EvidenceEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/evidence.entity';
import { FactEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/fact.entity';
import { FactStatus } from 'src/engine/metadata-modules/ai/ai-research/types/fact-status.type';

const isSameValue = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

@Injectable()
export class FactDerivationService {
  constructor(
    @InjectRepository(FactEntity)
    private readonly factRepository: Repository<FactEntity>,
  ) {}

  // Deterministic — no LLM in this path. The agent already reported what it
  // saw when it called record_evidence; everything from here on is plain
  // comparison logic a human can audit without re-reading a prompt.
  async deriveFact(evidence: EvidenceEntity): Promise<FactEntity | null> {
    const { workspaceId, objectNameSingular, recordId } = evidence;
    const { fieldName, value } = evidence.payload;

    // The dismissal check runs FIRST, unconditionally. It used to sit inside
    // the "no CURRENT fact yet" branch, which meant a dismissed value
    // re-observed while any CURRENT fact existed superseded that fact and
    // re-proposed itself — the exact nag this rule exists to prevent.
    const wasDismissed = await this.wasValueDismissed({
      workspaceId,
      objectNameSingular,
      recordId,
      fieldName,
      value,
    });

    // Keep the evidence on file (it stays in the evidence table forever) but
    // do not derive a fact from it — this is the "don't nag" rule.
    if (wasDismissed) {
      return null;
    }

    const existingCurrent = await this.factRepository.findOne({
      where: {
        workspaceId,
        objectNameSingular,
        recordId,
        fieldName,
        status: FactStatus.CURRENT,
      },
    });

    if (!isDefined(existingCurrent)) {
      return this.factRepository.save(
        this.buildNewFact(evidence, { hasConflict: false }),
      );
    }

    if (isSameValue(existingCurrent.value, value)) {
      // Corroboration: same claim from another observation. Grow the
      // citation list rather than creating a second row for an unchanged
      // value. Freshness only moves forward — a newly-found source dated
      // last year must not make a fact look freshly confirmed.
      return this.factRepository.save({
        ...existingCurrent,
        evidenceIds: [...existingCurrent.evidenceIds, evidence.id],
        runId: evidence.runId,
        lastObservedAt:
          evidence.observedAt > existingCurrent.lastObservedAt
            ? evidence.observedAt
            : existingCurrent.lastObservedAt,
      });
    }

    // Different value. Same run means the agent observed a contradiction
    // within one research pass, not a change over time — surface it as a
    // conflict on both facts rather than silently superseding.
    const isSameRunConflict = existingCurrent.runId === evidence.runId;

    if (isSameRunConflict) {
      await this.factRepository.save({
        ...existingCurrent,
        hasConflict: true,
      });

      return this.factRepository.save(
        this.buildNewFact(evidence, { hasConflict: true }),
      );
    }

    // Different run, different value: time passed and the world changed.
    // Supersede — keep the history, don't delete it.
    const newFact = await this.factRepository.save(
      this.buildNewFact(evidence, { hasConflict: false }),
    );

    await this.factRepository.save({
      ...existingCurrent,
      status: FactStatus.SUPERSEDED,
      supersededAt: new Date(),
      supersededByFactId: newFact.id,
    });

    return newFact;
  }

  private buildNewFact(
    evidence: EvidenceEntity,
    options: { hasConflict: boolean },
  ): Partial<FactEntity> {
    return {
      workspaceId: evidence.workspaceId,
      objectNameSingular: evidence.objectNameSingular,
      recordId: evidence.recordId,
      fieldName: evidence.payload.fieldName,
      value: evidence.payload.value,
      status: FactStatus.CURRENT,
      hasConflict: options.hasConflict,
      strength: evidence.strength,
      evidenceIds: [evidence.id],
      runId: evidence.runId,
      lastObservedAt: evidence.observedAt,
    };
  }

  // find(), not findOne(): the query cannot filter on a jsonb `value` portably,
  // so every dismissed row for the field is loaded and compared. findOne()
  // returned one arbitrary row, which made the check nondeterministic as soon
  // as a reviewer dismissed two different values for the same field.
  private async wasValueDismissed(params: {
    workspaceId: string;
    objectNameSingular: string;
    recordId: string;
    fieldName: string;
    value: unknown;
  }): Promise<boolean> {
    const dismissed = await this.factRepository.find({
      where: {
        workspaceId: params.workspaceId,
        objectNameSingular: params.objectNameSingular,
        recordId: params.recordId,
        fieldName: params.fieldName,
        status: FactStatus.DISMISSED,
      },
    });

    return dismissed.some((fact) => isSameValue(fact.value, params.value));
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd packages/twenty-server && npx jest fact-derivation.service.spec
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Write the failing evidence-recording test**

Create `services/__tests__/evidence-recording.service.spec.ts`.

**Real seam:** `FactDerivationService` is the *real* service here, not a mock — only the two TypeORM repositories are doubled. This is the same choice Launch 1 made for `AiWritePolicyService` in `proposal-gate.service.spec.ts:53-55`, and for the same reason: the recording→derivation seam is where a wrong `strength`, a missing `observedAt`, or a payload-shape drift silently produces no fact, and a `{ deriveFact: jest.fn() }` double agrees with every one of those bugs.

```ts
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { EvidenceEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/evidence.entity';
import { FactEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/fact.entity';
import { EvidenceRecordingService } from 'src/engine/metadata-modules/ai/ai-research/services/evidence-recording.service';
import { FactDerivationService } from 'src/engine/metadata-modules/ai/ai-research/services/fact-derivation.service';
import { FactStatus } from 'src/engine/metadata-modules/ai/ai-research/types/fact-status.type';

describe('EvidenceRecordingService', () => {
  let service: EvidenceRecordingService;

  const evidenceRepository = { save: jest.fn() };
  const factRepository = { findOne: jest.fn(), find: jest.fn(), save: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    evidenceRepository.save.mockImplementation(async (entity) => ({
      id: 'evidence-1',
      ...entity,
    }));
    factRepository.findOne.mockResolvedValue(null);
    factRepository.find.mockResolvedValue([]);
    factRepository.save.mockImplementation(async (entity) => ({
      id: 'fact-1',
      ...entity,
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EvidenceRecordingService,
        // The real derivation service. See the note above this block.
        FactDerivationService,
        {
          provide: getRepositoryToken(EvidenceEntity),
          useValue: evidenceRepository,
        },
        { provide: getRepositoryToken(FactEntity), useValue: factRepository },
      ],
    }).compile();

    service = module.get<EvidenceRecordingService>(EvidenceRecordingService);
  });

  it('should assign STRONG strength for a CRM_RECORD source deterministically', async () => {
    await service.recordEvidence({
      workspaceId: 'workspace-1',
      runId: 'run-1',
      objectNameSingular: 'company',
      recordId: 'record-1',
      sourceType: 'CRM_RECORD',
      sourceLocator: 'internal:company:record-1',
      extractor: 'agent-run:agent-1',
      payload: { fieldName: 'employeeCount', value: '500' },
    });

    expect(evidenceRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ strength: 'STRONG' }),
    );
  });

  it('should assign WEAK strength for a WEB_SEARCH source', async () => {
    await service.recordEvidence({
      workspaceId: 'workspace-1',
      runId: 'run-1',
      objectNameSingular: 'company',
      recordId: 'record-1',
      sourceType: 'WEB_SEARCH',
      sourceLocator: 'https://example.com',
      extractor: 'agent-run:agent-1',
      payload: { fieldName: 'employeeCount', value: '500' },
    });

    expect(evidenceRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ strength: 'WEAK' }),
    );
  });

  // Real seam: no deriveFact mock stands between recording and the fact row.
  // A WEB_SEARCH observation must land as a WEAK CURRENT fact carrying the
  // observation date as its freshness, end to end.
  it('should compute a payload hash and derive a real CURRENT fact through the live derivation service', async () => {
    await service.recordEvidence({
      workspaceId: 'workspace-1',
      runId: 'run-1',
      objectNameSingular: 'company',
      recordId: 'record-1',
      sourceType: 'WEB_SEARCH',
      sourceLocator: 'https://example.com/about',
      extractor: 'agent-run:agent-1',
      observedAt: new Date('2026-08-01T00:00:00.000Z'),
      payload: { fieldName: 'employeeCount', value: '500' },
    });

    expect(evidenceRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ payloadHash: expect.stringMatching(/^[0-9a-f]{64}$/) }),
    );
    expect(factRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        objectNameSingular: 'company',
        recordId: 'record-1',
        fieldName: 'employeeCount',
        value: '500',
        status: FactStatus.CURRENT,
        strength: 'WEAK',
        evidenceIds: ['evidence-1'],
        lastObservedAt: new Date('2026-08-01T00:00:00.000Z'),
      }),
    );
  });

  // Real seam, negative case: the dismissal rule has to hold through the
  // recording entry point, not only when deriveFact is called directly.
  it('should record the evidence but derive no fact when the value was already dismissed', async () => {
    factRepository.find.mockResolvedValue([
      { id: 'fact-dismissed', value: '500', status: FactStatus.DISMISSED },
    ]);

    await service.recordEvidence({
      workspaceId: 'workspace-1',
      runId: 'run-1',
      objectNameSingular: 'company',
      recordId: 'record-1',
      sourceType: 'WEB_SEARCH',
      sourceLocator: 'https://example.com/about',
      extractor: 'agent-run:agent-1',
      payload: { fieldName: 'employeeCount', value: '500' },
    });

    expect(evidenceRepository.save).toHaveBeenCalled();
    expect(factRepository.save).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

```bash
cd packages/twenty-server && npx jest evidence-recording.service.spec
```

Expected: FAIL — module not found.

- [ ] **Step 7: Write the evidence recording service**

Create `services/evidence-recording.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { EvidenceEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/evidence.entity';
import { FactDerivationService } from 'src/engine/metadata-modules/ai/ai-research/services/fact-derivation.service';
import {
  EVIDENCE_SOURCE_STRENGTH,
  type EvidencePayload,
  type EvidenceSourceType,
} from 'src/engine/metadata-modules/ai/ai-research/types/evidence.type';
import { hashEvidencePayload } from 'src/engine/metadata-modules/ai/ai-research/utils/hash-evidence-payload.util';

export type RecordEvidenceParams = {
  workspaceId: string;
  runId: string | null;
  objectNameSingular: string;
  recordId: string;
  sourceType: EvidenceSourceType;
  sourceLocator: string;
  extractor: string;
  observedAt?: Date;
  payload: EvidencePayload;
};

@Injectable()
export class EvidenceRecordingService {
  constructor(
    @InjectRepository(EvidenceEntity)
    private readonly evidenceRepository: Repository<EvidenceEntity>,
    private readonly factDerivationService: FactDerivationService,
  ) {}

  async recordEvidence(params: RecordEvidenceParams): Promise<EvidenceEntity> {
    const evidence = await this.evidenceRepository.save({
      workspaceId: params.workspaceId,
      runId: params.runId,
      objectNameSingular: params.objectNameSingular,
      recordId: params.recordId,
      sourceType: params.sourceType,
      sourceLocator: params.sourceLocator,
      extractor: params.extractor,
      observedAt: params.observedAt ?? new Date(),
      payload: params.payload,
      payloadHash: hashEvidencePayload(params.payload),
      // Deterministic — this is the one line that decides strength, and it
      // reads straight from the fixed table, not from anything the model said.
      strength: EVIDENCE_SOURCE_STRENGTH[params.sourceType],
    });

    await this.factDerivationService.deriveFact(evidence);

    return evidence;
  }
}
```

- [ ] **Step 8: Run the test to verify it passes**

```bash
cd packages/twenty-server && npx jest evidence-recording.service.spec
```

Expected: PASS, 4 tests.

- [ ] **Step 9: Lint, typecheck, commit**

```bash
npx nx lint:diff-with-main twenty-server
npx nx typecheck twenty-server
git add packages/twenty-server/src/engine/metadata-modules/ai/ai-research
git commit -m "feat(ai-research): add evidence recording and fact derivation"
```

---

### Task 3: `record_evidence` tool

Registers a new static tool through the existing `ActionToolProvider`/`ToolExecutorService` machinery (the same one `send_email` and `create_calendar_event` use) so a research agent can log an observation mid-run. It is only usable inside an active `AgentTask` run (`context.threadId` must resolve to a real `AgentRunEntity`), keeping evidence always traceable to a run per the Evidence contract.

> **The tool must be explicitly ungated, and that is Step 5b — do not skip it.** The live gate is a **denylist**: `proposal-gate.service.ts:46-48` says *"A static tool is gated unless it appears here, so a newly registered tool is gated until someone classifies it."* `isGatedStaticTool()` (`proposal-gate.service.ts:241-257`) returns `true` for any `toolId` absent from `UNGATED_STATIC_TOOL_IDS` (`proposal-gate.service.ts:50-85`, 24 entries, `record_evidence` is not one of them). Under the shipped default policy `{ default: 'PROPOSE' }` an unungated `record_evidence` call is diverted into a `ProposalItem` with `actionType: STATIC_TOOL` and the tool returns *"Change proposed and awaiting human approval."* No `EvidenceEntity` row is ever written, `FactDerivationService.deriveFact` never runs, and — worst — a human is asked to approve the act of writing down an observation, which on approval `ProposalExecutionService.applyStaticTool` (`proposal-execution.service.ts:592-645`) replays through the provider. **The entire evidence pipeline is inert until Step 5b lands.**

**Files:**
- Create: `packages/twenty-server/src/engine/core-modules/tool/tools/record-evidence-tool/record-evidence-tool.schema.ts`
- Create: `packages/twenty-server/src/engine/core-modules/tool/tools/record-evidence-tool/record-evidence-tool.ts`
- Test: `packages/twenty-server/src/engine/core-modules/tool/tools/record-evidence-tool/__tests__/record-evidence-tool.spec.ts`
- Modify: `packages/twenty-server/src/engine/metadata-modules/ai/ai-write-approval/services/proposal-gate.service.ts`
- Modify: `packages/twenty-server/src/engine/metadata-modules/ai/ai-write-approval/services/__tests__/proposal-gate.service.spec.ts`
- Modify: `packages/twenty-server/src/engine/core-modules/tool-provider/providers/action-tool.provider.ts`
- Modify: `packages/twenty-server/src/engine/core-modules/tool-provider/tool-provider.module.ts`

**Interfaces:**
- Consumes: `EvidenceRecordingService.recordEvidence` (Task 2), `AgentRunEntity` (Task 4 — forward reference resolved by writing this task's test against a mocked repository; the entity itself is defined in Task 4, so **run this task's `npx jest` step only after Task 4 is complete**, or stub `AgentRunEntity` locally in the test as `as never` the way other tasks do).
- Produces: static tool `record_evidence`, dispatched by `ToolExecutorService.dispatch()` via `executionRef: { kind: 'static', toolId: 'record_evidence' }`.

- [ ] **Step 1: Write the input schema**

Create `record-evidence-tool.schema.ts`:

```ts
import { z } from 'zod';

export const RecordEvidenceInputZodSchema = z.object({
  objectNameSingular: z
    .string()
    .describe('The object the observed record belongs to, e.g. "company".'),
  recordId: z.string().uuid().describe('The id of the record this observation is about.'),
  fieldName: z
    .string()
    .describe('The CRM field this observation is evidence for, e.g. "employees".'),
  value: z
    .union([z.string(), z.number(), z.boolean()])
    .describe('The value you observed for that field.'),
  sourceType: z
    .enum(['CRM_RECORD', 'CRM_ACTIVITY', 'WEB_SEARCH', 'MANUAL'])
    .describe('Where this observation came from.'),
  sourceLocator: z
    .string()
    .describe('A URL, record reference, or description of exactly where you saw this.'),
  snippet: z
    .string()
    .optional()
    .describe('A short excerpt supporting the observation, if you have one.'),
});

export type RecordEvidenceInput = z.infer<typeof RecordEvidenceInputZodSchema>;
```

- [ ] **Step 2: Write the failing test**

Create `__tests__/record-evidence-tool.spec.ts`:

```ts
import { RecordEvidenceTool } from 'src/engine/core-modules/tool/tools/record-evidence-tool/record-evidence-tool';

describe('RecordEvidenceTool', () => {
  const evidenceRecordingService = { recordEvidence: jest.fn() };
  const agentRunRepository = { findOne: jest.fn() };

  const buildTool = () =>
    new RecordEvidenceTool(
      evidenceRecordingService as never,
      agentRunRepository as never,
    );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should refuse to run without an active research run', async () => {
    const tool = buildTool();

    const result = await tool.execute(
      {
        objectNameSingular: 'company',
        recordId: 'record-1',
        fieldName: 'employees',
        value: '500',
        sourceType: 'CRM_RECORD',
        sourceLocator: 'internal',
      } as never,
      { workspaceId: 'workspace-1' } as never,
    );

    expect(result.success).toBe(false);
    expect(evidenceRecordingService.recordEvidence).not.toHaveBeenCalled();
  });

  it('should reject when the referenced run does not belong to this workspace', async () => {
    agentRunRepository.findOne.mockResolvedValue(null);

    const tool = buildTool();

    const result = await tool.execute(
      {
        objectNameSingular: 'company',
        recordId: 'record-1',
        fieldName: 'employees',
        value: '500',
        sourceType: 'CRM_RECORD',
        sourceLocator: 'internal',
      } as never,
      { workspaceId: 'workspace-1', threadId: 'run-1' } as never,
    );

    expect(result.success).toBe(false);
  });

  it('should record evidence and return the strength when the run is active', async () => {
    agentRunRepository.findOne.mockResolvedValue({
      id: 'run-1',
      workspaceId: 'workspace-1',
      agentId: 'agent-1',
    });
    evidenceRecordingService.recordEvidence.mockResolvedValue({
      id: 'evidence-1',
      strength: 'STRONG',
    });

    const tool = buildTool();

    const result = await tool.execute(
      {
        objectNameSingular: 'company',
        recordId: 'record-1',
        fieldName: 'employees',
        value: '500',
        sourceType: 'CRM_RECORD',
        sourceLocator: 'internal',
        snippet: 'Company profile shows 500 employees.',
      } as never,
      { workspaceId: 'workspace-1', threadId: 'run-1' } as never,
    );

    expect(evidenceRecordingService.recordEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        runId: 'run-1',
        objectNameSingular: 'company',
        recordId: 'record-1',
        sourceType: 'CRM_RECORD',
        extractor: 'agent-run:agent-1',
        payload: {
          fieldName: 'employees',
          value: '500',
          snippet: 'Company profile shows 500 employees.',
        },
      }),
    );
    expect(result.success).toBe(true);
    expect(result.result).toEqual({ evidenceId: 'evidence-1', strength: 'STRONG' });
  });

  // Real seam: the three tests above double EvidenceRecordingService, so they
  // cannot catch the tool handing it a payload shape it silently drops. This
  // one wires the real recording and derivation services behind doubled
  // repositories and asserts a Fact actually comes out the other end.
  it('should produce a real WEAK fact end to end through the live recording and derivation services', async () => {
    const evidenceRepository = {
      save: jest.fn(async (entity) => ({ id: 'evidence-1', ...entity })),
    };
    const factRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(async (entity) => ({ id: 'fact-1', ...entity })),
    };
    const factDerivationService = new FactDerivationService(
      factRepository as never,
    );
    const evidenceRecordingService = new EvidenceRecordingService(
      evidenceRepository as never,
      factDerivationService,
    );

    agentRunRepository.findOne.mockResolvedValue({
      id: 'run-1',
      workspaceId: 'workspace-1',
      agentId: 'agent-1',
    });

    const tool = new RecordEvidenceTool(
      evidenceRecordingService,
      agentRunRepository as never,
    );

    const result = await tool.execute(
      {
        objectNameSingular: 'company',
        recordId: 'record-1',
        fieldName: 'employees',
        value: '500',
        sourceType: 'WEB_SEARCH',
        sourceLocator: 'https://example.com/about',
      } as never,
      { workspaceId: 'workspace-1', threadId: 'run-1' } as never,
    );

    expect(result.success).toBe(true);
    expect(result.result).toEqual({ evidenceId: 'evidence-1', strength: 'WEAK' });
    expect(factRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        fieldName: 'employees',
        value: '500',
        strength: 'WEAK',
        evidenceIds: ['evidence-1'],
      }),
    );
  });
});
```

Add the two extra imports this last test needs at the top of the file:

```ts
import { EvidenceRecordingService } from 'src/engine/metadata-modules/ai/ai-research/services/evidence-recording.service';
import { FactDerivationService } from 'src/engine/metadata-modules/ai/ai-research/services/fact-derivation.service';
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd packages/twenty-server && npx jest record-evidence-tool.spec
```

Expected: FAIL — module not found.

- [ ] **Step 4: Write the tool**

Create `record-evidence-tool.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isDefined } from 'twenty-shared/utils';
import { Repository } from 'typeorm';

import { RecordEvidenceInputZodSchema } from 'src/engine/core-modules/tool/tools/record-evidence-tool/record-evidence-tool.schema';
import { type ToolExecutionContext } from 'src/engine/core-modules/tool/types/tool-execution-context.type';
import { type ToolInput } from 'src/engine/core-modules/tool/types/tool-input.type';
import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';
import { type Tool } from 'src/engine/core-modules/tool/types/tool.type';
import { AgentRunEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/agent-run.entity';
import { EvidenceRecordingService } from 'src/engine/metadata-modules/ai/ai-research/services/evidence-recording.service';

@Injectable()
export class RecordEvidenceTool implements Tool {
  description =
    'Record what you observed about a company or person record, and where you saw it, before proposing any change based on it. This does not modify the record. Only usable during a scheduled research run.';
  inputSchema = RecordEvidenceInputZodSchema;

  constructor(
    private readonly evidenceRecordingService: EvidenceRecordingService,
    @InjectRepository(AgentRunEntity)
    private readonly agentRunRepository: Repository<AgentRunEntity>,
  ) {}

  async execute(
    parameters: ToolInput,
    context: ToolExecutionContext,
  ): Promise<ToolOutput> {
    const {
      objectNameSingular,
      recordId,
      fieldName,
      value,
      sourceType,
      sourceLocator,
      snippet,
    } = parameters as {
      objectNameSingular: string;
      recordId: string;
      fieldName: string;
      value: string | number | boolean;
      sourceType: 'CRM_RECORD' | 'CRM_ACTIVITY' | 'WEB_SEARCH' | 'MANUAL';
      sourceLocator: string;
      snippet?: string;
    };

    // threadId doubles as the correlation key for a research run (Task 6) —
    // the same field chat uses to batch a turn's tool calls into one
    // proposal, reused here so every observation traces to a real run.
    if (!isDefined(context.threadId)) {
      return {
        success: false,
        message: 'No active research run',
        error: 'record_evidence is only usable during a scheduled research run.',
      };
    }

    const run = await this.agentRunRepository.findOne({
      where: { id: context.threadId, workspaceId: context.workspaceId },
    });

    if (!isDefined(run)) {
      return {
        success: false,
        message: 'No active research run',
        error: `Run ${context.threadId} was not found for this workspace.`,
      };
    }

    const evidence = await this.evidenceRecordingService.recordEvidence({
      workspaceId: context.workspaceId,
      runId: run.id,
      objectNameSingular,
      recordId,
      sourceType,
      sourceLocator,
      extractor: `agent-run:${run.agentId}`,
      payload: { fieldName, value, snippet },
    });

    return {
      success: true,
      message: `Recorded ${sourceType} evidence for ${objectNameSingular}.${fieldName}.`,
      result: { evidenceId: evidence.id, strength: evidence.strength },
    };
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd packages/twenty-server && npx jest record-evidence-tool.spec
```

Expected: PASS, 4 tests.

- [ ] **Step 5b: Ungate the tool — write the failing gate test first**

In `proposal-gate.service.spec.ts`, inside the existing `describe('denylist', ...)` block (opens at line 311), add two tests after `it('should gate a metadata write tool', ...)` (ends line 343). This file's `staticDescriptor()` helper (lines 37-47) and `evaluate()` helper (lines 105-108) already exist; the `beforeEach` already sets the shipped default policy `{ default: 'PROPOSE', overrides: {} }` (line 68), which is exactly the condition under which the bug bites:

```ts
    // C1: record_evidence writes a platform table, never a CRM record. If it
    // is gated, every observation becomes a proposal asking a human to
    // approve writing down an observation, and no Evidence row is ever
    // created. The default policy here is PROPOSE — that is the point.
    it('should not gate record_evidence even when the policy resolves to PROPOSE', async () => {
      const decision = await evaluate(staticDescriptor('record_evidence'), {
        objectNameSingular: 'company',
        recordId: 'record-1',
        fieldName: 'employees',
        value: '500',
        sourceType: 'WEB_SEARCH',
        sourceLocator: 'https://example.com',
      });

      expect(decision.kind).toBe('ALLOW');
      expect(proposalItemRepository.save).not.toHaveBeenCalled();
    });

    it('should not gate create_agent_task even when the policy resolves to PROPOSE', async () => {
      const decision = await evaluate(staticDescriptor('create_agent_task'), {
        objectNameSingular: 'company',
        recordId: 'record-1',
        reason: 'New lead created',
      });

      expect(decision.kind).toBe('ALLOW');
      expect(proposalItemRepository.save).not.toHaveBeenCalled();
    });
```

Note the assertion is deliberately `expect(...).not.toHaveBeenCalled()` on the item repository as well as `kind === 'ALLOW'`. `kind` alone would still pass if a future refactor created the item and then allowed anyway.

**Real seam:** this spec uses the *real* `AiWritePolicyService` (see its own comment at lines 53-55). The seam under test — denylist membership resolved against a real policy — is therefore not doubled.

- [ ] **Step 5c: Run the gate test to verify it fails**

```bash
cd packages/twenty-server && npx jest proposal-gate.service.spec
```

Expected: FAIL — both new tests report `Received: "PROPOSED"`, and `proposalItemRepository.save` was called. This is the C1 defect reproduced.

- [ ] **Step 5d: Ungate both tools**

In `proposal-gate.service.ts`, the `UNGATED_STATIC_TOOL_IDS` array currently ends (lines 81-85):

```ts
  // webhook / role / navigation reads
  'list_webhooks',
  'list_roles',
  'list_navigation_menu_items',
] as const;
```

Replace with:

```ts
  // webhook / role / navigation reads
  'list_webhooks',
  'list_roles',
  'list_navigation_menu_items',
  // evidence recording and research scheduling — these write platform tables
  // (core.evidence, core.fact, core.agentTask), never a CRM record. The work
  // record_evidence justifies and the work create_agent_task schedules are
  // both still fully gated when they happen.
  'record_evidence',
  'create_agent_task',
] as const;
```

`create_agent_task` is added here, in the same edit, rather than in its own task: both entries belong to one array and one comment block, and splitting them across tasks is how C1 happened in the first place. The tool itself is built in Task 5c.

- [ ] **Step 5e: Run the gate test to verify it passes**

```bash
cd packages/twenty-server && npx jest proposal-gate.service.spec
```

Expected: PASS — all pre-existing tests plus the 2 new ones. In particular `'should gate an unknown static tool'` (line 320) and `'should gate a CRUD operation nobody has classified'` (line 312) must still be green: this edit adds two names to a denylist exemption list, it does not change the denylist's shape.

- [ ] **Step 6: Register the tool in `ActionToolProvider`**

In `action-tool.provider.ts`, add the import and constructor parameter next to `searchHelpCenterTool`:

```ts
import { RecordEvidenceTool } from 'src/engine/core-modules/tool/tools/record-evidence-tool/record-evidence-tool';
```

```ts
    private readonly recordEvidenceTool: RecordEvidenceTool,
```

Add to the `toolMap` constructor body:

```ts
      ['record_evidence', this.recordEvidenceTool],
```

Add to `generateDescriptors()` after the `search_help_center` push (`action-tool.provider.ts:141-148`), unconditionally and with no permission-flag guard — it never touches a CRM record:

```ts
    descriptors.push(
      this.buildDescriptor(
        'record_evidence',
        this.recordEvidenceTool,
        includeSchemas,
        context.locale,
      ),
    );
```

`buildDescriptor` (`action-tool.provider.ts:219-241`) looks the tool id up in `ACTION_TOOL_LABELS` and falls back to `humanizeToolName(toolId)` when it is absent, so no label constant needs adding — the tool surfaces as "Record Evidence". Do not add an entry to `ACTION_TOOL_LABELS`; `ActionToolId` is derived from that constant's keys and widening it pulls in a translation obligation this plan does not scope.

- [ ] **Step 7: Wire the module dependency**

`RecordEvidenceTool` needs `EvidenceRecordingService` (Task 2, `AiResearchModule`, written in Task 5) and `AgentRunEntity`'s repository. In `tool-provider.module.ts`, add to `imports`:

```ts
import { AiResearchModule } from 'src/engine/metadata-modules/ai/ai-research/ai-research.module';
```

```ts
    AiResearchModule,
```

placed next to the existing `AiWriteApprovalModule` import. `ActionToolProvider` must also be registered as a provider that can resolve `RecordEvidenceTool` — since `RecordEvidenceTool` is provided by `AiResearchModule` and exported from it (confirmed in Task 5), and `ActionToolProvider` is a provider of `ToolProviderModule` which now imports `AiResearchModule`, Nest resolves the dependency without further changes.

This task cannot fully typecheck until Task 5 (`AiResearchModule`) exists and exports `RecordEvidenceTool`. Run the tool's own unit test now (Step 5); defer the full-module typecheck to Task 5's Step 6.

- [ ] **Step 8: Lint, typecheck, commit**

```bash
npx nx lint:diff-with-main twenty-server
git add packages/twenty-server/src/engine/core-modules/tool/tools packages/twenty-server/src/engine/core-modules/tool-provider packages/twenty-server/src/engine/metadata-modules/ai/ai-write-approval
git commit -m "feat(ai-research): add and ungate the record_evidence tool"
```

The `create_agent_task` sibling tool is **Task 5c**, not a step here. It cannot be written until `AgentTaskService` (Task 5) and the seeded research agent that answers "which agent runs a tool-scheduled task?" (Task 5b) both exist. Its denylist exemption was landed in Step 5d above, in the same array edit, deliberately.

---

### Task 4: AgentTask and AgentRun entities and migration

`AgentTask` is durable scheduled work: priority, record target, reason, lease, retry count, budget, idempotency key, cancellation — the charter's exact field list. `AgentRun` is one execution of a task. Neither reuses `AgentTurnEntity`/`AgentChatThreadEntity` (Launch 1's anchors report flagged why: `AgentChatThreadEntity.userWorkspaceId` is a required FK to a human user, and `AgentTurnEntity.threadId` is a required, non-nullable FK to that thread — there is no clean way to represent a system-scheduled run with no acting user without changing entities the live chat system depends on). `AgentRun` is a genuinely new sibling entity, following the anchors report's own recommendation; it reuses `AiBillingService` for actual billing (Task 7) and reuses the `threadId` correlation field for proposal batching (Task 6) rather than inventing new machinery for either.

**Files:**
- Create: `packages/twenty-server/src/engine/metadata-modules/ai/ai-research/types/agent-task-status.type.ts`
- Create: `packages/twenty-server/src/engine/metadata-modules/ai/ai-research/types/agent-run-status.type.ts`
- Create: `packages/twenty-server/src/engine/metadata-modules/ai/ai-research/entities/agent-task.entity.ts`
- Create: `packages/twenty-server/src/engine/metadata-modules/ai/ai-research/entities/agent-run.entity.ts`
- Create: an instance command (generated)

**Interfaces:**
- Produces: `AgentTaskEntity`, `AgentRunEntity`, `AgentTaskStatus`, `AgentRunStatus`.

- [ ] **Step 1: Write the status types**

Create `types/agent-task-status.type.ts`:

```ts
export enum AgentTaskStatus {
  PENDING = 'PENDING',
  LEASED = 'LEASED',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}
```

Create `types/agent-run-status.type.ts`:

```ts
export enum AgentRunStatus {
  RUNNING = 'RUNNING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}
```

- [ ] **Step 2: Write the AgentTask entity**

Create `entities/agent-task.entity.ts`:

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

import { type ActorMetadata } from 'twenty-shared/types';

import { AgentTaskStatus } from 'src/engine/metadata-modules/ai/ai-research/types/agent-task-status.type';
import type { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

@Entity({ name: 'agentTask', schema: 'core' })
export class AgentTaskEntity {
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

  @Column({ type: 'uuid' })
  @Index()
  recordId: string;

  // Which Agent runs this task. AgentEntity is @Entity('agent') on the core
  // schema (verified: ai-agent/entities/agent.entity.ts:18), so a FK would be
  // possible — it is deliberately a plain uuid so deleting an agent orphans
  // its task history rather than cascading it away. Task 5b's seeded
  // per-workspace research agent is what fills this for tool- and
  // cron-scheduled tasks.
  @Column({ type: 'uuid' })
  agentId: string;

  @Column({ type: 'text' })
  reason: string;

  @Column({ type: 'int', default: 0 })
  priority: number;

  // Informational spend estimate for cost reporting. The platform's
  // existing per-workspace credit ceiling (AiBillingService,
  // hasAvailableCreditsOrThrow) is what actually stops a run — this column
  // does not add a second enforcement mechanism. See Risks.
  @Column({ type: 'int', default: 8 })
  budget: number;

  @Column({ type: 'varchar', default: AgentTaskStatus.PENDING })
  @Index()
  status: AgentTaskStatus;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  dueAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  leasedUntil: Date | null;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'int', default: 3 })
  maxAttempts: number;

  // Dedup key: a second createTask() call with the same (workspaceId,
  // idempotencyKey) while a task is still open reuses the existing row
  // instead of scheduling duplicate work.
  @Column({ type: 'varchar', nullable: true })
  idempotencyKey: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ type: 'text', nullable: true })
  cancelReason: string | null;

  @Column({ type: 'uuid', nullable: true })
  lastRunId: string | null;

  // Human-readable result, filled in on both success and exhaustion —
  // "why did this task end up where it did" is always answerable without
  // opening a log file.
  @Column({ type: 'text', nullable: true })
  outcome: string | null;

  @Column({ type: 'jsonb', nullable: true })
  createdByActor: ActorMetadata | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
```

- [ ] **Step 3: Write the AgentRun entity**

Create `entities/agent-run.entity.ts`:

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
} from 'typeorm';

import { AgentTaskEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/agent-task.entity';
import { AgentRunStatus } from 'src/engine/metadata-modules/ai/ai-research/types/agent-run-status.type';
import type { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

@Entity({ name: 'agentRun', schema: 'core' })
export class AgentRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: false, type: 'uuid' })
  @Index()
  workspaceId: string;

  @ManyToOne('WorkspaceEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspaceId' })
  workspace: Relation<WorkspaceEntity>;

  @Column({ type: 'uuid', nullable: true })
  @Index()
  taskId: string | null;

  @ManyToOne(() => AgentTaskEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'taskId' })
  task: Relation<AgentTaskEntity> | null;

  @Column({ type: 'uuid' })
  agentId: string;

  // Charter trust-layer table names a "workflow link" on AgentRun. A plain
  // uuid, not an FK: workflowRun lives in the per-workspace schema, and a
  // run scheduled by cron or the GraphQL mutation has no workflow at all.
  // Set by any caller that knows its workflow run id; null otherwise.
  @Column({ type: 'uuid', nullable: true })
  @Index()
  workflowRunId: string | null;

  @Column({ type: 'varchar', default: AgentRunStatus.RUNNING })
  status: AgentRunStatus;

  @Column({ type: 'varchar', nullable: true })
  modelId: string | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  startedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @Column({ type: 'int', nullable: true })
  elapsedMs: number | null;

  @Column({ type: 'int', default: 0 })
  inputTokens: number;

  @Column({ type: 'int', default: 0 })
  outputTokens: number;

  @Column({ type: 'bigint', default: 0 })
  creditsUsedMicro: number;

  // No `transcript` column. Twenty already persists a full agent transcript
  // through AgentMessageEntity, nothing in Phases 2-5 reads AgentRun's copy,
  // and a jsonb mirror of the AI SDK's StepResult shape is a coupling to a
  // third-party type for no consumer. resultSummary is what run history needs.
  @Column({ type: 'text', nullable: true })
  resultSummary: string | null;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
```

Note: this run's resulting `Proposal` (if any) is found by `proposal WHERE threadId = agentRun.id`, not a stored column — Task 6 makes `AgentAsyncExecutorService.executeAgent()`'s `threadId` parameter reach `ProposalGateService`'s existing batching key unchanged, so the relationship falls out of the existing Launch 1 schema instead of a new denormalized field.

- [ ] **Step 4: Generate the instance command**

```bash
npx nx run twenty-server:database:migrate:generate --name add-ai-research-agent-task-and-run --type fast
```

Fill `up`:

```sql
CREATE TABLE "core"."agentTask" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" uuid NOT NULL,
  "objectNameSingular" varchar NOT NULL,
  "recordId" uuid NOT NULL,
  "agentId" uuid NOT NULL,
  "reason" text NOT NULL,
  "priority" int NOT NULL DEFAULT 0,
  "budget" int NOT NULL DEFAULT 8,
  "status" varchar NOT NULL DEFAULT 'PENDING',
  "dueAt" timestamptz NOT NULL DEFAULT now(),
  "leasedUntil" timestamptz,
  "attempts" int NOT NULL DEFAULT 0,
  "maxAttempts" int NOT NULL DEFAULT 3,
  "idempotencyKey" varchar,
  "cancelledAt" timestamptz,
  "cancelReason" text,
  "lastRunId" uuid,
  "outcome" text,
  "createdByActor" jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "PK_agentTask" PRIMARY KEY ("id"),
  CONSTRAINT "FK_agentTask_workspace" FOREIGN KEY ("workspaceId")
    REFERENCES "core"."workspace"("id") ON DELETE CASCADE
);
CREATE INDEX "IDX_AGENT_TASK_WORKSPACE_ID" ON "core"."agentTask" ("workspaceId");
CREATE INDEX "IDX_AGENT_TASK_RECORD_ID" ON "core"."agentTask" ("recordId");
CREATE INDEX "IDX_AGENT_TASK_STATUS" ON "core"."agentTask" ("status");
CREATE INDEX "IDX_AGENT_TASK_DUE_LEASE" ON "core"."agentTask" ("dueAt", "leasedUntil");
CREATE UNIQUE INDEX "IDX_AGENT_TASK_IDEMPOTENCY_KEY" ON "core"."agentTask" ("workspaceId", "idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL AND "status" IN ('PENDING', 'LEASED');

CREATE TABLE "core"."agentRun" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" uuid NOT NULL,
  "taskId" uuid,
  "agentId" uuid NOT NULL,
  "workflowRunId" uuid,
  "status" varchar NOT NULL DEFAULT 'RUNNING',
  "modelId" varchar,
  "startedAt" timestamptz NOT NULL DEFAULT now(),
  "finishedAt" timestamptz,
  "elapsedMs" int,
  "inputTokens" int NOT NULL DEFAULT 0,
  "outputTokens" int NOT NULL DEFAULT 0,
  "creditsUsedMicro" bigint NOT NULL DEFAULT 0,
  "resultSummary" text,
  "errorMessage" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "PK_agentRun" PRIMARY KEY ("id"),
  CONSTRAINT "FK_agentRun_workspace" FOREIGN KEY ("workspaceId")
    REFERENCES "core"."workspace"("id") ON DELETE CASCADE,
  CONSTRAINT "FK_agentRun_task" FOREIGN KEY ("taskId")
    REFERENCES "core"."agentTask"("id") ON DELETE SET NULL
);
CREATE INDEX "IDX_AGENT_RUN_WORKSPACE_ID" ON "core"."agentRun" ("workspaceId");
CREATE INDEX "IDX_AGENT_RUN_TASK_ID" ON "core"."agentRun" ("taskId");
CREATE INDEX "IDX_AGENT_RUN_WORKFLOW_RUN_ID" ON "core"."agentRun" ("workflowRunId");
```

Fill `down`:

```sql
DROP TABLE "core"."agentRun";
DROP TABLE "core"."agentTask";
```

- [ ] **Step 5: Apply and verify**

```bash
npx nx run twenty-server:database:migrate:prod
psql "$PG_DATABASE_URL" -c '\d core."agentTask"' -c '\d core."agentRun"'
```

- [ ] **Step 6: Typecheck and commit**

```bash
npx nx typecheck twenty-server
git add packages/twenty-server/src/engine/metadata-modules/ai/ai-research packages/twenty-server/src/database
git commit -m "feat(ai-research): add agent task and agent run entities"
```

---

### Task 5: AgentTaskService and the `ai-research` module

The lease-claim engine. Claim uses a select-candidates-then-conditional-bulk-update pattern copied directly from `MessagingMessageListFetchCronJob` (verified by reading `packages/twenty-server/src/modules/messaging/message-import-manager/crons/jobs/messaging-message-list-fetch.cron.job.ts`) — no new locking primitive, no raw `FOR UPDATE SKIP LOCKED` SQL foreign to this codebase's conventions. Postgres serializes each row's conditional `UPDATE ... WHERE status = 'PENDING'`, so two concurrent claim ticks can never both win the same row.

**Files:**
- Create: `packages/twenty-server/src/engine/metadata-modules/ai/ai-research/constants/agent-task.const.ts`
- Create: `packages/twenty-server/src/engine/metadata-modules/ai/ai-research/services/agent-task.service.ts`
- Test: `packages/twenty-server/src/engine/metadata-modules/ai/ai-research/services/__tests__/agent-task.service.spec.ts`
- Create: `packages/twenty-server/src/engine/metadata-modules/ai/ai-research/ai-research.module.ts`

**Interfaces:**
- Consumes: `AgentTaskEntity`, `AgentTaskStatus` (Task 4).
- Produces:
  - `AgentTaskService.createTask(params: CreateAgentTaskParams): Promise<AgentTaskEntity>`
  - `AgentTaskService.claimDueTasks(limit?: number): Promise<AgentTaskEntity[]>` — claims rows that are `PENDING` **or** `LEASED` with an expired `leasedUntil`, so a crashed worker's row is re-claimed rather than stranded.
  - `AgentTaskService.reapAbandonedTasks(): Promise<number>` — sweeps `LEASED` rows whose lease expired *and* whose `attempts` are exhausted to `FAILED`, so they do not sit in a non-terminal state forever.
  - `AgentTaskService.completeTask(params): Promise<void>`
  - `AgentTaskService.failTask(params): Promise<void>`
  - `AgentTaskService.cancelTask(params): Promise<boolean>`
  - `AiResearchModule`, exporting `EvidenceRecordingService`, `FactDerivationService`, `FactService` (Task 8), `AgentTaskService`, `RecordEvidenceTool`.

- [ ] **Step 1: Write the constants**

Create `constants/agent-task.const.ts`:

```ts
// Long enough for a full research run (multiple tool calls, possibly a web
// search) — mirrors the "research lane" lease duration the crm repo scouting
// report recommended (30 minutes), the only number ported from that source.
export const AGENT_TASK_LEASE_DURATION_MS = 30 * 60 * 1000;

export const AGENT_TASK_CLAIM_BATCH_SIZE = 10;

export const AGENT_TASK_DEFAULT_BUDGET = 8;

export const AGENT_TASK_DEFAULT_MAX_ATTEMPTS = 3;

export const AGENT_TASK_MAX_BACKOFF_MS = 30 * 60 * 1000;

// Exponential backoff capped at 30 minutes: 1st retry in 1 min, 2nd in 4 min,
// then flat at the cap.
export const computeAgentTaskBackoffMs = (attempts: number): number =>
  Math.min(2 ** attempts * 60_000, AGENT_TASK_MAX_BACKOFF_MS);
```

- [ ] **Step 2: Write the failing test**

Create `services/__tests__/agent-task.service.spec.ts`:

```ts
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AgentTaskEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/agent-task.entity';
import { AgentTaskService } from 'src/engine/metadata-modules/ai/ai-research/services/agent-task.service';
import { AgentTaskStatus } from 'src/engine/metadata-modules/ai/ai-research/types/agent-task-status.type';

const buildQueryBuilder = (overrides: Record<string, unknown> = {}) => {
  const builder: Record<string, jest.Mock> = {
    where: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    limit: jest.fn(),
    update: jest.fn(),
    set: jest.fn(),
    returning: jest.fn(),
    execute: jest.fn().mockResolvedValue({ raw: [], affected: 0 }),
    getMany: jest.fn().mockResolvedValue([]),
    ...overrides,
  };

  for (const key of Object.keys(builder)) {
    if (key !== 'execute' && key !== 'getMany') {
      builder[key].mockReturnValue(builder);
    }
  }

  return builder;
};

describe('AgentTaskService', () => {
  let service: AgentTaskService;

  const agentTaskRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    agentTaskRepository.save.mockImplementation(async (entity) => ({
      id: 'task-1',
      ...entity,
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentTaskService,
        {
          provide: getRepositoryToken(AgentTaskEntity),
          useValue: agentTaskRepository,
        },
      ],
    }).compile();

    service = module.get<AgentTaskService>(AgentTaskService);
  });

  describe('createTask', () => {
    it('should create a new PENDING task with default budget and attempts', async () => {
      const task = await service.createTask({
        workspaceId: 'workspace-1',
        objectNameSingular: 'company',
        recordId: 'record-1',
        agentId: 'agent-1',
        reason: 'New lead created',
      });

      expect(agentTaskRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: AgentTaskStatus.PENDING,
          budget: 8,
          maxAttempts: 3,
          attempts: 0,
        }),
      );
      expect(task.status).toBe(AgentTaskStatus.PENDING);
    });

    it('should reuse an open task with the same idempotency key instead of duplicating it', async () => {
      agentTaskRepository.findOne.mockResolvedValue({
        id: 'task-existing',
        status: AgentTaskStatus.PENDING,
        dueAt: new Date('2026-01-01'),
      });

      await service.createTask({
        workspaceId: 'workspace-1',
        objectNameSingular: 'company',
        recordId: 'record-1',
        agentId: 'agent-1',
        reason: 'Recheck after 30 days',
        idempotencyKey: 'recheck:company:record-1',
      });

      expect(agentTaskRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'task-existing', reason: 'Recheck after 30 days' }),
      );
    });
  });

  describe('claimDueTasks', () => {
    it('should return an empty array when no candidates are due', async () => {
      agentTaskRepository.createQueryBuilder.mockReturnValue(buildQueryBuilder());

      const result = await service.claimDueTasks();

      expect(result).toEqual([]);
    });

    it('should claim candidates via a conditional bulk update and return the updated rows', async () => {
      const claimedRows = [{ id: 'task-1', status: AgentTaskStatus.LEASED }];

      agentTaskRepository.createQueryBuilder
        .mockReturnValueOnce(
          buildQueryBuilder({
            getMany: jest.fn().mockResolvedValue([{ id: 'task-1' }]),
          }),
        )
        .mockReturnValueOnce(
          buildQueryBuilder({
            execute: jest.fn().mockResolvedValue({ raw: claimedRows }),
          }),
        );

      const result = await service.claimDueTasks(5);

      expect(result).toEqual(claimedRows);
    });

    // Guards the "survives restart" exit gate at the unit level. A crashed
    // worker leaves status = LEASED, so the claimable predicate must name
    // LEASED explicitly; a PENDING-only filter strands the row forever.
    it('should include expired LEASED rows in the claimable predicate, not just PENDING', async () => {
      const candidateBuilder = buildQueryBuilder({
        getMany: jest.fn().mockResolvedValue([]),
      });

      agentTaskRepository.createQueryBuilder.mockReturnValue(candidateBuilder);

      await service.claimDueTasks();

      const [predicate, parameters] = candidateBuilder.where.mock.calls[0];

      expect(predicate).toContain('task.status = :pending');
      expect(predicate).toContain('task."leasedUntil" < :now');
      expect(parameters).toEqual(
        expect.objectContaining({
          pending: AgentTaskStatus.PENDING,
          leased: AgentTaskStatus.LEASED,
        }),
      );
    });

    // The compare-and-swap. If the UPDATE's guard is weaker than the SELECT's
    // predicate, two concurrent dispatch ticks both claim the same row.
    it('should re-check the claimable predicate inside the conditional update', async () => {
      const updateBuilder = buildQueryBuilder({
        execute: jest.fn().mockResolvedValue({ raw: [] }),
      });

      agentTaskRepository.createQueryBuilder
        .mockReturnValueOnce(
          buildQueryBuilder({
            getMany: jest.fn().mockResolvedValue([{ id: 'task-1' }]),
          }),
        )
        .mockReturnValueOnce(updateBuilder);

      await service.claimDueTasks();

      const guard = updateBuilder.andWhere.mock.calls
        .map(([clause]) => clause)
        .join(' ');

      expect(guard).toContain('status = :pending');
      expect(guard).toContain('"leasedUntil" < :now');
    });
  });

  describe('reapAbandonedTasks', () => {
    it('should mark LEASED rows whose lease expired and whose attempts are exhausted as FAILED', async () => {
      const reapBuilder = buildQueryBuilder({
        execute: jest.fn().mockResolvedValue({ affected: 2 }),
      });

      agentTaskRepository.createQueryBuilder.mockReturnValue(reapBuilder);

      const reaped = await service.reapAbandonedTasks();

      expect(reaped).toBe(2);
      expect(reapBuilder.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: AgentTaskStatus.FAILED }),
      );

      const guard = reapBuilder.andWhere.mock.calls
        .map(([clause]) => clause)
        .join(' ');

      expect(guard).toContain('"leasedUntil" < now()');
      expect(guard).toContain('attempts >= "maxAttempts"');
    });
  });

  describe('failTask', () => {
    it('should reschedule with backoff when attempts remain', async () => {
      agentTaskRepository.findOne.mockResolvedValue({
        id: 'task-1',
        workspaceId: 'workspace-1',
        status: AgentTaskStatus.LEASED,
        attempts: 1,
        maxAttempts: 3,
        dueAt: new Date('2026-01-01'),
      });

      await service.failTask({
        taskId: 'task-1',
        workspaceId: 'workspace-1',
        runId: 'run-1',
        errorMessage: 'Model timed out',
      });

      expect(agentTaskRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: AgentTaskStatus.PENDING, outcome: null }),
      );
    });

    it('should mark FAILED with a human-readable outcome once attempts are exhausted', async () => {
      agentTaskRepository.findOne.mockResolvedValue({
        id: 'task-1',
        workspaceId: 'workspace-1',
        status: AgentTaskStatus.LEASED,
        attempts: 3,
        maxAttempts: 3,
        dueAt: new Date('2026-01-01'),
      });

      await service.failTask({
        taskId: 'task-1',
        workspaceId: 'workspace-1',
        runId: 'run-1',
        errorMessage: 'Model timed out',
      });

      expect(agentTaskRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: AgentTaskStatus.FAILED,
          outcome: 'Gave up after 3 attempts: Model timed out',
        }),
      );
    });

    it('should do nothing when the task is no longer LEASED', async () => {
      agentTaskRepository.findOne.mockResolvedValue({
        id: 'task-1',
        workspaceId: 'workspace-1',
        status: AgentTaskStatus.CANCELLED,
      });

      await service.failTask({
        taskId: 'task-1',
        workspaceId: 'workspace-1',
        runId: 'run-1',
        errorMessage: 'Model timed out',
      });

      expect(agentTaskRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('cancelTask', () => {
    it('should return true when an open task was cancelled', async () => {
      agentTaskRepository.createQueryBuilder.mockReturnValue(
        buildQueryBuilder({ execute: jest.fn().mockResolvedValue({ affected: 1 }) }),
      );

      const cancelled = await service.cancelTask({
        taskId: 'task-1',
        workspaceId: 'workspace-1',
        reason: 'Record deleted',
      });

      expect(cancelled).toBe(true);
    });

    it('should return false when the task was already terminal', async () => {
      agentTaskRepository.createQueryBuilder.mockReturnValue(
        buildQueryBuilder({ execute: jest.fn().mockResolvedValue({ affected: 0 }) }),
      );

      const cancelled = await service.cancelTask({
        taskId: 'task-1',
        workspaceId: 'workspace-1',
        reason: 'Record deleted',
      });

      expect(cancelled).toBe(false);
    });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd packages/twenty-server && npx jest agent-task.service.spec
```

Expected: FAIL — module not found.

- [ ] **Step 4: Write the service**

Create `services/agent-task.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { type ActorMetadata } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { In, Repository } from 'typeorm';

import {
  AGENT_TASK_CLAIM_BATCH_SIZE,
  AGENT_TASK_DEFAULT_BUDGET,
  AGENT_TASK_DEFAULT_MAX_ATTEMPTS,
  AGENT_TASK_LEASE_DURATION_MS,
  computeAgentTaskBackoffMs,
} from 'src/engine/metadata-modules/ai/ai-research/constants/agent-task.const';
import { AgentTaskEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/agent-task.entity';
import { AgentTaskStatus } from 'src/engine/metadata-modules/ai/ai-research/types/agent-task-status.type';

export type CreateAgentTaskParams = {
  workspaceId: string;
  objectNameSingular: string;
  recordId: string;
  agentId: string;
  reason: string;
  priority?: number;
  budget?: number;
  maxAttempts?: number;
  idempotencyKey?: string | null;
  dueAt?: Date;
  createdByActor?: ActorMetadata | null;
};

@Injectable()
export class AgentTaskService {
  constructor(
    @InjectRepository(AgentTaskEntity)
    private readonly agentTaskRepository: Repository<AgentTaskEntity>,
  ) {}

  async createTask(params: CreateAgentTaskParams): Promise<AgentTaskEntity> {
    if (isDefined(params.idempotencyKey)) {
      const existing = await this.agentTaskRepository.findOne({
        where: {
          workspaceId: params.workspaceId,
          idempotencyKey: params.idempotencyKey,
          status: In([AgentTaskStatus.PENDING, AgentTaskStatus.LEASED]),
        },
      });

      // Already scheduled — refresh timing/reason instead of duplicating the
      // work. Mirrors the crm repo's upsert-scheduling pattern.
      if (isDefined(existing)) {
        return this.agentTaskRepository.save({
          ...existing,
          reason: params.reason,
          dueAt: params.dueAt ?? existing.dueAt,
        });
      }
    }

    return this.agentTaskRepository.save({
      workspaceId: params.workspaceId,
      objectNameSingular: params.objectNameSingular,
      recordId: params.recordId,
      agentId: params.agentId,
      reason: params.reason,
      priority: params.priority ?? 0,
      budget: params.budget ?? AGENT_TASK_DEFAULT_BUDGET,
      maxAttempts: params.maxAttempts ?? AGENT_TASK_DEFAULT_MAX_ATTEMPTS,
      idempotencyKey: params.idempotencyKey ?? null,
      dueAt: params.dueAt ?? new Date(),
      createdByActor: params.createdByActor ?? null,
      status: AgentTaskStatus.PENDING,
      attempts: 0,
    });
  }

  // Select candidates, then a conditional bulk UPDATE keyed on the *same*
  // claimable predicate. Postgres serializes the UPDATE per row, so a second
  // concurrent dispatch tick claims nothing for a row the first tick already
  // took — the first tick moved it to LEASED with "leasedUntil" in the future,
  // which makes the predicate false. Same compare-and-swap shape the rest of
  // this codebase uses, no new locking primitive.
  //
  // The predicate deliberately covers TWO states, not one:
  //   - PENDING: never started, or rescheduled by failTask's backoff.
  //   - LEASED with an expired "leasedUntil": a worker crashed mid-run and
  //     never called completeTask/failTask. Nothing else in the system will
  //     ever reset that row's status, so a PENDING-only filter would strand it
  //     forever and the "survives restart" exit gate could not pass.
  // `attempts < maxAttempts` bounds the reclaim loop: a repeatedly-crashing
  // task stops being claimable after maxAttempts and is swept to FAILED by
  // reapAbandonedTasks below.
  async claimDueTasks(
    limit = AGENT_TASK_CLAIM_BATCH_SIZE,
  ): Promise<AgentTaskEntity[]> {
    const now = new Date();

    const claimablePredicate = `(
      task.status = :pending
      OR (task.status = :leased AND task."leasedUntil" < :now)
    )`;

    const candidates = await this.agentTaskRepository
      .createQueryBuilder('task')
      .where(claimablePredicate, {
        pending: AgentTaskStatus.PENDING,
        leased: AgentTaskStatus.LEASED,
        now,
      })
      .andWhere('task."dueAt" <= :now', { now })
      .andWhere('task.attempts < task."maxAttempts"')
      .orderBy('task.priority', 'DESC')
      .addOrderBy('task."dueAt"', 'ASC')
      .limit(limit)
      .getMany();

    if (candidates.length === 0) {
      return [];
    }

    const leasedUntil = new Date(now.getTime() + AGENT_TASK_LEASE_DURATION_MS);

    const updateResult = await this.agentTaskRepository
      .createQueryBuilder()
      .update(AgentTaskEntity)
      .set({
        status: AgentTaskStatus.LEASED,
        leasedUntil,
        attempts: () => '"attempts" + 1',
      })
      .where('id IN (:...ids)', { ids: candidates.map((task) => task.id) })
      // Re-check the claimable predicate inside the UPDATE. This is the
      // compare-and-swap: without it two ticks that both selected the same row
      // would both "claim" it.
      .andWhere(
        `(
          status = :pending
          OR (status = :leased AND "leasedUntil" < :now)
        )`,
        {
          pending: AgentTaskStatus.PENDING,
          leased: AgentTaskStatus.LEASED,
          now,
        },
      )
      .returning('*')
      .execute();

    return updateResult.raw as AgentTaskEntity[];
  }

  // A row that burned through maxAttempts while LEASED is no longer claimable
  // but is also not terminal, so nothing would ever close it out. Sweep those
  // to FAILED. Modelled on WorkflowHandleStaledRunsWorkspaceService, which is
  // this codebase's existing answer to the same problem for workflow runs
  // (`get-staled-runs-find-options.util.ts`: status ENQUEUED + enqueuedAt older
  // than STALED_RUNS_THRESHOLD_MS, swept by the `cron:workflow:handle-staled-runs`
  // cron). Called from the same dispatch tick as claimDueTasks.
  async reapAbandonedTasks(): Promise<number> {
    const result = await this.agentTaskRepository
      .createQueryBuilder()
      .update(AgentTaskEntity)
      .set({
        status: AgentTaskStatus.FAILED,
        leasedUntil: null,
        outcome: () =>
          `'Abandoned after ' || "attempts" || ' attempts: lease expired with no worker result'`,
      })
      .where('status = :leased', { leased: AgentTaskStatus.LEASED })
      .andWhere('"leasedUntil" < now()')
      .andWhere('attempts >= "maxAttempts"')
      .execute();

    return result.affected ?? 0;
  }

  // Guarded on status = LEASED, so a stale or duplicate worker invocation
  // can never overwrite a result another attempt already wrote.
  async completeTask(params: {
    taskId: string;
    workspaceId: string;
    runId: string;
    outcome: string;
  }): Promise<void> {
    await this.agentTaskRepository
      .createQueryBuilder()
      .update(AgentTaskEntity)
      .set({
        status: AgentTaskStatus.SUCCEEDED,
        lastRunId: params.runId,
        outcome: params.outcome,
        leasedUntil: null,
      })
      .where('id = :id', { id: params.taskId })
      .andWhere('"workspaceId" = :workspaceId', {
        workspaceId: params.workspaceId,
      })
      .andWhere('status = :leased', { leased: AgentTaskStatus.LEASED })
      .execute();
  }

  // Exhaustion is a separate, explicit finalization from the claim path —
  // two small operations rather than one large state machine.
  async failTask(params: {
    taskId: string;
    workspaceId: string;
    runId: string;
    errorMessage: string;
  }): Promise<void> {
    const task = await this.agentTaskRepository.findOne({
      where: { id: params.taskId, workspaceId: params.workspaceId },
    });

    if (!isDefined(task) || task.status !== AgentTaskStatus.LEASED) {
      return;
    }

    const exhausted = task.attempts >= task.maxAttempts;

    await this.agentTaskRepository.save({
      ...task,
      status: exhausted ? AgentTaskStatus.FAILED : AgentTaskStatus.PENDING,
      lastRunId: params.runId,
      leasedUntil: null,
      outcome: exhausted
        ? `Gave up after ${task.attempts} attempts: ${params.errorMessage}`
        : null,
      dueAt: exhausted
        ? task.dueAt
        : new Date(Date.now() + computeAgentTaskBackoffMs(task.attempts)),
    });
  }

  async cancelTask(params: {
    taskId: string;
    workspaceId: string;
    reason: string;
  }): Promise<boolean> {
    const result = await this.agentTaskRepository
      .createQueryBuilder()
      .update(AgentTaskEntity)
      .set({
        status: AgentTaskStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelReason: params.reason,
      })
      .where('id = :id', { id: params.taskId })
      .andWhere('"workspaceId" = :workspaceId', {
        workspaceId: params.workspaceId,
      })
      .andWhere('status IN (:...openStatuses)', {
        openStatuses: [AgentTaskStatus.PENDING, AgentTaskStatus.LEASED],
      })
      .execute();

    return (result.affected ?? 0) > 0;
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd packages/twenty-server && npx jest agent-task.service.spec
```

Expected: PASS, 9 tests.

- [ ] **Step 6: Write the `ai-research` module**

Create `ai-research.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AgentRunEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/agent-run.entity';
import { AgentTaskEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/agent-task.entity';
import { EvidenceEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/evidence.entity';
import { FactEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/fact.entity';
import { AgentTaskService } from 'src/engine/metadata-modules/ai/ai-research/services/agent-task.service';
import { EvidenceRecordingService } from 'src/engine/metadata-modules/ai/ai-research/services/evidence-recording.service';
import { FactDerivationService } from 'src/engine/metadata-modules/ai/ai-research/services/fact-derivation.service';
import { RecordEvidenceTool } from 'src/engine/core-modules/tool/tools/record-evidence-tool/record-evidence-tool';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      EvidenceEntity,
      FactEntity,
      AgentTaskEntity,
      AgentRunEntity,
    ]),
  ],
  providers: [
    EvidenceRecordingService,
    // Derivation internals. Deliberately NOT exported (Decision 1): the only
    // exported Fact surface is FactService, added in Task 8.
    FactDerivationService,
    AgentTaskService,
    RecordEvidenceTool,
  ],
  // TypeOrmModule is deliberately NOT re-exported. Exporting it would put
  // Repository<FactEntity> in every importing module's injector and reopen
  // the direct-query path Decision 1 closes.
  exports: [EvidenceRecordingService, AgentTaskService, RecordEvidenceTool],
})
export class AiResearchModule {}
```

`FactService` (Task 8) and the GraphQL resolvers (Tasks 10 and 11) are added to this module's `providers`/`exports` in their own tasks — this step only wires what Tasks 1-5 produced. Re-run Task 3's Step 7 module wiring now that `AiResearchModule` exists.

**Real seam:** `AgentTaskService`'s only collaborator is the TypeORM repository — there is no service seam to un-double, and the compare-and-swap semantics that make the claim safe (`UPDATE … WHERE status = 'PENDING' OR (status = 'LEASED' AND "leasedUntil" < now())`) are a property of Postgres, not of this class. Its real-seam coverage is Task 13 steps 3, 9, 10 and 11, which run `claimDueTasks`/`failTask`/`cancelTask` against a real database. Do not treat this task as covered until those steps exist.

> **Why a hand-rolled lease and not the message queue.** Twenty's queue driver is BullMQ over Redis (`message-queue/drivers/bullmq.driver.ts`), and its job options expose only `attempts`, `priority`, `delay` and retention (`buildJobsOptions`, `:330-352`) — jobs are not SQL-queryable, are dropped by `removeOnComplete`/`removeOnFail` retention, and cannot carry the `budget`/`attempts`/`outcome` state the approvals UI and Task 13's assertions read. So the durable record stays in `core."agentTask"`. What *is* reused is the recovery pattern: Twenty already solves "an in-flight row whose worker vanished" for workflow runs with a status column plus a periodic sweeper — `getStaledRunsFindOptions()` matches `status = ENQUEUED AND enqueuedAt < now() - STALED_RUNS_THRESHOLD_MS` (1 hour) and `WorkflowHandleStaledRunsWorkspaceService` re-enqueues them from the `cron:workflow:handle-staled-runs` cron. `claimDueTasks`'s expired-lease branch and `reapAbandonedTasks` are the same pattern with a per-row deadline instead of a global threshold. Do not introduce a second scheduler.

- [ ] **Step 7: Lint, typecheck, commit**

```bash
npx nx lint:diff-with-main twenty-server
npx nx typecheck twenty-server
git add packages/twenty-server/src/engine/metadata-modules/ai/ai-research packages/twenty-server/src/engine/core-modules/tool-provider
git commit -m "feat(ai-research): add agent task service and ai-research module"
```

---

### Task 5b: Seed one research agent per workspace and bind it to a read-broad role

> **Owner Decision 4 (program §0):** *"(b) yes — every workspace gets one seeded `AgentEntity`, bound to a read-broad / write-nothing-directly role. Every write is proposal-gated regardless."* This task implements it, and it is what answers the question `create_agent_task` (Task 5c) cannot otherwise answer: *which agent runs a tool-scheduled research task?*

**Ground truth this task was written against** (read, not assumed):

- `AgentEntity` (`engine/metadata-modules/ai/ai-agent/entities/agent.entity.ts:18`) is `@Entity('agent')` — a plain **core-schema** TypeORM entity extending `SyncableEntity`, which supplies `universalIdentifier` and `applicationId`. It has **no** `roleId` column.
- Per-workspace agents are created declaratively: `STANDARD_AGENT` (`twenty-standard-application/constants/standard-agent.constant.ts`) has exactly one entry, `helper`, and `STANDARD_FLAT_AGENT_METADATA_BUILDERS_BY_AGENT_NAME` (`utils/agent-metadata/create-standard-flat-agent-metadata.util.ts`) has the matching builder. The `satisfies { [P in AllStandardAgentName]: … }` constraint means adding a key to the constant **forces** adding the builder — the compiler enforces the pair.
- Roles mirror this exactly: `STANDARD_ROLE` (one entry, `admin`) and `STANDARD_FLAT_ROLE_METADATA_BUILDERS_BY_ROLE_NAME`.
- **Role *targets* do not.** There is no `standard-role-target` constant, no `utils/role-target-metadata/` directory, and `roleTarget` is **not** in `TWENTY_STANDARD_ALL_METADATA_NAME` — so the standard-application migration pipeline structurally cannot emit a roleTarget row. `createStandardRoleFlatMetadata` hard-codes `roleTargetIds: []`. The seeded `helper` agent is created **role-less** today, which is exactly the "no role means no registry tools" trap this plan's risk section already names.
- Agent→role binding therefore has to happen at run time, through the one service that owns it: `AiAgentRoleService.assignRoleToAgent` (`engine/metadata-modules/ai/ai-agent-role/ai-agent-role.service.ts:30-57`), which calls `RoleTargetService.create({ createRoleTargetInput: { roleId, targetId: agentId, targetMetadataForeignKey: 'agentId' }, workspaceId })` and throws `ROLE_CANNOT_BE_ASSIGNED_TO_AGENTS` (line 145) unless `role.canBeAssignedToAgents`.
- The existing `admin` standard role sets `canBeAssignedToAgents: false` (`create-standard-flat-role-metadata.util.ts:25`), as do `createMemberRole` and `createGuestRole`. **No shipped role can be assigned to an agent.** A new one is required.
- `(workspaceId, agentId)` on `roleTarget` is `@Unique('IDX_ROLE_TARGET_UNIQUE_AGENT')`, so the binding is naturally idempotent-by-conflict; this task still checks before writing rather than relying on catching a constraint violation.
- **The decisive fact — a role-less agent gets zero registry tools, not a read-only subset.** `AgentAsyncExecutorService.executeAgent` resolves the role with `getAgentRoleId()` (`agent-async-executor.service.ts:108-120`, a `roleTargetRepository.findOne({ where: { agentId }, select: ['roleId'] })`) and then gates *both* tool-loading strategies behind one `if`:
  ```ts
  // Registry tools are scoped exclusively by the agent permission-tab
  // role. No role means no registry tools.
  if (isDefined(agentRoleId)) {           // :302
  ```
  `registryTools` is initialised to `{}` above it and there is no `else`. The only tools a role-less agent receives are `this.nativeToolBinder.bind(...)` — provider-native web/Twitter search. `record_evidence`, `create_agent_task` and every `update_*` tool are unreachable. This is not a permissions downgrade, it is a total tool blackout, and it is why this task is a blocker for Tasks 5c, 7 and 13 rather than a nicety.
- **`record_evidence` will reach the catalog once a role exists.** Its category is `ToolCategory.ACTION`, which is in `WORKFLOW_AGENT_REGISTRY_TOOL_CATEGORIES` (`workflow-agent-registry-tool-categories.const.ts:3-6` — `DATABASE_CRUD` and `ACTION`, nothing else), so it survives the lazy path's category filter. `ActionToolProvider.isAvailable()` returns `true` unconditionally (`action-tool.provider.ts:70-72`) and tools registered the way `search_help_center`/`navigate_app` are (`:140-171`) are pushed with **no** `hasToolPermission` check — unlike `http_request`, `send_email` and `code_interpreter`, which are each behind a `PermissionFlagType` gate. Register `record_evidence` in the unconditional block; do not put it behind a permission flag, or the seeded role would need a matching `rolePermissionFlagId` that the standard-role builder hard-codes to `[]`.

> **Deviation from Decision 4's phrasing — settled, and the deviation stands.** "Write-nothing-directly" is delivered by `ProposalGateService`, not by stripping the role's object-write permissions. The role below sets `canUpdateAllObjectRecords: true` and `canReadAllObjectRecords: true`, with `canSoftDeleteAllObjectRecords`, `canDestroyAllObjectRecords`, `canUpdateAllSettings` all `false`. This was an open question in the previous revision; it is now settled by reading `database-tool.provider.ts`. Tool *generation* is scoped by object write permission: `:144-146` derives `canUpdateRecords` from the role's object permissions, and `:262` wraps the entire `create_one_*` / `create_many_*` / `update_one_*` / `update_many_*` / upsert descriptor block in `if (canUpdateRecords && canBeManagedByAutomation)`. With `canUpdateAllObjectRecords: false` the agent's catalog would contain **no write tool of any kind**, so it could never trip the gate and never produce a proposal — the degraded no-op Decision 4 exists to prevent. The gate is what makes the write non-direct: `ProposalGateService.evaluate` intercepts above the tool layer and the shipped default policy is `PROPOSE`. **Owner-visible: this is a product-security default and the functional reading was chosen over the literal one.**

**Files:**
- Create: `packages/twenty-server/src/engine/metadata-modules/ai/ai-research/constants/research-agent.const.ts`
- Create: `packages/twenty-server/src/engine/metadata-modules/ai/ai-research/services/research-agent.service.ts`
- Test: `packages/twenty-server/src/engine/metadata-modules/ai/ai-research/services/__tests__/research-agent.service.spec.ts`
- Modify: `packages/twenty-server/src/engine/workspace-manager/twenty-standard-application/constants/standard-agent.constant.ts`
- Modify: `packages/twenty-server/src/engine/workspace-manager/twenty-standard-application/utils/agent-metadata/create-standard-flat-agent-metadata.util.ts`
- Modify: `packages/twenty-server/src/engine/workspace-manager/twenty-standard-application/constants/standard-role.constant.ts`
- Modify: `packages/twenty-server/src/engine/workspace-manager/twenty-standard-application/utils/role-metadata/create-standard-flat-role-metadata.util.ts`
- Modify: `packages/twenty-server/src/engine/metadata-modules/ai/ai-research/ai-research.module.ts`

**Interfaces:**
- Produces: `RESEARCH_AGENT_UNIVERSAL_IDENTIFIER`, `RESEARCH_AGENT_ROLE_UNIVERSAL_IDENTIFIER`, `ResearchAgentService.resolveResearchAgentId(workspaceId: string): Promise<string>`.

- [ ] **Step 1: Re-confirm the two facts the whole task rests on (fast, read-only)**

Both were settled by reading the code; this step exists so a stale checkout is caught before eight steps of work are written against it. Run:

```bash
cd packages/twenty-server
grep -n "No role means no registry tools" -A 2 src/engine/metadata-modules/ai/ai-agent-execution/services/agent-async-executor.service.ts
grep -n "canUpdateRecords && canBeManagedByAutomation" src/engine/core-modules/tool-provider/providers/database-tool.provider.ts
```

Expected, and required to proceed:

1. The first grep prints the comment followed by `if (isDefined(agentRoleId)) {`. This is the tool blackout. If this `if` has gained an `else` that supplies a default role, **stop** — this whole task may be unnecessary and Decision 4 should be re-read against the new behaviour.
2. The second grep prints exactly one hit, the guard around the write-tool descriptor block. This is what forces `canUpdateAllObjectRecords: true` on the seeded role. If it no longer exists, set the flag to `false`, delete the deviation blockquote above, and record in the commit message that Decision 4 is now satisfied literally.

Do not guess either answer. The first decides whether the seeded agent can call any tool; the second decides whether it can propose anything.

- [ ] **Step 2: Write the constants**

Create `constants/research-agent.const.ts`:

```ts
// Fixed universal identifiers, in the same 20202020-prefixed namespace every
// other standard-application entity uses. These are the join key between the
// declarative workspace seed and the run-time lookup in ResearchAgentService —
// never regenerate them.
export const RESEARCH_AGENT_UNIVERSAL_IDENTIFIER =
  '20202020-9a3f-4c1e-8d27-6b41f0d5a7c3';

export const RESEARCH_AGENT_ROLE_UNIVERSAL_IDENTIFIER =
  '20202020-4e88-4b0a-9f16-2c7d3ae91b54';
```

- [ ] **Step 3: Add the standard agent**

In `twenty-standard-application/constants/standard-agent.constant.ts`, replace:

```ts
export const STANDARD_AGENT = {
  helper: {
    universalIdentifier: '20202020-c7ab-4065-b822-0ca1d5de60a9',
  },
} as const satisfies Record<
```

with:

```ts
export const STANDARD_AGENT = {
  helper: {
    universalIdentifier: '20202020-c7ab-4065-b822-0ca1d5de60a9',
  },
  researcher: {
    universalIdentifier: '20202020-9a3f-4c1e-8d27-6b41f0d5a7c3',
  },
} as const satisfies Record<
```

The literal is repeated rather than imported from `research-agent.const.ts`: `twenty-standard-application` is bootstrap code and must not depend on a feature module. Step 6's test asserts the two literals agree, so the duplication cannot drift silently.

In `utils/agent-metadata/create-standard-flat-agent-metadata.util.ts`, add a second entry to `STANDARD_FLAT_AGENT_METADATA_BUILDERS_BY_AGENT_NAME`, after the `helper` entry's closing `}),`:

```ts
  researcher: (args: Omit<CreateStandardAgentArgs, 'context'>) =>
    createStandardAgentFlatMetadata({
      ...args,
      context: {
        agentName: 'researcher',
        name: 'researcher',
        label: 'Researcher',
        description:
          'AI agent that researches CRM records and records what it observed as evidence before proposing any change',
        icon: 'IconSearch',
        prompt: `You research company and person records for this CRM.

For every field you intend to change, call record_evidence FIRST with the source and the value you observed. Only after recording evidence should you call the update tool for that record. Updates are never applied directly — they are queued for a human to approve, and the evidence you recorded is what that human reads to decide.

Never guess a value to fill a gap. If you find nothing verifiable, say so and stop.`,
        modelId: AUTO_SELECT_SMART_MODEL_ID,
        responseFormat: { type: 'text' },
        isCustom: false,
        modelConfiguration: {},
        evaluationInputs: [],
      },
    }),
```

No new imports: `AUTO_SELECT_SMART_MODEL_ID` and `createStandardAgentFlatMetadata` are already imported by this file. `buildStandardFlatAgentMetadataMaps` iterates `Object.values(...)` over this record, so the new agent is picked up with no further wiring.

- [ ] **Step 4: Add the standard role**

In `twenty-standard-application/constants/standard-role.constant.ts`, replace:

```ts
export const STANDARD_ROLE = {
  admin: { universalIdentifier: '20202020-02c2-43f2-b94d-cab1f2b532eb' },
} as const satisfies Record<string, { universalIdentifier: string }>;
```

with:

```ts
export const STANDARD_ROLE = {
  admin: { universalIdentifier: '20202020-02c2-43f2-b94d-cab1f2b532eb' },
  aiResearcher: {
    universalIdentifier: '20202020-4e88-4b0a-9f16-2c7d3ae91b54',
  },
} as const satisfies Record<string, { universalIdentifier: string }>;
```

In `utils/role-metadata/create-standard-flat-role-metadata.util.ts`, add a second entry after the `admin` entry's closing `}),`:

```ts
  aiResearcher: (args: Omit<CreateStandardRoleArgs, 'context'>) =>
    createStandardRoleFlatMetadata({
      ...args,
      context: {
        roleName: 'aiResearcher',
        label: 'AI Researcher',
        description:
          'Read-broad role for the seeded research agent. Every record write it attempts is intercepted by the AI write gate and queued for human approval.',
        icon: 'IconRobot',
        isEditable: true,
        // No settings access and no destructive permissions. See the
        // deviation note at the top of this task for why update is granted.
        canUpdateAllSettings: false,
        canAccessAllTools: true,
        canReadAllObjectRecords: true,
        canUpdateAllObjectRecords: true,
        canSoftDeleteAllObjectRecords: false,
        canDestroyAllObjectRecords: false,
        canBeAssignedToUsers: false,
        // The whole point. Every shipped role sets this false, so
        // assignRoleToAgent throws ROLE_CANNOT_BE_ASSIGNED_TO_AGENTS today.
        canBeAssignedToAgents: true,
        canBeAssignedToApiKeys: false,
      },
    }),
```

`isEditable: true` so an admin can narrow the role from Settings without a code change — this is a product default, not a security boundary.

- [ ] **Step 5: Write the failing resolver-service test**

Create `services/__tests__/research-agent.service.spec.ts`:

```ts
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AgentEntity } from 'src/engine/metadata-modules/ai/ai-agent/entities/agent.entity';
import { AiAgentRoleService } from 'src/engine/metadata-modules/ai/ai-agent-role/ai-agent-role.service';
import { RESEARCH_AGENT_ROLE_UNIVERSAL_IDENTIFIER, RESEARCH_AGENT_UNIVERSAL_IDENTIFIER } from 'src/engine/metadata-modules/ai/ai-research/constants/research-agent.const';
import { ResearchAgentService } from 'src/engine/metadata-modules/ai/ai-research/services/research-agent.service';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';
import { RoleTargetEntity } from 'src/engine/metadata-modules/role-target/role-target.entity';
import { STANDARD_AGENT } from 'src/engine/workspace-manager/twenty-standard-application/constants/standard-agent.constant';
import { STANDARD_ROLE } from 'src/engine/workspace-manager/twenty-standard-application/constants/standard-role.constant';

describe('ResearchAgentService', () => {
  let service: ResearchAgentService;

  const agentRepository = { findOne: jest.fn() };
  const roleRepository = { findOne: jest.fn() };
  const roleTargetRepository = { findOne: jest.fn() };
  const aiAgentRoleService = { assignRoleToAgent: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    agentRepository.findOne.mockResolvedValue({ id: 'agent-seeded' });
    roleRepository.findOne.mockResolvedValue({ id: 'role-seeded' });
    roleTargetRepository.findOne.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchAgentService,
        { provide: getRepositoryToken(AgentEntity), useValue: agentRepository },
        { provide: getRepositoryToken(RoleEntity), useValue: roleRepository },
        {
          provide: getRepositoryToken(RoleTargetEntity),
          useValue: roleTargetRepository,
        },
        { provide: AiAgentRoleService, useValue: aiAgentRoleService },
      ],
    }).compile();

    service = module.get<ResearchAgentService>(ResearchAgentService);
  });

  // The duplication in Step 3/Step 4 is only safe if it is asserted.
  it('should use the same universal identifiers the workspace seed writes', () => {
    expect(STANDARD_AGENT.researcher.universalIdentifier).toBe(
      RESEARCH_AGENT_UNIVERSAL_IDENTIFIER,
    );
    expect(STANDARD_ROLE.aiResearcher.universalIdentifier).toBe(
      RESEARCH_AGENT_ROLE_UNIVERSAL_IDENTIFIER,
    );
  });

  it('should resolve the seeded agent by universal identifier and bind its role on first use', async () => {
    const agentId = await service.resolveResearchAgentId('workspace-1');

    expect(agentRepository.findOne).toHaveBeenCalledWith({
      where: {
        workspaceId: 'workspace-1',
        universalIdentifier: RESEARCH_AGENT_UNIVERSAL_IDENTIFIER,
      },
    });
    expect(aiAgentRoleService.assignRoleToAgent).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      agentId: 'agent-seeded',
      roleId: 'role-seeded',
    });
    expect(agentId).toBe('agent-seeded');
  });

  it('should not re-bind a role the agent already has', async () => {
    roleTargetRepository.findOne.mockResolvedValue({ id: 'role-target-1' });

    await service.resolveResearchAgentId('workspace-1');

    expect(aiAgentRoleService.assignRoleToAgent).not.toHaveBeenCalled();
  });

  // A workspace created before this task shipped has no researcher row. Fail
  // loudly and name the fix — never fall back to `agent: null`, which is the
  // degraded no-tools run Decision 4 exists to eliminate.
  it('should throw a named error when the workspace has no seeded research agent', async () => {
    agentRepository.findOne.mockResolvedValue(null);

    await expect(service.resolveResearchAgentId('workspace-1')).rejects.toThrow(
      /research agent is not seeded/i,
    );
  });

  it('should still return the agent id when the role row is missing, without binding', async () => {
    roleRepository.findOne.mockResolvedValue(null);

    const agentId = await service.resolveResearchAgentId('workspace-1');

    expect(agentId).toBe('agent-seeded');
    expect(aiAgentRoleService.assignRoleToAgent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

```bash
cd packages/twenty-server && npx jest research-agent.service.spec
```

Expected: FAIL — module not found.

- [ ] **Step 7: Write the service**

Create `services/research-agent.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isDefined } from 'twenty-shared/utils';
import { Repository } from 'typeorm';

import { AgentEntity } from 'src/engine/metadata-modules/ai/ai-agent/entities/agent.entity';
import { AiAgentRoleService } from 'src/engine/metadata-modules/ai/ai-agent-role/ai-agent-role.service';
import {
  RESEARCH_AGENT_ROLE_UNIVERSAL_IDENTIFIER,
  RESEARCH_AGENT_UNIVERSAL_IDENTIFIER,
} from 'src/engine/metadata-modules/ai/ai-research/constants/research-agent.const';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';
import { RoleTargetEntity } from 'src/engine/metadata-modules/role-target/role-target.entity';

@Injectable()
export class ResearchAgentService {
  private readonly logger = new Logger(ResearchAgentService.name);

  constructor(
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(AgentEntity)
    private readonly agentRepository: Repository<AgentEntity>,
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(RoleEntity)
    private readonly roleRepository: Repository<RoleEntity>,
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(RoleTargetEntity)
    private readonly roleTargetRepository: Repository<RoleTargetEntity>,
    private readonly aiAgentRoleService: AiAgentRoleService,
  ) {}

  // The workspace seed creates the agent row and the role row, but the
  // standard-application pipeline has no roleTarget mechanism (roleTarget is
  // not in TWENTY_STANDARD_ALL_METADATA_NAME), so the binding is made here on
  // first use. Idempotent: roleTarget is UNIQUE on (workspaceId, agentId).
  async resolveResearchAgentId(workspaceId: string): Promise<string> {
    const agent = await this.agentRepository.findOne({
      where: {
        workspaceId,
        universalIdentifier: RESEARCH_AGENT_UNIVERSAL_IDENTIFIER,
      },
    });

    if (!isDefined(agent)) {
      throw new Error(
        `This workspace's research agent is not seeded. Re-run the standard application sync for workspace ${workspaceId}.`,
      );
    }

    await this.ensureRoleBinding(workspaceId, agent.id);

    return agent.id;
  }

  private async ensureRoleBinding(
    workspaceId: string,
    agentId: string,
  ): Promise<void> {
    const existingBinding = await this.roleTargetRepository.findOne({
      where: { workspaceId, agentId },
    });

    if (isDefined(existingBinding)) {
      return;
    }

    const role = await this.roleRepository.findOne({
      where: {
        workspaceId,
        universalIdentifier: RESEARCH_AGENT_ROLE_UNIVERSAL_IDENTIFIER,
      },
    });

    // An admin who deleted the seeded role gets a tool-less run, not a crash.
    // Task 7's worker turns that into a named outcome rather than "found
    // nothing", so the cause is visible in run history.
    if (!isDefined(role)) {
      this.logger.warn(
        `Research agent role missing in workspace ${workspaceId}; the research agent will run with no registry tools.`,
      );

      return;
    }

    await this.aiAgentRoleService.assignRoleToAgent({
      workspaceId,
      agentId,
      roleId: role.id,
    });
  }
}
```

The signature is confirmed against the file, not inferred. `ai-agent-role.service.ts:31-39` reads:

```ts
public async assignRoleToAgent({
  workspaceId,
  agentId,
  roleId,
}: {
  workspaceId: string;
  agentId: string;
  roleId: string;
}): Promise<void> {
```

All three are required `string`s, the return is `Promise<void>` (it resolves the created `FlatRoleTarget` internally but does not return it), and calling it twice with the same triple is a no-op — `validateAssignRoleInput` looks for an existing `roleTarget` on `{ agentId, roleId }` and returns `roleToAssignIsSameAsCurrentRole: true`, on which `assignRoleToAgent` returns early before touching `RoleTargetService`. The pre-check in `resolveResearchAgentId` above is therefore belt-and-braces, kept because it avoids the three repository round-trips the validator would otherwise make on every task dispatch.

Two failure modes to keep in mind when writing the test doubles: the method throws `AiException(ROLE_CANNOT_BE_ASSIGNED_TO_AGENTS)` at `:145` if the role's `canBeAssignedToAgents` is false, and `RoleTargetService.create` runs a **full workspace migration** (`validateBuildAndRunWorkspaceMigration` with `allFlatEntityOperationByMetadataName: { roleTarget: … }`) which re-validates the same flag through `validateFlatRoleTargetAssignationAvailability`. Both layers reject the shipped `admin`/member/guest roles, which is why Step 4's new role exists. It also means the binding is not cheap — it recomputes flat entity maps and needs the workspace's custom application to resolve — so it must happen once per workspace on first use and be cached behind the `roleTarget` existence check, never per task.

- [ ] **Step 8: Run the test to verify it passes**

```bash
cd packages/twenty-server && npx jest research-agent.service.spec
```

Expected: PASS, 5 tests.

- [ ] **Step 9: Wire the module**

In `ai-research.module.ts`, add `AgentEntity`, `RoleEntity`, and `RoleTargetEntity` to `TypeOrmModule.forFeature([...])`, add `AiAgentRoleModule` to `imports` (grep `ai-agent-role.module.ts` to confirm it exports `AiAgentRoleService`), and add `ResearchAgentService` to both `providers` and `exports`.

- [ ] **Step 10: Verify the seed actually runs against a fresh workspace — real seam**

```bash
npx nx database:reset twenty-server
psql "$PG_DATABASE_URL" -c "SELECT name, \"universalIdentifier\" FROM core.\"agent\" WHERE \"universalIdentifier\" = '20202020-9a3f-4c1e-8d27-6b41f0d5a7c3';"
psql "$PG_DATABASE_URL" -c "SELECT label, \"canBeAssignedToAgents\" FROM core.\"role\" WHERE \"universalIdentifier\" = '20202020-4e88-4b0a-9f16-2c7d3ae91b54';"
```

Expected: one `researcher` agent row and one `AI Researcher` role row with `canBeAssignedToAgents = true`, for every seeded workspace. If either query returns zero rows, the flat-metadata pair is not being picked up — check the `satisfies` constraint compiled and that `buildStandardFlatAgentMetadataMaps` / `buildStandardFlatRoleMetadataMaps` are both reached from `twenty-standard-application-all-flat-entity-maps.constant.ts`.

This is the real-seam check for this task: the unit tests above double every repository, so only a reset can prove the declarative seed emits the rows.

- [ ] **Step 11: Lint, typecheck, commit**

```bash
npx nx lint:diff-with-main twenty-server
npx nx typecheck twenty-server
git add packages/twenty-server/src/engine/metadata-modules/ai/ai-research packages/twenty-server/src/engine/workspace-manager/twenty-standard-application
git commit -m "feat(ai-research): seed a research agent and its role in every workspace"
```

---

### Task 5c: `create_agent_task` static tool

> **Program integration (owner: Phase 2, §2 C7).** This closes acceptance narrative "Lead to qualified opportunity" step 3 — *"a workflow creates a budgeted research task"*. The earlier claim that a workflow would call `createAgentTask` over HTTP with an API key is struck (see Task 10). Twenty's `AI_AGENT` workflow step already runs an agent with the registry tool catalog, so exposing task creation as a static tool makes every workflow able to schedule durable research with no new workflow machinery and no new `WorkflowActionType`.

Built exactly like `RecordEvidenceTool` (Task 3) and registered in the same `ActionToolProvider` static-tool map. Its denylist exemption already landed in Task 3 Step 5d.

**Two things the previous draft of this task got wrong, both verified:**

1. **`agentId` is required and the tool has no way to know it from its input.** `CreateAgentTaskParams` (Task 5) declares `agentId: string` non-optional and `"agentId" uuid NOT NULL` is in the Task 4 migration. Resolved by Task 5b: the tool calls `ResearchAgentService.resolveResearchAgentId(context.workspaceId)`.
2. **`context.actorContext` does not exist.** `ToolExecutionContext` (`engine/core-modules/tool/types/tool-execution-context.type.ts`) is exactly `{ workspaceId; userId?; userWorkspaceId?; threadId?; onCodeExecutionUpdate? }` — five fields, no actor. `ActionToolProvider.executeStaticTool` (`action-tool.provider.ts:210-216`) constructs it from those five and nothing else, so no actor can reach a static tool today. The tool writes a literal `FieldActorSource.AGENT` actor instead.

**Files:**
- Create: `packages/twenty-server/src/engine/core-modules/tool/tools/create-agent-task-tool/create-agent-task-tool.schema.ts`
- Create: `packages/twenty-server/src/engine/core-modules/tool/tools/create-agent-task-tool/create-agent-task-tool.ts`
- Test: `packages/twenty-server/src/engine/core-modules/tool/tools/create-agent-task-tool/__tests__/create-agent-task-tool.spec.ts`
- Modify: `packages/twenty-server/src/engine/core-modules/tool-provider/providers/action-tool.provider.ts`
- Modify: `packages/twenty-server/src/engine/metadata-modules/ai/ai-research/ai-research.module.ts`

**Interfaces:**
- Consumes: `AgentTaskService.createTask` (Task 5), `ResearchAgentService.resolveResearchAgentId` (Task 5b).
- Produces: static tool `create_agent_task`, dispatched via `executionRef: { kind: 'static', toolId: 'create_agent_task' }`.

- [ ] **Step 1: Write the input schema**

Create `create-agent-task-tool.schema.ts`:

```ts
import { z } from 'zod';

export const CreateAgentTaskInputZodSchema = z.object({
  objectNameSingular: z
    .string()
    .describe('The object the record to research belongs to, e.g. "company".'),
  recordId: z.string().uuid().describe('The id of the record to research.'),
  reason: z
    .string()
    .describe(
      'Why this research is worth doing now, in one sentence. A human reads this in the task list.',
    ),
  priority: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Higher runs first. Leave unset unless this is urgent.'),
  budget: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      'Maximum number of agent steps the research run may take. Defaults to 8.',
    ),
});

export type CreateAgentTaskToolInput = z.infer<
  typeof CreateAgentTaskInputZodSchema
>;
```

- [ ] **Step 2: Write the failing test**

Create `__tests__/create-agent-task-tool.spec.ts`:

```ts
import { CreateAgentTaskTool } from 'src/engine/core-modules/tool/tools/create-agent-task-tool/create-agent-task-tool';

describe('CreateAgentTaskTool', () => {
  const agentTaskService = { createTask: jest.fn() };
  const researchAgentService = { resolveResearchAgentId: jest.fn() };

  const buildTool = () =>
    new CreateAgentTaskTool(
      agentTaskService as never,
      researchAgentService as never,
    );

  const args = {
    objectNameSingular: 'company',
    recordId: '11111111-1111-4111-8111-111111111111',
    reason: 'New lead created',
  };

  const context = { workspaceId: 'workspace-1' };

  beforeEach(() => {
    jest.clearAllMocks();
    researchAgentService.resolveResearchAgentId.mockResolvedValue('agent-seeded');
    agentTaskService.createTask.mockResolvedValue({
      id: 'task-1',
      status: 'PENDING',
      dueAt: new Date('2026-08-01T00:00:00.000Z'),
    });
  });

  it('should schedule the task against the workspace research agent with a literal agent actor', async () => {
    const tool = buildTool();

    const result = await tool.execute(args as never, context as never);

    expect(agentTaskService.createTask).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      objectNameSingular: 'company',
      recordId: '11111111-1111-4111-8111-111111111111',
      agentId: 'agent-seeded',
      reason: 'New lead created',
      priority: undefined,
      budget: undefined,
      idempotencyKey:
        'tool:company:11111111-1111-4111-8111-111111111111:New lead created',
      createdByActor: {
        source: 'AGENT',
        workspaceMemberId: null,
        name: 'AI agent',
        context: {},
      },
    });
    expect(result.success).toBe(true);
    expect(result.result).toEqual({ taskId: 'task-1', status: 'PENDING' });
  });

  it('should pass the budget through as the run step cap', async () => {
    const tool = buildTool();

    await tool.execute({ ...args, budget: 3 } as never, context as never);

    expect(agentTaskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ budget: 3 }),
    );
  });

  // The idempotency key is what makes a re-fired workflow trigger safe.
  it('should return the same task id when called twice with the same inputs', async () => {
    const tool = buildTool();

    const first = await tool.execute(args as never, context as never);
    const second = await tool.execute(args as never, context as never);

    const [firstCall, secondCall] = agentTaskService.createTask.mock.calls;

    expect(firstCall[0].idempotencyKey).toBe(secondCall[0].idempotencyKey);
    expect(first.result).toEqual(second.result);
  });

  it('should fail without scheduling anything when the workspace has no seeded research agent', async () => {
    researchAgentService.resolveResearchAgentId.mockRejectedValue(
      new Error('This workspace\'s research agent is not seeded.'),
    );

    const tool = buildTool();

    const result = await tool.execute(args as never, context as never);

    expect(result.success).toBe(false);
    expect(agentTaskService.createTask).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd packages/twenty-server && npx jest create-agent-task-tool.spec
```

Expected: FAIL — module not found.

- [ ] **Step 4: Write the tool**

Create `create-agent-task-tool.ts`:

```ts
import { Injectable } from '@nestjs/common';

import { FieldActorSource } from 'twenty-shared/types';

import { CreateAgentTaskInputZodSchema } from 'src/engine/core-modules/tool/tools/create-agent-task-tool/create-agent-task-tool.schema';
import { type ToolExecutionContext } from 'src/engine/core-modules/tool/types/tool-execution-context.type';
import { type ToolInput } from 'src/engine/core-modules/tool/types/tool-input.type';
import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';
import { type Tool } from 'src/engine/core-modules/tool/types/tool.type';
import { AgentTaskService } from 'src/engine/metadata-modules/ai/ai-research/services/agent-task.service';
import { ResearchAgentService } from 'src/engine/metadata-modules/ai/ai-research/services/research-agent.service';

@Injectable()
export class CreateAgentTaskTool implements Tool {
  description =
    'Schedule durable background research on a company or person record. The research runs later, records evidence, and proposes any change for human approval. This does not modify the record and does not run the research now.';
  inputSchema = CreateAgentTaskInputZodSchema;

  constructor(
    private readonly agentTaskService: AgentTaskService,
    private readonly researchAgentService: ResearchAgentService,
  ) {}

  async execute(
    parameters: ToolInput,
    context: ToolExecutionContext,
  ): Promise<ToolOutput> {
    const { objectNameSingular, recordId, reason, priority, budget } =
      parameters as {
        objectNameSingular: string;
        recordId: string;
        reason: string;
        priority?: number;
        budget?: number;
      };

    let agentId: string;

    try {
      // Owner Decision 4: one seeded agent per workspace runs scheduled
      // research. Resolving it here is what keeps agentId off the model's
      // input schema — an agent must never get to pick which agent runs next.
      agentId = await this.researchAgentService.resolveResearchAgentId(
        context.workspaceId,
      );
    } catch (error) {
      return {
        success: false,
        message: 'No research agent is available in this workspace',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }

    const task = await this.agentTaskService.createTask({
      workspaceId: context.workspaceId,
      objectNameSingular,
      recordId,
      agentId,
      reason,
      priority,
      budget,
      // Same (record, reason) from a re-fired trigger reuses the open task
      // rather than queueing the same research twice.
      idempotencyKey: `tool:${objectNameSingular}:${recordId}:${reason}`,
      // ToolExecutionContext carries no actor (five fields, none of them an
      // actor), so the actor is a literal. This is the same shape
      // ProposalEntity.createdByActor already stores.
      createdByActor: {
        source: FieldActorSource.AGENT,
        workspaceMemberId: null,
        name: 'AI agent',
        context: {},
      },
    });

    return {
      success: true,
      message: `Scheduled research on ${objectNameSingular} ${recordId}.`,
      result: { taskId: task.id, status: task.status },
    };
  }
}
```

Note what this tool does **not** do: it never touches a record-CRUD service, and it holds no repository. That is the whole justification for its denylist exemption — assert it stays true (the test above asserts `createTask` is the only collaborator called).

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd packages/twenty-server && npx jest create-agent-task-tool.spec
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Register the tool**

In `action-tool.provider.ts`, add the import, the constructor parameter next to `recordEvidenceTool`, the `['create_agent_task', this.createAgentTaskTool],` entry in the `toolMap`, and an unconditional `descriptors.push(this.buildDescriptor('create_agent_task', this.createAgentTaskTool, includeSchemas, context.locale));` next to the `record_evidence` push.

In `ai-research.module.ts`, add `CreateAgentTaskTool` to both `providers` and `exports`, mirroring `RecordEvidenceTool`.

- [ ] **Step 7: Real-seam check — the tool is reachable and ungated through the live dispatcher**

Add one test to `proposal-gate.service.spec.ts` alongside the two from Task 3 Step 5b — it is already there. Instead, assert the *provider* wiring here, in `action-tool.provider`'s own spec if one exists, or add step 5 of Task 13's integration suite: dispatch `create_agent_task` through the real `ToolExecutorService` and assert an `AgentTask` row exists with `status: PENDING` and no `Proposal` was created. Task 13 step 5b covers this; do not consider Task 5c complete without it.

- [ ] **Step 8: Lint, typecheck, commit**

```bash
npx nx lint:diff-with-main twenty-server
npx nx typecheck twenty-server
git add packages/twenty-server/src/engine/core-modules/tool packages/twenty-server/src/engine/core-modules/tool-provider packages/twenty-server/src/engine/metadata-modules/ai/ai-research
git commit -m "feat(ai-research): add the create_agent_task tool"
```

---

### Task 6: Thread a research run's correlation id through `AgentAsyncExecutorService`

Chat already batches every tool call from one turn into a single `Proposal` via `ToolProviderContext.threadId` (`ProposalGateService.getOrCreatePendingProposal`, Launch 1 — verified by reading `proposal-gate.service.ts`). `AgentAsyncExecutorService.executeAgent()` — the same executor `AgentRunService.run()` uses for non-chat agent execution (workflow AI nodes, `runAgent`) — never sets `threadId` on the `ToolProviderContext`/`ToolContext` it builds internally (verified by reading `agent-async-executor.service.ts` in full: `buildPreloadedRegistryTools` and `buildLazyRegistryTools` construct their context objects with `workspaceId, roleId, rolePermissionConfig/authContext/actorContext/userId/userWorkspaceId` — no `threadId` field). This task adds one optional parameter and threads it through, so a research run's tool calls (`update_person`, `record_evidence`, …) batch into one `Proposal` per run — reusing the exact batching field chat already relies on, not inventing a second one.

**Files:**
- Modify: `packages/twenty-server/src/engine/metadata-modules/ai/ai-agent-execution/services/agent-async-executor.service.ts`
- Modify: `packages/twenty-server/src/engine/metadata-modules/ai/ai-agent-execution/services/__tests__/agent-async-executor.service.spec.ts`

**Interfaces:**
- Produces: `AgentAsyncExecutorService.executeAgent({ ..., threadId?: string, maxSteps?: number })` — every other field of the signature is unchanged and both new fields are optional with behaviour-preserving defaults, so every existing caller (chat, workflow AI nodes, `AgentRunService.run()`) compiles and behaves identically.

`maxSteps` is added here rather than in Task 7 because it is the same signature, the same two `build*RegistryTools` call sites, and the same spec file as `threadId`. Splitting one diff across two tasks is what produced the "budget is stored and nothing reads it" gap in the first place.

- [ ] **Step 1: Write the failing test**

This service already has a test file with a working mock harness (`agent-async-executor.service.spec.ts`, verified by reading it). Add one test to its existing `describe` block, after the two tool-loading-strategy tests:

```ts
  it('threads threadId into the tool-provider context so a research run batches its writes into one proposal', async () => {
    roleTargetRepository.findOne.mockResolvedValueOnce({ roleId: agentRoleId });

    await service.executeAgent({
      agent: buildAgent(),
      userPrompt: 'test',
      baseSystemPrompt: 'base system prompt',
      workspaceId,
      threadId: 'run-1',
    });

    expect(toolRegistry.getToolsByCategories).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'run-1' }),
      expect.anything(),
    );
  });
```

And a second test for the **lazy** strategy, which is the one Task 7's worker actually uses. The preload test above would pass while the worker's real path silently dropped `threadId`, so this test is not redundant — it is the one that matters:

```ts
  it('threads threadId into the lazy tool context, the path the research worker uses', async () => {
    roleTargetRepository.findOne.mockResolvedValueOnce({ roleId: agentRoleId });

    await service.executeAgent({
      agent: buildAgent(),
      userPrompt: 'test',
      baseSystemPrompt: 'base system prompt',
      workspaceId,
      threadId: 'run-1',
      toolLoadingStrategy: 'lazy',
    });

    // buildLazyRegistryTools hands the same ToolContext object to
    // buildToolIndex and to the two meta-tool factories, so asserting on the
    // index call proves the context the meta-tools captured.
    expect(toolRegistry.buildToolIndex).toHaveBeenCalled();
    expect(toolRegistry.getToolsByCategories).not.toHaveBeenCalled();
  });
```

> **Why the lazy path is safe once the context carries `threadId` — settled, previously open.** The chain was read end to end. `buildLazyRegistryTools` builds one `ToolContext` and closes over it in `createExecuteToolTool(this.toolRegistry, toolContext, …)` (`agent-async-executor.service.ts:215-219`). `createExecuteToolTool`'s `execute()` passes that captured context through **unchanged** — `toolRegistry.resolveAndExecute(toolName, args, context, {…})` (`execute-tool.tool.ts:66-69`), no reconstruction, no field picking. `resolveAndExecute` calls `this.buildContextFromToolContext(context)`, which copies `threadId` explicitly into the `ToolProviderContext` alongside `actorContext`, `authContext` and the rest (`tool-registry.service.ts`, `buildContextFromToolContext`). `ToolExecutorService.dispatch` then hands that provider context to `ActionToolProvider.executeStaticTool`, which forwards `threadId: context.threadId` into the five-field `ToolExecutionContext` (`action-tool.provider.ts:210-216`). So the only break in the chain was the missing field on the source object, which Step 6 fixes. `record_evidence` receives the run id through `execute_tool` exactly as it does through the preload path, and evidence from a lazily-loaded tool batches into the right proposal.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/twenty-server && npx jest agent-async-executor.service.spec
```

Expected: FAIL — `Object.objectContaining` assertion fails because `threadId` is `undefined` on the received context (or a TS error if `threadId` is not yet a valid property of the `executeAgent` params type — either failure is the expected one at this step).

- [ ] **Step 3: Extend `executeAgent`'s signature**

In `agent-async-executor.service.ts`, find the `executeAgent` method's destructured parameters and type (currently ending `toolLoadingStrategy = 'preload',` / `toolLoadingStrategy?: AgentToolLoadingStrategy;`). Replace:

```ts
  async executeAgent({
    agent,
    userPrompt,
    baseSystemPrompt,
    actorContext,
    authContext,
    workspaceId,
    userWorkspaceId,
    operationType = UsageOperationType.AI_WORKFLOW_TOKEN,
    toolLoadingStrategy = 'preload',
  }: {
    agent: AgentEntity | null;
    userPrompt: string;
    baseSystemPrompt: string;
    actorContext?: ActorMetadata;
    authContext?: WorkspaceAuthContext;
    workspaceId: string;
    userWorkspaceId?: string | null;
    operationType?: UsageOperationType;
    toolLoadingStrategy?: AgentToolLoadingStrategy;
  }): Promise<AgentExecutionResult> {
```

with:

```ts
  async executeAgent({
    agent,
    userPrompt,
    baseSystemPrompt,
    actorContext,
    authContext,
    workspaceId,
    userWorkspaceId,
    operationType = UsageOperationType.AI_WORKFLOW_TOKEN,
    toolLoadingStrategy = 'preload',
    threadId,
    maxSteps = AGENT_CONFIG.MAX_STEPS,
  }: {
    agent: AgentEntity | null;
    userPrompt: string;
    baseSystemPrompt: string;
    actorContext?: ActorMetadata;
    authContext?: WorkspaceAuthContext;
    workspaceId: string;
    userWorkspaceId?: string | null;
    operationType?: UsageOperationType;
    toolLoadingStrategy?: AgentToolLoadingStrategy;
    // Correlates every tool call in this run into one Proposal, the same
    // field chat uses to batch a turn. Callers with no natural chat thread
    // (AgentTaskRunJob, Task 7) pass the AgentRun id here instead.
    threadId?: string;
    // Per-run step ceiling. Defaults to the value that was hard-coded here
    // before, so no existing caller changes behaviour. AgentTaskRunJob passes
    // AgentTaskEntity.budget — the charter Execution contract's "budgeted".
    maxSteps?: number;
  }): Promise<AgentExecutionResult> {
```

`AGENT_CONFIG` is already imported by this file (`agent-async-executor.service.ts:44`); `AGENT_CONFIG.MAX_STEPS` is `300` (`ai-agent/constants/agent-config.const.ts:2`).

- [ ] **Step 4: Thread it into both call sites**

Still inside `executeAgent`, find:

```ts
          if (toolLoadingStrategy === 'lazy') {
            const lazyToolset = await this.buildLazyRegistryTools({
              agent,
              agentRoleId,
              authContext,
              actorContext,
            });

            registryTools = lazyToolset.tools;
            toolCatalogSection = lazyToolset.catalogSection;
          } else {
            registryTools = await this.buildPreloadedRegistryTools({
              agent,
              agentRoleId,
              authContext,
              actorContext,
            });
          }
```

Replace with:

```ts
          if (toolLoadingStrategy === 'lazy') {
            const lazyToolset = await this.buildLazyRegistryTools({
              agent,
              agentRoleId,
              authContext,
              actorContext,
              threadId,
            });

            registryTools = lazyToolset.tools;
            toolCatalogSection = lazyToolset.catalogSection;
          } else {
            registryTools = await this.buildPreloadedRegistryTools({
              agent,
              agentRoleId,
              authContext,
              actorContext,
              threadId,
            });
          }
```

- [ ] **Step 5: Thread it through `buildPreloadedRegistryTools`**

Find:

```ts
  private async buildPreloadedRegistryTools({
    agent,
    agentRoleId,
    authContext,
    actorContext,
  }: {
    agent: AgentEntity;
    agentRoleId: string;
    authContext?: WorkspaceAuthContext;
    actorContext?: ActorMetadata;
  }): Promise<ToolSet> {
    const { userId, userWorkspaceId } = this.resolveUserIdentity(authContext);

    const toolProviderContext: ToolProviderContext = {
      workspaceId: agent.workspaceId,
      roleId: agentRoleId,
      rolePermissionConfig: { intersectionOf: [agentRoleId] },
      requireExplicitObjectGrants: true,
      authContext,
      actorContext,
      userId,
      userWorkspaceId,
    };
```

Replace with:

```ts
  private async buildPreloadedRegistryTools({
    agent,
    agentRoleId,
    authContext,
    actorContext,
    threadId,
  }: {
    agent: AgentEntity;
    agentRoleId: string;
    authContext?: WorkspaceAuthContext;
    actorContext?: ActorMetadata;
    threadId?: string;
  }): Promise<ToolSet> {
    const { userId, userWorkspaceId } = this.resolveUserIdentity(authContext);

    const toolProviderContext: ToolProviderContext = {
      workspaceId: agent.workspaceId,
      roleId: agentRoleId,
      rolePermissionConfig: { intersectionOf: [agentRoleId] },
      requireExplicitObjectGrants: true,
      authContext,
      actorContext,
      userId,
      userWorkspaceId,
      threadId,
    };
```

- [ ] **Step 6: Thread it through `buildLazyRegistryTools`**

Find:

```ts
  private async buildLazyRegistryTools({
    agent,
    agentRoleId,
    authContext,
    actorContext,
  }: {
    agent: AgentEntity;
    agentRoleId: string;
    authContext?: WorkspaceAuthContext;
    actorContext?: ActorMetadata;
  }): Promise<{ tools: ToolSet; catalogSection: string }> {
    const { userId, userWorkspaceId } = this.resolveUserIdentity(authContext);

    const toolContext: ToolContext = {
      workspaceId: agent.workspaceId,
      roleId: agentRoleId,
      authContext,
      actorContext,
      userId,
      userWorkspaceId,
    };
```

Replace with:

```ts
  private async buildLazyRegistryTools({
    agent,
    agentRoleId,
    authContext,
    actorContext,
    threadId,
  }: {
    agent: AgentEntity;
    agentRoleId: string;
    authContext?: WorkspaceAuthContext;
    actorContext?: ActorMetadata;
    threadId?: string;
  }): Promise<{ tools: ToolSet; catalogSection: string }> {
    const { userId, userWorkspaceId } = this.resolveUserIdentity(authContext);

    const toolContext: ToolContext = {
      workspaceId: agent.workspaceId,
      roleId: agentRoleId,
      authContext,
      actorContext,
      userId,
      userWorkspaceId,
      threadId,
    };
```

- [ ] **Step 6b: Make `maxSteps` actually stop the run**

Still in `agent-async-executor.service.ts`, find the `stopWhen` option inside the first `generateText` call (lines 352-354):

```ts
        stopWhen: (step) =>
          stepCountIs(AGENT_CONFIG.MAX_STEPS)(step) ||
          hasNoMoreAvailableCredits,
```

Replace with:

```ts
        stopWhen: (step) =>
          stepCountIs(maxSteps)(step) || hasNoMoreAvailableCredits,
```

Three lines become two. `stepCountIs` is imported at line 9. Leave the second `generateText` (the structured-output pass, line 452) untouched — it is a single non-tool call with no step loop to cap.

- [ ] **Step 6c: Add the budget test**

Add one more test to `agent-async-executor.service.spec.ts`, after the `threadId` test from Step 1. The file already mocks the `ai` module (lines 23-40), so `generateText` is a jest mock whose call arguments can be inspected directly via the file's existing `generateTextMock` handle (line 42):

```ts
  it('caps the run at the caller-supplied maxSteps rather than the global default', async () => {
    roleTargetRepository.findOne.mockResolvedValueOnce({ roleId: agentRoleId });

    await service.executeAgent({
      agent: buildAgent(),
      userPrompt: 'test',
      baseSystemPrompt: 'base system prompt',
      workspaceId,
      maxSteps: 3,
    });

    const [{ stopWhen }] = generateTextMock.mock.calls[0];

    // stopWhen is a predicate, not a number, so assert its behaviour: it must
    // stop at the caller's cap and not at AGENT_CONFIG.MAX_STEPS.
    expect(await stopWhen({ steps: new Array(3).fill({}) } as never)).toBe(true);
    expect(await stopWhen({ steps: new Array(2).fill({}) } as never)).toBe(false);
  });

  it('falls back to the global step cap when no maxSteps is supplied', async () => {
    roleTargetRepository.findOne.mockResolvedValueOnce({ roleId: agentRoleId });

    await service.executeAgent({
      agent: buildAgent(),
      userPrompt: 'test',
      baseSystemPrompt: 'base system prompt',
      workspaceId,
    });

    const [{ stopWhen }] = generateTextMock.mock.calls[0];

    expect(await stopWhen({ steps: new Array(3).fill({}) } as never)).toBe(false);
    expect(
      await stopWhen({
        steps: new Array(AGENT_CONFIG.MAX_STEPS).fill({}),
      } as never),
    ).toBe(true);
  });
```

Add `import { AGENT_CONFIG } from 'src/engine/metadata-modules/ai/ai-agent/constants/agent-config.const';` to the spec's imports.

**Real seam:** `stepCountIs` is the *real* AI SDK function here — the spec's `jest.mock('ai', …)` uses `...jest.requireActual('ai')` (line 24) and only replaces `generateText`, so the predicate under test is the SDK's own. Asserting the predicate's behaviour rather than `expect(stopWhen).toBeDefined()` is what makes this test capable of failing.

- [ ] **Step 7: Run the test to verify it passes**

```bash
cd packages/twenty-server && npx jest agent-async-executor.service.spec
```

Expected: PASS, all tests in the file including the new one (the pre-existing suite has more tests than shown above — every one of them must still pass unchanged, since `threadId` is optional and every existing call site omits it).

- [ ] **Step 8: Full regression check on the executor and its direct callers**

```bash
cd packages/twenty-server && npx jest ai-agent-execution
cd packages/twenty-server && npx jest ai-chat
```

Expected: PASS. This is a hot path for every AI feature in the product — a red suite here means the threading is wrong, not that the suite is stale.

- [ ] **Step 9: Lint, typecheck, commit**

```bash
npx nx lint:diff-with-main twenty-server
npx nx typecheck twenty-server
git add packages/twenty-server/src/engine/metadata-modules/ai/ai-agent-execution
git commit -m "feat(ai-agent-execution): thread threadId through executeAgent for non-chat runs"
```

---

### Task 7: AgentTask dispatch cron and worker job

> **Budget enforcement — the executor half is Task 6 Step 6b, the worker half is here.** `AgentTaskEntity.budget` (default 8) would otherwise be stored by Tasks 4 and 5 and read by nothing, leaving the charter's Execution contract ("leased, retryable, cancellable, idempotent, **and budgeted**") unsatisfied: a runaway research agent would be capped only by the workspace-wide AI credit ceiling, which is a business-ending limit, not a task limit. Task 6 added `maxSteps` and wired it into the live `stopWhen`. This worker passes `maxSteps: task.budget` and, in Step 11 below, distinguishes an exhausted budget from "found nothing" in the recorded outcome — otherwise a truncated run reads in run history exactly like a thorough one that came up empty.
>
> This narrows the cut-table row "per-task hard spend cap" to *dollars only*. A per-task **credit** cap stays cut with its row: credits are already enforced workspace-wide by `AiBillingService`, and a per-task dollar cap needs a mid-run billing check `AgentAsyncExecutorService` does not expose.

The actual execution engine. A cron tick claims due tasks and enqueues one worker job per task (mirrors `MessagingMessageListFetchCronJob` → `MessagingMessagesImportJob`, verified by reading both files). The worker re-validates the task inside `GlobalWorkspaceOrmManager.executeInWorkspaceContext`, runs the agent via `AgentAsyncExecutorService.executeAgent()` with `threadId: agentRun.id`, records an `AgentRun`, and completes or fails the task.

**Files:**
- Create: `packages/twenty-server/src/engine/metadata-modules/ai/ai-research/constants/research-agent-prompts.const.ts`
- Create: `packages/twenty-server/src/engine/metadata-modules/ai/ai-research/crons/jobs/agent-task-dispatch.cron.job.ts`
- Create: `packages/twenty-server/src/engine/metadata-modules/ai/ai-research/crons/commands/agent-task-dispatch.cron.command.ts`
- Create: `packages/twenty-server/src/engine/metadata-modules/ai/ai-research/jobs/agent-task-run.job.ts`
- Test: `packages/twenty-server/src/engine/metadata-modules/ai/ai-research/jobs/__tests__/agent-task-run.job.spec.ts`
- Modify: `packages/twenty-server/src/engine/core-modules/message-queue/message-queue.constants.ts`
- Modify: `packages/twenty-server/src/database/commands/cron-register-all.command.ts`
- Modify: `packages/twenty-server/src/engine/metadata-modules/ai/ai-research/ai-research.module.ts`

**Interfaces:**
- Consumes: `AgentTaskService` (Task 5), `AgentAsyncExecutorService.executeAgent` with `threadId`/`maxSteps` (Task 6), `AgentRunEntity` (Task 4), `buildSystemAuthContext` (existing, `src/engine/twenty-orm/utils/build-system-auth-context.util`), `GlobalWorkspaceOrmManager` (existing, `src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager`).
- Produces: a running `AgentTaskDispatchCronJob` + `AgentTaskRunJob` pair.

**Cut from this task:** `summarizeAgentSteps` + `AgentRunEntity.transcript` + their spec. Twenty already persists a full agent transcript through `AgentMessageEntity`, and no task in Phases 2-5 reads `AgentRun.transcript`. `resultSummary` alone carries what run history needs. This removes a util, a spec, a jsonb column, and a coupling to the AI SDK's `StepResult` content-part shape.

- [ ] **Step 1: Write the prompt constants**

Create `constants/research-agent-prompts.const.ts`:

```ts
export const RESEARCH_AGENT_BASE_SYSTEM_PROMPT = `You are running as a scheduled background research task, not a chat conversation. Nobody is watching you work in real time.

For every field you intend to change, first call record_evidence with the source and what you observed. Only after recording evidence should you call the appropriate update tool to propose the change — the update itself is never applied directly, it is queued for human review.

If you find nothing verifiable, say so and stop. Do not guess a value to fill a gap.`;

export const buildResearchAgentUserPrompt = (params: {
  objectNameSingular: string;
  recordId: string;
  reason: string;
}): string =>
  `Research the ${params.objectNameSingular} record ${params.recordId}. Reason this task was scheduled: ${params.reason}`;
```

- [ ] **Step 6: Add the queue**

In `message-queue.constants.ts`, the `MessageQueue` enum currently ends (lines 21-23):

```ts
  aiQueue = 'ai-queue',
  aiStreamQueue = 'ai-stream-queue',
}
```

Replace with:

```ts
  aiQueue = 'ai-queue',
  aiStreamQueue = 'ai-stream-queue',
  agentTaskQueue = 'agent-task-queue',
}
```

- [ ] **Step 7: Write the dispatch cron job**

Create `crons/jobs/agent-task-dispatch.cron.job.ts`:

```ts
import { Logger } from '@nestjs/common';

import { SentryCronMonitor } from 'src/engine/core-modules/cron/sentry-cron-monitor.decorator';
import { ExceptionHandlerService } from 'src/engine/core-modules/exception-handler/exception-handler.service';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { AgentTaskService } from 'src/engine/metadata-modules/ai/ai-research/services/agent-task.service';
import {
  AgentTaskRunJob,
  type AgentTaskRunJobData,
} from 'src/engine/metadata-modules/ai/ai-research/jobs/agent-task-run.job';

export const AGENT_TASK_DISPATCH_CRON_PATTERN = '* * * * *';

@Processor(MessageQueue.cronQueue)
export class AgentTaskDispatchCronJob {
  private readonly logger = new Logger(AgentTaskDispatchCronJob.name);

  constructor(
    private readonly agentTaskService: AgentTaskService,
    @InjectMessageQueue(MessageQueue.agentTaskQueue)
    private readonly messageQueueService: MessageQueueService,
    private readonly exceptionHandlerService: ExceptionHandlerService,
  ) {}

  @Process(AgentTaskDispatchCronJob.name)
  @SentryCronMonitor(
    AgentTaskDispatchCronJob.name,
    AGENT_TASK_DISPATCH_CRON_PATTERN,
  )
  async handle(): Promise<void> {
    try {
      // Reap first: a row that exhausted maxAttempts while leased is not
      // claimable, so leaving it for the next tick only delays the FAILED
      // transition an operator needs to see. Same tick, same transaction
      // boundary as the workflow staled-runs sweeper.
      await this.agentTaskService.reapAbandonedTasks();

      const claimedTasks = await this.agentTaskService.claimDueTasks();

      for (const task of claimedTasks) {
        await this.messageQueueService.add<AgentTaskRunJobData>(
          AgentTaskRunJob.name,
          { taskId: task.id, workspaceId: task.workspaceId },
        );
      }
    } catch (error) {
      this.exceptionHandlerService.captureExceptions([error]);
    }
  }
}
```

Note: `claimDueTasks()` runs across every workspace's tasks in one query (unlike the messaging cron, which loops per-workspace) because `AgentTaskEntity` is a core-schema table with `workspaceId` as an ordinary column, not a per-workspace-schema table — there is nothing to loop over.

Note on `@Processor`: it takes **two different argument shapes**, and both appear in this task. A cron job uses the bare-queue form `@Processor(MessageQueue.cronQueue)` (above); the worker in Step 11 uses the options form `@Processor({ queueName, scope })` because it needs `Scope.REQUEST`. Confirm both overloads against `message-queue/decorators/processor.decorator.ts` before writing either — they are not interchangeable.

- [ ] **Step 8: Write the cron command**

Create `crons/commands/agent-task-dispatch.cron.command.ts`:

```ts
import { Command, CommandRunner } from 'nest-commander';

import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import {
  AGENT_TASK_DISPATCH_CRON_PATTERN,
  AgentTaskDispatchCronJob,
} from 'src/engine/metadata-modules/ai/ai-research/crons/jobs/agent-task-dispatch.cron.job';

@Command({
  name: 'cron:ai-research:agent-task-dispatch',
  description: 'Starts a cron job to claim and dispatch due AgentTask rows',
})
export class AgentTaskDispatchCronCommand extends CommandRunner {
  constructor(
    @InjectMessageQueue(MessageQueue.cronQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {
    super();
  }

  async run(): Promise<void> {
    await this.messageQueueService.addCron<undefined>({
      jobName: AgentTaskDispatchCronJob.name,
      data: undefined,
      options: {
        repeat: { pattern: AGENT_TASK_DISPATCH_CRON_PATTERN },
      },
    });
  }
}
```

- [ ] **Step 9: Write the failing worker test**

Create `jobs/__tests__/agent-task-run.job.spec.ts`:

```ts
import { AgentTaskRunJob } from 'src/engine/metadata-modules/ai/ai-research/jobs/agent-task-run.job';
import { AgentRunStatus } from 'src/engine/metadata-modules/ai/ai-research/types/agent-run-status.type';

describe('AgentTaskRunJob', () => {
  const agentTaskRepository = { findOne: jest.fn() };
  const agentRunRepository = { save: jest.fn() };
  const agentRepository = { findOne: jest.fn() };
  const agentTaskService = { completeTask: jest.fn(), failTask: jest.fn() };
  const agentAsyncExecutorService = { executeAgent: jest.fn() };
  const globalWorkspaceOrmManager = {
    executeInWorkspaceContext: jest.fn((fn: () => Promise<void>) => fn()),
  };

  const buildJob = () =>
    new AgentTaskRunJob(
      agentTaskService as never,
      agentAsyncExecutorService as never,
      globalWorkspaceOrmManager as never,
      agentTaskRepository as never,
      agentRunRepository as never,
      agentRepository as never,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    agentRunRepository.save.mockImplementation(async (entity) => ({
      id: 'run-1',
      ...entity,
    }));
  });

  it('should do nothing when the task is no longer LEASED (cancelled between claim and pickup)', async () => {
    agentTaskRepository.findOne.mockResolvedValue({
      id: 'task-1',
      status: 'CANCELLED',
    });

    const job = buildJob();

    await job.handle({ taskId: 'task-1', workspaceId: 'workspace-1' });

    expect(agentAsyncExecutorService.executeAgent).not.toHaveBeenCalled();
  });

  it('should run the agent with threadId set to the new run id and complete the task on success', async () => {
    agentTaskRepository.findOne.mockResolvedValue({
      id: 'task-1',
      workspaceId: 'workspace-1',
      status: 'LEASED',
      agentId: 'agent-1',
      objectNameSingular: 'company',
      recordId: 'record-1',
      reason: 'New lead created',
      budget: 8,
    });
    agentRepository.findOne.mockResolvedValue({ id: 'agent-1', label: 'Researcher' });
    agentAsyncExecutorService.executeAgent.mockResolvedValue({
      result: { response: 'Found nothing new.' },
      usage: { inputTokens: 100, outputTokens: 50 },
      steps: [],
      modelId: 'openai/gpt-4.1',
      creditsUsedMicro: 42,
    });

    const job = buildJob();

    await job.handle({ taskId: 'task-1', workspaceId: 'workspace-1' });

    expect(agentAsyncExecutorService.executeAgent).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'run-1' }),
    );
    expect(agentRunRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: AgentRunStatus.SUCCEEDED }),
    );
    expect(agentTaskService.completeTask).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1', runId: 'run-1' }),
    );
    expect(agentTaskService.failTask).not.toHaveBeenCalled();
  });

  it('should cap the agent at the task budget', async () => {
    agentTaskRepository.findOne.mockResolvedValue({
      id: 'task-1',
      workspaceId: 'workspace-1',
      status: 'LEASED',
      agentId: 'agent-1',
      objectNameSingular: 'company',
      recordId: 'record-1',
      reason: 'New lead created',
      budget: 3,
    });
    agentRepository.findOne.mockResolvedValue({ id: 'agent-1', label: 'Researcher' });
    agentAsyncExecutorService.executeAgent.mockResolvedValue({
      result: { response: 'Partial.' },
      usage: { inputTokens: 1, outputTokens: 1 },
      steps: [{}, {}],
      modelId: 'openai/gpt-4.1',
      creditsUsedMicro: 1,
    });

    const job = buildJob();

    await job.handle({ taskId: 'task-1', workspaceId: 'workspace-1' });

    expect(agentAsyncExecutorService.executeAgent).toHaveBeenCalledWith(
      expect.objectContaining({ maxSteps: 3 }),
    );
  });

  // An exhausted budget must not read like a thorough run that found nothing.
  it('should name the budget in the outcome when the step cap was reached', async () => {
    agentTaskRepository.findOne.mockResolvedValue({
      id: 'task-1',
      workspaceId: 'workspace-1',
      status: 'LEASED',
      agentId: 'agent-1',
      objectNameSingular: 'company',
      recordId: 'record-1',
      reason: 'New lead created',
      budget: 3,
    });
    agentRepository.findOne.mockResolvedValue({ id: 'agent-1', label: 'Researcher' });
    agentAsyncExecutorService.executeAgent.mockResolvedValue({
      result: { response: 'Partial findings.' },
      usage: { inputTokens: 1, outputTokens: 1 },
      steps: [{}, {}, {}],
      modelId: 'openai/gpt-4.1',
      creditsUsedMicro: 1,
    });

    const job = buildJob();

    await job.handle({ taskId: 'task-1', workspaceId: 'workspace-1' });

    // Still SUCCEEDED: the run did real work, it just ran out of room.
    expect(agentTaskService.completeTask).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: expect.stringContaining('step budget of 3'),
      }),
    );
  });

  // I1: AgentExecutionResult declares steps/modelId/creditsUsedMicro optional.
  // creditsUsedMicro lands in a NOT NULL bigint column and modelId in a
  // nullable varchar, so both need explicit coalescing, not a pass-through.
  it('should tolerate an execution result that omits its optional fields', async () => {
    agentTaskRepository.findOne.mockResolvedValue({
      id: 'task-1',
      workspaceId: 'workspace-1',
      status: 'LEASED',
      agentId: 'agent-1',
      objectNameSingular: 'company',
      recordId: 'record-1',
      reason: 'New lead created',
      budget: 8,
    });
    agentRepository.findOne.mockResolvedValue({ id: 'agent-1', label: 'Researcher' });
    agentAsyncExecutorService.executeAgent.mockResolvedValue({
      result: { response: 'Done.' },
      usage: {},
    });

    const job = buildJob();

    await job.handle({ taskId: 'task-1', workspaceId: 'workspace-1' });

    expect(agentRunRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: AgentRunStatus.SUCCEEDED,
        modelId: null,
        creditsUsedMicro: 0,
        inputTokens: 0,
        outputTokens: 0,
      }),
    );
  });

  it('should record the run as FAILED and call failTask when the agent throws', async () => {
    agentTaskRepository.findOne.mockResolvedValue({
      id: 'task-1',
      workspaceId: 'workspace-1',
      status: 'LEASED',
      agentId: 'agent-1',
      objectNameSingular: 'company',
      recordId: 'record-1',
      reason: 'New lead created',
    });
    agentRepository.findOne.mockResolvedValue({ id: 'agent-1', label: 'Researcher' });
    agentAsyncExecutorService.executeAgent.mockRejectedValue(new Error('model unavailable'));

    const job = buildJob();

    await job.handle({ taskId: 'task-1', workspaceId: 'workspace-1' });

    expect(agentRunRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: AgentRunStatus.FAILED, errorMessage: 'model unavailable' }),
    );
    expect(agentTaskService.failTask).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1', errorMessage: 'model unavailable' }),
    );
    expect(agentTaskService.completeTask).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 10: Run the test to verify it fails**

```bash
cd packages/twenty-server && npx jest agent-task-run.job.spec
```

Expected: FAIL — module not found.

- [ ] **Step 11: Write the worker job**

Create `jobs/agent-task-run.job.ts`:

```ts
import { Scope } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { FieldActorSource, type ActorMetadata } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { Repository } from 'typeorm';

import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { AgentEntity } from 'src/engine/metadata-modules/ai/ai-agent/entities/agent.entity';
import { AgentAsyncExecutorService } from 'src/engine/metadata-modules/ai/ai-agent-execution/services/agent-async-executor.service';
import { AgentRunEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/agent-run.entity';
import { AgentTaskEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/agent-task.entity';
import {
  buildResearchAgentUserPrompt,
  RESEARCH_AGENT_BASE_SYSTEM_PROMPT,
} from 'src/engine/metadata-modules/ai/ai-research/constants/research-agent-prompts.const';
import { AgentTaskService } from 'src/engine/metadata-modules/ai/ai-research/services/agent-task.service';
import { AgentRunStatus } from 'src/engine/metadata-modules/ai/ai-research/types/agent-run-status.type';
import { AgentTaskStatus } from 'src/engine/metadata-modules/ai/ai-research/types/agent-task-status.type';
import { UsageOperationType } from 'src/engine/core-modules/usage/enums/usage-operation-type.enum';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';

export type AgentTaskRunJobData = {
  taskId: string;
  workspaceId: string;
};

@Processor({ queueName: MessageQueue.agentTaskQueue, scope: Scope.REQUEST })
export class AgentTaskRunJob {
  constructor(
    private readonly agentTaskService: AgentTaskService,
    private readonly agentAsyncExecutorService: AgentAsyncExecutorService,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    @InjectRepository(AgentTaskEntity)
    private readonly agentTaskRepository: Repository<AgentTaskEntity>,
    @InjectRepository(AgentRunEntity)
    private readonly agentRunRepository: Repository<AgentRunEntity>,
    // AgentEntity is @Entity('agent') on the CORE schema (verified:
    // ai-agent/entities/agent.entity.ts:18), not a per-workspace-schema
    // entity, so a plain core repository is correct here. An earlier draft
    // typed this `unknown` and told the implementer to swap in
    // InjectWorkspaceScopedRepository — that was an unresolved architectural
    // question sitting in the phase's only execution engine, and it was
    // resolved by reading the entity: there is nothing workspace-scoped to
    // resolve. The workspaceId filter below is an ordinary column predicate.
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(AgentEntity)
    private readonly agentRepository: Repository<AgentEntity>,
  ) {}

  @Process(AgentTaskRunJob.name)
  async handle(data: AgentTaskRunJobData): Promise<void> {
    const { taskId, workspaceId } = data;

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      // Re-fetch and re-validate: the task may have been cancelled between
      // the claim and this job running — the explicit status check is the
      // cancellation mechanism, no downstream 404s to interpret.
      const task = await this.agentTaskRepository.findOne({
        where: { id: taskId, workspaceId },
      });

      if (!isDefined(task) || task.status !== AgentTaskStatus.LEASED) {
        return;
      }

      const agent = await this.agentRepository.findOne({
        where: { id: task.agentId, workspaceId },
      });

      const run = await this.agentRunRepository.save({
        workspaceId,
        taskId: task.id,
        agentId: task.agentId,
        status: AgentRunStatus.RUNNING,
      });

      const actorContext: ActorMetadata = {
        source: FieldActorSource.AGENT,
        workspaceMemberId: null,
        name: agent?.label ?? 'Research agent',
        context: {},
      };

      try {
        const result = await this.agentAsyncExecutorService.executeAgent({
          agent: agent ?? null,
          userPrompt: buildResearchAgentUserPrompt({
            objectNameSingular: task.objectNameSingular,
            recordId: task.recordId,
            reason: task.reason,
          }),
          baseSystemPrompt: RESEARCH_AGENT_BASE_SYSTEM_PROMPT,
          actorContext,
          authContext: buildSystemAuthContext(workspaceId),
          workspaceId,
          userWorkspaceId: null,
          operationType: UsageOperationType.AI_WORKFLOW_TOKEN,
          toolLoadingStrategy: 'lazy',
          threadId: run.id,
          // The charter's "budgeted". Task 6 Step 6b made this reach stopWhen.
          maxSteps: task.budget,
        });

        const resultText =
          typeof (result.result as { response?: string })?.response === 'string'
            ? (result.result as { response: string }).response
            : '';

        // AgentExecutionResult declares steps, modelId and creditsUsedMicro
        // OPTIONAL (agent-execution-result.type.ts:9-12). creditsUsedMicro
        // lands in a NOT NULL bigint column and modelId in a nullable varchar,
        // so every one of them is coalesced rather than passed through.
        const stepCount = result.steps?.length ?? 0;
        const exhaustedBudget = stepCount >= task.budget;

        await this.agentRunRepository.save({
          ...run,
          status: AgentRunStatus.SUCCEEDED,
          modelId: result.modelId ?? null,
          finishedAt: new Date(),
          elapsedMs: Date.now() - run.startedAt.getTime(),
          inputTokens: result.usage.inputTokens ?? 0,
          outputTokens: result.usage.outputTokens ?? 0,
          creditsUsedMicro: result.creditsUsedMicro ?? 0,
          resultSummary: resultText.slice(0, 2000),
        });

        // A truncated run and a thorough run that found nothing look identical
        // in run history unless the outcome says which one happened.
        const budgetNote = exhaustedBudget
          ? ` (stopped at the step budget of ${task.budget} — findings may be incomplete)`
          : '';

        await this.agentTaskService.completeTask({
          taskId: task.id,
          workspaceId,
          runId: run.id,
          outcome: `${resultText.slice(0, 400) || 'Research run completed.'}${budgetNote}`,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Agent execution failed';

        await this.agentRunRepository.save({
          ...run,
          status: AgentRunStatus.FAILED,
          finishedAt: new Date(),
          elapsedMs: Date.now() - run.startedAt.getTime(),
          errorMessage,
        });

        await this.agentTaskService.failTask({
          taskId: task.id,
          workspaceId,
          runId: run.id,
          errorMessage,
        });
      }
    });
  }
}
```

- [ ] **Step 12: Run the test to verify it passes**

```bash
cd packages/twenty-server && npx jest agent-task-run.job.spec
```

Expected: PASS, 6 tests.

- [ ] **Step 13: Register the job, command, and cron in the module and aggregator**

In `ai-research.module.ts`, add to `imports`: `MessageQueueModule` (or the equivalent module providing `@InjectMessageQueue` — confirm by grepping `MessagingMessageListFetchCronJob`'s owning module for how it obtains queue injection) and `AiAgentExecutionModule` (exports `AgentAsyncExecutorService` — confirm export in `ai-agent-execution.module.ts`). Add `AgentEntity` to the `TypeOrmModule.forFeature([...])` list if Task 5b did not already. Add to `providers`: `AgentTaskDispatchCronJob`, `AgentTaskDispatchCronCommand`, `AgentTaskRunJob`.

In `database/commands/cron-register-all.command.ts` (260 lines, read in full), three edits. Add the import after the `EventLogCleanupCronCommand` import (line 11):

```ts
import { AgentTaskDispatchCronCommand } from 'src/engine/metadata-modules/ai/ai-research/crons/commands/agent-task-dispatch.cron.command';
```

Add a constructor parameter. The constructor's last two parameters are (lines 77-78):

```ts
    private readonly userSessionCleanupCronCommand: UserSessionCleanupCronCommand,
    private readonly twentyConfigService: TwentyConfigService,
```

Replace with:

```ts
    private readonly userSessionCleanupCronCommand: UserSessionCleanupCronCommand,
    private readonly agentTaskDispatchCronCommand: AgentTaskDispatchCronCommand,
    private readonly twentyConfigService: TwentyConfigService,
```

`twentyConfigService` stays last, matching the file's existing convention of keeping the non-command dependency at the end.

Then add an entry to the `allCommands` array. Its final element is (lines 212-215):

```ts
      {
        name: 'UserSessionCleanup',
        command: this.userSessionCleanupCronCommand,
      },
    ];
```

Replace with:

```ts
      {
        name: 'UserSessionCleanup',
        command: this.userSessionCleanupCronCommand,
      },
      {
        name: 'AgentTaskDispatch',
        command: this.agentTaskDispatchCronCommand,
      },
    ];
```

The loop at lines 224-242 picks it up with no further change — `isEnabled` defaults to `true` via destructuring, so no config flag is needed.

- [ ] **Step 14: Lint, typecheck, commit**

```bash
npx nx lint:diff-with-main twenty-server
npx nx typecheck twenty-server
git add packages/twenty-server/src/engine/metadata-modules/ai/ai-research packages/twenty-server/src/engine/core-modules/message-queue packages/twenty-server/src/database
git commit -m "feat(ai-research): add agent task dispatch cron and worker"
```

---

### Task 8: Attach facts to a `ProposalItem` at proposal time

> **Program integration — `proposal-gate.service.ts` is edited by three phases. Merge order is fixed:** Phase 2 Task 8 (this task, adds `factIds`) → Phase 3 Task 1 (adds the separate `createFromExtraction` method, no overlap with `evaluate()`) → Phase 4 Task 2 (`FORBID` gains a `failure`, a different branch) → Phase 4 Task 5 (`CONFIRMATION_REQUIRED`, a different branch) → Phase 4 Task 6 (rewrites the propose block; **it is written to preserve the `factIds` lookup this task adds and the `gateInput.baselineFieldNames` argument Launch 1 uses** — see that task's Program-integration note). If Phase 4 lands first for any reason, apply this task's Step 10 on top of Phase 4 Task 6's block rather than reverting it.

Closes the gap the Launch 1 anchors report flagged explicitly (§8): "Missing explicit evidence-links field (charter wants 'related evidence' on the item)." `ProposalGateService.evaluate()` (Launch 1, unchanged control flow) already knows the object/record/fields a write touches when it builds `gateInput` — this task adds one lookup before saving the item. No new write path: this only *reads* `Fact` rows and *attaches their ids* to the `ProposalItem` the gate was already about to create.

**Files:**
- Create: `packages/twenty-server/src/engine/metadata-modules/ai/ai-research/services/fact.service.ts`
- Test: `packages/twenty-server/src/engine/metadata-modules/ai/ai-research/services/__tests__/fact.service.spec.ts`
- Modify: `packages/twenty-server/src/engine/metadata-modules/ai/ai-write-approval/entities/proposal-item.entity.ts`
- Modify: `packages/twenty-server/src/engine/metadata-modules/ai/ai-write-approval/services/proposal-gate.service.ts`
- Modify: `packages/twenty-server/src/engine/metadata-modules/ai/ai-write-approval/services/__tests__/proposal-gate.service.spec.ts`
- Modify: `packages/twenty-server/src/engine/metadata-modules/ai/ai-write-approval/ai-write-approval.module.ts`
- Modify: `packages/twenty-server/src/engine/metadata-modules/ai/ai-research/ai-research.module.ts`
- Create: an instance command (generated)

**Interfaces:**
- Consumes: `FactEntity`, `FactStatus` (Task 1), `EvidenceEntity` (Task 1).
- Produces: `FactService.findCurrentFactIdsForFields(params): Promise<string[]>`, `FactService.markDismissed(ids: string[]): Promise<void>` (used by Task 9), `FactService.findProposalItemFacts(ids: string[]): Promise<ProposalItemFact[]>` (used by Task 11's resolver); `ProposalItemEntity.factIds: string[]`.

**This is the `FactService` boundary Owner Decision 1 requires.** It is the only class outside `AiResearchModule` that any other module may reach `Fact` through, and it holds the only exported `Repository<FactEntity>` injection. It deliberately does **not** expose `findByIds(): FactEntity[]` — returning entities would let a caller reach `FactEntity` fields directly and re-establish the coupling the decision closes. `findProposalItemFacts` returns a flat projection type owned by this file.

- [ ] **Step 1: Write the failing test**

Create `services/__tests__/fact.service.spec.ts`:

```ts
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { EvidenceEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/evidence.entity';
import { FactEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/fact.entity';
import { FactService } from 'src/engine/metadata-modules/ai/ai-research/services/fact.service';
import { FactStatus } from 'src/engine/metadata-modules/ai/ai-research/types/fact-status.type';

describe('FactService', () => {
  let service: FactService;

  const factRepository = { find: jest.fn(), update: jest.fn() };
  const evidenceRepository = { find: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FactService,
        { provide: getRepositoryToken(FactEntity), useValue: factRepository },
        {
          provide: getRepositoryToken(EvidenceEntity),
          useValue: evidenceRepository,
        },
      ],
    }).compile();

    service = module.get<FactService>(FactService);
  });

  it('should return an empty array without querying when no field names are given', async () => {
    const ids = await service.findCurrentFactIdsForFields({
      workspaceId: 'workspace-1',
      objectNameSingular: 'person',
      recordId: 'record-1',
      fieldNames: [],
    });

    expect(ids).toEqual([]);
    expect(factRepository.find).not.toHaveBeenCalled();
  });

  it('should return the ids of CURRENT facts matching the given fields', async () => {
    factRepository.find.mockResolvedValue([
      { id: 'fact-1' },
      { id: 'fact-2' },
    ]);

    const ids = await service.findCurrentFactIdsForFields({
      workspaceId: 'workspace-1',
      objectNameSingular: 'person',
      recordId: 'record-1',
      fieldNames: ['jobTitle', 'city'],
    });

    expect(factRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: 'workspace-1',
          objectNameSingular: 'person',
          recordId: 'record-1',
          status: FactStatus.CURRENT,
        }),
      }),
    );
    expect(ids).toEqual(['fact-1', 'fact-2']);
  });

  describe('findProposalItemFacts', () => {
    it('should return an empty array without querying for no ids', async () => {
      const facts = await service.findProposalItemFacts([]);

      expect(facts).toEqual([]);
      expect(factRepository.find).not.toHaveBeenCalled();
      expect(evidenceRepository.find).not.toHaveBeenCalled();
    });

    it('should flatten each fact with its first evidence row into one citation', async () => {
      factRepository.find.mockResolvedValue([
        {
          id: 'fact-1',
          fieldName: 'jobTitle',
          strength: 'WEAK',
          hasConflict: false,
          evidenceIds: ['evidence-1', 'evidence-2'],
        },
      ]);
      evidenceRepository.find.mockResolvedValue([
        {
          id: 'evidence-1',
          sourceType: 'WEB_SEARCH',
          sourceLocator: 'https://example.com/about',
          observedAt: new Date('2026-08-01T00:00:00.000Z'),
        },
      ]);

      const facts = await service.findProposalItemFacts(['fact-1']);

      // Only the primary evidence id is fetched — not evidence-2.
      expect(evidenceRepository.find).toHaveBeenCalledWith({
        where: { id: expect.objectContaining({ _value: ['evidence-1'] }) },
      });
      expect(facts).toEqual([
        {
          id: 'fact-1',
          fieldName: 'jobTitle',
          strength: 'WEAK',
          hasConflict: false,
          sourceType: 'WEB_SEARCH',
          sourceLocator: 'https://example.com/about',
          observedAt: new Date('2026-08-01T00:00:00.000Z'),
        },
      ]);
    });

    it('should return null source fields for a fact whose evidence row is missing', async () => {
      factRepository.find.mockResolvedValue([
        {
          id: 'fact-1',
          fieldName: 'jobTitle',
          strength: 'STRONG',
          hasConflict: true,
          evidenceIds: [],
        },
      ]);

      const facts = await service.findProposalItemFacts(['fact-1']);

      expect(evidenceRepository.find).not.toHaveBeenCalled();
      expect(facts[0]).toMatchObject({
        sourceType: null,
        sourceLocator: null,
        observedAt: null,
        hasConflict: true,
      });
    });
  });

  describe('markDismissed', () => {
    it('should not issue an update for an empty id list', async () => {
      await service.markDismissed([]);

      expect(factRepository.update).not.toHaveBeenCalled();
    });

    it('should set every named fact to DISMISSED', async () => {
      await service.markDismissed(['fact-1', 'fact-2']);

      expect(factRepository.update).toHaveBeenCalledWith(
        { id: expect.objectContaining({ _value: ['fact-1', 'fact-2'] }) },
        { status: FactStatus.DISMISSED },
      );
    });
  });
});
```

The `expect.objectContaining({ _value: [...] })` shape matches TypeORM's `In()` operator, which stores its argument on `_value` — this is the same technique Launch 1's `proposal-execution.service.spec.ts` uses in its `itemStatusWrite` helper (lines 201-210).

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/twenty-server && npx jest fact.service.spec
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the service**

Create `services/fact.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isDefined } from 'twenty-shared/utils';
import { In, Repository } from 'typeorm';

import { EvidenceEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/evidence.entity';
import { FactEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/fact.entity';
import { FactStatus } from 'src/engine/metadata-modules/ai/ai-research/types/fact-status.type';

// The flat citation projection the approval UI renders. Deliberately not
// FactEntity and not EvidenceEntity: this is the whole contract other modules
// get, so promoting Fact to a standard object later changes this file only.
export type ProposalItemFact = {
  id: string;
  fieldName: string;
  strength: string;
  hasConflict: boolean;
  // Nulls when a fact somehow has no evidence row — a corrupt state the UI
  // must render as "no citation" rather than crash on.
  sourceType: string | null;
  sourceLocator: string | null;
  observedAt: Date | null;
};

@Injectable()
export class FactService {
  constructor(
    @InjectRepository(FactEntity)
    private readonly factRepository: Repository<FactEntity>,
    @InjectRepository(EvidenceEntity)
    private readonly evidenceRepository: Repository<EvidenceEntity>,
  ) {}

  async findCurrentFactIdsForFields(params: {
    workspaceId: string;
    objectNameSingular: string;
    recordId: string;
    fieldNames: string[];
  }): Promise<string[]> {
    if (params.fieldNames.length === 0) {
      return [];
    }

    const facts = await this.factRepository.find({
      where: {
        workspaceId: params.workspaceId,
        objectNameSingular: params.objectNameSingular,
        recordId: params.recordId,
        fieldName: In(params.fieldNames),
        status: FactStatus.CURRENT,
      },
    });

    return facts.map((fact) => fact.id);
  }

  // The single citation surface for the approval UI (Task 11). Two queries
  // total for a whole proposal item, not one per fact and one per evidence
  // row: the earlier design had a FactDTO.evidence resolve field behind a
  // ProposalItemDTO.facts resolve field, which is an N+1 pair rendering one
  // line of text.
  async findProposalItemFacts(ids: string[]): Promise<ProposalItemFact[]> {
    if (ids.length === 0) {
      return [];
    }

    const facts = await this.factRepository.find({ where: { id: In(ids) } });

    // Only the first evidence row per fact is cited, so only those are
    // fetched. evidenceIds[0] is the observation that created the fact;
    // later entries are corroborations of the same value.
    const primaryEvidenceIds = facts
      .map((fact) => fact.evidenceIds[0])
      .filter((evidenceId): evidenceId is string => isDefined(evidenceId));

    const evidence =
      primaryEvidenceIds.length === 0
        ? []
        : await this.evidenceRepository.find({
            where: { id: In(primaryEvidenceIds) },
          });

    const evidenceById = new Map(evidence.map((row) => [row.id, row]));

    return facts.map((fact) => {
      const primary = evidenceById.get(fact.evidenceIds[0]);

      return {
        id: fact.id,
        fieldName: fact.fieldName,
        strength: fact.strength,
        hasConflict: fact.hasConflict,
        sourceType: primary?.sourceType ?? null,
        sourceLocator: primary?.sourceLocator ?? null,
        observedAt: primary?.observedAt ?? null,
      };
    });
  }

  // Used by Task 9 to permanently dismiss the facts behind a rejected item.
  async markDismissed(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await this.factRepository.update({ id: In(ids) }, { status: FactStatus.DISMISSED });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd packages/twenty-server && npx jest fact.service.spec
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Export the service**

In `ai-research.module.ts`, add `FactService` to both `providers` and `exports`, and add its import.

- [ ] **Step 6: Add `factIds` to the entity**

In `proposal-item.entity.ts`, add after `resultRecordId`:

```ts
  // Fact rows current for the touched fields when this item was created.
  // Empty for writes with no research pipeline behind them (chat, manual
  // tool calls) — that is the correct, honest state: no evidence backs those.
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  factIds: string[];
```

- [ ] **Step 7: Generate the instance command**

```bash
npx nx run twenty-server:database:migrate:generate --name add-fact-ids-to-proposal-item --type fast
```

Fill `up`:

```sql
ALTER TABLE "core"."proposalItem" ADD COLUMN "factIds" jsonb NOT NULL DEFAULT '[]'::jsonb;
```

Fill `down`:

```sql
ALTER TABLE "core"."proposalItem" DROP COLUMN "factIds";
```

Apply:

```bash
npx nx run twenty-server:database:migrate:prod
psql "$PG_DATABASE_URL" -c '\d core."proposalItem"'
```

Expected: `factIds` column present.

- [ ] **Step 8: Add the failing gate integration test**

In `proposal-gate.service.spec.ts` (Launch 1's existing file, 385 lines), four edits.

Add the import alongside the others (after line 11):

```ts
import { FactService } from 'src/engine/metadata-modules/ai/ai-research/services/fact.service';
```

Declare the mock next to the existing ones (the block at lines 56-59, ending `const proposalItemRepository = { save: jest.fn() };`):

```ts
  const factService = { findCurrentFactIdsForFields: jest.fn() };
```

Default it in `beforeEach`, next to the other defaults (after the `findRecordsService.execute.mockResolvedValue({...})` block that ends at line 82):

```ts
    factService.findCurrentFactIdsForFields.mockResolvedValue([]);
```

Register it in the testing module's `providers` array, after the `ProposalItemEntity` repository entry (lines 94-97):

```ts
        { provide: FactService, useValue: factService },
```

Note the policy service in this spec is the **real** `AiWritePolicyService`, driven through `setPolicy(...)` (lines 61-63) rather than a `resolveMode` mock — an earlier draft of this step wrote `policyService.resolveMode.mockReturnValue('PROPOSE')`, which no longer exists and would throw. The `beforeEach` already sets `{ default: 'PROPOSE', overrides: {} }` at line 68, so no policy setup is needed in the new test.

Add one new test inside the existing `describe('proposal capture', ...)` block (opens at line 184), immediately after `it('should capture a staleness baseline for a delete', ...)` (lines 229-247). Use the file's own `evaluate()` and `crudDescriptor()` helpers:

```ts
    it('should attach current fact ids for the touched fields to the proposal item', async () => {
      factService.findCurrentFactIdsForFields.mockResolvedValue(['fact-1']);

      await evaluate(crudDescriptor('update_one'), {
        id: 'record-1',
        jobTitle: 'New title',
      });

      expect(factService.findCurrentFactIdsForFields).toHaveBeenCalledWith({
        workspaceId: 'workspace-1',
        objectNameSingular: 'person',
        recordId: 'record-1',
        fieldNames: ['jobTitle'],
      });
      expect(savedItem()).toMatchObject({ factIds: ['fact-1'] });
    });

    // A chat-originated write has no research behind it. Empty is the honest
    // answer, and it must be an empty array, not undefined — the column is
    // NOT NULL.
    it('should attach an empty fact list when nothing was researched', async () => {
      await evaluate(crudDescriptor('update_one'), {
        id: 'record-1',
        jobTitle: 'New title',
      });

      expect(savedItem()).toMatchObject({ factIds: [] });
    });
```

The anchor is `'should capture a staleness baseline for a delete'`, not `'should capture the current field values as the baseline'` — the latter name does not exist in the live file.

- [ ] **Step 9: Run the test to verify it fails**

```bash
cd packages/twenty-server && npx jest proposal-gate.service.spec
```

Expected: FAIL — `FactService` is not provided / `factIds` is `undefined` in the save call.

- [ ] **Step 10: Wire the lookup into the gate**

In `proposal-gate.service.ts`, add the import after the `AiWritePolicyService` import (line 14):

```ts
import { FactService } from 'src/engine/metadata-modules/ai/ai-research/services/fact.service';
```

Add to the constructor, after `findRecordsService` (line 115) and **before** the two `@InjectRepository` parameters — Nest resolves by decorator, not position, but the file's convention is plain services first:

```ts
    private readonly factService: FactService,
```

In `evaluate()` (lines 127-193), between the `readBaseline` call (lines 159-164) and `getOrCreatePendingProposal` (line 166), add:

```ts
    const factIds = await this.factService.findCurrentFactIdsForFields({
      workspaceId: context.workspaceId,
      objectNameSingular: gateInput.objectNameSingular ?? '',
      recordId: gateInput.recordId ?? '',
      fieldNames: Object.keys(gateInput.payload),
    });
```

Add `factIds,` to the object passed to `this.proposalItemRepository.save({...})` (lines 168-178), after `baseline,` and before `status:`.

Note: for `SEND_EMAIL`/`CREATE_CALENDAR_EVENT` and every static-tool item, `gateInput.objectNameSingular`/`recordId` are `null` (`proposal-gate.service.ts:229-230`), so `findCurrentFactIdsForFields` is called with empty strings for those two params and non-empty `fieldNames` from the payload — since no `Fact` row will ever have `objectNameSingular: ''`, this always resolves to `[]`, which is correct: outbound sends have no fact-backed justification in this phase. The `fieldNames.length === 0` short-circuit in `FactService` additionally means bulk operations (`payload: { records }`, `payload: { filter, data }`) issue one wasted key lookup at most, never a scan.

- [ ] **Step 11: Run the test to verify it passes**

```bash
cd packages/twenty-server && npx jest proposal-gate.service.spec
```

Expected: PASS — all pre-existing tests (including the two Task 3 Step 5b added) plus the 2 new ones. Do not "fix" any pre-existing test: this change adds a field to a save call, it changes no decision.

- [ ] **Step 12: Wire the module import**

In `ai-write-approval.module.ts`, add the import:

```ts
import { AiResearchModule } from 'src/engine/metadata-modules/ai/ai-research/ai-research.module';
```

Add `AiResearchModule` to `imports`.

- [ ] **Step 13: Lint, typecheck, commit**

```bash
npx nx lint:diff-with-main twenty-server
npx nx typecheck twenty-server
git add packages/twenty-server/src/engine/metadata-modules/ai/ai-research packages/twenty-server/src/engine/metadata-modules/ai/ai-write-approval packages/twenty-server/src/database
git commit -m "feat(ai-research): attach current facts to proposal items at creation"
```

---

### Task 9: Permanently dismiss a fact when its proposal item is rejected

The "don't nag" rule from Task 2 needs a trigger: something has to mark a `Fact` `DISMISSED`. That happens exactly where Launch 1 already marks a `ProposalItem` `REJECTED`. This task adds one call at each of those two existing marking points; it does not add a new rejection path.

**Read the file before editing it.** `proposal-execution.service.ts` was rewritten by the Launch 1 fix wave and both marking points moved. The two find-blocks below are quoted from the current file with line numbers, and they are *not* what an earlier draft of this task quoted:

- The unselected-items marking is **not** in `approve()` — `approve()` (lines 108-166) claims the proposal and delegates. It is in the private `applyClaimedProposal()` at lines 267-276, and it is a single bulk `update({ id: In(...) })`, not a per-item `save()` loop.
- `reject()` (lines 320-351) **never loads the items at all** — it is one bulk `update({ proposalId, status: In([PENDING, CONFLICTED]) })`. There is no `items` variable in scope, so an `items.flatMap(...)` patch cannot compile. Note it also rejects `CONFLICTED` items, which an earlier draft's version silently dropped.

**Files:**
- Modify: `packages/twenty-server/src/engine/metadata-modules/ai/ai-write-approval/services/proposal-execution.service.ts`
- Modify: `packages/twenty-server/src/engine/metadata-modules/ai/ai-write-approval/services/__tests__/proposal-execution.service.spec.ts`

**Interfaces:**
- Consumes: `FactService.markDismissed` (Task 8).

- [ ] **Step 1: Add the failing test**

In `proposal-execution.service.spec.ts` (612 lines), five edits.

Add the import after the `ProposalExecutionService` import (line 19):

```ts
import { FactService } from 'src/engine/metadata-modules/ai/ai-research/services/fact.service';
```

Extend the `buildItem` helper (lines 24-36) with a `factIds` default, so the 20 pre-existing tests that do not care about facts keep passing unchanged. Replace:

```ts
  payload: { jobTitle: 'New title' },
  baseline: { jobTitle: 'Old title' },
  status: 'PENDING',
  ...overrides,
});
```

with:

```ts
  payload: { jobTitle: 'New title' },
  baseline: { jobTitle: 'Old title' },
  status: 'PENDING',
  factIds: [],
  ...overrides,
});
```

Declare the mock next to the others (after `const moduleRef = { get: jest.fn() };`, line 71):

```ts
  const factService = { markDismissed: jest.fn() };
```

Register it in the testing module's `providers`, after the `ProposalItemEntity` repository entry (lines 180-183):

```ts
        { provide: FactService, useValue: factService },
```

Add three new tests immediately after `it('should reject items the reviewer did not select', ...)` (lines 393-402), before the `describe('final status reflects the real outcome', ...)` block at line 405. They use the file's existing `approve()` helper (lines 190-196):

```ts
  it('should dismiss the facts behind an item the reviewer deselected', async () => {
    proposalItemRepository.find.mockResolvedValue([
      buildItem({ factIds: ['fact-1'] }),
      buildItem({ id: 'item-2', factIds: ['fact-2'] }),
    ]);

    await approve(['item-1']);

    // Only the deselected item's facts. Approving item-1 is a "yes" to its
    // facts, not a "no".
    expect(factService.markDismissed).toHaveBeenCalledWith(['fact-2']);
  });

  it('should not dismiss anything when every item was selected', async () => {
    proposalItemRepository.find.mockResolvedValue([
      buildItem({ factIds: ['fact-1'] }),
    ]);

    await approve(['item-1']);

    expect(factService.markDismissed).toHaveBeenCalledWith([]);
  });

  it('should dismiss the facts behind every still-open item in a whole-proposal reject', async () => {
    proposalItemRepository.find.mockResolvedValue([
      buildItem({ factIds: ['fact-1'] }),
      // reject() clears CONFLICTED items too — their facts are dismissed with
      // the rest, which an earlier draft of this task silently dropped.
      buildItem({ id: 'item-2', status: 'CONFLICTED', factIds: ['fact-2'] }),
    ]);

    await service.reject({
      proposalId: 'proposal-1',
      workspaceId: 'workspace-1',
      approverUserWorkspaceId: 'user-workspace-1',
    });

    expect(factService.markDismissed).toHaveBeenCalledWith([
      'fact-1',
      'fact-2',
    ]);
  });
```

The third test also needs `proposalItemRepository.find` to be reachable from `reject()`, which today never calls it — that is the change Step 3 makes. Add a matching assertion inside the existing `it('should bail when the proposal is no longer pending', ...)` (lines 599-610) so the early-return path stays covered:

```ts
      expect(factService.markDismissed).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/twenty-server && npx jest proposal-execution.service.spec
```

Expected: FAIL — `FactService` not provided / `markDismissed` never called.

- [ ] **Step 3: Wire dismissal into the service**

In `proposal-execution.service.ts`, add the import:

```ts
import { FactService } from 'src/engine/metadata-modules/ai/ai-research/services/fact.service';
```

Add to the constructor, after `userRoleService` (line 82):

```ts
    private readonly factService: FactService,
```

**Edit 1 — `applyClaimedProposal()`, lines 267-276.** It currently reads:

```ts
      const unselectedItemIds = items
        .filter((item) => !selectedItemIds.includes(item.id))
        .map((item) => item.id);

      if (unselectedItemIds.length > 0) {
        await this.proposalItemRepository.update(
          { id: In(unselectedItemIds) },
          { status: ProposalItemStatus.REJECTED },
        );
      }
```

Replace with:

```ts
      const unselectedItems = items.filter(
        (item) => !selectedItemIds.includes(item.id),
      );

      if (unselectedItems.length > 0) {
        await this.proposalItemRepository.update(
          { id: In(unselectedItems.map((item) => item.id)) },
          { status: ProposalItemStatus.REJECTED },
        );
      }

      // A reviewer deselecting an item is an explicit "no" to that exact
      // value — the facts that justified it must not be re-proposed. The
      // entities are kept (rather than mapping straight to ids) because
      // factIds lives on them and re-querying would be a second round trip.
      await this.factService.markDismissed(
        unselectedItems.flatMap((item) => item.factIds),
      );
```

The bulk `update` is preserved — this keeps one statement for N items and does not reintroduce a per-item `save()` loop. `markDismissed([])` is a no-op by its own guard, so it is called unconditionally rather than inside the `if`.

**Edit 2 — `reject()`, lines 340-348.** It currently reads:

```ts
    // CONFLICTED items are rejectable too: an aborted batch left them in a
    // terminal-looking state that reject() previously could never clear.
    await this.proposalItemRepository.update(
      {
        proposalId,
        status: In([ProposalItemStatus.PENDING, ProposalItemStatus.CONFLICTED]),
      },
      { status: ProposalItemStatus.REJECTED },
    );
```

Replace with:

```ts
    // CONFLICTED items are rejectable too: an aborted batch left them in a
    // terminal-looking state that reject() previously could never clear.
    const openStatuses = [
      ProposalItemStatus.PENDING,
      ProposalItemStatus.CONFLICTED,
    ];

    // Load before updating: after the update nothing is PENDING or
    // CONFLICTED any more, and factIds only exists on the rows themselves.
    // This is a read reject() did not previously do.
    const rejectedItems = await this.proposalItemRepository.find({
      where: { proposalId, status: In(openStatuses) },
    });

    await this.proposalItemRepository.update(
      { proposalId, status: In(openStatuses) },
      { status: ProposalItemStatus.REJECTED },
    );

    await this.factService.markDismissed(
      rejectedItems.flatMap((item) => item.factIds),
    );
```

This adds one `SELECT` to `reject()`. It sits after the proposal-level `rejection.affected === 0` bail (lines 336-338), so a losing concurrent reject still does no work.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd packages/twenty-server && npx jest proposal-execution.service.spec
```

Expected: PASS — all pre-existing tests plus the 3 new ones. `'should reject items the reviewer did not select'` (line 393) and `'should reject pending and conflicted items'` (line 585) are the two that would break if the bulk `update` shape were changed; both must stay green untouched.

- [ ] **Step 5: Regression check the whole approval suite**

```bash
cd packages/twenty-server && npx jest ai-write-approval
```

Expected: PASS — `ai-write-policy.service.spec`, `proposal-gate.service.spec`, `proposal-execution.service.spec` all green.

**Real seam:** every test in this task doubles `FactService`, so none of them proves a `Fact` row's `status` column actually becomes `DISMISSED`, nor that Task 2's derivation then declines to re-propose it. That loop — reject → DISMISSED → re-observe → no new CURRENT fact — is Task 13 step 12, against a real database. This task is not covered until that step exists.

- [ ] **Step 6: Lint, typecheck, commit**

```bash
npx nx lint:diff-with-main twenty-server
npx nx typecheck twenty-server
git add packages/twenty-server/src/engine/metadata-modules/ai/ai-write-approval
git commit -m "feat(ai-research): dismiss facts behind rejected proposal items"
```

---

### Task 10: GraphQL API for AgentTask

Lets a human, an admin script, or an external OAuth-scoped agent schedule and cancel research tasks over GraphQL.

> **Program integration (resolved).** The earlier version of this task claimed a workflow would reach `createAgentTask` through its generic HTTP-request action with a workspace API key. That path was never traced end to end and is struck. The supported workflow path is **Task 5c's `create_agent_task` static tool**, called from inside an `AI_AGENT` workflow step — the same step type every Phase 4 workflow template uses. This GraphQL mutation remains the path for humans, admin scripts, and external agents. Both call the same `AgentTaskService.createTask`; there is one scheduling path, two front doors.

A purpose-built "AI research" node in the workflow-builder UI is deferred (see the deliberately-cut table) — a new `WorkflowActionType` touches roughly 108 files across `twenty-shared`/`twenty-front`/`twenty-server` in this codebase (verified: `grep -rl "WorkflowActionType" twenty-shared/src twenty-front/src twenty-server/src --include=*.ts | wc -l` → 108), comparable in cost to a standard object, and nobody has asked for the no-code version yet.

**Files:**
- Create: `packages/twenty-server/src/engine/metadata-modules/ai/ai-research/dtos/agent-task.dto.ts`
- Create: `packages/twenty-server/src/engine/metadata-modules/ai/ai-research/dtos/create-agent-task.input.ts`
- Create: `packages/twenty-server/src/engine/metadata-modules/ai/ai-research/resolvers/agent-task.resolver.ts`
- Modify: `packages/twenty-server/src/engine/metadata-modules/ai/ai-research/ai-research.module.ts`

**Interfaces:**
- Consumes: `AgentTaskService` (Task 5).
- Produces GraphQL operations: `agentTasks(objectNameSingular: String, recordId: ID): [AgentTask!]!`, `createAgentTask(input: CreateAgentTaskInput!): AgentTask!`, `cancelAgentTask(taskId: ID!, reason: String!): Boolean!`.

- [ ] **Step 1: Write the DTOs**

Create `dtos/agent-task.dto.ts`:

```ts
import { Field, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';

import { AgentTaskStatus } from 'src/engine/metadata-modules/ai/ai-research/types/agent-task-status.type';

registerEnumType(AgentTaskStatus, { name: 'AgentTaskStatus' });

@ObjectType('AgentTask')
export class AgentTaskDTO {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  objectNameSingular: string;

  @Field(() => ID)
  recordId: string;

  @Field(() => ID)
  agentId: string;

  @Field(() => String)
  reason: string;

  @Field(() => Int)
  priority: number;

  @Field(() => AgentTaskStatus)
  status: AgentTaskStatus;

  @Field(() => Date)
  dueAt: Date;

  @Field(() => Int)
  attempts: number;

  @Field(() => Int)
  maxAttempts: number;

  @Field(() => String, { nullable: true })
  outcome: string | null;

  @Field(() => Date)
  createdAt: Date;
}
```

Create `dtos/create-agent-task.input.ts`:

```ts
import { Field, ID, InputType, Int } from '@nestjs/graphql';

import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

@InputType()
export class CreateAgentTaskInput {
  @Field(() => String)
  @IsString()
  objectNameSingular: string;

  @Field(() => ID)
  @IsUUID()
  recordId: string;

  @Field(() => ID)
  @IsUUID()
  agentId: string;

  @Field(() => String)
  @IsString()
  reason: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
```

- [ ] **Step 2: Write the resolver**

Create `resolvers/agent-task.resolver.ts`. Guard pattern copied from Launch 1's `ProposalResolver` (verified: `WorkspaceAuthGuard` + `SettingsPermissionGuard(PermissionFlagType.AI)`):

```ts
import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query } from '@nestjs/graphql';
import { InjectRepository } from '@nestjs/typeorm';

import { FieldActorSource } from 'twenty-shared/types';
import { PermissionFlagType } from 'twenty-shared/constants';
import { Repository } from 'typeorm';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { type FlatWorkspace } from 'src/engine/core-modules/workspace/types/flat-workspace.type';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { SettingsPermissionGuard } from 'src/engine/guards/settings-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { AgentTaskDTO } from 'src/engine/metadata-modules/ai/ai-research/dtos/agent-task.dto';
import { CreateAgentTaskInput } from 'src/engine/metadata-modules/ai/ai-research/dtos/create-agent-task.input';
import { AgentTaskEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/agent-task.entity';
import { AgentTaskService } from 'src/engine/metadata-modules/ai/ai-research/services/agent-task.service';

@UseGuards(WorkspaceAuthGuard, SettingsPermissionGuard(PermissionFlagType.AI))
@MetadataResolver()
export class AgentTaskResolver {
  constructor(
    private readonly agentTaskService: AgentTaskService,
    @InjectRepository(AgentTaskEntity)
    private readonly agentTaskRepository: Repository<AgentTaskEntity>,
  ) {}

  @Query(() => [AgentTaskDTO])
  async agentTasks(
    @AuthWorkspace() workspace: FlatWorkspace,
    @Args('objectNameSingular', { type: () => String, nullable: true })
    objectNameSingular?: string,
    @Args('recordId', { type: () => ID, nullable: true }) recordId?: string,
  ): Promise<AgentTaskDTO[]> {
    const tasks = await this.agentTaskRepository.find({
      where: {
        workspaceId: workspace.id,
        ...(objectNameSingular ? { objectNameSingular } : {}),
        ...(recordId ? { recordId } : {}),
      },
      order: { createdAt: 'DESC' },
    });

    return tasks as unknown as AgentTaskDTO[];
  }

  @Mutation(() => AgentTaskDTO)
  async createAgentTask(
    @Args('input') input: CreateAgentTaskInput,
    @AuthWorkspace() workspace: FlatWorkspace,
  ): Promise<AgentTaskDTO> {
    const task = await this.agentTaskService.createTask({
      workspaceId: workspace.id,
      objectNameSingular: input.objectNameSingular,
      recordId: input.recordId,
      agentId: input.agentId,
      reason: input.reason,
      priority: input.priority,
      idempotencyKey: input.idempotencyKey ?? null,
      createdByActor: {
        source: FieldActorSource.API,
        workspaceMemberId: null,
        name: 'GraphQL API',
        context: {},
      },
    });

    return task as unknown as AgentTaskDTO;
  }

  @Mutation(() => Boolean)
  async cancelAgentTask(
    @Args('taskId', { type: () => ID }) taskId: string,
    @Args('reason', { type: () => String }) reason: string,
    @AuthWorkspace() workspace: FlatWorkspace,
  ): Promise<boolean> {
    return this.agentTaskService.cancelTask({
      taskId,
      workspaceId: workspace.id,
      reason,
    });
  }
}
```

The `agentId` field on `CreateAgentTaskInput` stays required here, unlike the `create_agent_task` tool (Task 5c) which resolves the seeded research agent. A human or admin script calling this mutation is choosing an agent deliberately; a model must not be allowed to.

- [ ] **Step 3: Register the resolver**

In `ai-research.module.ts`, add `AgentTaskResolver` to `providers`.

- [ ] **Step 4: Verify the schema builds**

```bash
npx nx typecheck twenty-server
npx nx start twenty-server
```

Expected: server boots with no GraphQL schema errors. Confirm `agentTasks`, `createAgentTask`, `cancelAgentTask` appear in the metadata GraphQL playground.

- [ ] **Step 5: Regenerate front types, lint, commit**

```bash
npx nx run twenty-front:graphql:generate --configuration=metadata
npx nx lint:diff-with-main twenty-server
git add packages/twenty-server/src/engine/metadata-modules/ai/ai-research packages/twenty-front/src/generated-metadata
git commit -m "feat(ai-research): expose agent task graphql api"
```

---

### Task 11: Surface a proposal item's citations in GraphQL

This is the task that makes "the agent proposed this because of X, dated Y, from source Z" queryable from the approval UI. `ProposalItemDTO.factIds` (Task 8) gains a sibling resolved `facts` field.

**Collapsed from the previous design.** That design was `EvidenceLookupService` + `FactFieldsResolver` + `ProposalItemFieldsResolver` + `FactDTO` + `EvidenceDTO` + two specs — an N+1 resolver pair and five new classes — so the component in Task 12 could render one line of text from `fact.evidence[0]`. It is now one DTO, one resolver, and `FactService.findProposalItemFacts` (Task 8), which does the join itself in two queries.

That collapse also deletes the `EvidenceSourceTypeGraphQL` mirror enum, and with it a runtime error. The mirror declared four members — `CRM_RECORD | CRM_ACTIVITY | WEB_SEARCH | MANUAL` — against `EvidenceSourceType`'s seven, and Phase 3 Task 4 writes `EMAIL_MESSAGE` and `CALL_RECORDING`. The first ingestion-derived proposal a reviewer opened would have thrown *"Expected a value of type EvidenceSourceType but received: EMAIL_MESSAGE"* on the exact query Task 12 installs. The projection below types `sourceType` and `strength` as `String`, the way Launch 1's own `ProposalItemDTO` already types `toolId` and `error`, so no mirror can drift out of sync with the union again.

The DataLoader cut-table row is deleted along with the N+1 pair it described.

**Files:**
- Modify: `packages/twenty-server/src/engine/metadata-modules/ai/ai-write-approval/dtos/proposal.dto.ts`
- Create: `packages/twenty-server/src/engine/metadata-modules/ai/ai-write-approval/resolvers/proposal-item-fields.resolver.ts`
- Test: `packages/twenty-server/src/engine/metadata-modules/ai/ai-write-approval/resolvers/__tests__/proposal-item-fields.resolver.spec.ts`
- Modify: `packages/twenty-server/src/engine/metadata-modules/ai/ai-write-approval/ai-write-approval.module.ts`

**Interfaces:**
- Consumes: `FactService.findProposalItemFacts` (Task 8).
- Produces: GraphQL fields `ProposalItem.factIds: [ID!]!` and `ProposalItem.facts: [ProposalItemFact!]!`, where `ProposalItemFact` is `{ id, fieldName, strength, hasConflict, sourceType, sourceLocator, observedAt }`.

- [ ] **Step 1: Add the DTO and the two fields**

In `ai-write-approval/dtos/proposal.dto.ts`, add the projection type immediately above `@ObjectType('ProposalItem')` (line 14):

```ts
// A fact and its primary evidence, flattened. sourceType and strength are
// String, not GraphQL enums: EvidenceSourceType is a seven-member string
// union owned by Phase 2 Task 1, and Phase 3 adds writers for three of them,
// so a mirror enum here is a runtime error waiting for its first ingestion
// proposal. This mirrors what the DTO already does for toolId and error.
@ObjectType('ProposalItemFact')
export class ProposalItemFactDTO {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  fieldName: string;

  @Field(() => String)
  strength: string;

  @Field(() => Boolean)
  hasConflict: boolean;

  @Field(() => String, { nullable: true })
  sourceType: string | null;

  @Field(() => String, { nullable: true })
  sourceLocator: string | null;

  @Field(() => Date, { nullable: true })
  observedAt: Date | null;
}
```

Then extend `ProposalItemDTO`. It currently ends (lines 40-42):

```ts
  @Field(() => String, { nullable: true })
  error: string | null;
}
```

Replace with:

```ts
  @Field(() => String, { nullable: true })
  error: string | null;

  @Field(() => [ID])
  factIds: string[];

  // Populated by ProposalItemFieldsResolver. Declared on the type rather
  // than only on the resolver so a missing citation reads as an empty list,
  // never as an unknown-field query error in the approval inbox.
  @Field(() => [ProposalItemFactDTO])
  facts: ProposalItemFactDTO[];
}
```

No `registerEnumType` call is added by this task, and `FactStatus` is not exposed over GraphQL at all — nothing in the approval UI renders it, and any fact that reached a proposal item is CURRENT by construction (Task 8 filters on exactly that).

- [ ] **Step 2: Write the failing resolver test**

Create `resolvers/__tests__/proposal-item-fields.resolver.spec.ts`:

```ts
import { ProposalItemFieldsResolver } from 'src/engine/metadata-modules/ai/ai-write-approval/resolvers/proposal-item-fields.resolver';

describe('ProposalItemFieldsResolver', () => {
  const factService = { findProposalItemFacts: jest.fn() };

  const buildResolver = () =>
    new ProposalItemFieldsResolver(factService as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return the flat citation projection for the item factIds', async () => {
    const projection = [
      {
        id: 'fact-1',
        fieldName: 'jobTitle',
        strength: 'WEAK',
        hasConflict: false,
        sourceType: 'WEB_SEARCH',
        sourceLocator: 'https://example.com/about',
        observedAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    ];

    factService.findProposalItemFacts.mockResolvedValue(projection);

    const facts = await buildResolver().facts({ factIds: ['fact-1'] } as never);

    expect(factService.findProposalItemFacts).toHaveBeenCalledWith(['fact-1']);
    expect(facts).toEqual(projection);
  });

  // A chat-originated item, and every outbound send.
  it('should return an empty list without querying when the item has no facts', async () => {
    const facts = await buildResolver().facts({ factIds: [] } as never);

    expect(facts).toEqual([]);
    expect(factService.findProposalItemFacts).not.toHaveBeenCalled();
  });

  // The column is jsonb NOT NULL DEFAULT '[]', but a proposal item created
  // before Task 8's migration ran still arrives here with factIds undefined.
  it('should tolerate an item whose factIds are undefined', async () => {
    const facts = await buildResolver().facts({} as never);

    expect(facts).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd packages/twenty-server && npx jest proposal-item-fields.resolver.spec
```

Expected: FAIL — module not found.

- [ ] **Step 4: Write the resolver**

Create `ai-write-approval/resolvers/proposal-item-fields.resolver.ts`:

```ts
import { Parent, ResolveField, Resolver } from '@nestjs/graphql';

import { isDefined } from 'twenty-shared/utils';

import { FactService } from 'src/engine/metadata-modules/ai/ai-research/services/fact.service';
import {
  ProposalItemDTO,
  ProposalItemFactDTO,
} from 'src/engine/metadata-modules/ai/ai-write-approval/dtos/proposal.dto';

@Resolver(() => ProposalItemDTO)
export class ProposalItemFieldsResolver {
  // FactService is the only Fact surface this module may touch (Owner
  // Decision 1). No Repository<FactEntity> and no FactEntity import appear
  // anywhere in ai-write-approval.
  constructor(private readonly factService: FactService) {}

  @ResolveField(() => [ProposalItemFactDTO])
  async facts(@Parent() item: ProposalItemDTO): Promise<ProposalItemFactDTO[]> {
    // Most items have no facts — every chat-originated write, every outbound
    // send. Short-circuiting here is what keeps opening the inbox cheap.
    if (!isDefined(item.factIds) || item.factIds.length === 0) {
      return [];
    }

    return this.factService.findProposalItemFacts(item.factIds);
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd packages/twenty-server && npx jest proposal-item-fields.resolver.spec
```

Expected: PASS, 3 tests.

- [ ] **Step 6: Register the resolver**

In `ai-write-approval.module.ts`, add `ProposalItemFieldsResolver` to `providers` (the array at lines 35-41), after `AiWritePolicyResolver`. `AiResearchModule` is already in `imports` from Task 8 Step 12 and exports `FactService`, so no other wiring is needed. The resolver is **not** added to `exports`.

- [ ] **Step 7: Verify the schema builds and the field resolves — real seam**

```bash
npx nx typecheck twenty-server
npx nx start twenty-server
```

`ProposalResolver` is a `@MetadataResolver()`, so `pendingProposals` is served from **`/metadata`**, not `/graphql` (verified: Launch 1's integration spec routes it through its `metadataRequest` helper and comments on exactly this). In the metadata playground run:

```graphql
query {
  pendingProposals {
    items {
      id
      toolId
      factIds
      facts { id fieldName strength hasConflict sourceType sourceLocator observedAt }
    }
  }
}
```

Expected: resolves with no error. Against a workspace with no research-derived proposals every `facts` is `[]` — that is this step's pass condition; Task 13 produces a non-empty one. An unknown-field error means the resolver is registered on the wrong module; a value error means the projection is leaking an entity instead of the flat type.

- [ ] **Step 8: Regenerate front types, lint, commit**

```bash
npx nx run twenty-front:graphql:generate --configuration=metadata
npx nx lint:diff-with-main twenty-server
npx nx typecheck twenty-server
git add packages/twenty-server/src/engine/metadata-modules/ai packages/twenty-front/src/generated-metadata
git commit -m "feat(ai-research): surface proposal item citations in graphql"
```

---


### Task 12: Show the "why" in the approval UI

Extends Launch 1's existing `ProposalDiffTable` with a citation under the field name of a fact-backed diff row: strength, source type, source locator, and a conflict badge. This is the task that makes the charter's Phase 2 requirement literally true on screen — a reviewer sees why a change was proposed, dated, and sourced, without leaving the approval inbox.

**Read the component before editing it.** It was rewritten by the Launch 1 fix wave and none of the earlier draft of this task matched it. What is actually on disk (177 lines, verified):

- It uses `styled` from **`@linaria/react`** with **`themeCssVariables`** from `twenty-ui/theme-constants` (lines 2-3), e.g. `${themeCssVariables.font.color.tertiary}`. The `${({ theme }) => theme.font.color.light}` prop-interpolation idiom appears nowhere in the file and Linaria's static extraction does not support it — a styled block written that way fails at build time, not at review time.
- The render is **two-tier**, not flat. Each item emits one item-level `<tr>` carrying the single checkbox (`aria-label={describeItem(item)}`) and a `colSpan={3}` description cell (lines 125-150), followed by per-field `<StyledFieldRow>` rows that begin with an empty `<StyledCell />` spacer (lines 151-162). Field rows are produced **only** when `FIELD_DIFF_ACTION_TYPES.includes(item.actionType)` — that is `['CREATE_RECORD', 'UPDATE_RECORD']` (line 92).
- The local `ProposalItem` type (lines 7-17) already carries `toolId?: string | null`, which `describeItem()` reads at line 68 (`item.objectNameSingular ?? item.toolId ?? 'unknown target'`). **Extend the type; do not replace it.** An earlier draft's replacement omitted `toolId` and broke `describeItem`.
- `PENDING_PROPOSALS` (`graphql/queries/pendingProposals.ts`) already selects `toolId` inside `items { … }` (line 15). Any "replace this selection" block that omits it either fails to match or silently drops the field.
- The spec (`components/__tests__/ProposalDiffTable.test.tsx`) has **six** tests driven by a two-item fixture with multi-field payloads. **Add to the fixture; do not replace it.** An earlier draft supplied a complete replacement array that destroyed four of the six.

**Files:**
- Modify: `packages/twenty-front/src/modules/settings/ai-approvals/graphql/queries/pendingProposals.ts`
- Modify: `packages/twenty-front/src/modules/settings/ai-approvals/components/ProposalDiffTable.tsx`
- Modify: `packages/twenty-front/src/modules/settings/ai-approvals/components/__tests__/ProposalDiffTable.test.tsx`

**Interfaces:**
- Consumes: `ProposalItemDTO.facts[]` (Task 11) — the flat projection, so there is no nested `evidence` selection to write.

- [ ] **Step 1: Extend the query**

In `pendingProposals.ts`, the `items { … }` selection currently reads (lines 10-20):

```graphql
      items {
        id
        actionType
        objectNameSingular
        recordId
        toolId
        payload
        baseline
        status
        error
      }
```

Replace with:

```graphql
      items {
        id
        actionType
        objectNameSingular
        recordId
        toolId
        payload
        baseline
        status
        error
        facts {
          id
          fieldName
          strength
          hasConflict
          sourceType
          sourceLocator
          observedAt
        }
      }
```

`toolId` stays. `factIds` is deliberately **not** selected — the component renders `facts`, and selecting both would ship the ids to the browser for nothing.

- [ ] **Step 2: Extend the test fixture and add the failing tests**

In `ProposalDiffTable.test.tsx`, add `facts` to **both** existing fixture items, leaving every other field alone. Item 1 (lines 7-17) becomes:

```tsx
  {
    id: 'item-1',
    actionType: 'UPDATE_RECORD',
    objectNameSingular: 'person',
    recordId: 'record-1',
    toolId: null,
    payload: { jobTitle: 'Head of Sales', city: 'Berlin' },
    baseline: { jobTitle: 'Sales Rep', city: 'Munich' },
    status: 'PENDING',
    error: null,
    // jobTitle is fact-backed; city deliberately is not, so one item covers
    // both the citation and the no-citation case on adjacent rows.
    facts: [
      {
        id: 'fact-1',
        fieldName: 'jobTitle',
        strength: 'WEAK',
        hasConflict: false,
        sourceType: 'WEB_SEARCH',
        sourceLocator: 'https://example.com/about',
        observedAt: '2026-08-01T00:00:00.000Z',
      },
    ],
  },
```

Item 2 (lines 18-28, the `DELETE_RECORD`) gets `facts: [],` added before its closing brace. Nothing else in the fixture changes, and the `{ ...items[1], … }` and `{ ...items[0], … }` spreads at lines 96-102 and 119 keep working unchanged.

Add three tests to the existing `describe` block:

```tsx
  it('should show the strength and source for a fact-backed field', () => {
    render(
      <ProposalDiffTable
        items={items}
        onApprove={jest.fn()}
        onReject={jest.fn()}
      />,
    );

    const citation = screen.getByText(/WEAK/);

    expect(citation).toHaveTextContent('WEB_SEARCH');
    expect(citation).toHaveTextContent('https://example.com/about');
    // The citation belongs to the jobTitle row, not the city row.
    expect(citation.closest('tr')).toHaveTextContent('jobTitle');
  });

  // I7: the earlier version of this test asserted `.not.toHaveTextContent('WEAK')`
  // on the Berlin row, which passed against the unmodified component because
  // nothing rendered 'WEAK' anywhere — a test that could never go red. Assert
  // instead that exactly one citation exists and it is not on the city row.
  it('should show no citation on a field with no backing fact', () => {
    render(
      <ProposalDiffTable
        items={items}
        onApprove={jest.fn()}
        onReject={jest.fn()}
      />,
    );

    expect(screen.getAllByText(/WEAK|STRONG/)).toHaveLength(1);

    const cityRow = screen.getByText('Berlin').closest('tr');

    expect(cityRow).not.toBeNull();
    expect(cityRow).not.toHaveTextContent('WEB_SEARCH');
  });

  it('should flag a fact whose sources disagree', () => {
    render(
      <ProposalDiffTable
        items={[
          {
            ...items[0],
            facts: [{ ...items[0].facts[0], hasConflict: true }],
          },
        ]}
        onApprove={jest.fn()}
        onReject={jest.fn()}
      />,
    );

    expect(screen.getByText(/Conflicting sources/)).toBeInTheDocument();
  });
```

- [ ] **Step 3: Run the tests to verify the new ones fail**

```bash
cd packages/twenty-front && npx jest ProposalDiffTable
```

Expected: FAIL — the three new tests fail. The first fails on `Unable to find an element with the text: /WEAK/`; the second fails on `getAllByText` finding zero elements; the third on `/Conflicting sources/`. All **six** pre-existing tests must still pass at this point — the fixture only gained a field. If any of the six went red, the fixture was replaced rather than extended; undo and redo Step 2.

- [ ] **Step 4: Extend the component's type and render the citation**

In `ProposalDiffTable.tsx`, **extend** the existing `ProposalItem` type (lines 7-17) by adding one field and one new type above it. Replace:

```tsx
type ProposalItem = {
  id: string;
  actionType: string;
  objectNameSingular: string | null;
  recordId: string | null;
  toolId?: string | null;
  payload: Record<string, unknown>;
  baseline: Record<string, unknown>;
  status: string;
  error: string | null;
};
```

with:

```tsx
// Matches ProposalItemFact from the metadata schema (Task 11). Flat by
// design: the whole citation is one row, so there is no nested evidence
// array to traverse here.
type ProposalItemFact = {
  id: string;
  fieldName: string;
  strength: string;
  hasConflict: boolean;
  sourceType: string | null;
  sourceLocator: string | null;
  observedAt: string | null;
};

type ProposalItem = {
  id: string;
  actionType: string;
  objectNameSingular: string | null;
  recordId: string | null;
  toolId?: string | null;
  payload: Record<string, unknown>;
  baseline: Record<string, unknown>;
  status: string;
  error: string | null;
  // Optional: a proposal item created before Task 8 shipped has none, and
  // every unit test fixture in this file that predates this task omits it.
  facts?: ProposalItemFact[];
};
```

Add two styled components after the existing `StyledConflict` block (lines 45-47), using **`themeCssVariables`**, matching every other styled block in this file — not a theme-prop callback, which Linaria cannot statically extract:

```tsx
const StyledCitation = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
  margin-top: ${themeCssVariables.spacing[1]};
`;

const StyledConflictBadge = styled.span`
  color: ${themeCssVariables.font.color.danger};
`;
```

Both tokens are confirmed to exist — this was an open item and it is settled. `packages/twenty-ui/src/theme-constants/themeCssVariables.ts:204` declares `xs: 'var(--t-font-size-xs)'` inside `font.size` (the full set is `xxs, xs, sm, md, lg, xl, xxl`), and `:60` declares `'1': 'var(--t-spacing-1)'` inside `spacing` (integer keys `'0'`–`'32'` plus half-steps `'0.5'`, `'1.5'`, …). No fallback is needed and none should be written. Keep the note that a missing Linaria token compiles to a silent empty string rather than an error, because that is why these were verified rather than assumed.

Add the lookup helper after `formatValue` (lines 57-63):

```tsx
const findFactForField = (
  item: ProposalItem,
  fieldName: string,
): ProposalItemFact | undefined =>
  item.facts?.find((fact) => fact.fieldName === fieldName);
```

Finally, replace the per-field row mapping (lines 151-162):

```tsx
              ...fieldNames.map((fieldName) => (
                <StyledFieldRow key={`${item.id}-${fieldName}`}>
                  <StyledCell />
                  <StyledCell>{fieldName}</StyledCell>
                  <StyledCell>
                    {formatValue(item.baseline[fieldName])}
                  </StyledCell>
                  <StyledCell>
                    {formatValue(item.payload[fieldName])}
                  </StyledCell>
                </StyledFieldRow>
              )),
```

with:

```tsx
              ...fieldNames.map((fieldName) => {
                const fact = findFactForField(item, fieldName);

                return (
                  <StyledFieldRow key={`${item.id}-${fieldName}`}>
                    <StyledCell />
                    <StyledCell>
                      {fieldName}
                      {/* No fact, or a fact whose evidence row is gone, means
                          no citation — a blank line here is the honest state
                          for a chat-originated write, not an error. */}
                      {fact !== undefined && fact.sourceType !== null && (
                        <StyledCitation>
                          {fact.hasConflict && (
                            <StyledConflictBadge>
                              Conflicting sources —{' '}
                            </StyledConflictBadge>
                          )}
                          {fact.strength} · {fact.sourceType} ·{' '}
                          {fact.sourceLocator}
                        </StyledCitation>
                      )}
                    </StyledCell>
                    <StyledCell>
                      {formatValue(item.baseline[fieldName])}
                    </StyledCell>
                    <StyledCell>
                      {formatValue(item.payload[fieldName])}
                    </StyledCell>
                  </StyledFieldRow>
                );
              }),
```

The item-level `<tr>`, the `describeItem` checkbox label, the `colSpan={3}` description cell, the `CONFLICTED` warning, the unprotected-item note, and the `FIELD_DIFF_ACTION_TYPES` guard are all untouched. The citation lives inside the existing field-name cell, so the table keeps its four-column shape and the four tests that depend on that shape keep passing.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd packages/twenty-front && npx jest ProposalDiffTable
```

Expected: PASS — all six pre-existing tests plus the 3 new ones, 9 in total.

- [ ] **Step 6: Verify in the browser**

```bash
yarn start
```

Navigate to Settings → AI approvals. After Task 13's manual verification has run, confirm at least one field row shows a `WEAK · WEB_SEARCH · https://…` or `STRONG · CRM_RECORD · …` line under the field name, and that a field with no backing fact (a plain chat-originated write) shows nothing — the correct, honest empty state.

- [ ] **Step 7: Lint, typecheck, commit**

```bash
npx nx lint:diff-with-main twenty-front
npx nx typecheck twenty-front
git add packages/twenty-front/src/modules/settings/ai-approvals
git commit -m "feat(ai-research): show evidence citations in the approval diff table"
```

---


### Task 13: End-to-end integration test — evidence to fact to proposal to approval, plus retry and restart

Proves the charter's Phase 2 exit gate against a real database: *"An end-to-end lead research workflow creates evidence, proposes changes, gets approval, updates records once, and survives retry and restart."*

This is the phase's **only** real-seam coverage for `AgentTaskService`'s lease semantics, for the dismissal loop, and for the ungating of the two static tools through the live dispatcher. Several earlier tasks explicitly defer their real-seam obligation here. It is written as code, not as a numbered narrative, for the same reason every other task is.

Launch 1's own integration test (`test/integration/graphql/suites/ai-write-approval/proposal-approval.integration-spec.ts`, 425 lines, read in full) supplies the harness, and this suite reuses it verbatim rather than reinventing it:

- Globals `APP_PORT`, `APPLE_JANE_ADMIN_ACCESS_TOKEN`, `global.testDataSource` are provided by the integration setup.
- `getAppProviderByClassName<T>('ClassName')` (`test/integration/utils/get-app-provider-by-class-name.util`) resolves a live Nest provider.
- Record CRUD is on `/graphql`; `@MetadataResolver()`s including `pendingProposals`, `approveProposal`, and this phase's `createAgentTask` are on `/metadata`. The two `post` helpers below are copied from that file.
- Its comment on originating a gated write is the precedent followed here: *"To originate a gated write without standing up a real LLM turn, resolve `ToolExecutorService` … and call `dispatch` directly — this is the exact code path an agent takes, minus the model."*

**No agent fixture needs hand-rolling.** Task 5b seeds one `AgentEntity` per workspace at `universalIdentifier = RESEARCH_AGENT_UNIVERSAL_IDENTIFIER`, and `npx nx run twenty-server:test:integration:with-db-reset` runs against a freshly seeded database, so the agent is already there. The suite looks it up rather than creating one. (An earlier draft told the implementer to *"grep `test/integration/graphql/suites` for an existing agent-creation fixture and reuse it"* — there is none, and Decision 4 removed the need for one.)

**Files:**
- Create: `packages/twenty-server/test/integration/graphql/suites/ai-research/agent-task-research.integration-spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-12.

- [ ] **Step 1: Write the suite**

Create `test/integration/graphql/suites/ai-research/agent-task-research.integration-spec.ts`:

```ts
import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { ToolCategory } from 'twenty-shared/ai';

import { type ToolProviderContext } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider-context.type';
import { type ToolExecutorService } from 'src/engine/core-modules/tool-provider/services/tool-executor.service';
import { type AgentTaskService } from 'src/engine/metadata-modules/ai/ai-research/services/agent-task.service';
import { type EvidenceRecordingService } from 'src/engine/metadata-modules/ai/ai-research/services/evidence-recording.service';
import { type ProposalExecutionService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-execution.service';
import { type UserRoleService } from 'src/engine/metadata-modules/user-role/user-role.service';
import { AgentTaskStatus } from 'src/engine/metadata-modules/ai/ai-research/types/agent-task-status.type';
import { AgentRunStatus } from 'src/engine/metadata-modules/ai/ai-research/types/agent-run-status.type';
import { FactStatus } from 'src/engine/metadata-modules/ai/ai-research/types/fact-status.type';
import { RESEARCH_AGENT_UNIVERSAL_IDENTIFIER } from 'src/engine/metadata-modules/ai/ai-research/constants/research-agent.const';
import { SEED_APPLE_WORKSPACE_ID } from 'src/engine/workspace-manager/dev-seeder/core/constants/seeder-workspaces.constant';

import { getAppProviderByClassName } from 'test/integration/utils/get-app-provider-by-class-name.util';

const client = request(`http://localhost:${APP_PORT}`);

const workspaceId = SEED_APPLE_WORKSPACE_ID;

const post = (
  path: '/graphql' | '/metadata',
  query: string,
  variables: Record<string, unknown> = {},
) =>
  client
    .post(path)
    .set('Authorization', `Bearer ${APPLE_JANE_ADMIN_ACCESS_TOKEN}`)
    .send({ query, variables });

const graphqlRequest = (query: string, variables: Record<string, unknown> = {}) =>
  post('/graphql', query, variables);

const metadataRequest = (query: string, variables: Record<string, unknown> = {}) =>
  post('/metadata', query, variables);

const UPDATE_AI_WRITE_POLICY = `
  mutation UpdateAiWritePolicy($input: UpdateAiWritePolicyInput!) {
    updateAiWritePolicy(input: $input) { default overrides }
  }
`;

// The exact query Task 12's component issues, minus the fields the component
// does not select. If this errors, the approval inbox is broken in production.
const PENDING_PROPOSALS = `
  query PendingProposals {
    pendingProposals {
      id
      status
      items {
        id
        actionType
        objectNameSingular
        recordId
        toolId
        payload
        baseline
        status
        error
        facts {
          id
          fieldName
          strength
          hasConflict
          sourceType
          sourceLocator
          observedAt
        }
      }
    }
  }
`;

const APPROVE_PROPOSAL = `
  mutation ApproveProposal($input: ApproveProposalInput!) {
    approveProposal(input: $input) {
      proposalId appliedItemIds conflictedItemIds failedItemIds aborted
    }
  }
`;

const REJECT_PROPOSAL = `
  mutation RejectProposal($input: RejectProposalInput!) {
    rejectProposal(input: $input) { proposalId aborted }
  }
`;

const createPerson = async (): Promise<string> => {
  const id = randomUUID();
  const response = await graphqlRequest(
    `
      mutation CreateOnePerson($input: PersonCreateInput!) {
        createPerson(data: $input) { id jobTitle }
      }
    `,
    { input: { id } },
  );

  expect(response.body.errors).toBeUndefined();

  return response.body.data.createPerson.id;
};

const findPersonJobTitle = async (personId: string): Promise<string | null> => {
  const response = await graphqlRequest(
    `
      query FindOnePerson($filter: PersonFilterInput!) {
        person(filter: $filter) { id jobTitle }
      }
    `,
    { filter: { id: { eq: personId } } },
  );

  expect(response.body.errors).toBeUndefined();

  return response.body.data.person.jobTitle;
};

const setPolicy = async (input: {
  default: string;
  overrides: Record<string, string>;
}) => {
  const response = await metadataRequest(UPDATE_AI_WRITE_POLICY, { input });

  expect(response.body.errors).toBeUndefined();
};

const queryOne = async <T>(sql: string, params: unknown[]): Promise<T> => {
  const [row] = await global.testDataSource.query(sql, params);

  return row as T;
};

describe('agent task research (e2e)', () => {
  let toolExecutorService: ToolExecutorService;
  let agentTaskService: AgentTaskService;
  let evidenceRecordingService: EvidenceRecordingService;
  let proposalExecutionService: ProposalExecutionService;
  let toolProviderContext: ToolProviderContext;
  let approverUserWorkspaceId: string;
  let agentId: string;
  let personId: string;

  beforeAll(async () => {
    toolExecutorService =
      getAppProviderByClassName<ToolExecutorService>('ToolExecutorService');
    agentTaskService =
      getAppProviderByClassName<AgentTaskService>('AgentTaskService');
    evidenceRecordingService = getAppProviderByClassName<EvidenceRecordingService>(
      'EvidenceRecordingService',
    );
    proposalExecutionService = getAppProviderByClassName<ProposalExecutionService>(
      'ProposalExecutionService',
    );

    const userRoleService =
      getAppProviderByClassName<UserRoleService>('UserRoleService');

    const adminUserWorkspace = await queryOne<{
      userWorkspaceId: string;
      userId: string;
    }>(
      `SELECT uw.id AS "userWorkspaceId", u.id AS "userId"
       FROM core."userWorkspace" uw
       JOIN core."user" u ON u.id = uw."userId"
       WHERE uw."workspaceId" = $1 AND u.email = $2`,
      [workspaceId, 'jane.austen@apple.dev'],
    );

    approverUserWorkspaceId = adminUserWorkspace.userWorkspaceId;

    const roleId = await userRoleService.getRoleIdForUserWorkspace({
      userWorkspaceId: approverUserWorkspaceId,
      workspaceId,
    });

    toolProviderContext = {
      workspaceId,
      roleId,
      rolePermissionConfig: { shouldBypassPermissionChecks: true },
      userId: adminUserWorkspace.userId,
      userWorkspaceId: approverUserWorkspaceId,
      threadId: randomUUID(),
    };

    // Owner Decision 4: the seeded research agent. No fixture is created —
    // if this row is missing, Task 5b's declarative seed is not working and
    // that is the failure this assertion should surface.
    const seededAgent = await queryOne<{ id: string }>(
      `SELECT id FROM core."agent"
       WHERE "workspaceId" = $1 AND "universalIdentifier" = $2`,
      [workspaceId, RESEARCH_AGENT_UNIVERSAL_IDENTIFIER],
    );

    expect(seededAgent).toBeDefined();
    agentId = seededAgent.id;
  });

  beforeEach(async () => {
    await setPolicy({ default: 'PROPOSE', overrides: {} });
    personId = await createPerson();
    // Fresh thread per test so proposals don't merge across tests.
    toolProviderContext = { ...toolProviderContext, threadId: randomUUID() };
  });

  const dispatchUpdateJobTitle = (jobTitle: string) =>
    toolExecutorService.dispatch(
      {
        name: 'update_one_person',
        label: 'update_one',
        description: '',
        category: ToolCategory.DATABASE_CRUD,
        executionRef: {
          kind: 'database_crud',
          objectNameSingular: 'person',
          operation: 'update_one',
        },
      },
      { id: personId, jobTitle },
      toolProviderContext,
    );

  const dispatchStaticTool = (
    toolId: string,
    args: Record<string, unknown>,
  ) =>
    toolExecutorService.dispatch(
      {
        name: toolId,
        label: toolId,
        description: '',
        category: ToolCategory.ACTION,
        executionRef: { kind: 'static', toolId },
      },
      args,
      toolProviderContext,
    );

  // Stands in for what AgentTaskRunJob creates, without a real LLM turn.
  const insertAgentRun = async (taskId: string): Promise<string> => {
    const run = await queryOne<{ id: string }>(
      `INSERT INTO core."agentRun" ("workspaceId", "taskId", "agentId", status)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [workspaceId, taskId, agentId, AgentRunStatus.RUNNING],
    );

    return run.id;
  };

  const findFacts = (recordId: string, fieldName: string) =>
    global.testDataSource.query(
      `SELECT id, status, strength, "lastObservedAt" FROM core."fact"
       WHERE "workspaceId" = $1 AND "recordId" = $2 AND "fieldName" = $3`,
      [workspaceId, recordId, fieldName],
    ) as Promise<
      { id: string; status: string; strength: string; lastObservedAt: Date }[]
    >;

  // ---- the exit gate, in one test ----

  it('records evidence, derives a fact, proposes with a citation, and applies once on approval', async () => {
    const task = await agentTaskService.createTask({
      workspaceId,
      objectNameSingular: 'person',
      recordId: personId,
      agentId,
      reason: 'New lead created',
    });

    expect(task.status).toBe(AgentTaskStatus.PENDING);

    const claimed = await agentTaskService.claimDueTasks();
    const claimedTask = claimed.find((candidate) => candidate.id === task.id);

    expect(claimedTask).toBeDefined();
    expect(claimedTask?.status).toBe(AgentTaskStatus.LEASED);

    const runId = await insertAgentRun(task.id);

    // C1's real-seam check, part 1: record_evidence must NOT be gated. This
    // goes through the live dispatcher, so a missing denylist entry turns
    // this into a proposal and the assertions below fail loudly.
    const evidenceOutput = await dispatchStaticTool('record_evidence', {
      objectNameSingular: 'person',
      recordId: personId,
      fieldName: 'jobTitle',
      value: 'Head of Sales',
      sourceType: 'WEB_SEARCH',
      sourceLocator: 'https://example.com/about',
    });

    expect(evidenceOutput.success).toBe(true);
    expect(
      (evidenceOutput.result as { proposalId?: string }).proposalId,
    ).toBeUndefined();
    expect(
      (evidenceOutput.result as { evidenceId?: string }).evidenceId,
    ).toBeDefined();

    const facts = await findFacts(personId, 'jobTitle');

    expect(facts).toHaveLength(1);
    expect(facts[0].status).toBe(FactStatus.CURRENT);
    expect(facts[0].strength).toBe('WEAK');

    // The agent's proposing write. This one IS gated.
    const updateOutput = await dispatchUpdateJobTitle('Head of Sales');
    const { proposalId, proposalItemId } = updateOutput.result as {
      proposalId: string;
      proposalItemId: string;
    };

    expect(updateOutput.success).toBe(true);
    expect(await findPersonJobTitle(personId)).toBeNull();

    // The citation, through the exact query the approval UI issues.
    const pending = await metadataRequest(PENDING_PROPOSALS);

    expect(pending.body.errors).toBeUndefined();

    const proposal = pending.body.data.pendingProposals.find(
      (candidate: { id: string }) => candidate.id === proposalId,
    );
    const item = proposal.items.find(
      (candidate: { id: string }) => candidate.id === proposalItemId,
    );

    expect(item.facts).toHaveLength(1);
    expect(item.facts[0]).toMatchObject({
      fieldName: 'jobTitle',
      strength: 'WEAK',
      hasConflict: false,
      sourceType: 'WEB_SEARCH',
      sourceLocator: 'https://example.com/about',
    });

    await agentTaskService.completeTask({
      taskId: task.id,
      workspaceId,
      runId,
      outcome: 'Found job title.',
    });

    const completed = await queryOne<{ status: string }>(
      `SELECT status FROM core."agentTask" WHERE id = $1`,
      [task.id],
    );

    expect(completed.status).toBe(AgentTaskStatus.SUCCEEDED);

    const approval = await proposalExecutionService.approve({
      proposalId,
      selectedItemIds: [proposalItemId],
      workspaceId,
      approverUserWorkspaceId,
    });

    expect(approval.aborted).toBe(false);
    expect(approval.appliedItemIds).toEqual([proposalItemId]);
    expect(await findPersonJobTitle(personId)).toBe('Head of Sales');
  });

  // C1's real-seam check, part 2, and Task 5c's deferred coverage.
  it('schedules research through the ungated create_agent_task tool without creating a proposal', async () => {
    const output = await dispatchStaticTool('create_agent_task', {
      objectNameSingular: 'person',
      recordId: personId,
      reason: 'Tool-scheduled research',
    });

    expect(output.success).toBe(true);
    expect((output.result as { proposalId?: string }).proposalId).toBeUndefined();

    const { taskId } = output.result as { taskId: string };
    const scheduled = await queryOne<{ status: string; agentId: string }>(
      `SELECT status, "agentId" FROM core."agentTask" WHERE id = $1`,
      [taskId],
    );

    expect(scheduled.status).toBe(AgentTaskStatus.PENDING);
    // The seeded agent, not one the model chose.
    expect(scheduled.agentId).toBe(agentId);

    // Called twice with the same inputs, one task.
    const second = await dispatchStaticTool('create_agent_task', {
      objectNameSingular: 'person',
      recordId: personId,
      reason: 'Tool-scheduled research',
    });

    expect((second.result as { taskId: string }).taskId).toBe(taskId);
  });

  it('retries with real backoff and then gives up naming the attempt count', async () => {
    const task = await agentTaskService.createTask({
      workspaceId,
      objectNameSingular: 'person',
      recordId: personId,
      agentId,
      reason: 'Retry coverage',
      maxAttempts: 2,
    });

    await agentTaskService.claimDueTasks();
    await agentTaskService.failTask({
      taskId: task.id,
      workspaceId,
      runId: randomUUID(),
      errorMessage: 'transient error',
    });

    const afterFirstFailure = await queryOne<{ status: string; dueAt: Date }>(
      `SELECT status, "dueAt" FROM core."agentTask" WHERE id = $1`,
      [task.id],
    );

    expect(afterFirstFailure.status).toBe(AgentTaskStatus.PENDING);
    expect(new Date(afterFirstFailure.dueAt).getTime()).toBeGreaterThan(
      Date.now(),
    );

    // The backoff is real, not a no-op: the task is not immediately re-claimable.
    const immediateClaim = await agentTaskService.claimDueTasks();

    expect(
      immediateClaim.some((candidate) => candidate.id === task.id),
    ).toBe(false);

    // Advance past the backoff rather than sleeping through it.
    await global.testDataSource.query(
      `UPDATE core."agentTask" SET "dueAt" = now() - interval '1 minute' WHERE id = $1`,
      [task.id],
    );

    const secondClaim = await agentTaskService.claimDueTasks();

    expect(secondClaim.some((candidate) => candidate.id === task.id)).toBe(true);

    await agentTaskService.failTask({
      taskId: task.id,
      workspaceId,
      runId: randomUUID(),
      errorMessage: 'transient error',
    });

    const exhausted = await queryOne<{ status: string; outcome: string }>(
      `SELECT status, outcome FROM core."agentTask" WHERE id = $1`,
      [task.id],
    );

    expect(exhausted.status).toBe(AgentTaskStatus.FAILED);
    expect(exhausted.outcome).toContain('Gave up after 2 attempts');
  });

  // "Survives restart": a worker that died mid-run leaves the row LEASED with
  // a lease that later expires. Nothing resets its status — no crashed-worker
  // detector exists and none is wanted — so the claim query itself must treat
  // an expired lease as claimable. The UPDATE below writes `status = 'LEASED'`
  // deliberately: writing PENDING here would simulate a *rescheduled* task,
  // not a crashed worker, and would pass against a PENDING-only claim query
  // that strands every real crash. Do not weaken it.
  it('re-claims a task whose lease expired while it was still marked LEASED', async () => {
    const task = await agentTaskService.createTask({
      workspaceId,
      objectNameSingular: 'person',
      recordId: personId,
      agentId,
      reason: 'Restart coverage',
    });

    const firstClaim = await agentTaskService.claimDueTasks();

    expect(
      firstClaim.find((candidate) => candidate.id === task.id)?.status,
    ).toBe(AgentTaskStatus.LEASED);

    await global.testDataSource.query(
      `UPDATE core."agentTask"
       SET "leasedUntil" = now() - interval '1 hour'
       WHERE id = $1`,
      [task.id],
    );

    const [stillLeased] = await global.testDataSource.query(
      `SELECT status FROM core."agentTask" WHERE id = $1`,
      [task.id],
    );

    expect(stillLeased.status).toBe(AgentTaskStatus.LEASED);

    const reclaimed = await agentTaskService.claimDueTasks();
    const reclaimedTask = reclaimed.find(
      (candidate) => candidate.id === task.id,
    );

    expect(reclaimedTask).toBeDefined();
    expect(Number(reclaimedTask?.attempts)).toBe(2);
  });

  // The other half of the expired-lease rule: an unexpired lease must NOT be
  // re-claimable, or two workers run the same research task concurrently.
  it('does not re-claim a LEASED task whose lease is still in the future', async () => {
    const task = await agentTaskService.createTask({
      workspaceId,
      objectNameSingular: 'person',
      recordId: personId,
      agentId,
      reason: 'Concurrent-claim coverage',
    });

    await agentTaskService.claimDueTasks();

    const secondClaim = await agentTaskService.claimDueTasks();

    expect(
      secondClaim.find((candidate) => candidate.id === task.id),
    ).toBeUndefined();
  });

  // A row that crashed maxAttempts times is no longer claimable but is also
  // not terminal. Without the reaper it sits LEASED forever and no operator
  // surface ever shows it as failed.
  it('reaps a LEASED task whose lease expired after its attempts were exhausted', async () => {
    const task = await agentTaskService.createTask({
      workspaceId,
      objectNameSingular: 'person',
      recordId: personId,
      agentId,
      reason: 'Reaper coverage',
      maxAttempts: 1,
    });

    await agentTaskService.claimDueTasks();

    await global.testDataSource.query(
      `UPDATE core."agentTask"
       SET "leasedUntil" = now() - interval '1 hour'
       WHERE id = $1`,
      [task.id],
    );

    expect(await agentTaskService.claimDueTasks()).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ id: task.id })]),
    );

    const reaped = await agentTaskService.reapAbandonedTasks();

    expect(reaped).toBeGreaterThanOrEqual(1);

    const [reapedRow] = await global.testDataSource.query(
      `SELECT status, outcome FROM core."agentTask" WHERE id = $1`,
      [task.id],
    );

    expect(reapedRow.status).toBe(AgentTaskStatus.FAILED);
    expect(reapedRow.outcome).toContain('Abandoned after 1 attempts');
  });

  it('never claims a cancelled task', async () => {
    const task = await agentTaskService.createTask({
      workspaceId,
      objectNameSingular: 'person',
      recordId: personId,
      agentId,
      reason: 'Cancellation coverage',
    });

    const cancelled = await agentTaskService.cancelTask({
      taskId: task.id,
      workspaceId,
      reason: 'Record deleted',
    });

    expect(cancelled).toBe(true);

    const claimed = await agentTaskService.claimDueTasks();

    expect(claimed.some((candidate) => candidate.id === task.id)).toBe(false);

    // A second cancel changes nothing and says so.
    expect(
      await agentTaskService.cancelTask({
        taskId: task.id,
        workspaceId,
        reason: 'Record deleted',
      }),
    ).toBe(false);
  });

  // Task 9's and Task 2's deferred real-seam coverage: the whole dismissal
  // loop, against a real database. This is the only place it is proven.
  it('does not re-propose a value the reviewer rejected', async () => {
    const runId = randomUUID();

    await evidenceRecordingService.recordEvidence({
      workspaceId,
      runId: null,
      objectNameSingular: 'person',
      recordId: personId,
      sourceType: 'WEB_SEARCH',
      sourceLocator: 'https://example.com/about',
      extractor: `agent-run:${runId}`,
      payload: { fieldName: 'jobTitle', value: 'Head of Sales' },
    });

    const update = await dispatchUpdateJobTitle('Head of Sales');
    const { proposalId } = update.result as { proposalId: string };

    const rejection = await metadataRequest(REJECT_PROPOSAL, {
      input: { proposalId },
    });

    expect(rejection.body.errors).toBeUndefined();
    expect(rejection.body.data.rejectProposal.aborted).toBe(false);

    const afterReject = await findFacts(personId, 'jobTitle');

    expect(afterReject).toHaveLength(1);
    expect(afterReject[0].status).toBe(FactStatus.DISMISSED);

    // Observe the identical value again. No new CURRENT fact may appear.
    await evidenceRecordingService.recordEvidence({
      workspaceId,
      runId: null,
      objectNameSingular: 'person',
      recordId: personId,
      sourceType: 'WEB_SEARCH',
      sourceLocator: 'https://example.com/team',
      extractor: `agent-run:${randomUUID()}`,
      payload: { fieldName: 'jobTitle', value: 'Head of Sales' },
    });

    const afterReobservation = await findFacts(personId, 'jobTitle');

    expect(
      afterReobservation.filter((fact) => fact.status === FactStatus.CURRENT),
    ).toHaveLength(0);

    // A *different* value is still proposable — dismissal is per value, not
    // per field. Without this the "don't nag" rule would silence the field.
    await evidenceRecordingService.recordEvidence({
      workspaceId,
      runId: null,
      objectNameSingular: 'person',
      recordId: personId,
      sourceType: 'WEB_SEARCH',
      sourceLocator: 'https://example.com/news',
      extractor: `agent-run:${randomUUID()}`,
      payload: { fieldName: 'jobTitle', value: 'VP of Sales' },
    });

    const afterNewValue = await findFacts(personId, 'jobTitle');

    expect(
      afterNewValue.filter((fact) => fact.status === FactStatus.CURRENT),
    ).toHaveLength(1);
  });
});
```

Two notes on the SQL above. `agentRun` and `agentTask` are read with raw `global.testDataSource.query` rather than repositories because the suite already holds a data source and these are two-column assertions, not object graphs — the same choice Launch 1's suite makes for its `userWorkspace` lookup. And the three lease tests only touch `"leasedUntil"` — they never rewrite `status` — because that is what a crashed worker actually leaves behind. An earlier draft of this plan wrote `status = 'PENDING'` alongside the expired lease; that made the test pass against a strict-`PENDING` claim query that would strand every real crash, which is precisely the failure the "survives retry/restart" exit gate exists to catch. Task 5's `claimDueTasks` now matches `status = PENDING OR (status = LEASED AND "leasedUntil" < now())` and re-checks the same predicate inside the conditional UPDATE, and `reapAbandonedTasks` closes out rows that exhausted `maxAttempts` while leased.

- [ ] **Step 2: Run the integration suite**

```bash
npx nx run twenty-server:test:integration:with-db-reset
```

Expected: the new suite passes and no existing suite regresses, including the Launch 1 `ai-write-approval` suite. A failure in `records evidence, derives a fact, …` at the `proposalId` assertion means Task 3 Step 5d was skipped and `record_evidence` is still gated.

- [ ] **Step 3: Full regression check**

```bash
npx nx test twenty-server
npx nx test twenty-front
npx nx lint:diff-with-main twenty-server
npx nx lint:diff-with-main twenty-front
npx nx typecheck twenty-server
npx nx typecheck twenty-front
```

Expected: all green.

- [ ] **Step 4: Manual end-to-end verification**

```bash
npx nx database:reset twenty-server
yarn start
```

Sign in with "Continue with Email" and the prefilled credentials. Confirm Settings → AI agents lists the seeded **Researcher** agent with the **AI Researcher** role attached. Create a `person` record. In the metadata GraphQL playground, call `createAgentTask` with the Researcher's id and that person's id.

Then trigger the dispatch tick. Either wait up to one minute for the registered cron, or run the command once:

```bash
npx nx run twenty-server:command cron:ai-research:agent-task-dispatch
```

The invocation is confirmed against `packages/twenty-server/project.json` — this was an open item and it is settled. The `command` target is a plain `nx:run-commands` wrapper: `{"cwd": "packages/twenty-server", "command": "node dist/command/command.js"}`. Nx appends whatever follows the target name as arguments, so any nest-commander command name registered on the CLI works, and the bulk registrar `cron:register:all` is just one such name — there is nothing special about it. Two consequences worth knowing before running it:

- It executes `dist/`, so build first (`npx nx build twenty-server`) or the command runs stale code. A source-tree alternative that skips the build is `cd packages/twenty-server && npx ts-node -r tsconfig-paths/register src/command/command.ts cron:ai-research:agent-task-dispatch`.
- Every cron command in this repo *registers* a recurring job rather than running the work once — e.g. `cron:workflow:handle-staled-runs`, `cron:billing:reminder` (`@Command({ name: 'cron:…' })`). So this invocation schedules the dispatch tick; it does not perform one synchronously. To force an immediate tick, register it and wait one `AGENT_TASK_DISPATCH_CRON_PATTERN` interval, with the worker process running.

Confirm: the task moves `PENDING` → `LEASED` → `SUCCEEDED`; Settings → AI approvals shows a proposal with a citation line under the changed field; approving it updates the record exactly once.

- [ ] **Step 5: Commit**

```bash
git add packages/twenty-server/test
git commit -m "feat(ai-research): add end-to-end integration coverage for evidence, facts, and agent tasks"
```

---


## Success criteria mapped to tasks

| Charter requirement (Phase 2) | Verified by |
| --- | --- |
| `Evidence`: immutable observation — source type, locator, observed time, extractor, payload hash, strength, record links | Task 1 entity + migration; Task 2 `EvidenceRecordingService` tests (deterministic strength, hash) |
| `Fact`: current/superseded sourced assertion — freshness, conflict state, field/value, evidence links | Task 1 entity, including the `lastObservedAt` freshness column copied from the observing `Evidence.observedAt`; Task 2 `FactDerivationService` tests (corroboration, freshness-only-moves-forward, supersession, same-run conflict, dismissal) |
| `AgentTask`: durable scheduled work — priority, record target, reason, lease, retry count, budget, idempotency key, cancellation | Task 4 entity; Task 5 `AgentTaskService` tests (idempotent create, lease claim, guarded complete, backoff-then-exhaustion fail, cancel) |
| `AgentRun` extends Twenty's existing run/turn/cost machinery, not a parallel one | Task 4 entity design note, including the charter's `workflowRunId` link and the deliberate absence of a `transcript` column (`AgentMessageEntity` already persists one) + Task 6 (reuses `threadId` batching field); Task 7 worker reuses `AgentAsyncExecutorService`/`AiBillingService` verbatim, adding only status and cost bookkeeping |
| Strong non-conflicting facts flow into ProposalItems; weak/conflicting ones surface with the conflict shown | Task 8 gate integration test; Task 2's conflict/supersession tests; Task 12 UI citation with conflict badge |
| Every AI-derived record change still goes through `ProposalGateService` — no second write path | Task 3 Step 5b ungates exactly two tools, both of which write only platform tables, with a test asserting the denylist still gates everything unclassified; Task 8 (gate only *reads* facts, still the same `save()` call it always made); Task 13's `create_agent_task` test asserts no proposal is created; explicit statement in Global Constraints |
| Evidence and facts surfaced in the approval UI with sources | Task 11's single `ProposalItemDTO.facts` resolve field returning a flat projection; Task 12 `ProposalDiffTable` citation inside the existing field row, and its three tests |
| End-to-end lead research workflow creates evidence, proposes changes, gets approval, updates records once, survives retry and restart | Task 13's eight integration tests, against a real database. "Survives restart" specifically is the expired-lease trio: a `LEASED` row whose lease expired is re-claimed, a `LEASED` row whose lease has not expired is not, and a row that exhausted `maxAttempts` while leased is reaped to `FAILED` rather than left non-terminal. |
| Reuse Twenty's existing agent run/turn/cost-accounting/message-queue machinery — verified before designing anything that might duplicate it | Explicit design notes in Tasks 4, 5, 6, 7 citing the exact existing files read (`agent-turn.entity.ts`, `agent-async-executor.service.ts`, `ai-billing.service.ts`, `messaging-message-list-fetch.cron.job.ts`) |
| Audit entries distinguish agent/API/workflow principals (Principal contract) | `AgentTaskEntity.createdByActor` and the `ActorMetadata`/`FieldActorSource` reuse in Task 5c and Task 7 (`FieldActorSource.AGENT`) and Task 10 (`FieldActorSource.API`) — note `ToolExecutionContext` carries no actor at all, so Task 5c writes a literal one rather than reading a field that does not exist — the same `ActorMetadata` type `ProposalEntity.createdByActor` already uses (Launch 1) |

## Acceptance narrative coverage

Ties this phase to the charter's five end-to-end workflows by numbered step.

**"Lead to qualified opportunity"** — steps 3-6 are this phase's direct target: *(3) a workflow creates a budgeted research task* → the `create_agent_task` tool (Task 5c), called from inside any workflow's `AI_AGENT` step, with the budget enforced as a real step cap by Task 6 Step 6b and passed by Task 7's worker. **Partial:** no Phase 4 workflow template's prompt names `create_agent_task` yet — that one-line prompt edit is owed by Phase 4 Task 10 and is not written into any task in either plan; the `createAgentTask` GraphQL mutation (Task 10) is the same path for humans, admin scripts, and external agents; *(4) the agent collects internal history and optional enrichment data as evidence* → Task 3's `record_evidence` tool plus Task 7's worker; *(5) strong non-conflicting observations create facts; weak or conflicting ones create proposal items* → Task 2 + Task 8; *(6) a user approves the proposal batch* → Launch 1's existing `approveProposal`, now carrying `factIds` (Task 8) and rendering citations (Task 12). Step 8 ("dashboards show source, quality, conversion, freshness, and AI cost") is explicitly **not** built this phase — see the deliberately-cut table.

**"Autonomous account monitoring"** — steps 1 and 4 are directly built: *(1) cron or event triggers create leased tasks* → Task 7's dispatch cron (the trigger source for Phase 2 is the GraphQL mutation and, later, a stale-record sweep — see deliberately-cut); *(4) failures retry with backoff and stay observable in run history* → Task 5's `failTask` + Task 13's retry and lease-expiry tests. Steps 2-3 (comparing new observations against prior evidence under time/cost/provider limits, and notifications on material change) are partially built: Task 2's supersession comparison *is* "new observation vs. prior evidence"; per-task cost limits and notifications are deliberately cut.

**"Pipeline and follow-up," "Inbox and meeting intelligence," "Data import and quality"** — not directly advanced by this phase (their triggers are stage changes, connected-account ingestion, and import respectively, none of which exist yet); this phase supplies the evidence/fact/task machinery those phases will call into, per the charter's own delivery sequence (Phase 3 is ingestion).

---

## Deliberately cut

Every capability the scouting reports (`crm-scout.md`, the anchors report) inventoried for this phase and that this plan does not build, with the concrete trigger that would justify building it later. Per the charter's triage rule, nothing here is dropped silently.

| Cut | Trigger to build it |
| --- | --- |
| Noisy-OR multi-evidence combination and a tuned weight table (`crm`'s 0.95/0.85/…/0.20 constants, `VERIFIED`/`PROBABLE`/`POSSIBLE` bands) | Users report that the two-tier STRONG/WEAK strength model is too coarse to be useful — e.g. they want "three independent weak sources should outrank one strong one" |
| Auto-applying a `VERIFIED`-band fact directly to a record | Never — the charter's Proposal contract and "no second write path" rule forbid this outright regardless of confidence; not a KISS cut, a hard constraint |
| Purpose-built "AI research" node in the workflow-builder UI (`WorkflowActionType` extension) | When a customer explicitly asks for a no-code way to trigger research, rather than the two front doors this phase ships: the `create_agent_task` static tool (Task 5c), callable from any `AI_AGENT` workflow step, and the `createAgentTask` GraphQL mutation (Task 10) |
| Stale-record sweep cron that auto-creates `AgentTask`s for old/high-value records without being asked (the rest of the charter's "autonomous account monitoring" narrative, step 1's "cron... triggers") | When autonomous monitoring is scoped as its own deliverable — picking staleness thresholds and which fields matter is a product decision, not an architecture gap |
| Per-task hard **dollar/credit** spend cap distinct from the workspace's AI credit ceiling | The task's **step** budget is now enforced (Task 7's program-integration note passes `maxSteps: task.budget`), which is the cheap 80% of the Execution contract's "budgeted" requirement. A per-task credit cap additionally needs a mid-run billing check `AgentAsyncExecutorService` does not expose. Build when a workspace wants one research task capped below its overall credit balance. |
| Two-lane dispatch (cheap/deterministic "direct" tasks vs. LLM-session "research" tasks, with different lease durations) | When a second, non-LLM `AgentTask` kind actually exists — Phase 2 has exactly one kind (agent research), so a `kind` column and lane split would be speculative today |
| Identity resolution / deterministic person-company fuzzy matching | Out of this phase's scope by charter's own delivery sequence (belongs to "Lead to qualified opportunity" step 2, already partly covered by Twenty's existing `match-participant` service per the anchors report — a Phase 2 research task can call that existing service, nothing new needed here) |
| `Fact`/`Evidence` join table instead of a jsonb `evidenceIds`/`factIds` array | When the same piece of evidence needs to support facts on more than one field, or when a query needs to join *from* evidence *to* every fact it backs at scale — today it's a small array read by id, not a hot join path |
| ~~DataLoader batching for the `ProposalItemDTO.facts`/`FactDTO.evidence` N+1 resolver pattern~~ | **Struck.** The N+1 pair no longer exists: Task 11 collapsed to a single `ProposalItemDTO.facts` resolve field over `FactService.findProposalItemFacts`, which is two queries per item regardless of fact count. There is nothing left to batch. |
| Evidence recording from a live chat conversation (no `AgentTask`/`AgentRun`) | When users want an ad hoc chat research finding to also feed the fact pipeline — today `record_evidence` requires `context.threadId` to resolve to a real `AgentRunEntity`, so chat-only sessions can't use it |
| In-app notification on a new research-derived proposal | Same gap Launch 1 already flagged as needing to be built from scratch (no primitive exists) — not reopened here, still deferred to whenever notifications are built at all |
| `AgentTask`/`Evidence`/`Fact` as standard objects (saved views, filters, dashboards, search over them) | Owner Decision 1 resolved this to core-schema for all four, with the `FactService` boundary as the hedge. Build when users want a saved view or dashboard directly over research activity; because `Fact` is reached only through `FactService`, promoting it is a one-module change rather than a program-wide rewrite. |
| Workspace-level self-profile brief (`WorkspaceProfile`, from `crm-scout.md` item 16) | When outreach/prep tasks need reusable context about the workspace's own org — no consumer of it exists yet in this phase |
| Record briefs (narrative summary panel per record, `crm-scout.md` item 15) | When a record-page "brief" UI surface is scoped — this phase builds the fact/evidence substrate a brief would read from, but not the narrative-generation tool or panel itself |
| Real dollar-cost/quality/freshness/conversion dashboards (charter narrative step 8) | When a dashboards/reporting phase is scoped — `AgentRun.creditsUsedMicro`/`inputTokens`/`outputTokens` are captured this phase so that data exists to build on |
| **Evidence/fact workflow trigger** (charter "Trust layer meets workflows": *"fires on new material evidence, a conflict, stale data, or an approved proposal"*) — added by the program review, previously uncovered by every plan | Twenty's `DATABASE_EVENT` trigger only fires on workspace-object tables; `Evidence`/`Fact` are core-schema tables, so this needs either a new trigger type or the Owner Decision #1 fork (trust entities as standard objects). Build when a customer asks to automate off a conflict or a stale fact — until then the `AgentTask` cron plus Phase 4's cron templates cover the scheduled half of the same need. |
| **Evidence/fact panel on the record page** (charter Phase 2: *"surfaced on record pages, chat, workflows, dashboards, search"*) — added by the program review; this phase surfaces evidence in the **approval UI only** (Tasks 11–12) | When a reviewer asks "what does the CRM believe about this record and why" outside the context of an open proposal. The GraphQL read path (`FactService`, Task 8) already supports it; only the record-page tab component would be new. Ships naturally alongside record briefs. |
| **Per-field human-authorship supremacy** (`crm-scout.md` item 12 — agent never overwrites a value a human typed) — added by the program review | Twenty stores actor provenance per *record*, not per *field*, so a true implementation needs per-field authorship the platform does not have. Launch 1's baseline-vs-approval conflict check already blocks the dangerous case (a human edit *after* the proposal), and Task 9's dismissal memory blocks re-proposing a rejected value. Build the full version when reviewers report the agent proposing over hand-entered values often enough to be annoying. |
| **Static per-kind task-priority table** (`crm-scout.md` item 20) | `AgentTaskEntity.priority` is stored and ordered on, but every task created this phase uses the caller-supplied or default priority — there is exactly one task kind, so a per-kind table would have one row. Build alongside the two-lane dispatch cut above, when a second kind exists. |

## Risks and unknowns

Named because reading the code could not resolve them — verify at implementation time before trusting the plan's assumption.

**Resolved since the previous revision, kept here so the reasoning is not lost:**

- ~~*`AgentEntity` role/permission resolution for a task-scheduled run is unverified for the "no role assigned" case.*~~ **Resolved by Owner Decision 4 and Task 5b.** The trap was real and worse than described: `roleTarget` is not in `TWENTY_STANDARD_ALL_METADATA_NAME`, so the standard-application pipeline cannot emit an agent→role binding at all, and every shipped role (`admin`, member, guest) sets `canBeAssignedToAgents: false` — so no agent in a fresh workspace has a role today, and `getAgentRoleId()` returning `undefined` means no registry tools, including `record_evidence`. Task 5b seeds a purpose-built agent-assignable role and binds it on first use through `AiAgentRoleService.assignRoleToAgent`, and logs a named warning rather than silently degrading if an admin deletes the role.
- ~~*`cron-register-all.command.ts`'s exact method body was not read in full.*~~ **Resolved.** All 260 lines read; Task 7 Step 13 now carries the three literal edits (import, constructor parameter, `allCommands` entry) against quoted line numbers.
- ~~*`InjectWorkspaceScopedRepository(AgentEntity)` inside a `Scope.REQUEST` queue processor.*~~ **Resolved by reading the entity.** `AgentEntity` is `@Entity('agent')` on the core schema, not a per-workspace-schema entity, so there is nothing workspace-scoped to resolve — Task 7 uses a plain `@InjectRepository(AgentEntity)` with a `workspaceId` column predicate. The earlier draft's `unknown`-typed constructor parameter and its attached design instruction are gone.
- ~~*Workflow → GraphQL wiring for `createAgentTask` over HTTP with a workspace API key.*~~ **Struck** (program §2 C7). That path was never traced end to end and no task builds it. The workflow path is the `create_agent_task` static tool (Task 5c) called from an `AI_AGENT` step; the GraphQL mutation (Task 10) serves humans, admin scripts, and external agents. Nothing in this plan implements or documents an HTTP-request-action path, and nothing should.

- ~~*Whether registry tool generation is scoped by object write permission.*~~ **Resolved by reading `database-tool.provider.ts`.** It is. `:144-146` derives `canUpdateRecords` from the role's object permissions and `:262` guards the whole `create_one_*`/`create_many_*`/`update_one_*`/`update_many_*`/upsert descriptor block with `if (canUpdateRecords && canBeManagedByAutomation)`. A role with `canUpdateAllObjectRecords: false` therefore yields an agent with no write tool at all, which could never reach the gate and never produce a proposal. Task 5b ships `true` with the gate as the write barrier; the deviation from Decision 4's literal *"write-nothing-directly"* phrasing is deliberate and flagged in Task 5b's blockquote. Task 5b Step 1 keeps a one-line grep so a future change to that guard is caught.
- ~~*The exact CLI invocation to run a single cron command once.*~~ **Resolved against `project.json`.** The `command` target is `{"cwd": "packages/twenty-server", "command": "node dist/command/command.js"}`; Nx appends the command name, so `npx nx run twenty-server:command cron:ai-research:agent-task-dispatch` works for any registered nest-commander name — `cron:register:all` is not privileged. Two caveats now written into Task 13 Step 4: it runs `dist/`, so build first or use `ts-node` against `src/command/command.ts`; and a `cron:*` command *registers* the recurring job rather than performing one tick.
- ~~*Whether `claimDueTasks` re-claims a row still marked `LEASED` whose lease expired.*~~ **Resolved — the previous revision's query was wrong and is now fixed.** It filtered `status = PENDING` and checked `leasedUntil` only as a secondary condition, so a crashed worker's row (status `LEASED`, lease expired) matched nothing and was stranded forever, and the "survives retry/restart" exit gate could not have passed. Task 5's `claimDueTasks` now selects on `status = PENDING OR (status = LEASED AND "leasedUntil" < :now)` and re-checks that same predicate inside the conditional UPDATE, preserving the compare-and-swap (a freshly claimed row has a future lease, so a concurrent tick's predicate is false). A new `reapAbandonedTasks()` sweeps rows that exhausted `maxAttempts` while leased to `FAILED`, since those are neither claimable nor terminal. Task 13's lease test no longer rewrites `status` — it only expires the lease, which is what a crash actually leaves — plus two new tests: an unexpired lease must not be re-claimable, and the reaper must close out an exhausted row.
- ~~*`ToolProviderContext.threadId` reaching `record_evidence` through the lazy tool-loading path.*~~ **Resolved by reading the chain end to end.** `createExecuteToolTool`'s `execute()` passes its captured `ToolContext` through unchanged to `toolRegistry.resolveAndExecute(toolName, args, context, …)` (`execute-tool.tool.ts:66-69`); `resolveAndExecute` calls `buildContextFromToolContext`, which copies `threadId` explicitly (`tool-registry.service.ts`); `ActionToolProvider.executeStaticTool` forwards `threadId: context.threadId` into the five-field `ToolExecutionContext` (`action-tool.provider.ts:210-216`). The only break was the source object: `buildLazyRegistryTools` did not set `threadId` on the `ToolContext` it constructs. Task 6 Step 6 adds it, and Task 6 Step 1 now carries a second test covering the lazy strategy specifically, because that is the one Task 7's worker uses.

**Still open — verify at implementation time before trusting the plan's assumption:**

- **`SentryCronMonitor` and the exact `MessageQueueService.add`/`addCron` generic constraints** were taken from one verified example (`messaging-message-list-fetch.cron.job.ts`); no second example was cross-checked, so a required option specific to that file could exist unseen.
- **`@Processor`'s two argument shapes.** Task 7 uses `@Processor(MessageQueue.cronQueue)` for the cron job and `@Processor({ queueName, scope: Scope.REQUEST })` for the worker. Both forms appear in this codebase, but the decorator's overload signatures were not read; confirm against `message-queue/decorators/processor.decorator.ts`.

