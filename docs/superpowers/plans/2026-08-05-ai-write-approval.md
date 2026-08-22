# AI Write Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI-originated writes in SeaRM become human-reviewable proposals instead of applying directly to records.

**Architecture:** A single gate in `ToolExecutorService.dispatch()` — the sole funnel for every AI write (chat, agent runs, MCP, `execute_tool`, workflow AI-agent nodes) plus the `send_email` / `create_calendar_event` tools. A per-workspace JSON policy decides AUTO / PROPOSE / FORBID per object-field or tool. Proposed writes land in two new core-schema entities and are applied later by an approval service running as the approving user, so existing permission enforcement does the authorization work.

**Tech Stack:** NestJS 10, TypeORM, PostgreSQL 16, GraphQL (code-first, metadata schema), React 18 + Jotai + Linaria, Nx, Jest.

**Spec:** `docs/superpowers/specs/2026-08-05-ai-write-approval-design.md`

**Working directory for all paths below:** `d:\Files\Vatsa\Projects\AI-CRM\searm`

## Global Constraints

Copied from the repo's `CLAUDE.md` and the spec. Every task's requirements implicitly include this section.

- **Named exports only.** No default exports anywhere.
- **No `any`.** Strict TypeScript enforced.
- **Types over interfaces**, except when extending a third-party interface.
- **String literal unions over enums**, except GraphQL enums (which must be real TS enums registered with `registerEnumType`).
- **Functional components only** in `searm-front`.
- **File naming:** kebab-case with suffix — `.service.ts`, `.entity.ts`, `.dto.ts`, `.module.ts`, `.resolver.ts`. Front components are PascalCase `.tsx`.
- **Comments:** short-form `//` only, no JSDoc blocks. Explain WHY, not WHAT.
- **Import order:** external libraries, then internal `@/` or `src/`, then relative.
- **Use `isDefined()` from `searm-shared/utils`** rather than hand-rolled null checks.
- **Services under 500 lines, components under 300 lines.**
- **Entity registration is automatic** — `core.datasource.ts` globs `engine/metadata-modules/**/*.entity.{ts,js}`. Do not add entities to any registry list.
- **Schema changes ship as instance commands**, not TypeORM migrations. The TypeORM migration system in this repo is frozen. Generate with `npx nx run searm-server:database:migrate:generate --name <name> --type fast`.
- **Never gate reads.** `find_many`, `find_one`, `group_by` must pass through untouched.
- **Never gate the four deterministic workflow record-crud actions.** Only AI-originated writes are proposed.
- **The gate must return `success: true` for proposed writes.** An agent that reads failure will retry and duplicate.
- Lint and typecheck after each task: `npx nx lint:diff-with-main searm-server` and `npx nx typecheck searm-server`.

## File Structure

**New — server** (all under `packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval/`):

| File | Responsibility |
| --- | --- |
| `entities/proposal.entity.ts` | `ProposalEntity` — the batch envelope |
| `entities/proposal-item.entity.ts` | `ProposalItemEntity` — one proposed action |
| `types/proposal-status.type.ts` | Status and action-type unions + GraphQL enums |
| `types/ai-write-policy.type.ts` | Policy blob shape + key-value type map |
| `services/ai-write-policy.service.ts` | Read/write the policy, resolve a mode for a set of keys |
| `services/proposal-gate.service.ts` | Decide AUTO/PROPOSE/FORBID for a dispatch, capture baseline, write items |
| `services/proposal-execution.service.ts` | Validate-then-apply on approval; reject |
| `dtos/proposal.dto.ts` | GraphQL object types for proposal + item |
| `dtos/approve-proposal.input.ts` | Approve/reject inputs |
| `dtos/ai-write-policy.dto.ts` | Policy DTO + update input |
| `resolvers/proposal.resolver.ts` | `pendingProposals`, `approveProposal`, `rejectProposal` |
| `resolvers/ai-write-policy.resolver.ts` | `aiWritePolicy`, `updateAiWritePolicy` (admin-only) |
| `ai-write-approval.module.ts` | Nest module wiring |

**Modified — server:**

| File | Change |
| --- | --- |
| `engine/core-modules/tool-provider/services/tool-executor.service.ts` | Call the gate at the top of `dispatch()` |
| `engine/core-modules/tool-provider/tool-provider.module.ts` | Import `AiWriteApprovalModule` |
| `engine/metadata-modules/metadata-engine.module.ts` (or the module that aggregates AI modules — confirm at implementation time by finding where `AiAgentExecutionModule` is imported) | Register `AiWriteApprovalModule` |

**New — front:**

| File | Responsibility |
| --- | --- |
| `packages/searm-front/src/pages/settings/ai/SettingsAiApprovals.tsx` | Page shell + route target |
| `packages/searm-front/src/modules/settings/ai-approvals/graphql/queries/pendingProposals.ts` | Query document |
| `packages/searm-front/src/modules/settings/ai-approvals/graphql/mutations/approveProposal.ts` | Mutation documents |
| `packages/searm-front/src/modules/settings/ai-approvals/components/ProposalList.tsx` | Pending proposals list |
| `packages/searm-front/src/modules/settings/ai-approvals/components/ProposalDiffTable.tsx` | Per-item diff + checkboxes + actions |

**Modified — front:** `packages/searm-shared/src/types/SettingsPath.ts`, `packages/searm-front/src/modules/app/components/SettingsRoutes.tsx`.

---

### Task 1: Policy types and resolution service

The policy decides whether a given write is AUTO, PROPOSE, or FORBID. It is stored as one JSON blob per workspace in the existing `keyValuePair` table — no new table, no migration.

**Files:**
- Create: `packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval/types/ai-write-policy.type.ts`
- Create: `packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval/services/ai-write-policy.service.ts`
- Test: `packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval/services/__tests__/ai-write-policy.service.spec.ts`

**Interfaces:**
- Consumes: `KeyValuePairService` from `src/engine/core-modules/key-value-pair/key-value-pair.service`, `KeyValuePairType` from `src/engine/core-modules/key-value-pair/key-value-pair.entity`.
- Produces:
  - `type AiWriteMode = 'AUTO' | 'PROPOSE' | 'FORBID'`
  - `type AiWritePolicy = { default: AiWriteMode; overrides: Record<string, AiWriteMode> }`
  - `AiWritePolicyService.getPolicy(workspaceId: string): Promise<AiWritePolicy>`
  - `AiWritePolicyService.setPolicy(workspaceId: string, policy: AiWritePolicy): Promise<void>`
  - `AiWritePolicyService.resolveMode(policy: AiWritePolicy, keys: string[]): AiWriteMode`

- [ ] **Step 1: Write the types file**

Create `types/ai-write-policy.type.ts`:

```ts
export const AI_WRITE_APPROVAL_POLICY_KEY = 'AI_WRITE_APPROVAL_POLICY';

export type AiWriteMode = 'AUTO' | 'PROPOSE' | 'FORBID';

// One blob per workspace. Override keys are `<objectNameSingular>.<fieldName>`,
// `<objectNameSingular>`, or a static tool id such as `send_email`.
export type AiWritePolicy = {
  default: AiWriteMode;
  overrides: Record<string, AiWriteMode>;
};

export type AiWritePolicyKeyValueTypeMap = {
  [AI_WRITE_APPROVAL_POLICY_KEY]: AiWritePolicy;
};

// Default deny: everything an agent writes is proposed until an admin opts out.
export const DEFAULT_AI_WRITE_POLICY: AiWritePolicy = {
  default: 'PROPOSE',
  overrides: {},
};
```

- [ ] **Step 2: Write the failing test**

Create `services/__tests__/ai-write-policy.service.spec.ts`:

```ts
import { Test, type TestingModule } from '@nestjs/testing';

import { KeyValuePairService } from 'src/engine/core-modules/key-value-pair/key-value-pair.service';
import { AiWritePolicyService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/ai-write-policy.service';
import {
  DEFAULT_AI_WRITE_POLICY,
  type AiWritePolicy,
} from 'src/engine/metadata-modules/ai/ai-write-approval/types/ai-write-policy.type';

describe('AiWritePolicyService', () => {
  let service: AiWritePolicyService;
  const keyValuePairService = { get: jest.fn(), set: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiWritePolicyService,
        { provide: KeyValuePairService, useValue: keyValuePairService },
      ],
    }).compile();

    service = module.get<AiWritePolicyService>(AiWritePolicyService);
  });

  describe('getPolicy', () => {
    it('should return the default policy when nothing is stored', async () => {
      keyValuePairService.get.mockResolvedValue(undefined);

      const policy = await service.getPolicy('workspace-1');

      expect(policy).toEqual(DEFAULT_AI_WRITE_POLICY);
    });

    it('should return the stored policy when one exists', async () => {
      const stored: AiWritePolicy = {
        default: 'AUTO',
        overrides: { 'person.email': 'FORBID' },
      };

      keyValuePairService.get.mockResolvedValue(stored);

      const policy = await service.getPolicy('workspace-1');

      expect(policy).toEqual(stored);
    });
  });

  describe('resolveMode', () => {
    const policy: AiWritePolicy = {
      default: 'PROPOSE',
      overrides: {
        'person.linkedinLink': 'AUTO',
        'person.email': 'FORBID',
        company: 'AUTO',
      },
    };

    it('should fall back to the default when no key matches', () => {
      expect(service.resolveMode(policy, ['person.jobTitle'])).toBe('PROPOSE');
    });

    it('should use an exact override when one matches', () => {
      expect(service.resolveMode(policy, ['person.linkedinLink'])).toBe('AUTO');
    });

    it('should return the most restrictive mode across several keys', () => {
      expect(
        service.resolveMode(policy, ['person.linkedinLink', 'person.email']),
      ).toBe('FORBID');
    });

    it('should prefer PROPOSE over AUTO when keys disagree', () => {
      expect(
        service.resolveMode(policy, ['person.linkedinLink', 'person.jobTitle']),
      ).toBe('PROPOSE');
    });

    it('should return the default when no keys are supplied', () => {
      expect(service.resolveMode(policy, [])).toBe('PROPOSE');
    });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd packages/searm-server && npx jest ai-write-policy.service.spec
```

Expected: FAIL — `Cannot find module '.../ai-write-policy.service'`.

- [ ] **Step 4: Write the service**

Create `services/ai-write-policy.service.ts`:

```ts
import { Injectable } from '@nestjs/common';

import { isDefined } from 'searm-shared/utils';

import { KeyValuePairType } from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { KeyValuePairService } from 'src/engine/core-modules/key-value-pair/key-value-pair.service';
import {
  AI_WRITE_APPROVAL_POLICY_KEY,
  DEFAULT_AI_WRITE_POLICY,
  type AiWriteMode,
  type AiWritePolicy,
  type AiWritePolicyKeyValueTypeMap,
} from 'src/engine/metadata-modules/ai/ai-write-approval/types/ai-write-policy.type';

// Most restrictive mode wins when several keys apply to one write.
const MODE_SEVERITY: Record<AiWriteMode, number> = {
  AUTO: 0,
  PROPOSE: 1,
  FORBID: 2,
};

@Injectable()
export class AiWritePolicyService {
  constructor(
    private readonly keyValuePairService: KeyValuePairService<AiWritePolicyKeyValueTypeMap>,
  ) {}

  async getPolicy(workspaceId: string): Promise<AiWritePolicy> {
    const stored = await this.keyValuePairService.get({
      workspaceId,
      userId: null,
      type: KeyValuePairType.CONFIG_VARIABLE,
      key: AI_WRITE_APPROVAL_POLICY_KEY,
    });

    return isDefined(stored) ? stored : DEFAULT_AI_WRITE_POLICY;
  }

  async setPolicy(workspaceId: string, policy: AiWritePolicy): Promise<void> {
    await this.keyValuePairService.set({
      workspaceId,
      userId: null,
      type: KeyValuePairType.CONFIG_VARIABLE,
      key: AI_WRITE_APPROVAL_POLICY_KEY,
      value: policy,
    });
  }

  resolveMode(policy: AiWritePolicy, keys: string[]): AiWriteMode {
    return keys.reduce<AiWriteMode>((mostRestrictive, key) => {
      const mode = policy.overrides[key] ?? policy.default;

      return MODE_SEVERITY[mode] > MODE_SEVERITY[mostRestrictive]
        ? mode
        : mostRestrictive;
    }, policy.default);
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd packages/searm-server && npx jest ai-write-policy.service.spec
```

Expected: PASS, 7 tests.

If `keyValuePairService.get` rejects the `userId: null` argument on a type level, check the real signature in `src/engine/core-modules/key-value-pair/key-value-pair.service.ts` and match it — the workspace-scoped row is the one with `userId` null.

- [ ] **Step 6: Lint, typecheck, commit**

```bash
npx nx lint:diff-with-main searm-server
npx nx typecheck searm-server
git add packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval
git commit -m "feat(ai-write-approval): add per-workspace AI write policy"
```

---

### Task 2: Proposal entities and schema migration

**Files:**
- Create: `packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval/types/proposal-status.type.ts`
- Create: `packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval/entities/proposal.entity.ts`
- Create: `packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval/entities/proposal-item.entity.ts`
- Create: an instance command (generated — exact path produced by the generator)

**Interfaces:**
- Produces: `ProposalEntity`, `ProposalItemEntity`, `ProposalStatus`, `ProposalItemStatus`, `ProposalActionType`.

- [ ] **Step 1: Write the status types**

Create `types/proposal-status.type.ts`. These are real TS enums because they are exposed through GraphQL in Task 6, which is the documented exception to the string-literal rule:

```ts
export enum ProposalStatus {
  PENDING = 'PENDING',
  APPLIED = 'APPLIED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}

export enum ProposalItemStatus {
  PENDING = 'PENDING',
  APPLIED = 'APPLIED',
  REJECTED = 'REJECTED',
  CONFLICTED = 'CONFLICTED',
  FAILED = 'FAILED',
}

export enum ProposalActionType {
  CREATE_RECORD = 'CREATE_RECORD',
  UPDATE_RECORD = 'UPDATE_RECORD',
  DELETE_RECORD = 'DELETE_RECORD',
  SEND_EMAIL = 'SEND_EMAIL',
  CREATE_CALENDAR_EVENT = 'CREATE_CALENDAR_EVENT',
}

// A pending proposal older than this is treated as expired at read time.
// Computed, not enforced by a cron job.
export const PROPOSAL_TTL_DAYS = 7;
```

- [ ] **Step 2: Write the proposal entity**

Create `entities/proposal.entity.ts`. Pattern copied from `src/engine/metadata-modules/ai/ai-agent-execution/entities/agent-turn.entity.ts`:

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn,
} from 'typeorm';

import { type ActorMetadata } from 'searm-shared/types';

import { ProposalItemEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal-item.entity';
import { ProposalStatus } from 'src/engine/metadata-modules/ai/ai-write-approval/types/proposal-status.type';
import type { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

@Entity({ name: 'proposal', schema: 'core' })
export class ProposalEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: false, type: 'uuid' })
  @Index()
  workspaceId: string;

  @ManyToOne('WorkspaceEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspaceId' })
  workspace: Relation<WorkspaceEntity>;

  @Column({ type: 'varchar', default: ProposalStatus.PENDING })
  @Index()
  status: ProposalStatus;

  @Column({ type: 'jsonb', nullable: true })
  createdByActor: ActorMetadata | null;

  // Correlates every tool call from one agent turn into a single reviewable batch.
  @Column({ type: 'uuid', nullable: true })
  @Index()
  threadId: string | null;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ type: 'timestamptz', nullable: false })
  expiresAt: Date;

  @Column({ type: 'uuid', nullable: true })
  reviewedByUserWorkspaceId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @OneToMany(() => ProposalItemEntity, (item) => item.proposal)
  items: Relation<ProposalItemEntity[]>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
```

- [ ] **Step 3: Write the proposal item entity**

Create `entities/proposal-item.entity.ts`:

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

import { ProposalEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal.entity';
import {
  ProposalActionType,
  ProposalItemStatus,
} from 'src/engine/metadata-modules/ai/ai-write-approval/types/proposal-status.type';

@Entity({ name: 'proposalItem', schema: 'core' })
export class ProposalItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: false, type: 'uuid' })
  @Index()
  proposalId: string;

  @ManyToOne(() => ProposalEntity, (proposal) => proposal.items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'proposalId' })
  proposal: Relation<ProposalEntity>;

  @Column({ type: 'varchar' })
  actionType: ProposalActionType;

  @Column({ type: 'varchar', nullable: true })
  objectNameSingular: string | null;

  @Column({ type: 'uuid', nullable: true })
  recordId: string | null;

  // Proposed values for a record write, or the message payload for a send.
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  payload: Record<string, unknown>;

  // Field values observed when the proposal was created. Re-read at approval
  // time to detect that a human changed the record in the meantime.
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  baseline: Record<string, unknown>;

  @Column({ type: 'varchar', default: ProposalItemStatus.PENDING })
  status: ProposalItemStatus;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'uuid', nullable: true })
  resultRecordId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
```

- [ ] **Step 4: Generate the instance command**

```bash
npx nx run searm-server:database:migrate:generate --name add-ai-write-approval --type fast
```

This writes a new instance command file. Open the generated file and confirm its `up` creates both tables. If the generator produced an empty shell, fill `up` with:

```sql
CREATE TABLE "core"."proposal" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" uuid NOT NULL,
  "status" varchar NOT NULL DEFAULT 'PENDING',
  "createdByActor" jsonb,
  "threadId" uuid,
  "reason" text,
  "expiresAt" timestamptz NOT NULL,
  "reviewedByUserWorkspaceId" uuid,
  "reviewedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "PK_proposal" PRIMARY KEY ("id"),
  CONSTRAINT "FK_proposal_workspace" FOREIGN KEY ("workspaceId")
    REFERENCES "core"."workspace"("id") ON DELETE CASCADE
);
CREATE INDEX "IDX_proposal_workspaceId" ON "core"."proposal" ("workspaceId");
CREATE INDEX "IDX_proposal_status" ON "core"."proposal" ("status");
CREATE INDEX "IDX_proposal_threadId" ON "core"."proposal" ("threadId");

CREATE TABLE "core"."proposalItem" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "proposalId" uuid NOT NULL,
  "actionType" varchar NOT NULL,
  "objectNameSingular" varchar,
  "recordId" uuid,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "baseline" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" varchar NOT NULL DEFAULT 'PENDING',
  "error" text,
  "resultRecordId" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "PK_proposalItem" PRIMARY KEY ("id"),
  CONSTRAINT "FK_proposalItem_proposal" FOREIGN KEY ("proposalId")
    REFERENCES "core"."proposal"("id") ON DELETE CASCADE
);
CREATE INDEX "IDX_proposalItem_proposalId" ON "core"."proposalItem" ("proposalId");
```

And `down` with `DROP TABLE "core"."proposalItem"; DROP TABLE "core"."proposal";`.

Read `packages/searm-server/docs/UPGRADE_COMMANDS.md` before editing the generated file. Never rewrite a committed command's `up`/`down`.

- [ ] **Step 5: Apply and verify the schema**

```bash
npx nx run searm-server:database:migrate:prod
```

Then verify both tables exist using the read-only Postgres MCP server configured in `.mcp.json`, or:

```bash
psql "$PG_DATABASE_URL" -c '\d core."proposal"' -c '\d core."proposalItem"'
```

Expected: both tables present with the columns above.

- [ ] **Step 6: Typecheck and commit**

```bash
npx nx typecheck searm-server
git add packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval packages/searm-server/src/database
git commit -m "feat(ai-write-approval): add proposal and proposal item entities"
```

---

### Task 3: The proposal gate service

Decides what happens to a write and, when the answer is PROPOSE, captures it. This is the heart of the feature.

**Files:**
- Create: `packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval/services/proposal-gate.service.ts`
- Test: `packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval/services/__tests__/proposal-gate.service.spec.ts`

**Interfaces:**
- Consumes: `AiWritePolicyService.getPolicy` / `.resolveMode` (Task 1), `ProposalEntity` / `ProposalItemEntity` (Task 2), `FindRecordsService` from `src/engine/core-modules/record-crud/services/find-records.service`, `buildSystemAuthContext` from `src/engine/searm-orm/utils/build-system-auth-context.util`.
- Produces:
  - `type GateDecision = { kind: 'ALLOW' } | { kind: 'FORBID'; message: string } | { kind: 'PROPOSED'; output: ToolOutput }`
  - `ProposalGateService.evaluate(params: { descriptor: ToolIndexEntry | ToolDescriptor; args: Record<string, unknown>; context: ToolProviderContext }): Promise<GateDecision>`

- [ ] **Step 1: Write the failing test**

Create `services/__tests__/proposal-gate.service.spec.ts`:

```ts
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { FindRecordsService } from 'src/engine/core-modules/record-crud/services/find-records.service';
import { ProposalItemEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal-item.entity';
import { ProposalEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal.entity';
import { AiWritePolicyService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/ai-write-policy.service';
import { ProposalGateService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-gate.service';

const context = {
  workspaceId: 'workspace-1',
  roleId: 'role-1',
  rolePermissionConfig: { unionOf: ['role-1'] },
  threadId: 'thread-1',
} as never;

const updateDescriptor = {
  name: 'update_person',
  category: 'database',
  executionRef: {
    kind: 'database_crud',
    objectNameSingular: 'person',
    operation: 'update_one',
  },
} as never;

const findDescriptor = {
  name: 'find_person',
  category: 'database',
  executionRef: {
    kind: 'database_crud',
    objectNameSingular: 'person',
    operation: 'find_many',
  },
} as never;

describe('ProposalGateService', () => {
  let service: ProposalGateService;

  const policyService = {
    getPolicy: jest.fn(),
    resolveMode: jest.fn(),
  };
  const findRecordsService = { execute: jest.fn() };
  const proposalRepository = { findOne: jest.fn(), save: jest.fn() };
  const proposalItemRepository = { save: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    policyService.getPolicy.mockResolvedValue({
      default: 'PROPOSE',
      overrides: {},
    });
    proposalRepository.findOne.mockResolvedValue(null);
    proposalRepository.save.mockImplementation(async (entity) => ({
      ...entity,
      id: 'proposal-1',
    }));
    proposalItemRepository.save.mockImplementation(async (entity) => ({
      ...entity,
      id: 'item-1',
    }));
    findRecordsService.execute.mockResolvedValue({
      success: true,
      message: 'ok',
      result: { records: [{ id: 'record-1', jobTitle: 'Old title' }] },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProposalGateService,
        { provide: AiWritePolicyService, useValue: policyService },
        { provide: FindRecordsService, useValue: findRecordsService },
        {
          provide: getRepositoryToken(ProposalEntity, 'core'),
          useValue: proposalRepository,
        },
        {
          provide: getRepositoryToken(ProposalItemEntity, 'core'),
          useValue: proposalItemRepository,
        },
      ],
    }).compile();

    service = module.get<ProposalGateService>(ProposalGateService);
  });

  it('should allow reads without consulting the policy', async () => {
    const decision = await service.evaluate({
      descriptor: findDescriptor,
      args: {},
      context,
    });

    expect(decision.kind).toBe('ALLOW');
    expect(policyService.getPolicy).not.toHaveBeenCalled();
  });

  it('should allow a write when the policy resolves to AUTO', async () => {
    policyService.resolveMode.mockReturnValue('AUTO');

    const decision = await service.evaluate({
      descriptor: updateDescriptor,
      args: { id: 'record-1', jobTitle: 'New title' },
      context,
    });

    expect(decision.kind).toBe('ALLOW');
    expect(proposalItemRepository.save).not.toHaveBeenCalled();
  });

  it('should propose a write when the policy resolves to PROPOSE', async () => {
    policyService.resolveMode.mockReturnValue('PROPOSE');

    const decision = await service.evaluate({
      descriptor: updateDescriptor,
      args: { id: 'record-1', jobTitle: 'New title' },
      context,
    });

    expect(decision.kind).toBe('PROPOSED');
    expect(proposalItemRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'UPDATE_RECORD',
        objectNameSingular: 'person',
        recordId: 'record-1',
        payload: { jobTitle: 'New title' },
      }),
    );
  });

  it('should capture the current field values as the baseline', async () => {
    policyService.resolveMode.mockReturnValue('PROPOSE');

    await service.evaluate({
      descriptor: updateDescriptor,
      args: { id: 'record-1', jobTitle: 'New title' },
      context,
    });

    expect(proposalItemRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ baseline: { jobTitle: 'Old title' } }),
    );
  });

  it('should return a success-shaped output so the agent does not retry', async () => {
    policyService.resolveMode.mockReturnValue('PROPOSE');

    const decision = await service.evaluate({
      descriptor: updateDescriptor,
      args: { id: 'record-1', jobTitle: 'New title' },
      context,
    });

    if (decision.kind !== 'PROPOSED') {
      throw new Error('expected a proposed decision');
    }

    expect(decision.output.success).toBe(true);
    expect(decision.output.message).toContain('awaiting human approval');
  });

  it('should reuse one pending proposal for every call in the same thread', async () => {
    policyService.resolveMode.mockReturnValue('PROPOSE');
    proposalRepository.findOne.mockResolvedValue({ id: 'proposal-existing' });

    await service.evaluate({
      descriptor: updateDescriptor,
      args: { id: 'record-1', jobTitle: 'New title' },
      context,
    });

    expect(proposalRepository.save).not.toHaveBeenCalled();
    expect(proposalItemRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: 'proposal-existing' }),
    );
  });

  it('should resolve policy keys from the data envelope of a bulk update', async () => {
    policyService.resolveMode.mockReturnValue('PROPOSE');

    const updateManyDescriptor = {
      name: 'update_many_person',
      category: 'database',
      executionRef: {
        kind: 'database_crud',
        objectNameSingular: 'person',
        operation: 'update_many',
      },
    } as never;

    await service.evaluate({
      descriptor: updateManyDescriptor,
      args: { filter: { city: { eq: 'Berlin' } }, data: { jobTitle: 'Lead' } },
      context,
    });

    expect(policyService.resolveMode).toHaveBeenCalledWith(expect.anything(), [
      'person',
      'person.jobTitle',
    ]);
  });

  it('should forbid a write when the policy resolves to FORBID', async () => {
    policyService.resolveMode.mockReturnValue('FORBID');

    const decision = await service.evaluate({
      descriptor: updateDescriptor,
      args: { id: 'record-1', jobTitle: 'New title' },
      context,
    });

    expect(decision.kind).toBe('FORBID');
    expect(proposalItemRepository.save).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/searm-server && npx jest proposal-gate.service.spec
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the service**

Create `services/proposal-gate.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isDefined } from 'searm-shared/utils';
import { Repository } from 'typeorm';

import { FindRecordsService } from 'src/engine/core-modules/record-crud/services/find-records.service';
import { type ToolProviderContext } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider-context.type';
import { type ToolDescriptor } from 'src/engine/core-modules/tool-provider/types/tool-descriptor.type';
import { type ToolIndexEntry } from 'src/engine/core-modules/tool-provider/types/tool-index-entry.type';
import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';
import { ProposalItemEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal-item.entity';
import { ProposalEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal.entity';
import { AiWritePolicyService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/ai-write-policy.service';
import {
  PROPOSAL_TTL_DAYS,
  ProposalActionType,
  ProposalItemStatus,
  ProposalStatus,
} from 'src/engine/metadata-modules/ai/ai-write-approval/types/proposal-status.type';
import { buildSystemAuthContext } from 'src/engine/searm-orm/utils/build-system-auth-context.util';

export type GateDecision =
  | { kind: 'ALLOW' }
  | { kind: 'FORBID'; message: string }
  | { kind: 'PROPOSED'; output: ToolOutput };

// Reads are never gated. Everything else that mutates is.
const GATED_CRUD_OPERATIONS = [
  'create_one',
  'create_many',
  'update_one',
  'update_many',
  'upsert_many',
  'delete_one',
  'delete_many',
] as const;

// Static tools with side effects outside the CRM.
const GATED_STATIC_TOOL_IDS = ['send_email', 'create_calendar_event'] as const;

const CRUD_OPERATION_TO_ACTION_TYPE: Record<string, ProposalActionType> = {
  create_one: ProposalActionType.CREATE_RECORD,
  create_many: ProposalActionType.CREATE_RECORD,
  update_one: ProposalActionType.UPDATE_RECORD,
  update_many: ProposalActionType.UPDATE_RECORD,
  upsert_many: ProposalActionType.CREATE_RECORD,
  delete_one: ProposalActionType.DELETE_RECORD,
  delete_many: ProposalActionType.DELETE_RECORD,
};

const STATIC_TOOL_ID_TO_ACTION_TYPE: Record<string, ProposalActionType> = {
  send_email: ProposalActionType.SEND_EMAIL,
  create_calendar_event: ProposalActionType.CREATE_CALENDAR_EVENT,
};

@Injectable()
export class ProposalGateService {
  private readonly logger = new Logger(ProposalGateService.name);

  constructor(
    private readonly aiWritePolicyService: AiWritePolicyService,
    private readonly findRecordsService: FindRecordsService,
    @InjectRepository(ProposalEntity, 'core')
    private readonly proposalRepository: Repository<ProposalEntity>,
    @InjectRepository(ProposalItemEntity, 'core')
    private readonly proposalItemRepository: Repository<ProposalItemEntity>,
  ) {}

  async evaluate(params: {
    descriptor: ToolIndexEntry | ToolDescriptor;
    args: Record<string, unknown>;
    context: ToolProviderContext;
  }): Promise<GateDecision> {
    const { descriptor, args, context } = params;
    const { executionRef } = descriptor;

    const gateInput = this.buildGateInput(executionRef, args);

    if (!isDefined(gateInput)) {
      return { kind: 'ALLOW' };
    }

    const policy = await this.aiWritePolicyService.getPolicy(
      context.workspaceId,
    );
    const mode = this.aiWritePolicyService.resolveMode(policy, gateInput.keys);

    if (mode === 'AUTO') {
      return { kind: 'ALLOW' };
    }

    if (mode === 'FORBID') {
      return {
        kind: 'FORBID',
        message: `This workspace does not permit AI to perform "${descriptor.name}". Ask a workspace admin to change the AI write policy.`,
      };
    }

    const baseline = await this.readBaseline({
      objectNameSingular: gateInput.objectNameSingular,
      recordId: gateInput.recordId,
      fieldNames: Object.keys(gateInput.payload),
      context,
    });

    const proposal = await this.getOrCreatePendingProposal(context);

    const item = await this.proposalItemRepository.save({
      proposalId: proposal.id,
      actionType: gateInput.actionType,
      objectNameSingular: gateInput.objectNameSingular,
      recordId: gateInput.recordId,
      payload: gateInput.payload,
      baseline,
      status: ProposalItemStatus.PENDING,
    });

    return {
      kind: 'PROPOSED',
      output: {
        success: true,
        message:
          'Change proposed and awaiting human approval. Do not retry this write.',
        result: {
          proposalId: proposal.id,
          proposalItemId: item.id,
          status: ProposalItemStatus.PENDING,
        },
      },
    };
  }

  private buildGateInput(
    executionRef: ToolIndexEntry['executionRef'],
    args: Record<string, unknown>,
  ): {
    keys: string[];
    actionType: ProposalActionType;
    objectNameSingular: string | null;
    recordId: string | null;
    payload: Record<string, unknown>;
  } | null {
    if (executionRef.kind === 'database_crud') {
      const isGated = GATED_CRUD_OPERATIONS.some(
        (operation) => operation === executionRef.operation,
      );

      if (!isGated) {
        return null;
      }

      const objectNameSingular = executionRef.objectNameSingular;
      const { id, ...rest } = args;

      // Bulk operations wrap their fields differently: update_many takes
      // { filter, data }, create_many/upsert_many take { records }. Unwrap so
      // policy keys are real field names, not the envelope's own keys.
      const payload = this.extractPayload(executionRef.operation, rest);

      const fieldKeys = Object.keys(payload).map(
        (fieldName) => `${objectNameSingular}.${fieldName}`,
      );

      return {
        keys: [objectNameSingular, ...fieldKeys],
        actionType: CRUD_OPERATION_TO_ACTION_TYPE[executionRef.operation],
        objectNameSingular,
        recordId: typeof id === 'string' ? id : null,
        payload,
      };
    }

    if (executionRef.kind === 'static') {
      const isGated = GATED_STATIC_TOOL_IDS.some(
        (toolId) => toolId === executionRef.toolId,
      );

      if (!isGated) {
        return null;
      }

      return {
        keys: [executionRef.toolId],
        actionType: STATIC_TOOL_ID_TO_ACTION_TYPE[executionRef.toolId],
        objectNameSingular: null,
        recordId: null,
        payload: args,
      };
    }

    return null;
  }

  // update_many wraps its fields in `data`; create_many and upsert_many wrap
  // an array of records. Everything else is already a flat field map.
  private extractPayload(
    operation: string,
    args: Record<string, unknown>,
  ): Record<string, unknown> {
    if (operation === 'update_many') {
      const data = args.data;

      return typeof data === 'object' && data !== null
        ? (data as Record<string, unknown>)
        : {};
    }

    if (operation === 'create_many' || operation === 'upsert_many') {
      const records = args.records;

      if (!Array.isArray(records)) {
        return {};
      }

      // Union of every record's fields, so one risky field anywhere in the
      // batch still resolves the policy for the whole write.
      return Object.fromEntries(
        records.flatMap((record) =>
          typeof record === 'object' && record !== null
            ? Object.entries(record as Record<string, unknown>)
            : [],
        ),
      );
    }

    if (operation === 'delete_many') {
      return {};
    }

    return args;
  }

  // Reads the fields the write would change, so approval can detect that a
  // human edited them in the meantime. Uses the agent's own role config, so a
  // field the agent cannot read never lands in the baseline.
  private async readBaseline(params: {
    objectNameSingular: string | null;
    recordId: string | null;
    fieldNames: string[];
    context: ToolProviderContext;
  }): Promise<Record<string, unknown>> {
    const { objectNameSingular, recordId, fieldNames, context } = params;

    if (
      !isDefined(objectNameSingular) ||
      !isDefined(recordId) ||
      fieldNames.length === 0
    ) {
      return {};
    }

    const output = await this.findRecordsService.execute({
      objectName: objectNameSingular,
      filter: { id: { eq: recordId } },
      limit: 1,
      select: fieldNames,
      shouldBuildEffectiveSelectFields: true,
      authContext: buildSystemAuthContext(context.workspaceId),
      rolePermissionConfig: context.rolePermissionConfig,
    });

    if (!output.success) {
      this.logger.warn(
        `Could not read baseline for ${objectNameSingular}:${recordId} — ${output.error}`,
      );

      return {};
    }

    const records = (output.result as { records?: Record<string, unknown>[] })
      ?.records;
    const record = records?.[0];

    if (!isDefined(record)) {
      return {};
    }

    return Object.fromEntries(
      fieldNames.map((fieldName) => [fieldName, record[fieldName]]),
    );
  }

  // One agent turn produces one reviewable batch rather than one proposal per
  // tool call. Falls back to a fresh proposal when there is no thread to key on.
  private async getOrCreatePendingProposal(
    context: ToolProviderContext,
  ): Promise<ProposalEntity> {
    if (isDefined(context.threadId)) {
      const existing = await this.proposalRepository.findOne({
        where: {
          workspaceId: context.workspaceId,
          threadId: context.threadId,
          status: ProposalStatus.PENDING,
        },
      });

      if (isDefined(existing)) {
        return existing;
      }
    }

    const expiresAt = new Date();

    expiresAt.setDate(expiresAt.getDate() + PROPOSAL_TTL_DAYS);

    return this.proposalRepository.save({
      workspaceId: context.workspaceId,
      threadId: context.threadId ?? null,
      createdByActor: context.actorContext ?? null,
      status: ProposalStatus.PENDING,
      expiresAt,
    });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd packages/searm-server && npx jest proposal-gate.service.spec
```

Expected: PASS, 7 tests.

If the `getRepositoryToken(Entity, 'core')` connection name is wrong, find the correct one by grepping an existing metadata-module service for `@InjectRepository(` and matching its second argument.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npx nx lint:diff-with-main searm-server
npx nx typecheck searm-server
git add packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval
git commit -m "feat(ai-write-approval): add proposal gate service"
```

---

### Task 4: Wire the gate into the tool executor

Three lines in one method. This is where the feature becomes real — and where a mistake breaks every AI feature in the product, so the regression suite matters more than the new test.

**Files:**
- Modify: `packages/searm-server/src/engine/core-modules/tool-provider/services/tool-executor.service.ts` (the `dispatch` method, lines 62-85)
- Modify: `packages/searm-server/src/engine/core-modules/tool-provider/tool-provider.module.ts`
- Create: `packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval/ai-write-approval.module.ts`
- Test: `packages/searm-server/src/engine/core-modules/tool-provider/services/__tests__/tool-executor-gate.spec.ts`

**Interfaces:**
- Consumes: `ProposalGateService.evaluate` (Task 3).
- Produces: gated `ToolExecutorService.dispatch` — signature unchanged.

- [ ] **Step 1: Write the module**

Create `ai-write-approval.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { KeyValuePairModule } from 'src/engine/core-modules/key-value-pair/key-value-pair.module';
import { RecordCrudModule } from 'src/engine/core-modules/record-crud/record-crud.module';
import { ProposalItemEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal-item.entity';
import { ProposalEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal.entity';
import { AiWritePolicyService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/ai-write-policy.service';
import { ProposalGateService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-gate.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProposalEntity, ProposalItemEntity], 'core'),
    KeyValuePairModule,
    RecordCrudModule,
  ],
  providers: [AiWritePolicyService, ProposalGateService],
  exports: [AiWritePolicyService, ProposalGateService],
})
export class AiWriteApprovalModule {}
```

Confirm the `KeyValuePairModule` and `RecordCrudModule` import paths and that each exports the service you need. If `RecordCrudModule` importing `ToolProviderModule` would create a circular dependency, break it with `forwardRef(() => ...)` on the `ToolProviderModule` side.

- [ ] **Step 2: Write the failing test**

Create `services/__tests__/tool-executor-gate.spec.ts`. Mock every record-crud service the executor injects — the point is proving the gate short-circuits before any of them are reached:

```ts
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { LogicFunctionExecutorService } from 'src/engine/core-modules/logic-function/logic-function-executor/logic-function-executor.service';
import { CreateManyRecordsService } from 'src/engine/core-modules/record-crud/services/create-many-records.service';
import { CreateRecordService } from 'src/engine/core-modules/record-crud/services/create-record.service';
import { DeleteManyRecordsService } from 'src/engine/core-modules/record-crud/services/delete-many-records.service';
import { DeleteRecordService } from 'src/engine/core-modules/record-crud/services/delete-record.service';
import { FindRecordsService } from 'src/engine/core-modules/record-crud/services/find-records.service';
import { GroupByRecordsService } from 'src/engine/core-modules/record-crud/services/group-by-records.service';
import { UpdateManyRecordsService } from 'src/engine/core-modules/record-crud/services/update-many-records.service';
import { UpdateRecordService } from 'src/engine/core-modules/record-crud/services/update-record.service';
import { UpsertManyRecordsService } from 'src/engine/core-modules/record-crud/services/upsert-many-records.service';
import { TOOL_PROVIDERS } from 'src/engine/core-modules/tool-provider/constants/tool-providers.token';
import { ToolExecutorService } from 'src/engine/core-modules/tool-provider/services/tool-executor.service';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { ProposalGateService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-gate.service';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

const context = {
  workspaceId: 'workspace-1',
  roleId: 'role-1',
  rolePermissionConfig: { unionOf: ['role-1'] },
  authContext: { type: 'system', workspace: { id: 'workspace-1' } },
} as never;

const updateDescriptor = {
  name: 'update_person',
  category: 'database',
  executionRef: {
    kind: 'database_crud',
    objectNameSingular: 'person',
    operation: 'update_one',
  },
} as never;

const findDescriptor = {
  name: 'find_person',
  category: 'database',
  executionRef: {
    kind: 'database_crud',
    objectNameSingular: 'person',
    operation: 'find_many',
  },
} as never;

describe('ToolExecutorService gating', () => {
  let service: ToolExecutorService;

  const gateService = { evaluate: jest.fn() };
  const updateRecordService = { execute: jest.fn() };
  const findRecordsService = { execute: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    updateRecordService.execute.mockResolvedValue({
      success: true,
      message: 'updated',
    });
    findRecordsService.execute.mockResolvedValue({
      success: true,
      message: 'found',
    });

    const stub = { execute: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ToolExecutorService,
        { provide: TOOL_PROVIDERS, useValue: [] },
        { provide: ProposalGateService, useValue: gateService },
        { provide: UpdateRecordService, useValue: updateRecordService },
        { provide: FindRecordsService, useValue: findRecordsService },
        { provide: GroupByRecordsService, useValue: stub },
        { provide: CreateRecordService, useValue: stub },
        { provide: CreateManyRecordsService, useValue: stub },
        { provide: UpdateManyRecordsService, useValue: stub },
        { provide: UpsertManyRecordsService, useValue: stub },
        { provide: DeleteRecordService, useValue: stub },
        { provide: DeleteManyRecordsService, useValue: stub },
        { provide: LogicFunctionExecutorService, useValue: stub },
        { provide: WorkspaceCacheService, useValue: { getOrRecompute: jest.fn() } },
        { provide: getRepositoryToken(UserEntity, 'core'), useValue: { findOne: jest.fn() } },
      ],
    }).compile();

    service = module.get<ToolExecutorService>(ToolExecutorService);
  });

  it('should execute the write when the gate allows it', async () => {
    gateService.evaluate.mockResolvedValue({ kind: 'ALLOW' });

    await service.dispatch(
      updateDescriptor,
      { id: 'record-1', jobTitle: 'New title' },
      context,
    );

    expect(updateRecordService.execute).toHaveBeenCalled();
  });

  it('should not execute the write when the gate proposes it', async () => {
    const proposedOutput = {
      success: true,
      message: 'Change proposed and awaiting human approval.',
      result: { proposalId: 'proposal-1' },
    };

    gateService.evaluate.mockResolvedValue({
      kind: 'PROPOSED',
      output: proposedOutput,
    });

    const result = await service.dispatch(
      updateDescriptor,
      { id: 'record-1', jobTitle: 'New title' },
      context,
    );

    expect(updateRecordService.execute).not.toHaveBeenCalled();
    expect(result).toEqual(proposedOutput);
  });

  it('should return an error output when the gate forbids the write', async () => {
    gateService.evaluate.mockResolvedValue({
      kind: 'FORBID',
      message: 'Not permitted',
    });

    const result = await service.dispatch(
      updateDescriptor,
      { id: 'record-1', jobTitle: 'New title' },
      context,
    );

    expect(updateRecordService.execute).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toBe('Not permitted');
  });

  it('should still execute reads', async () => {
    gateService.evaluate.mockResolvedValue({ kind: 'ALLOW' });

    await service.dispatch(findDescriptor, {}, context);

    expect(findRecordsService.execute).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd packages/searm-server && npx jest tool-executor-gate.spec
```

Expected: FAIL — Nest cannot resolve `ProposalGateService` for `ToolExecutorService`.

- [ ] **Step 4: Wire the gate**

In `tool-executor.service.ts`, add the import:

```ts
import { ProposalGateService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-gate.service';
```

Add to the constructor parameter list (after `providers`):

```ts
    private readonly proposalGateService: ProposalGateService,
```

Replace the body of `dispatch` (lines 62-85) with:

```ts
  async dispatch(
    descriptor: ToolIndexEntry | ToolDescriptor,
    args: Record<string, unknown> | undefined,
    context: ToolProviderContext,
  ): Promise<ToolOutput> {
    const safeArgs = args ?? {};

    // Every AI write in the product funnels through here, so the approval gate
    // sits above the tool layer — a new write tool is gated by default.
    const decision = await this.proposalGateService.evaluate({
      descriptor,
      args: safeArgs,
      context,
    });

    if (decision.kind === 'PROPOSED') {
      return decision.output;
    }

    if (decision.kind === 'FORBID') {
      return {
        success: false,
        message: decision.message,
        error: decision.message,
      };
    }

    switch (descriptor.executionRef.kind) {
      case 'database_crud':
        return this.dispatchDatabaseCrud(
          descriptor.executionRef,
          safeArgs,
          context,
        );
      case 'static':
        return this.dispatchStaticTool(descriptor, safeArgs, context);
      case 'logic_function':
        return this.dispatchLogicFunction(
          descriptor.executionRef,
          safeArgs,
          context,
        );
    }
  }
```

In `tool-provider.module.ts`, add `AiWriteApprovalModule` to the `imports` array.

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd packages/searm-server && npx jest tool-executor-gate.spec
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Run the surrounding suites for regressions**

```bash
cd packages/searm-server && npx jest tool-provider
cd packages/searm-server && npx jest tool-executor
```

Expected: PASS. Existing `ToolExecutorService` tests that construct the service directly will now fail on the missing constructor argument — add a `ProposalGateService` mock returning `{ kind: 'ALLOW' }` to each.

- [ ] **Step 7: Lint, typecheck, commit**

```bash
npx nx lint:diff-with-main searm-server
npx nx typecheck searm-server
git add packages/searm-server/src/engine
git commit -m "feat(ai-write-approval): gate AI writes in the tool executor"
```

---

### Task 5: Approval execution service

Validate every selected item, abort the whole batch if any conflict, then apply sequentially as the approving user.

**Files:**
- Create: `packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval/services/proposal-execution.service.ts`
- Modify: `packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval/ai-write-approval.module.ts`
- Test: `packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval/services/__tests__/proposal-execution.service.spec.ts`

**Interfaces:**
- Consumes: `ProposalEntity` / `ProposalItemEntity` (Task 2), `FindRecordsService`, `CreateRecordService`, `UpdateRecordService`, `DeleteRecordService` from `src/engine/core-modules/record-crud/services/`, `UserRoleService` from `src/engine/metadata-modules/user-role/user-role.service`.
- Produces:
  - `type ApprovalResult = { proposalId: string; appliedItemIds: string[]; conflictedItemIds: string[]; failedItemIds: string[]; aborted: boolean }`
  - `ProposalExecutionService.approve(params: { proposalId: string; selectedItemIds: string[]; workspaceId: string; approverUserWorkspaceId: string }): Promise<ApprovalResult>`
  - `ProposalExecutionService.reject(params: { proposalId: string; workspaceId: string; approverUserWorkspaceId: string }): Promise<ApprovalResult>`

- [ ] **Step 1: Write the failing test**

Create `services/__tests__/proposal-execution.service.spec.ts`:

```ts
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { CreateRecordService } from 'src/engine/core-modules/record-crud/services/create-record.service';
import { DeleteRecordService } from 'src/engine/core-modules/record-crud/services/delete-record.service';
import { FindRecordsService } from 'src/engine/core-modules/record-crud/services/find-records.service';
import { UpdateRecordService } from 'src/engine/core-modules/record-crud/services/update-record.service';
import { CreateCalendarEventTool } from 'src/engine/core-modules/tool/tools/calendar-tool/create-calendar-event-tool';
import { SendEmailTool } from 'src/engine/core-modules/tool/tools/email-tool/send-email-tool';
import { ProposalItemEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal-item.entity';
import { ProposalEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal.entity';
import { ProposalExecutionService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-execution.service';
import { UserRoleService } from 'src/engine/metadata-modules/user-role/user-role.service';

const buildItem = (overrides: Record<string, unknown> = {}) => ({
  id: 'item-1',
  proposalId: 'proposal-1',
  actionType: 'UPDATE_RECORD',
  objectNameSingular: 'person',
  recordId: 'record-1',
  payload: { jobTitle: 'New title' },
  baseline: { jobTitle: 'Old title' },
  status: 'PENDING',
  ...overrides,
});

describe('ProposalExecutionService', () => {
  let service: ProposalExecutionService;

  const proposalRepository = { findOne: jest.fn(), save: jest.fn() };
  const proposalItemRepository = { find: jest.fn(), save: jest.fn() };
  const findRecordsService = { execute: jest.fn() };
  const updateRecordService = { execute: jest.fn() };
  const createRecordService = { execute: jest.fn() };
  const deleteRecordService = { execute: jest.fn() };
  const userRoleService = { getRoleIdForUserWorkspace: jest.fn() };
  const sendEmailTool = { execute: jest.fn() };
  const createCalendarEventTool = { execute: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    proposalRepository.findOne.mockResolvedValue({
      id: 'proposal-1',
      workspaceId: 'workspace-1',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 86400000),
    });
    proposalRepository.save.mockImplementation(async (entity) => entity);
    proposalItemRepository.save.mockImplementation(async (entity) => entity);
    userRoleService.getRoleIdForUserWorkspace.mockResolvedValue('role-1');
    updateRecordService.execute.mockResolvedValue({
      success: true,
      message: 'updated',
    });
    findRecordsService.execute.mockResolvedValue({
      success: true,
      message: 'ok',
      result: { records: [{ id: 'record-1', jobTitle: 'Old title' }] },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProposalExecutionService,
        { provide: FindRecordsService, useValue: findRecordsService },
        { provide: UpdateRecordService, useValue: updateRecordService },
        { provide: CreateRecordService, useValue: createRecordService },
        { provide: DeleteRecordService, useValue: deleteRecordService },
        { provide: UserRoleService, useValue: userRoleService },
        { provide: SendEmailTool, useValue: sendEmailTool },
        { provide: CreateCalendarEventTool, useValue: createCalendarEventTool },
        {
          provide: getRepositoryToken(ProposalEntity, 'core'),
          useValue: proposalRepository,
        },
        {
          provide: getRepositoryToken(ProposalItemEntity, 'core'),
          useValue: proposalItemRepository,
        },
      ],
    }).compile();

    service = module.get<ProposalExecutionService>(ProposalExecutionService);
  });

  const approve = (selectedItemIds: string[]) =>
    service.approve({
      proposalId: 'proposal-1',
      selectedItemIds,
      workspaceId: 'workspace-1',
      approverUserWorkspaceId: 'user-workspace-1',
    });

  it('should apply a selected item whose baseline still matches', async () => {
    proposalItemRepository.find.mockResolvedValue([buildItem()]);

    const result = await approve(['item-1']);

    expect(updateRecordService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        objectName: 'person',
        objectRecordId: 'record-1',
        objectRecord: { jobTitle: 'New title' },
      }),
    );
    expect(result.appliedItemIds).toEqual(['item-1']);
    expect(result.aborted).toBe(false);
  });

  it('should apply as the approver, not as the agent', async () => {
    proposalItemRepository.find.mockResolvedValue([buildItem()]);

    await approve(['item-1']);

    expect(updateRecordService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        rolePermissionConfig: { unionOf: ['role-1'] },
      }),
    );
  });

  it('should abort the whole batch when any baseline changed', async () => {
    proposalItemRepository.find.mockResolvedValue([
      buildItem(),
      buildItem({ id: 'item-2' }),
    ]);
    findRecordsService.execute.mockResolvedValue({
      success: true,
      message: 'ok',
      result: { records: [{ id: 'record-1', jobTitle: 'Human edited this' }] },
    });

    const result = await approve(['item-1', 'item-2']);

    expect(updateRecordService.execute).not.toHaveBeenCalled();
    expect(result.aborted).toBe(true);
    expect(result.conflictedItemIds).toEqual(['item-1', 'item-2']);
  });

  it('should reject items the reviewer did not select', async () => {
    proposalItemRepository.find.mockResolvedValue([
      buildItem(),
      buildItem({ id: 'item-2' }),
    ]);

    await approve(['item-1']);

    expect(proposalItemRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'item-2', status: 'REJECTED' }),
    );
  });

  it('should mark an item FAILED when its write fails', async () => {
    proposalItemRepository.find.mockResolvedValue([buildItem()]);
    updateRecordService.execute.mockResolvedValue({
      success: false,
      message: 'permission denied',
      error: 'permission denied',
    });

    const result = await approve(['item-1']);

    expect(result.failedItemIds).toEqual(['item-1']);
    expect(result.appliedItemIds).toEqual([]);
  });

  it('should apply record writes before outbound sends', async () => {
    const applyOrder: string[] = [];

    updateRecordService.execute.mockImplementation(async () => {
      applyOrder.push('record');

      return { success: true, message: 'updated' };
    });
    sendEmailTool.execute.mockImplementation(async () => {
      applyOrder.push('email');

      return { success: true, message: 'sent' };
    });

    proposalItemRepository.find.mockResolvedValue([
      buildItem({
        id: 'item-email',
        actionType: 'SEND_EMAIL',
        objectNameSingular: null,
        recordId: null,
        baseline: {},
        payload: { to: 'a@example.com', subject: 'Hi', body: 'Hello' },
      }),
      buildItem({ id: 'item-record' }),
    ]);

    await approve(['item-email', 'item-record']);

    expect(applyOrder).toEqual(['record', 'email']);
  });

  it('should refuse to approve an expired proposal', async () => {
    proposalRepository.findOne.mockResolvedValue({
      id: 'proposal-1',
      workspaceId: 'workspace-1',
      status: 'PENDING',
      expiresAt: new Date(Date.now() - 86400000),
    });
    proposalItemRepository.find.mockResolvedValue([buildItem()]);

    const result = await approve(['item-1']);

    expect(result.aborted).toBe(true);
    expect(updateRecordService.execute).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/searm-server && npx jest proposal-execution.service.spec
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the service**

Create `services/proposal-execution.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isDefined } from 'searm-shared/utils';
import { In, Repository } from 'typeorm';

import { CreateRecordService } from 'src/engine/core-modules/record-crud/services/create-record.service';
import { DeleteRecordService } from 'src/engine/core-modules/record-crud/services/delete-record.service';
import { FindRecordsService } from 'src/engine/core-modules/record-crud/services/find-records.service';
import { UpdateRecordService } from 'src/engine/core-modules/record-crud/services/update-record.service';
import { CreateCalendarEventTool } from 'src/engine/core-modules/tool/tools/calendar-tool/create-calendar-event-tool';
import { SendEmailTool } from 'src/engine/core-modules/tool/tools/email-tool/send-email-tool';
import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';
import { ProposalItemEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal-item.entity';
import { ProposalEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal.entity';
import {
  ProposalActionType,
  ProposalItemStatus,
  ProposalStatus,
} from 'src/engine/metadata-modules/ai/ai-write-approval/types/proposal-status.type';
import { UserRoleService } from 'src/engine/metadata-modules/user-role/user-role.service';
import { type RolePermissionConfig } from 'src/engine/searm-orm/types/role-permission-config';
import { buildSystemAuthContext } from 'src/engine/searm-orm/utils/build-system-auth-context.util';

export type ApprovalResult = {
  proposalId: string;
  appliedItemIds: string[];
  conflictedItemIds: string[];
  failedItemIds: string[];
  aborted: boolean;
};

@Injectable()
export class ProposalExecutionService {
  private readonly logger = new Logger(ProposalExecutionService.name);

  constructor(
    private readonly findRecordsService: FindRecordsService,
    private readonly createRecordService: CreateRecordService,
    private readonly updateRecordService: UpdateRecordService,
    private readonly deleteRecordService: DeleteRecordService,
    private readonly userRoleService: UserRoleService,
    private readonly sendEmailTool: SendEmailTool,
    private readonly createCalendarEventTool: CreateCalendarEventTool,
    @InjectRepository(ProposalEntity, 'core')
    private readonly proposalRepository: Repository<ProposalEntity>,
    @InjectRepository(ProposalItemEntity, 'core')
    private readonly proposalItemRepository: Repository<ProposalItemEntity>,
  ) {}

  async approve(params: {
    proposalId: string;
    selectedItemIds: string[];
    workspaceId: string;
    approverUserWorkspaceId: string;
  }): Promise<ApprovalResult> {
    const { proposalId, selectedItemIds, workspaceId, approverUserWorkspaceId } =
      params;

    const proposal = await this.proposalRepository.findOne({
      where: { id: proposalId, workspaceId },
    });

    if (!isDefined(proposal) || proposal.status !== ProposalStatus.PENDING) {
      return this.emptyResult(proposalId, true);
    }

    if (proposal.expiresAt.getTime() < Date.now()) {
      await this.proposalRepository.save({
        ...proposal,
        status: ProposalStatus.EXPIRED,
      });

      return this.emptyResult(proposalId, true);
    }

    const items = await this.proposalItemRepository.find({
      where: { proposalId },
    });
    const selectedItems = items.filter((item) =>
      selectedItemIds.includes(item.id),
    );

    // Validate every selected item before writing anything. One stale baseline
    // aborts the batch — a partially applied change set is worse than none.
    const conflictedItemIds: string[] = [];

    for (const item of selectedItems) {
      const hasConflict = await this.hasBaselineConflict(item, workspaceId);

      if (hasConflict) {
        conflictedItemIds.push(item.id);
      }
    }

    if (conflictedItemIds.length > 0) {
      await this.proposalItemRepository.save(
        selectedItems.map((item) => ({
          ...item,
          status: ProposalItemStatus.CONFLICTED,
        })),
      );

      return {
        proposalId,
        appliedItemIds: [],
        conflictedItemIds: selectedItems.map((item) => item.id),
        failedItemIds: [],
        aborted: true,
      };
    }

    const roleId = await this.userRoleService.getRoleIdForUserWorkspace({
      userWorkspaceId: approverUserWorkspaceId,
      workspaceId,
    });

    const rolePermissionConfig: RolePermissionConfig = { unionOf: [roleId] };
    const appliedItemIds: string[] = [];
    const failedItemIds: string[] = [];

    // Record writes first. An outbound send cannot be undone, so it must never
    // fire ahead of a record write that might still fail.
    const isOutboundSend = (item: ProposalItemEntity) =>
      item.actionType === ProposalActionType.SEND_EMAIL ||
      item.actionType === ProposalActionType.CREATE_CALENDAR_EVENT;

    const orderedItems = [
      ...selectedItems.filter((item) => !isOutboundSend(item)),
      ...selectedItems.filter(isOutboundSend),
    ];

    for (const item of orderedItems) {
      const output = await this.applyItem(
        item,
        workspaceId,
        rolePermissionConfig,
        approverUserWorkspaceId,
      );

      if (output.success) {
        appliedItemIds.push(item.id);
        await this.proposalItemRepository.save({
          ...item,
          status: ProposalItemStatus.APPLIED,
        });
      } else {
        failedItemIds.push(item.id);
        await this.proposalItemRepository.save({
          ...item,
          status: ProposalItemStatus.FAILED,
          error: output.error ?? output.message,
        });
      }
    }

    const unselectedItems = items.filter(
      (item) => !selectedItemIds.includes(item.id),
    );

    for (const item of unselectedItems) {
      await this.proposalItemRepository.save({
        ...item,
        status: ProposalItemStatus.REJECTED,
      });
    }

    await this.proposalRepository.save({
      ...proposal,
      status: ProposalStatus.APPLIED,
      reviewedByUserWorkspaceId: approverUserWorkspaceId,
      reviewedAt: new Date(),
    });

    return {
      proposalId,
      appliedItemIds,
      conflictedItemIds: [],
      failedItemIds,
      aborted: false,
    };
  }

  async reject(params: {
    proposalId: string;
    workspaceId: string;
    approverUserWorkspaceId: string;
  }): Promise<ApprovalResult> {
    const { proposalId, workspaceId, approverUserWorkspaceId } = params;

    const proposal = await this.proposalRepository.findOne({
      where: { id: proposalId, workspaceId },
    });

    if (!isDefined(proposal) || proposal.status !== ProposalStatus.PENDING) {
      return this.emptyResult(proposalId, true);
    }

    const items = await this.proposalItemRepository.find({
      where: { proposalId, status: In([ProposalItemStatus.PENDING]) },
    });

    for (const item of items) {
      await this.proposalItemRepository.save({
        ...item,
        status: ProposalItemStatus.REJECTED,
      });
    }

    await this.proposalRepository.save({
      ...proposal,
      status: ProposalStatus.REJECTED,
      reviewedByUserWorkspaceId: approverUserWorkspaceId,
      reviewedAt: new Date(),
    });

    return this.emptyResult(proposalId, false);
  }

  // Compares the values captured when the proposal was made against the record
  // as it stands now. A human edit in between must not be silently overwritten.
  private async hasBaselineConflict(
    item: ProposalItemEntity,
    workspaceId: string,
  ): Promise<boolean> {
    const baselineFieldNames = Object.keys(item.baseline);

    if (
      !isDefined(item.objectNameSingular) ||
      !isDefined(item.recordId) ||
      baselineFieldNames.length === 0
    ) {
      return false;
    }

    const output = await this.findRecordsService.execute({
      objectName: item.objectNameSingular,
      filter: { id: { eq: item.recordId } },
      limit: 1,
      select: baselineFieldNames,
      shouldBuildEffectiveSelectFields: true,
      authContext: buildSystemAuthContext(workspaceId),
      rolePermissionConfig: { shouldBypassPermissionChecks: true },
    });

    const record = (output.result as { records?: Record<string, unknown>[] })
      ?.records?.[0];

    if (!isDefined(record)) {
      return true;
    }

    return baselineFieldNames.some(
      (fieldName) =>
        JSON.stringify(record[fieldName]) !==
        JSON.stringify(item.baseline[fieldName]),
    );
  }

  private async applyItem(
    item: ProposalItemEntity,
    workspaceId: string,
    rolePermissionConfig: RolePermissionConfig,
    approverUserWorkspaceId: string,
  ): Promise<ToolOutput> {
    const authContext = buildSystemAuthContext(workspaceId);
    const objectName = item.objectNameSingular ?? '';

    switch (item.actionType) {
      case ProposalActionType.CREATE_RECORD:
        return this.createRecordService.execute({
          objectName,
          objectRecord: item.payload,
          authContext,
          rolePermissionConfig,
          slimResponse: true,
        });

      case ProposalActionType.UPDATE_RECORD:
        return this.updateRecordService.execute({
          objectName,
          objectRecordId: item.recordId ?? '',
          objectRecord: item.payload,
          authContext,
          rolePermissionConfig,
          slimResponse: true,
        });

      case ProposalActionType.DELETE_RECORD:
        return this.deleteRecordService.execute({
          objectName,
          objectRecordId: item.recordId ?? '',
          authContext,
          rolePermissionConfig,
          soft: true,
        });

      // Outbound sends are external calls that cannot be rolled back, so the
      // apply loop orders them after every record write in the batch.
      case ProposalActionType.SEND_EMAIL:
        return this.sendEmailTool.execute(item.payload as never, {
          workspaceId,
          userWorkspaceId: approverUserWorkspaceId,
        });

      case ProposalActionType.CREATE_CALENDAR_EVENT:
        return this.createCalendarEventTool.execute(item.payload as never, {
          workspaceId,
          userWorkspaceId: approverUserWorkspaceId,
        });
    }
  }

  private emptyResult(proposalId: string, aborted: boolean): ApprovalResult {
    return {
      proposalId,
      appliedItemIds: [],
      conflictedItemIds: [],
      failedItemIds: [],
      aborted,
    };
  }
}
```

Confirm the `SendEmailTool` and `CreateCalendarEventTool` import paths and that `ToolExecutionContext` accepts `{ workspaceId, userWorkspaceId }` — see `src/engine/core-modules/tool/types/tool-execution-context.type.ts`.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd packages/searm-server && npx jest proposal-execution.service.spec
```

Expected: PASS, 7 tests.

Confirm `UserRoleService.getRoleIdForUserWorkspace` takes the params object shown. If its real signature differs, match it and update the mock.

- [ ] **Step 5: Register the service**

Add `ProposalExecutionService` to `providers` and `exports` in `ai-write-approval.module.ts`. Add to its `imports`: the module exporting `UserRoleService`, and the module exporting `SendEmailTool` / `CreateCalendarEventTool` (find it by grepping for `providers: [` containing `SendEmailTool` — likely `ToolModule` under `engine/core-modules/tool/`).

- [ ] **Step 6: Lint, typecheck, commit**

```bash
npx nx lint:diff-with-main searm-server
npx nx typecheck searm-server
git add packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval
git commit -m "feat(ai-write-approval): add proposal approval execution"
```

---

### Task 6: GraphQL API

**Files:**
- Create: `packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval/dtos/proposal.dto.ts`
- Create: `packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval/dtos/approve-proposal.input.ts`
- Create: `packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval/dtos/ai-write-policy.dto.ts`
- Create: `packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval/resolvers/proposal.resolver.ts`
- Create: `packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval/resolvers/ai-write-policy.resolver.ts`
- Modify: `packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval/ai-write-approval.module.ts`

**Interfaces:**
- Consumes: `ProposalExecutionService.approve` / `.reject` (Task 5), `AiWritePolicyService` (Task 1).
- Produces GraphQL operations: `pendingProposals: [ProposalDTO!]!`, `approveProposal(input: ApproveProposalInput!): ApprovalResultDTO!`, `rejectProposal(input: RejectProposalInput!): ApprovalResultDTO!`, `aiWritePolicy: AiWritePolicyDTO!`, `updateAiWritePolicy(input: UpdateAiWritePolicyInput!): AiWritePolicyDTO!`.

- [ ] **Step 1: Write the DTOs**

Create `dtos/proposal.dto.ts`:

```ts
import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-type-json';

import {
  ProposalActionType,
  ProposalItemStatus,
  ProposalStatus,
} from 'src/engine/metadata-modules/ai/ai-write-approval/types/proposal-status.type';

registerEnumType(ProposalStatus, { name: 'ProposalStatus' });
registerEnumType(ProposalItemStatus, { name: 'ProposalItemStatus' });
registerEnumType(ProposalActionType, { name: 'ProposalActionType' });

@ObjectType('ProposalItem')
export class ProposalItemDTO {
  @Field(() => ID)
  id: string;

  @Field(() => ProposalActionType)
  actionType: ProposalActionType;

  @Field(() => String, { nullable: true })
  objectNameSingular: string | null;

  @Field(() => ID, { nullable: true })
  recordId: string | null;

  @Field(() => GraphQLJSON)
  payload: Record<string, unknown>;

  @Field(() => GraphQLJSON)
  baseline: Record<string, unknown>;

  @Field(() => ProposalItemStatus)
  status: ProposalItemStatus;

  @Field(() => String, { nullable: true })
  error: string | null;
}

@ObjectType('Proposal')
export class ProposalDTO {
  @Field(() => ID)
  id: string;

  @Field(() => ProposalStatus)
  status: ProposalStatus;

  @Field(() => String, { nullable: true })
  reason: string | null;

  @Field(() => Date)
  expiresAt: Date;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => [ProposalItemDTO])
  items: ProposalItemDTO[];
}

@ObjectType('ApprovalResult')
export class ApprovalResultDTO {
  @Field(() => ID)
  proposalId: string;

  @Field(() => [ID])
  appliedItemIds: string[];

  @Field(() => [ID])
  conflictedItemIds: string[];

  @Field(() => [ID])
  failedItemIds: string[];

  @Field(() => Boolean)
  aborted: boolean;
}
```

Confirm `graphql-type-json` is the JSON scalar this repo uses by grepping an existing DTO for `GraphQLJSON`; if it uses a different scalar, match it.

Create `dtos/approve-proposal.input.ts`:

```ts
import { Field, ID, InputType } from '@nestjs/graphql';

import { IsArray, IsUUID } from 'class-validator';

@InputType()
export class ApproveProposalInput {
  @Field(() => ID)
  @IsUUID()
  proposalId: string;

  @Field(() => [ID])
  @IsArray()
  selectedItemIds: string[];
}

@InputType()
export class RejectProposalInput {
  @Field(() => ID)
  @IsUUID()
  proposalId: string;
}
```

Create `dtos/ai-write-policy.dto.ts`:

```ts
import { Field, InputType, ObjectType } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-type-json';

@ObjectType('AiWritePolicy')
export class AiWritePolicyDTO {
  @Field(() => String)
  default: string;

  @Field(() => GraphQLJSON)
  overrides: Record<string, string>;
}

@InputType()
export class UpdateAiWritePolicyInput {
  @Field(() => String)
  default: string;

  @Field(() => GraphQLJSON)
  overrides: Record<string, string>;
}
```

- [ ] **Step 2: Write the proposal resolver**

Create `resolvers/proposal.resolver.ts`. Guard and decorator pattern copied verbatim from `src/engine/metadata-modules/ai/ai-agent-execution/resolvers/agent-run.resolver.ts`:

```ts
import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query } from '@nestjs/graphql';
import { InjectRepository } from '@nestjs/typeorm';

import { PermissionFlagType } from 'searm-shared/constants';
import { Repository } from 'typeorm';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { type FlatWorkspace } from 'src/engine/core-modules/workspace/types/flat-workspace.type';
import { AuthUserWorkspaceId } from 'src/engine/decorators/auth/auth-user-workspace-id.decorator';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { SettingsPermissionGuard } from 'src/engine/guards/settings-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import {
  ApproveProposalInput,
  RejectProposalInput,
} from 'src/engine/metadata-modules/ai/ai-write-approval/dtos/approve-proposal.input';
import {
  ApprovalResultDTO,
  ProposalDTO,
} from 'src/engine/metadata-modules/ai/ai-write-approval/dtos/proposal.dto';
import { ProposalEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal.entity';
import { ProposalExecutionService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-execution.service';
import { ProposalStatus } from 'src/engine/metadata-modules/ai/ai-write-approval/types/proposal-status.type';

@UseGuards(WorkspaceAuthGuard, SettingsPermissionGuard(PermissionFlagType.AI))
@MetadataResolver()
export class ProposalResolver {
  constructor(
    private readonly proposalExecutionService: ProposalExecutionService,
    @InjectRepository(ProposalEntity, 'core')
    private readonly proposalRepository: Repository<ProposalEntity>,
  ) {}

  // Expiry is computed here rather than enforced by a background job.
  @Query(() => [ProposalDTO])
  async pendingProposals(
    @AuthWorkspace() workspace: FlatWorkspace,
  ): Promise<ProposalDTO[]> {
    const proposals = await this.proposalRepository.find({
      where: {
        workspaceId: workspace.id,
        status: ProposalStatus.PENDING,
      },
      relations: ['items'],
      order: { createdAt: 'DESC' },
    });

    const now = new Date();

    return proposals.filter(
      (proposal) => proposal.expiresAt > now,
    ) as unknown as ProposalDTO[];
  }

  @Mutation(() => ApprovalResultDTO)
  async approveProposal(
    @Args('input') input: ApproveProposalInput,
    @AuthWorkspace() workspace: FlatWorkspace,
    @AuthUserWorkspaceId() userWorkspaceId: string,
  ): Promise<ApprovalResultDTO> {
    return this.proposalExecutionService.approve({
      proposalId: input.proposalId,
      selectedItemIds: input.selectedItemIds,
      workspaceId: workspace.id,
      approverUserWorkspaceId: userWorkspaceId,
    });
  }

  @Mutation(() => ApprovalResultDTO)
  async rejectProposal(
    @Args('input') input: RejectProposalInput,
    @AuthWorkspace() workspace: FlatWorkspace,
    @AuthUserWorkspaceId() userWorkspaceId: string,
  ): Promise<ApprovalResultDTO> {
    return this.proposalExecutionService.reject({
      proposalId: input.proposalId,
      workspaceId: workspace.id,
      approverUserWorkspaceId: userWorkspaceId,
    });
  }
}
```


- [ ] **Step 3: Write the policy resolver**

Create `resolvers/ai-write-policy.resolver.ts`. Note the different guard: policy changes are admin-only, so this uses `AI_SETTINGS`, not `AI`:

```ts
import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query } from '@nestjs/graphql';

import { PermissionFlagType } from 'searm-shared/constants';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { type FlatWorkspace } from 'src/engine/core-modules/workspace/types/flat-workspace.type';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { SettingsPermissionGuard } from 'src/engine/guards/settings-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import {
  AiWritePolicyDTO,
  UpdateAiWritePolicyInput,
} from 'src/engine/metadata-modules/ai/ai-write-approval/dtos/ai-write-policy.dto';
import { AiWritePolicyService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/ai-write-policy.service';
import { type AiWritePolicy } from 'src/engine/metadata-modules/ai/ai-write-approval/types/ai-write-policy.type';

// The policy is deliberately not a workspace record: a user with record write
// permissions must not be able to disable the gate on themselves.
@UseGuards(
  WorkspaceAuthGuard,
  SettingsPermissionGuard(PermissionFlagType.AI_SETTINGS),
)
@MetadataResolver()
export class AiWritePolicyResolver {
  constructor(private readonly aiWritePolicyService: AiWritePolicyService) {}

  @Query(() => AiWritePolicyDTO)
  async aiWritePolicy(
    @AuthWorkspace() workspace: FlatWorkspace,
  ): Promise<AiWritePolicyDTO> {
    return this.aiWritePolicyService.getPolicy(workspace.id);
  }

  @Mutation(() => AiWritePolicyDTO)
  async updateAiWritePolicy(
    @Args('input') input: UpdateAiWritePolicyInput,
    @AuthWorkspace() workspace: FlatWorkspace,
  ): Promise<AiWritePolicyDTO> {
    const policy = input as AiWritePolicy;

    await this.aiWritePolicyService.setPolicy(workspace.id, policy);

    return policy;
  }
}
```

- [ ] **Step 4: Register the resolvers**

Add `ProposalResolver` and `AiWritePolicyResolver` to `providers` in `ai-write-approval.module.ts`.

- [ ] **Step 5: Verify the schema builds**

```bash
npx nx typecheck searm-server
npx nx start searm-server
```

Expected: server boots with no GraphQL schema errors. Open the metadata GraphQL playground and confirm `pendingProposals`, `approveProposal`, `rejectProposal`, `aiWritePolicy`, and `updateAiWritePolicy` appear.

- [ ] **Step 6: Regenerate front types and commit**

```bash
npx nx run searm-front:graphql:generate --configuration=metadata
npx nx lint:diff-with-main searm-server
git add packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval packages/searm-front/src/generated-metadata
git commit -m "feat(ai-write-approval): expose proposal and policy graphql api"
```

---

### Task 7: Approval inbox UI

One settings page. Ships inside Settings because that routing path is well-trodden and costs nothing to extend — a dedicated top-level surface is a later refinement, not a launch requirement.

**Files:**
- Modify: `packages/searm-shared/src/types/SettingsPath.ts`
- Modify: `packages/searm-front/src/modules/app/components/SettingsRoutes.tsx`
- Create: `packages/searm-front/src/pages/settings/ai/SettingsAiApprovals.tsx`
- Create: `packages/searm-front/src/modules/settings/ai-approvals/graphql/queries/pendingProposals.ts`
- Create: `packages/searm-front/src/modules/settings/ai-approvals/graphql/mutations/approveProposal.ts`
- Create: `packages/searm-front/src/modules/settings/ai-approvals/components/ProposalDiffTable.tsx`
- Test: `packages/searm-front/src/modules/settings/ai-approvals/components/__tests__/ProposalDiffTable.test.tsx`

**Interfaces:**
- Consumes: the GraphQL operations from Task 6 via generated metadata hooks.
- Produces: route `SettingsPath.AiApprovals`.

- [ ] **Step 1: Add the route path**

In `packages/searm-shared/src/types/SettingsPath.ts`, add to the `SettingsPath` enum next to the other AI entries:

```ts
  AiApprovals = 'ai/approvals',
```

- [ ] **Step 2: Write the GraphQL documents**

Create `modules/settings/ai-approvals/graphql/queries/pendingProposals.ts`:

```ts
import { gql } from '@apollo/client';

export const PENDING_PROPOSALS = gql`
  query PendingProposals {
    pendingProposals {
      id
      status
      reason
      expiresAt
      createdAt
      items {
        id
        actionType
        objectNameSingular
        recordId
        payload
        baseline
        status
        error
      }
    }
  }
`;
```

Create `modules/settings/ai-approvals/graphql/mutations/approveProposal.ts`:

```ts
import { gql } from '@apollo/client';

export const APPROVE_PROPOSAL = gql`
  mutation ApproveProposal($input: ApproveProposalInput!) {
    approveProposal(input: $input) {
      proposalId
      appliedItemIds
      conflictedItemIds
      failedItemIds
      aborted
    }
  }
`;

export const REJECT_PROPOSAL = gql`
  mutation RejectProposal($input: RejectProposalInput!) {
    rejectProposal(input: $input) {
      proposalId
      aborted
    }
  }
`;
```

- [ ] **Step 3: Write the failing component test**

Create `modules/settings/ai-approvals/components/__tests__/ProposalDiffTable.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ProposalDiffTable } from '@/settings/ai-approvals/components/ProposalDiffTable';

const items = [
  {
    id: 'item-1',
    actionType: 'UPDATE_RECORD',
    objectNameSingular: 'person',
    recordId: 'record-1',
    payload: { jobTitle: 'Head of Sales' },
    baseline: { jobTitle: 'Sales Rep' },
    status: 'PENDING',
    error: null,
  },
  {
    id: 'item-2',
    actionType: 'UPDATE_RECORD',
    objectNameSingular: 'person',
    recordId: 'record-1',
    payload: { city: 'Berlin' },
    baseline: { city: 'Munich' },
    status: 'PENDING',
    error: null,
  },
];

describe('ProposalDiffTable', () => {
  it('should show the current and proposed value for each field', () => {
    render(<ProposalDiffTable items={items} onApprove={jest.fn()} onReject={jest.fn()} />);

    expect(screen.getByText('Sales Rep')).toBeInTheDocument();
    expect(screen.getByText('Head of Sales')).toBeInTheDocument();
    expect(screen.getByText('Munich')).toBeInTheDocument();
    expect(screen.getByText('Berlin')).toBeInTheDocument();
  });

  it('should approve only the items left selected', async () => {
    const onApprove = jest.fn();

    render(<ProposalDiffTable items={items} onApprove={onApprove} onReject={jest.fn()} />);

    await userEvent.click(screen.getByRole('checkbox', { name: /city/i }));
    await userEvent.click(screen.getByRole('button', { name: /approve selected/i }));

    expect(onApprove).toHaveBeenCalledWith(['item-1']);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
cd packages/searm-front && npx jest ProposalDiffTable
```

Expected: FAIL — cannot resolve `ProposalDiffTable`.

- [ ] **Step 5: Write the component**

Create `modules/settings/ai-approvals/components/ProposalDiffTable.tsx`:

```tsx
import { useState } from 'react';
import styled from '@emotion/styled';

import { Button } from 'searm-ui/input';

type ProposalItem = {
  id: string;
  actionType: string;
  objectNameSingular: string | null;
  recordId: string | null;
  payload: Record<string, unknown>;
  baseline: Record<string, unknown>;
  status: string;
  error: string | null;
};

type ProposalDiffTableProps = {
  items: ProposalItem[];
  onApprove: (selectedItemIds: string[]) => void;
  onReject: () => void;
};

const StyledTable = styled.table`
  border-collapse: collapse;
  width: 100%;
`;

const StyledCell = styled.td`
  border-bottom: 1px solid ${({ theme }) => theme.border.color.light};
  padding: ${({ theme }) => theme.spacing(2)};
`;

const StyledActions = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing(2)};
  padding-top: ${({ theme }) => theme.spacing(3)};
`;

const formatValue = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value ?? '—');

export const ProposalDiffTable = ({
  items,
  onApprove,
  onReject,
}: ProposalDiffTableProps) => {
  const [deselectedItemIds, setDeselectedItemIds] = useState<string[]>([]);

  const toggleItem = (itemId: string) => {
    setDeselectedItemIds((previous) =>
      previous.includes(itemId)
        ? previous.filter((id) => id !== itemId)
        : [...previous, itemId],
    );
  };

  const selectedItemIds = items
    .map((item) => item.id)
    .filter((itemId) => !deselectedItemIds.includes(itemId));

  return (
    <div>
      <StyledTable>
        <tbody>
          {items.map((item) =>
            Object.keys(item.payload).map((fieldName) => (
              <tr key={`${item.id}-${fieldName}`}>
                <StyledCell>
                  <input
                    type="checkbox"
                    aria-label={fieldName}
                    checked={!deselectedItemIds.includes(item.id)}
                    onChange={() => toggleItem(item.id)}
                  />
                </StyledCell>
                <StyledCell>{fieldName}</StyledCell>
                <StyledCell>{formatValue(item.baseline[fieldName])}</StyledCell>
                <StyledCell>{formatValue(item.payload[fieldName])}</StyledCell>
              </tr>
            )),
          )}
        </tbody>
      </StyledTable>
      <StyledActions>
        <Button
          title="Approve selected"
          accent="blue"
          onClick={() => onApprove(selectedItemIds)}
        />
        <Button title="Reject" accent="danger" onClick={onReject} />
      </StyledActions>
    </div>
  );
};
```

Confirm the `Button` import path and its props against an existing settings component — `packages/searm-front/src/pages/settings/ai/SettingsAI.tsx` is the nearest reference. This repo uses Linaria/emotion styling; match whatever that file imports.

- [ ] **Step 6: Run the test to verify it passes**

```bash
cd packages/searm-front && npx jest ProposalDiffTable
```

Expected: PASS, 2 tests.

- [ ] **Step 7: Write the page and register the route**

Create `pages/settings/ai/SettingsAiApprovals.tsx`:

```tsx
import { useMutation, useQuery } from '@apollo/client';
import styled from '@emotion/styled';

import { ProposalDiffTable } from '@/settings/ai-approvals/components/ProposalDiffTable';
import {
  APPROVE_PROPOSAL,
  REJECT_PROPOSAL,
} from '@/settings/ai-approvals/graphql/mutations/approveProposal';
import { PENDING_PROPOSALS } from '@/settings/ai-approvals/graphql/queries/pendingProposals';

const StyledProposal = styled.section`
  padding-bottom: ${({ theme }) => theme.spacing(6)};
`;

const StyledHeading = styled.h2`
  font-size: ${({ theme }) => theme.font.size.md};
  font-weight: ${({ theme }) => theme.font.weight.medium};
`;

export const SettingsAiApprovals = () => {
  const { data, loading, refetch } = useQuery(PENDING_PROPOSALS);
  const [approveProposal] = useMutation(APPROVE_PROPOSAL);
  const [rejectProposal] = useMutation(REJECT_PROPOSAL);

  const proposals = data?.pendingProposals ?? [];

  const handleApprove = async (
    proposalId: string,
    selectedItemIds: string[],
  ) => {
    await approveProposal({
      variables: { input: { proposalId, selectedItemIds } },
    });
    await refetch();
  };

  const handleReject = async (proposalId: string) => {
    await rejectProposal({ variables: { input: { proposalId } } });
    await refetch();
  };

  if (loading) {
    return <div>Loading…</div>;
  }

  if (proposals.length === 0) {
    return <div>No AI changes are waiting for review.</div>;
  }

  return (
    <div>
      {proposals.map((proposal) => (
        <StyledProposal key={proposal.id}>
          <StyledHeading>
            {proposal.items.length} proposed change
            {proposal.items.length === 1 ? '' : 's'}
          </StyledHeading>
          <ProposalDiffTable
            items={proposal.items}
            onApprove={(selectedItemIds) =>
              handleApprove(proposal.id, selectedItemIds)
            }
            onReject={() => handleReject(proposal.id)}
          />
        </StyledProposal>
      ))}
    </div>
  );
};
```

Wrap the returned markup in the same page chrome the neighbouring settings pages use — open `pages/settings/ai/SettingsAI.tsx`, copy its `SubMenuTopBarContainer` / `SettingsPageContainer` wrapper and its breadcrumb props, and substitute the title "AI approvals". Do not invent a different shell.

In `modules/app/components/SettingsRoutes.tsx`, add the lazy import next to the existing `SettingsAI` one:

```tsx
const SettingsAiApprovals = lazy(() =>
  import('~/pages/settings/ai/SettingsAiApprovals').then((module) => ({
    default: module.SettingsAiApprovals,
  })),
);
```

and add a `<Route path={SettingsPath.AiApprovals} element={<SettingsAiApprovals />} />` alongside the other AI routes.

- [ ] **Step 8: Verify in the browser**

```bash
yarn start
```

Sign in via "Continue with Email" using the prefilled credentials, navigate to Settings → the AI approvals route, and confirm the page renders (empty state is fine at this point).

- [ ] **Step 9: Lint, typecheck, commit**

```bash
npx nx lint:diff-with-main searm-front
npx nx typecheck searm-front
git add packages/searm-front packages/searm-shared
git commit -m "feat(ai-write-approval): add approval inbox settings page"
```

---

### Task 8: End-to-end integration test

Proves the whole path against a real database.

**Files:**
- Create: `packages/searm-server/test/integration/graphql/suites/ai-write-approval/proposal-approval.integration-spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-7.

- [ ] **Step 1: Write the integration test**

Create `test/integration/graphql/suites/ai-write-approval/proposal-approval.integration-spec.ts`.

Read `test/integration/graphql/suites/object-generated/tasks.integration-spec.ts` first and copy its harness imports and request helper verbatim — the global test client, auth token handling, and `makeGraphqlAPIRequest`-style helper differ between repos and must not be invented. Then build the suite around these operations:

```ts
const UPDATE_AI_WRITE_POLICY = `
  mutation UpdateAiWritePolicy($input: UpdateAiWritePolicyInput!) {
    updateAiWritePolicy(input: $input) { default overrides }
  }
`;

const PENDING_PROPOSALS = `
  query PendingProposals {
    pendingProposals {
      id
      status
      items { id actionType objectNameSingular recordId payload baseline status }
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
```

To originate a gated write without standing up a real LLM turn, resolve `ToolExecutorService` from the running Nest application context and call `dispatch` directly with a `database_crud` / `update_one` descriptor for `person` — this is the exact code path an agent takes, minus the model:

```ts
const descriptor = {
  name: 'update_person',
  category: 'database',
  executionRef: {
    kind: 'database_crud',
    objectNameSingular: 'person',
    operation: 'update_one',
  },
};

const output = await toolExecutorService.dispatch(
  descriptor,
  { id: personId, jobTitle: 'Head of Sales' },
  toolProviderContext,
);
```

Assertions, in order:

1. Setting the policy to `{ default: 'PROPOSE', overrides: {} }` and dispatching an agent record update creates one `PENDING` proposal with one item, and the person record is unchanged.
2. `pendingProposals` returns that proposal with a populated `baseline` and `payload`.
3. `approveProposal` with the item selected returns `aborted: false`, `appliedItemIds` of length 1, and the person record now holds the proposed value.
4. A second proposal whose baseline is changed by a direct record update before approval returns `aborted: true` with the item id in `conflictedItemIds`, and the record still holds the human's value.
5. `approveProposal` with an empty `selectedItemIds` marks every item `REJECTED` and writes nothing.
6. Setting the policy to `{ default: 'AUTO', overrides: {} }` and repeating step 1 updates the record directly and creates no proposal.

- [ ] **Step 2: Run the integration suite**

```bash
npx nx run searm-server:test:integration:with-db-reset
```

Expected: the new suite passes and no existing suite regresses.

- [ ] **Step 3: Full regression check**

```bash
npx nx test searm-server
npx nx test searm-front
npx nx lint:diff-with-main searm-server
npx nx lint:diff-with-main searm-front
npx nx typecheck searm-server
npx nx typecheck searm-front
```

Expected: all green. The gate sits on a hot path used by every AI feature — a red suite here means the gate is wrong, not that the suite is stale.

- [ ] **Step 4: Manual end-to-end verification**

```bash
npx nx database:reset searm-server
yarn start
```

Sign in with "Continue with Email" and the prefilled credentials. In AI chat, instruct the agent to update a company's employee count and address. Confirm: the agent replies that the change is awaiting approval and does not retry; the record is unchanged; Settings → AI approvals shows one proposal with two field diffs; deselect one, approve; the record reflects exactly the approved field.

- [ ] **Step 5: Commit**

```bash
git add packages/searm-server
git commit -m "feat(ai-write-approval): add end-to-end integration coverage"
```

---

## Success criteria mapped to tasks

| Spec criterion | Verified by |
| --- | --- |
| Agent write produces a PENDING proposal, writes nothing | Task 3 test, Task 4 test, Task 8 integration step 1 |
| Agent receives a success-shaped result and does not retry | Task 3 test "success-shaped output", Task 8 manual step 7 |
| Reviewer sees a field-level diff and deselects an item | Task 7 tests, Task 8 manual step 7 |
| Approved items apply once, deselected are REJECTED | Task 5 tests, Task 8 integration steps 3 and 5 |
| Human edit between proposal and approval aborts as CONFLICTED | Task 5 test "abort the whole batch", Task 8 integration step 4 |
| Approver without write permission cannot apply | Task 5 test "apply as the approver" — permission enforcement is the existing record-crud path |
| FORBID blocks with an instructive message | Task 3 test, Task 4 test |
| AUTO override executes directly, unchanged | Task 1 tests, Task 8 integration step 6 |
| Reads are never gated | Task 3 test, Task 4 test |
| A new AI write tool is gated by default | Structural — the gate sits above the tool layer in `dispatch()` |

## Risks and unknowns

- **Circular module dependency.** `ToolProviderModule` importing `AiWriteApprovalModule`, which imports `RecordCrudModule`, may cycle depending on what `RecordCrudModule` pulls in. Resolve with `forwardRef` if Nest complains at boot; this is a known, bounded fix.
- **`FindRecordsService` result shape.** The gate and the execution service both assume `output.result.records[]`. Verify against a real response during Task 3 and adjust the accessor once, in both places, if it differs.
- **`UserRoleService.getRoleIdForUserWorkspace` signature.** Assumed to take `{ userWorkspaceId, workspaceId }`. Confirm at Task 5.
- **`ToolExecutionContext` has no actor.** The `send_email` and `create_calendar_event` tools receive only `workspaceId` and optional user ids. Attribution of an approved send to the approver may be weaker than for record writes; acceptable for launch, worth revisiting when outbound volume matters.
- **`update_many` / `delete_many` baselines.** A filter-based bulk write has no single `recordId`, so its baseline is empty and the conflict check is a no-op for those operations. They are still gated and still require approval — only the staleness protection is absent. Note it in the UI copy; narrow it later if bulk writes prove common.
