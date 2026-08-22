# Phase 4 — Universal Agent Access and Agent-Safe API Semantics

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** an external, OAuth-authorized agent can discover SeaRM's schema, read the records its role permits, create proposals for writes, and — when something goes wrong — recover from the response alone, without a human in the loop to translate the error. Every AI-facing failure carries `code`, `message`, `hint`, `retryable`, `allowedActions`. AI-requested deletes require a confirmation round-trip. Retried AI writes never duplicate a proposal. Three starter workflow templates package the research/proposal capabilities already in the product.

**Architecture:** this phase does not replace anything from Launch 1 (`docs/superpowers/plans/2026-08-05-ai-write-approval.md`) or from SeaRM's existing tool-provider/MCP stack — it extends both. The single write chokepoint is still `ProposalGateService.evaluate()`, called from `ToolExecutorService.dispatch()`. The single external-facing transport is still `packages/searm-server/src/engine/api/mcp/`. Every task below either (a) adds a structured failure shape and threads it through the *existing* error paths of that stack, or (b) extends `ProposalGateService`/`ProposalItemEntity` in place, or (c) adds new, narrowly-scoped services that call *existing* SeaRM services rather than reimplementing them.

**Tech Stack:** NestJS 10, TypeORM, PostgreSQL 16, GraphQL (code-first, metadata schema), React 18 + Jotai + Linaria, Nx, Jest, Vercel AI SDK (`ai` package) for tool sets.

**Spec:** `docs/superpowers/PRODUCT-CHARTER.md` §"Metadata-aware AI and MCP tools" and delivery-sequence row 4. Scouting: `docs/superpowers/scouting/searm-anchors.md` §2, §8; `docs/superpowers/scouting/crmkit-scout.md` §1.1–§1.11.

**Working directory for all paths below:** `d:\Files\Vatsa\Projects\AI-CRM\searm`

## Ground truth this plan was written against

**Re-verified against HEAD `dba03d0907`** ("style(ai-write-approval): apply oxfmt to the fix-wave changes") on 2026-08-06, after the fix wave `c6e057906b..HEAD` rewrote the gate, the policy service and the execution service. Every quoted signature, line number, permission flag, GraphQL decorator and find-and-replace block below was re-read from the file it names. Where this document quotes a line number, that number is from this commit. If HEAD has moved, re-read before transcribing — **reality wins over this plan, always.**

Read directly from the checkout before writing a single line of code below (paths relative to `packages/searm-server/src/` unless noted):

- `engine/core-modules/tool/types/tool-output.type.ts` — the `ToolOutput<T>` shape every tool returns today.
- `engine/core-modules/tool-provider/services/tool-executor.service.ts` — `ToolExecutorService.dispatch()`, **already gated by `ProposalGateService`** (Launch 1 Task 4 has landed on this branch — verified by reading the file, not assumed).
- `engine/metadata-modules/ai/ai-write-approval/services/proposal-gate.service.ts` — the live `ProposalGateService`, verified by reading the file in full; this plan's diffs are written against its exact current content, not the plan-document version.
- `engine/core-modules/tool-provider/services/tool-registry.service.ts` — `ToolRegistryService.resolveAndExecute()` (used by `execute_tool`) and `.hydrateToolSet()` (used by MCP and native AI-SDK tool calls) — the two paths that turn a `ToolOutput` into what a model sees.
- `engine/api/mcp/services/mcp-tool-executor.service.ts` — `McpToolExecutorService.handleToolCall()`, the exact JSON-RPC wire format an MCP client receives today: `{content:[{type:'text', text: JSON.stringify(result)}], isError}` on success, `{content:[{type:'text', text: error.message}], isError:true}` on an uncaught exception. No `code`/`hint`/`retryable` today.
- `engine/api/mcp/guards/mcp-auth.guard.ts`, `engine/core-modules/application/application-oauth/` — a working RFC 9728/8414/7591/7009 OAuth authorization server already exists, already workspace-pinned (a token is minted against one workspace + one role, chosen during the authorize flow) and already scoped by the application's assigned role (object/field/row permissions), not by a hand-rolled tool allowlist. `constants/oauth-scopes.ts` confirms the two OAuth scopes (`api`, `profile`) are a thin consent label — the actual access boundary is the role.
- `engine/core-modules/tool-provider/providers/database-tool.provider.ts` — CRUD tool descriptors are already generated per-object from live metadata + `FlatObjectPermission` (`canReadObjectRecords`, `canUpdateObjectRecords`, `canSoftDeleteObjectRecords`), already field-schema-aware, already permission-filtered.
- `engine/metadata-modules/object-metadata/tools/object-metadata-tools.factory.ts` — `get_object_metadata` tool: returns object/field metadata **without any permission filter** — this is the concrete gap this plan closes for metadata discovery (Task 8).
- `engine/core-modules/record-crud/services/find-records.service.ts` — pagination is already stable (`orderBy` always gets `id` appended as a tiebreaker) and already returns `count` (total); it does **not** return an explicit "is there more" signal — the concrete gap Task 7 closes.
- `engine/core-modules/tool-provider/output-transforms/{compact-tool-output,strip-empty-values}.util.ts`, `utils/estimate-tool-output-tokens.util.ts`, `utils/find-similar-tool-names.util.ts` — compact output and "did you mean" tool-name suggestions **already exist**; this plan reuses them rather than rebuilding them.
- `engine/core-modules/record-crud/zod-schemas/{delete-tool,bulk-delete-tool}.zod-schema.ts` — the exact Zod schemas an AI-requested delete is validated against before `dispatch()` ever sees the args; Zod's default `z.object()` **strips** unknown keys, so a `confirm` field must be added to these schemas explicitly (Task 5) or it never reaches the gate.
- `modules/workflow/workflow-executor/workflow-actions/ai-agent/{ai-agent.workflow-action.ts,types/workflow-ai-agent-action-input.type.ts}` — an `AI_AGENT` workflow step already exists, already routes through `AgentAsyncExecutorService.executeAgent()`, and its `agentId` input is **optional** (an unset `agentId` runs an ad-hoc, unconfigured agent against the given `prompt`) — the exact mechanism Task 10's workflow templates use.
- `modules/workflow/workflow-tools/tools/create-complete-workflow.tool.ts` — the existing AI-facing "build a workflow" meta-tool; this plan's `WorkflowTemplateService` (Task 10) is modeled directly on its internal `createWorkflow`/`createWorkflowVersion` helpers (read in full, reproduced below), not invented.
- `modules/workflow/common/standard-objects/{workflow,workflow-version,workflow-automated-trigger}.workspace-entity.ts` — the live, workspace-object-backed Workflow/WorkflowVersion/WorkflowAutomatedTrigger shapes (there is also a newer `core`-schema `WorkflowEntity`/`WorkflowVersionEntity` pair behind a feature flag, `IS_WORKFLOW_VERSION_IN_CORE_ENABLED` — this plan targets the **workspace-object path**, which is the default, unconditional data path today per `WorkflowCommonWorkspaceService.overlayCoreWorkflowVersionContent`).
- `modules/workflow/workflow-tools/tools/activate-workflow-version.tool.ts` — confirms `WorkflowTriggerWorkspaceService.activateWorkflowVersion(workflowVersionId, workspaceId)` is the one call that turns a `DRAFT` version into a running, triggerable one (creates whatever `WorkflowAutomatedTriggerWorkspaceEntity` rows a CRON/DATABASE_EVENT trigger needs) — this plan calls it, it does not reimplement it.

## Global Constraints

Copied from the repo's `CLAUDE.md`, the Launch 1 plan, and this phase's brief. Every task's requirements implicitly include this section.

- **Named exports only.** No default exports anywhere.
- **No `any`.** Strict TypeScript enforced.
- **Types over interfaces**, except when extending a third-party interface.
- **String literal unions over enums**, except GraphQL enums (real TS enums registered with `registerEnumType`).
- **Functional components only** in `searm-front`.
- **File naming:** kebab-case with suffix — `.service.ts`, `.entity.ts`, `.dto.ts`, `.module.ts`, `.resolver.ts`. Front components are PascalCase `.tsx`.
- **Comments:** short-form `//` only, no JSDoc blocks. Explain WHY, not WHAT.
- **Use `isDefined()` from `searm-shared/utils`** rather than hand-rolled null checks.
- **Services under 500 lines, components under 300 lines.**
- **Entity registration is automatic** — `core.datasource.ts` globs `engine/metadata-modules/**/*.entity.{ts,js}`. Never add an entity to a registry list.
- **Schema changes ship as instance commands**, never TypeORM migrations. Generate with `npx nx run searm-server:database:migrate:generate --name <name> --type fast`. The naming convention actually used in this repo, confirmed by reading a real generated file, is `<minor>-instance-command-fast-<epoch-ms>-<slug>.ts` containing a class decorated `@RegisteredInstanceCommand('<version>', <epoch-ms>)` implementing `FastInstanceCommand` (`up`/`down` raw SQL). Never rewrite a committed command's `up`/`down`.
- **Never gate reads.** `find_many`, `find_one`, `group_by` must pass through untouched.
- **Never gate the four deterministic workflow record-crud actions.** Only AI-originated writes are proposed.
- **Confirmation tokens apply to AI-requested deletes only.** Human UI deletion (the ordinary GraphQL record-delete mutation used by the front end) is untouched by every task in this plan — every change below lives inside `ProposalGateService`, `ToolExecutorService`, MCP, or the Zod schemas that only AI tool calls are validated against.
- **The gate must keep returning `success: true` for proposed writes** and now also for `ALLOW`ed AUTO writes that pass confirmation — an agent that reads failure retries and duplicates.
- **Custom objects are the only extension mechanism for business-specific records.** Nothing in this plan adds a workspace-visible standard object; the new entity change (Task 6) extends an existing `core`-schema TypeORM entity, matching the pattern `ProposalEntity`/`ProposalItemEntity` already use.
- Lint and typecheck after each task: `npx nx lint:diff-with-main searm-server` and `npx nx typecheck searm-server` (front tasks: `searm-front`).
- **Every task must have at least one test that exercises a real seam, not a double.** Launch 1 shipped three Criticals behind a green suite because its specs doubled the broken seam. Each task below names its own; do not replace one with a mock to make a test simpler. The seams, per task: T1 the real util; T2/T5/T6 the **real `AiWritePolicyService`** inside `proposal-gate.service.spec.ts` (that spec does not mock `resolveMode` — see Task 2 Step 1), plus T5's real `buildDeleteConfirmationToken`; T3 the real `ToolRegistryService` + real `findSimilarToolNames`; T4 the real `McpToolExecutorService` JSON-RPC envelope; T7 the real `FindRecordsService`; T8 the real `getObjectsPermissionsFromRolePermissionConfig` against the real cache payload shape; T9 and T13 real database integration suites; T10 the real `normalizeWorkflowTemplateSteps` and real `WORKFLOW_TEMPLATES`; T11 a real render of the component.

## File Structure

**New — server, error envelope** (under `packages/searm-server/src/engine/core-modules/tool/`):

| File | Responsibility |
| --- | --- |
| `types/tool-failure.type.ts` | `ToolFailureCode` union + `ToolFailure` type |
| `utils/build-tool-failure.util.ts` | `buildToolFailure()`, `toFailedToolOutput()` |

**Modified — server, error envelope migration:**

| File | Change |
| --- | --- |
| `engine/core-modules/tool/types/tool-output.type.ts` | add optional `failure?: ToolFailure` |
| `engine/metadata-modules/ai/ai-write-approval/services/proposal-gate.service.ts` | `GateDecision`'s `FORBID` carries a `failure`; new `CONFIRMATION_REQUIRED` decision kind (Task 5); dedupe on retry (Task 6) |
| `engine/core-modules/tool-provider/services/tool-executor.service.ts` | consume `decision.failure`; build a `failure` for the "provider not available" branch |
| `engine/core-modules/tool-provider/services/tool-registry.service.ts` | `resolveAndExecute`'s not-found and catch branches build a `failure` |
| `engine/core-modules/tool-provider/utils/tool-error.util.ts` | `wrapWithErrorHandler`'s catch builds a `failure` |
| `engine/api/mcp/services/mcp-tool-executor.service.ts` | unknown-tool and catch branches surface `failure` in the JSON-RPC response |
| `engine/core-modules/record-crud/zod-schemas/delete-tool.zod-schema.ts` | add optional `confirm` field |
| `engine/core-modules/record-crud/zod-schemas/bulk-delete-tool.zod-schema.ts` | add optional `confirm` field |
| `engine/core-modules/record-crud/types/find-records-result.type.ts` | add `hasMore: boolean` |
| `engine/core-modules/record-crud/services/find-records.service.ts` | compute `hasMore` |
| `engine/metadata-modules/object-metadata/tools/object-metadata-tools.factory.ts` | `generateTools(context)` instead of `generateTools(workspaceId)`; annotate each object with `permittedOperations` |
| `engine/core-modules/tool-provider/providers/metadata-tool.provider.ts` | pass full `context` to `objectMetadataToolsFactory.generateTools` |

**New — server, confirmation tokens** (under `packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval/`):

| File | Responsibility |
| --- | --- |
| `utils/build-delete-confirmation-token.util.ts` | deterministic per-record/per-filter confirm token |

**New — server, workflow templates** (under `packages/searm-server/src/modules/workflow/workflow-templates/`):

| File | Responsibility |
| --- | --- |
| `types/workflow-template.type.ts` | `WorkflowTemplateKey`, `WorkflowTemplateDefinition` |
| `constants/workflow-templates.const.ts` | the three starter templates |
| `services/workflow-template.service.ts` | `list()`, `install({key, workspaceId, activate})`, `installDefinition({definition, workspaceId, activate})`, `findWorkflowByName(workspaceId, name)` |
| `utils/normalize-workflow-template-steps.util.ts` | assigns missing step `id`, forces `valid`, chains `nextStepIds` |
| `dtos/workflow-template.dto.ts` | GraphQL object types |
| `dtos/install-workflow-template.input.ts` | GraphQL input (metadata schema) |
| `dtos/install-workflow-definition.input.ts` | GraphQL input (core schema, app-supplied definitions) |
| `resolvers/workflow-template.resolver.ts` | metadata schema: `workflowTemplates`, `installWorkflowTemplate` |
| `resolvers/workflow-definition-install.resolver.ts` | core schema: `installWorkflowDefinition` (Phase 5 edge) |
| `workflow-templates.module.ts` | Nest module wiring; imported by `CoreEngineModule` and `MetadataEngineModule` |

**New — front:**

| File | Responsibility |
| --- | --- |
| `packages/searm-front/src/pages/settings/ai/SettingsWorkflowTemplates.tsx` | page shell + route target |
| `packages/searm-front/src/modules/settings/workflow-templates/graphql/queries/workflowTemplates.ts` | query document |
| `packages/searm-front/src/modules/settings/workflow-templates/graphql/mutations/installWorkflowTemplate.ts` | mutation document |
| `packages/searm-front/src/modules/settings/workflow-templates/components/WorkflowTemplateCard.tsx` | one template card + install button |

**Modified — front:** `packages/searm-shared/src/types/SettingsPath.ts`, `packages/searm-front/src/modules/app/components/SettingsRoutes.tsx`.

**New — docs:** `packages/searm-server/docs/AGENT_API_CONTRACT.md`.

**New — migration:** none. (An earlier draft of this line promised `idempotencyKey`/`workspaceId` columns on `core.proposalItem` for Task 6; Task 6 as written needs no schema change and none is added. Removed by the program review as a contradiction between this table and the task.)

---

### Task 1: Agent-safe error envelope — types and builder

Defines the machine-readable failure shape the charter requires: `code`, `message`, `hint`, `retryable`, `allowedActions`. Additive to `ToolOutput` — nothing that reads `success`/`error`/`message` today breaks.

**Files:**
- Create: `packages/searm-server/src/engine/core-modules/tool/types/tool-failure.type.ts`
- Create: `packages/searm-server/src/engine/core-modules/tool/utils/build-tool-failure.util.ts`
- Modify: `packages/searm-server/src/engine/core-modules/tool/types/tool-output.type.ts`
- Test: `packages/searm-server/src/engine/core-modules/tool/utils/__tests__/build-tool-failure.util.spec.ts`

**Interfaces:**
- Produces:
  - `type ToolFailureCode = 'UNKNOWN_TOOL' | 'INVALID_ARGUMENTS' | 'NOT_FOUND' | 'FORBIDDEN_BY_POLICY' | 'PERMISSION_DENIED' | 'CONFIRMATION_REQUIRED' | 'DUPLICATE_PROPOSAL' | 'RATE_LIMITED' | 'INTERNAL_ERROR'`
  - `type ToolFailure = { code: ToolFailureCode; message: string; hint: string; retryable: boolean; allowedActions: string[] }`
  - `buildToolFailure(params: { code: ToolFailureCode; message: string; hint: string; retryable: boolean; allowedActions?: string[] }): ToolFailure`
  - `toFailedToolOutput(failure: ToolFailure): ToolOutput`

- [ ] **Step 1: Write the failure type**

Create `types/tool-failure.type.ts`:

```ts
// Machine-readable failure shape every AI-facing tool call can surface, in
// addition to the legacy `error`/`message` strings on ToolOutput. An agent
// must be able to decide its next move — retry, ask a human, or give up —
// from `retryable` and `allowedActions` alone, without parsing English.
export type ToolFailureCode =
  | 'UNKNOWN_TOOL'
  | 'INVALID_ARGUMENTS'
  | 'NOT_FOUND'
  | 'FORBIDDEN_BY_POLICY'
  | 'PERMISSION_DENIED'
  | 'CONFIRMATION_REQUIRED'
  | 'DUPLICATE_PROPOSAL'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export type ToolFailure = {
  code: ToolFailureCode;
  message: string;
  hint: string;
  retryable: boolean;
  allowedActions: string[];
};
```

- [ ] **Step 2: Add the field to `ToolOutput`**

Edit `types/tool-output.type.ts`:

```ts
import { type RecordReference } from 'src/engine/core-modules/tool/types/record-reference.type';
import { type ToolFailure } from 'src/engine/core-modules/tool/types/tool-failure.type';

export type ToolOutput<T = object> = {
  success: boolean;
  message: string;
  error?: string;
  result?: T;
  warnings?: string[];
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  recordReferences?: RecordReference[];
  // Structured failure detail. Optional and additive: every call site that
  // only sets `error`/`message` today keeps working unchanged. New and
  // migrated call sites (see Task 2-4) also set this.
  failure?: ToolFailure;
};
```

- [ ] **Step 3: Write the failing test**

Create `utils/__tests__/build-tool-failure.util.spec.ts`:

```ts
import {
  buildToolFailure,
  toFailedToolOutput,
} from 'src/engine/core-modules/tool/utils/build-tool-failure.util';

describe('buildToolFailure', () => {
  it('should default allowedActions to an empty array', () => {
    const failure = buildToolFailure({
      code: 'NOT_FOUND',
      message: 'No person with that id',
      hint: 'List people first with find_many_people to find the right id.',
      retryable: false,
    });

    expect(failure.allowedActions).toEqual([]);
  });

  it('should keep the caller-supplied allowedActions', () => {
    const failure = buildToolFailure({
      code: 'UNKNOWN_TOOL',
      message: 'Tool "find_persons" not found',
      hint: 'Did you mean find_many_people?',
      retryable: false,
      allowedActions: ['find_many_people'],
    });

    expect(failure.allowedActions).toEqual(['find_many_people']);
  });
});

describe('toFailedToolOutput', () => {
  it('should shape a ToolOutput with success false and the same message on error', () => {
    const failure = buildToolFailure({
      code: 'PERMISSION_DENIED',
      message: 'You do not have access to this tool',
      hint: 'Call get_tool_catalog to see available tools.',
      retryable: false,
    });

    const output = toFailedToolOutput(failure);

    expect(output.success).toBe(false);
    expect(output.message).toBe(failure.message);
    expect(output.error).toBe(failure.message);
    expect(output.failure).toEqual(failure);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
cd packages/searm-server && npx jest build-tool-failure.util.spec
```

Expected: FAIL — `Cannot find module '.../build-tool-failure.util'`.

- [ ] **Step 5: Write the util**

Create `utils/build-tool-failure.util.ts`:

```ts
import {
  type ToolFailure,
  type ToolFailureCode,
} from 'src/engine/core-modules/tool/types/tool-failure.type';
import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';

export const buildToolFailure = (params: {
  code: ToolFailureCode;
  message: string;
  hint: string;
  retryable: boolean;
  allowedActions?: string[];
}): ToolFailure => ({
  code: params.code,
  message: params.message,
  hint: params.hint,
  retryable: params.retryable,
  allowedActions: params.allowedActions ?? [],
});

// The legacy `error`/`message` strings stay populated from the same failure
// so nothing reading the old shape breaks during the migration.
export const toFailedToolOutput = (failure: ToolFailure): ToolOutput => ({
  success: false,
  message: failure.message,
  error: failure.message,
  failure,
});
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
cd packages/searm-server && npx jest build-tool-failure.util.spec
```

Expected: PASS, 3 tests.

- [ ] **Step 7: Lint, typecheck, commit**

```bash
npx nx lint:diff-with-main searm-server
npx nx typecheck searm-server
git add packages/searm-server/src/engine/core-modules/tool
git commit -m "feat(agent-api): add agent-safe tool failure envelope"
```

---

### Task 2: Wire the envelope into the proposal gate's FORBID decision

The gate is the single funnel for every AI write. `FORBID` is its only failure-shaped decision today — give it a structured `failure` instead of a bare string, so callers (Task 3) don't have to re-derive one.

**Files:**
- Modify: `packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval/services/proposal-gate.service.ts`
- Modify: `packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval/services/__tests__/proposal-gate.service.spec.ts`

**Interfaces:**
- Consumes: `buildToolFailure` (Task 1).
- Produces: `type GateDecision = { kind: 'ALLOW' } | { kind: 'FORBID'; failure: ToolFailure } | { kind: 'PROPOSED'; output: ToolOutput }` (the `CONFIRMATION_REQUIRED` kind is added in Task 5, not here).

- [ ] **Step 1: Update the existing failing assertion**

In `services/__tests__/proposal-gate.service.spec.ts`, replace the body of the existing `'should forbid a write when the policy resolves to FORBID'` test (verified present at line 168, HEAD `dba03d0907`).

**Harness note:** this spec provides the **real** `AiWritePolicyService` (line 87) and drives it through `setPolicy(...)` (line 61) — there is no `policyService.resolveMode` mock, and no `updateDescriptor` constant; the file's helpers are `crudDescriptor(operation)` (line 21), `staticDescriptor(toolId)` (line 37), `evaluate(descriptor, args)` (line 105) and `savedItem()` (line 110). Keeping the real policy service is deliberate — it is this task's real-seam coverage.

```ts
  it('should forbid a write when the policy resolves to FORBID', async () => {
    setPolicy({ default: 'FORBID', overrides: {} });

    const decision = await evaluate(crudDescriptor('update_one'), {
      id: 'record-1',
      jobTitle: 'New title',
    });

    expect(decision.kind).toBe('FORBID');
    if (decision.kind !== 'FORBID') {
      throw new Error('expected a forbid decision');
    }
    expect(decision.failure.code).toBe('FORBIDDEN_BY_POLICY');
    expect(decision.failure.retryable).toBe(false);
    expect(proposalItemRepository.save).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/searm-server && npx jest proposal-gate.service.spec
```

Expected: FAIL — `decision.failure` is `undefined` (the current `FORBID` branch only sets `message`).

- [ ] **Step 3: Update the service**

In `services/proposal-gate.service.ts`, add the import:

```ts
import { buildToolFailure } from 'src/engine/core-modules/tool/utils/build-tool-failure.util';
```

and the failure type import (used in the `GateDecision` type):

```ts
import { type ToolFailure } from 'src/engine/core-modules/tool/types/tool-failure.type';
```

Change the `GateDecision` type:

```ts
export type GateDecision =
  | { kind: 'ALLOW' }
  | { kind: 'FORBID'; failure: ToolFailure }
  | { kind: 'PROPOSED'; output: ToolOutput };
```

Replace the `FORBID` branch inside `evaluate()`:

```ts
    if (mode === 'FORBID') {
      return {
        kind: 'FORBID',
        failure: buildToolFailure({
          code: 'FORBIDDEN_BY_POLICY',
          message: `This workspace does not permit AI to perform "${descriptor.name}".`,
          hint: 'Ask a workspace admin to change the AI write policy for this object or tool, or ask a human to make this change directly.',
          retryable: false,
          allowedActions: ['ask_admin_to_change_policy'],
        }),
      };
    }
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd packages/searm-server && npx jest proposal-gate.service.spec
```

Expected: PASS — all pre-existing tests in the file (~19 `it` blocks at HEAD `dba03d0907`) including the updated one. Do not treat a higher count as a regression.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npx nx lint:diff-with-main searm-server
npx nx typecheck searm-server
git add packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval
git commit -m "feat(agent-api): give the proposal gate's FORBID decision a structured failure"
```

---

### Task 3: Thread the envelope through the tool executor and registry funnel

Every AI tool call resolves through exactly two chokepoints before it reaches an AI SDK `ToolSet`: `ToolExecutorService.dispatch()` (called by `hydrateToolSet`'s closures and by `resolveAndExecute`) and `ToolRegistryService.resolveAndExecute()` (used by the `execute_tool` meta-tool). This task builds a `failure` at every place those two files already build a failed `ToolOutput`.

**Files:**
- Modify: `packages/searm-server/src/engine/core-modules/tool-provider/services/tool-executor.service.ts`
- Modify: `packages/searm-server/src/engine/core-modules/tool-provider/services/tool-registry.service.ts`
- Modify: `packages/searm-server/src/engine/core-modules/tool-provider/utils/tool-error.util.ts`
- Test: `packages/searm-server/src/engine/core-modules/tool-provider/services/__tests__/tool-executor-gate.spec.ts` (extend)
- Test: `packages/searm-server/src/engine/core-modules/tool-provider/services/__tests__/tool-registry.service.spec.ts` (create)

**Interfaces:**
- Consumes: `GateDecision` (Task 2), `buildToolFailure`/`toFailedToolOutput` (Task 1), `findSimilarToolNames` (existing).
- Produces: `ToolExecutorService.dispatch()` and `ToolRegistryService.resolveAndExecute()` now populate `output.failure` on every failure path they construct directly.

- [ ] **Step 1: Extend the tool-executor gate test**

In `services/__tests__/tool-executor-gate.spec.ts`, replace the `'should return an error output when the gate forbids the write'` test:

```ts
  it('should return a structured failure when the gate forbids the write', async () => {
    gateService.evaluate.mockResolvedValue({
      kind: 'FORBID',
      failure: {
        code: 'FORBIDDEN_BY_POLICY',
        message: 'Not permitted',
        hint: 'Ask a workspace admin.',
        retryable: false,
        allowedActions: ['ask_admin_to_change_policy'],
      },
    });

    const result = await service.dispatch(
      updateDescriptor,
      { id: 'record-1', jobTitle: 'New title' },
      context,
    );

    expect(updateRecordService.execute).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.failure?.code).toBe('FORBIDDEN_BY_POLICY');
    expect(result.error).toBe('Not permitted');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/searm-server && npx jest tool-executor-gate.spec
```

Expected: FAIL — `dispatch()` still builds `{success:false, message: decision.message, error: decision.message}`, which no longer type-checks against the new `GateDecision` (`decision.message` doesn't exist on the `FORBID` variant anymore) and doesn't set `failure`.

- [ ] **Step 3: Update `ToolExecutorService.dispatch()`**

In `services/tool-executor.service.ts`, add the import:

```ts
import { toFailedToolOutput } from 'src/engine/core-modules/tool/utils/build-tool-failure.util';
```

Replace the `FORBID` branch inside `dispatch()`:

```ts
    if (decision.kind === 'FORBID') {
      return toFailedToolOutput(decision.failure);
    }
```

In `dispatchStaticTool()`, replace the "not available" branch:

```ts
    if (!(await provider.isAvailable(context))) {
      return toFailedToolOutput(
        buildToolFailure({
          code: 'PERMISSION_DENIED',
          message: `Tool "${descriptor.name}" is not available in this context.`,
          hint: 'Call get_tool_catalog to see the tools available to you.',
          retryable: false,
          allowedActions: ['get_tool_catalog'],
        }),
      );
    }
```

Add the matching import next to the one above:

```ts
import { buildToolFailure } from 'src/engine/core-modules/tool/utils/build-tool-failure.util';
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd packages/searm-server && npx jest tool-executor-gate.spec
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing test for the tool registry**

Create `services/__tests__/tool-registry.service.spec.ts`:

```ts
import { Test, type TestingModule } from '@nestjs/testing';

import { ToolExecutorService } from 'src/engine/core-modules/tool-provider/services/tool-executor.service';
import { ToolRegistryService } from 'src/engine/core-modules/tool-provider/services/tool-registry.service';
import { TOOL_PROVIDERS } from 'src/engine/core-modules/tool-provider/constants/tool-providers.token';
import { ToolOutputSpillService } from 'src/engine/core-modules/tool/services/tool-output-spill.service';

const context = {
  workspaceId: 'workspace-1',
  roleId: 'role-1',
};

describe('ToolRegistryService failure envelope', () => {
  let service: ToolRegistryService;

  const provider = {
    category: 'DATABASE_CRUD',
    isAvailable: jest.fn().mockResolvedValue(true),
    generateDescriptors: jest.fn().mockResolvedValue([
      {
        name: 'find_many_people',
        label: 'Find people',
        description: 'Find people',
        category: 'DATABASE_CRUD',
        executionRef: {
          kind: 'database_crud',
          objectNameSingular: 'person',
          operation: 'find_many',
        },
      },
    ]),
  };

  const toolExecutorService = { dispatch: jest.fn() };
  const toolOutputSpillService = { spillIfTooLarge: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ToolRegistryService,
        { provide: TOOL_PROVIDERS, useValue: [provider] },
        { provide: ToolExecutorService, useValue: toolExecutorService },
        { provide: ToolOutputSpillService, useValue: toolOutputSpillService },
      ],
    }).compile();

    service = module.get<ToolRegistryService>(ToolRegistryService);
  });

  it('should return an UNKNOWN_TOOL failure with a suggestion for a near-miss name', async () => {
    const output = await service.resolveAndExecute(
      'find_persons',
      {},
      context,
    );

    expect(output.success).toBe(false);
    expect(output.failure?.code).toBe('UNKNOWN_TOOL');
    expect(output.failure?.allowedActions).toContain('find_many_people');
    expect(toolExecutorService.dispatch).not.toHaveBeenCalled();
  });

  it('should return an INTERNAL_ERROR failure when dispatch throws', async () => {
    toolExecutorService.dispatch.mockRejectedValue(new Error('boom'));

    const output = await service.resolveAndExecute(
      'find_many_people',
      {},
      context,
    );

    expect(output.success).toBe(false);
    expect(output.failure?.code).toBe('INTERNAL_ERROR');
    expect(output.failure?.retryable).toBe(true);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

```bash
cd packages/searm-server && npx jest tool-registry.service.spec
```

Expected: FAIL — `output.failure` is `undefined` on both assertions.

- [ ] **Step 7: Update `ToolRegistryService.resolveAndExecute()`**

In `services/tool-registry.service.ts`, add the imports:

```ts
import {
  buildToolFailure,
  toFailedToolOutput,
} from 'src/engine/core-modules/tool/utils/build-tool-failure.util';
```

Replace the "not found" branch:

```ts
      if (!entry) {
        const similarToolNames = findSimilarToolNames(
          toolName,
          index.map((indexEntry) => indexEntry.name),
        );

        return toFailedToolOutput(
          buildToolFailure({
            code: 'UNKNOWN_TOOL',
            message: `Tool "${toolName}" not found.`,
            hint:
              similarToolNames.length > 0
                ? `Did you mean: ${similarToolNames.join(', ')}? Call learn_tools with the correct name, or call get_tool_catalog to browse all tools.`
                : 'Call get_tool_catalog to discover available tools.',
            retryable: false,
            allowedActions:
              similarToolNames.length > 0
                ? similarToolNames
                : ['get_tool_catalog'],
          }),
        );
      }
```

Replace the catch branch:

```ts
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(`Error executing tool "${toolName}": ${errorMessage}`);

      return toFailedToolOutput(
        buildToolFailure({
          code: 'INTERNAL_ERROR',
          message: `Failed to execute ${toolName}: ${errorMessage}`,
          hint: 'This looks like a transient failure. Retry once; if it persists, tell the user what you were trying to do.',
          retryable: true,
          allowedActions: ['retry'],
        }),
      );
    }
```

- [ ] **Step 8: Run the test to verify it passes**

```bash
cd packages/searm-server && npx jest tool-registry.service.spec
```

Expected: PASS, 2 tests.

- [ ] **Step 9: Update `wrapWithErrorHandler`**

In `utils/tool-error.util.ts`, replace the whole file:

```ts
import { buildToolFailure } from 'src/engine/core-modules/tool/utils/build-tool-failure.util';
import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';

export const wrapWithErrorHandler = (
  toolName: string,
  executeFn: (args: Record<string, unknown>) => Promise<ToolOutput>,
): ((args: Record<string, unknown>) => Promise<ToolOutput>) => {
  return async (args: Record<string, unknown>) => {
    try {
      return await executeFn(args);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      return {
        success: false,
        message: `Failed to execute ${toolName}`,
        error: errorMessage,
        failure: buildToolFailure({
          code: 'INTERNAL_ERROR',
          message: `Failed to execute ${toolName}: ${errorMessage}`,
          hint: 'This looks like a transient failure. Retry once; if it persists, tell the user what you were trying to do.',
          retryable: true,
          allowedActions: ['retry'],
        }),
      };
    }
  };
};
```

- [ ] **Step 10: Run the surrounding suites for regressions**

```bash
cd packages/searm-server && npx jest tool-provider
```

Expected: PASS. Existing suites that assert exact `message: 'Failed to execute ...'` text on `wrapWithErrorHandler`'s output are unaffected (`message` is unchanged; only `failure` is new).

- [ ] **Step 11: Lint, typecheck, commit**

```bash
npx nx lint:diff-with-main searm-server
npx nx typecheck searm-server
git add packages/searm-server/src/engine/core-modules/tool-provider
git commit -m "feat(agent-api): surface structured failures from the tool executor and registry"
```

---

### Task 4: Surface the failure envelope over MCP

`McpToolExecutorService.handleToolCall()` is the literal JSON an external MCP client receives. Today an unknown tool name or an uncaught exception reaches the client as either a bare JSON-RPC `error.message` string or `content[0].text` set to `executionError.message` — no code, no hint, no retryable flag. This is the gap named explicitly in the anchors report.

**Files:**
- Modify: `packages/searm-server/src/engine/api/mcp/services/mcp-tool-executor.service.ts`
- Test: `packages/searm-server/src/engine/api/mcp/services/__tests__/mcp-tool-executor.service.spec.ts` (extend)

**Interfaces:**
- Consumes: `buildToolFailure`/`toFailedToolOutput` (Task 1).
- Produces: `McpToolExecutorService.handleToolCall()` — signature unchanged; JSON-RPC error responses now carry `error.data` with the structured failure, and the `isError: true` result branch's `content[0].text` is now `JSON.stringify(ToolOutput)` (with `.failure`) instead of a bare string.

- [ ] **Step 1: Read the existing test file to match its harness**

Open `services/__tests__/mcp-tool-executor.service.spec.ts` and copy its `MetricsService` mock setup verbatim — do not invent a different one.

- [ ] **Step 2: Write the failing assertions**

Add to the existing describe block (or a new one in the same file):

```ts
  it('should include a structured failure in error.data for an unknown tool name', async () => {
    const response = await service.handleToolCall(1, {}, { name: 'nope' });

    expect(response.error?.data?.failure?.code).toBe('UNKNOWN_TOOL');
    expect(response.error?.data?.failure?.retryable).toBe(false);
  });

  it('should JSON-encode a structured failure in content[0].text when execution throws', async () => {
    const toolSet = {
      broken_tool: {
        inputSchema: {},
        execute: jest.fn().mockRejectedValue(new Error('downstream boom')),
      },
    };

    const response = await service.handleToolCall(1, toolSet, {
      name: 'broken_tool',
      arguments: {},
    });

    const parsed = JSON.parse(response.result.content[0].text);

    expect(response.result.isError).toBe(true);
    expect(parsed.success).toBe(false);
    expect(parsed.failure.code).toBe('INTERNAL_ERROR');
    expect(parsed.failure.retryable).toBe(true);
  });
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd packages/searm-server && npx jest mcp-tool-executor.service.spec
```

Expected: FAIL — `response.error.data` is `undefined`; `response.result.content[0].text` is the bare string `'downstream boom'`, not JSON.

- [ ] **Step 4: Update the service**

In `services/mcp-tool-executor.service.ts`, add the imports:

```ts
import {
  buildToolFailure,
  toFailedToolOutput,
} from 'src/engine/core-modules/tool/utils/build-tool-failure.util';
```

Replace the "Tool name is required" and "Unknown tool" branches:

```ts
    if (!isNonEmptyString(params.name)) {
      const failure = buildToolFailure({
        code: 'INVALID_ARGUMENTS',
        message: 'Tool name is required',
        hint: 'Call tools/list first to see available tool names.',
        retryable: false,
      });

      return wrapJsonRpcResponse(id, {
        error: {
          code: JSON_RPC_ERROR_CODE.INVALID_PARAMS,
          message: failure.message,
          data: { failure },
        },
      });
    }

    const toolName = params.name;
    const tool = toolSet[toolName];

    if (!isDefined(tool) || !isDefined(tool.execute)) {
      const failure = buildToolFailure({
        code: 'UNKNOWN_TOOL',
        message: `Unknown tool: ${toolName}`,
        hint: 'Call tools/list to see the tools available to this session.',
        retryable: false,
      });

      return wrapJsonRpcResponse(id, {
        error: {
          code: JSON_RPC_ERROR_CODE.INVALID_PARAMS,
          message: failure.message,
          data: { failure },
        },
      });
    }
```

Replace the catch branch's return:

```ts
    } catch (executionError) {
      this.metricsService.recordHistogram({
        key: MetricsKeys.McpToolExecutionDurationMs,
        value: performance.now() - executionStartedAt,
        unit: 'ms',
        attributes: { tool: metricToolName },
        bucketBoundaries: TOOL_EXECUTION_DURATION_MS_BUCKET_BOUNDARIES,
      });

      this.metricsService.incrementCounterBy({
        key: MetricsKeys.McpToolExecutionFailed,
        amount: 1,
        attributes: { tool: metricToolName },
      });

      const errorMessage =
        executionError instanceof Error
          ? executionError.message
          : 'Tool execution failed';

      const failedOutput = toFailedToolOutput(
        buildToolFailure({
          code: 'INTERNAL_ERROR',
          message: errorMessage,
          hint: 'This looks like a transient failure. Retry once; if it persists, stop and report it.',
          retryable: true,
          allowedActions: ['retry'],
        }),
      );

      return wrapJsonRpcResponse(id, {
        result: {
          content: [{ type: 'text', text: JSON.stringify(failedOutput) }],
          isError: true,
        },
      });
    }
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd packages/searm-server && npx jest mcp-tool-executor.service.spec
```

Expected: PASS, all existing tests plus the 2 new ones.

- [ ] **Step 6: Lint, typecheck, commit**

```bash
npx nx lint:diff-with-main searm-server
npx nx typecheck searm-server
git add packages/searm-server/src/engine/api/mcp
git commit -m "feat(agent-api): surface structured failures over the MCP transport"
```

---

### Task 5: Confirmation-token semantics for AI-requested deletes

Under the Launch 1 default policy (`PROPOSE`), an AI-requested delete already stops at a human-reviewed proposal — no single AI call ever deletes anything. The gap this task closes is the **AUTO** fast path: a workspace admin who has opted an object's deletes into `AUTO` still has a single AI tool call that deletes a record immediately. This task adds a deterministic confirm-token round trip to that one path — a second call is required even when the write is otherwise auto-approved. Nothing here touches the human UI delete mutation.

**Files:**
- Create: `packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval/utils/build-delete-confirmation-token.util.ts`
- Modify: `packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval/services/proposal-gate.service.ts`
- Modify: `packages/searm-server/src/engine/core-modules/record-crud/zod-schemas/delete-tool.zod-schema.ts`
- Modify: `packages/searm-server/src/engine/core-modules/record-crud/zod-schemas/bulk-delete-tool.zod-schema.ts`
- Test: `packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval/utils/__tests__/build-delete-confirmation-token.util.spec.ts`
- Test: `packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval/services/__tests__/proposal-gate.service.spec.ts` (extend)

**Interfaces:**
- Consumes: `buildToolFailure` (Task 1).
- Produces:
  - `buildDeleteConfirmationToken(params: { workspaceId: string; objectNameSingular: string; basis: string }): string`
  - `GateDecision` gains `{ kind: 'CONFIRMATION_REQUIRED'; failure: ToolFailure }`.
  - `GateInput` gains two **optional** properties, `confirm?: string | null` and `confirmationBasis?: string | null`, set only in the `delete_one` and `delete_many` branches of `buildCrudGateInput`. Every other property of `GateInput` — `target`, `actionType`, `objectNameSingular`, `recordId`, `toolId`, `toolCategory`, `payload`, `baselineFieldNames` — and the whole gated/ungated classification are **unchanged by this task**.

- [ ] **Step 1: Write the failing test for the token util**

Create `utils/__tests__/build-delete-confirmation-token.util.spec.ts`:

```ts
import { buildDeleteConfirmationToken } from 'src/engine/metadata-modules/ai/ai-write-approval/utils/build-delete-confirmation-token.util';

describe('buildDeleteConfirmationToken', () => {
  it('should be deterministic for the same inputs', () => {
    const params = {
      workspaceId: 'workspace-1',
      objectNameSingular: 'person',
      basis: 'record-1',
    };

    expect(buildDeleteConfirmationToken(params)).toBe(
      buildDeleteConfirmationToken(params),
    );
  });

  it('should differ when the record id differs', () => {
    const tokenA = buildDeleteConfirmationToken({
      workspaceId: 'workspace-1',
      objectNameSingular: 'person',
      basis: 'record-1',
    });
    const tokenB = buildDeleteConfirmationToken({
      workspaceId: 'workspace-1',
      objectNameSingular: 'person',
      basis: 'record-2',
    });

    expect(tokenA).not.toBe(tokenB);
  });

  it('should differ across workspaces for the same record id', () => {
    const tokenA = buildDeleteConfirmationToken({
      workspaceId: 'workspace-1',
      objectNameSingular: 'person',
      basis: 'record-1',
    });
    const tokenB = buildDeleteConfirmationToken({
      workspaceId: 'workspace-2',
      objectNameSingular: 'person',
      basis: 'record-1',
    });

    expect(tokenA).not.toBe(tokenB);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/searm-server && npx jest build-delete-confirmation-token.util.spec
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the util**

Create `utils/build-delete-confirmation-token.util.ts`:

```ts
import { createHash } from 'crypto';

// Stateless and deterministic: no confirmation record is written or expired,
// the server just recomputes the hash and compares. `basis` is the record id
// for delete_one, or a stable stringified filter for delete_many.
export const buildDeleteConfirmationToken = (params: {
  workspaceId: string;
  objectNameSingular: string;
  basis: string;
}): string => {
  const { workspaceId, objectNameSingular, basis } = params;

  return createHash('sha256')
    .update(`ai-delete:${workspaceId}:${objectNameSingular}:${basis}`)
    .digest('hex')
    .slice(0, 10);
};
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd packages/searm-server && npx jest build-delete-confirmation-token.util.spec
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Add `confirm` to the delete tool schemas**

Zod's default `z.object()` strips unrecognized keys before `execute` ever runs, so `confirm` must be a declared field or it never reaches the gate.

Edit `zod-schemas/delete-tool.zod-schema.ts`:

```ts
import { z } from 'zod';

export const DeleteToolInputSchema = z.object({
  id: z.string().uuid().describe('The unique UUID of the record to delete'),
  confirm: z
    .string()
    .optional()
    .describe(
      'Confirmation token. Omit on the first call. If the workspace requires confirmation, the response tells you the exact token to pass here on a second, identical call.',
    ),
});

export type DeleteToolInput = z.infer<typeof DeleteToolInputSchema>;
```

Edit `zod-schemas/bulk-delete-tool.zod-schema.ts` — add `confirm` alongside `filter` in the returned object:

```ts
  return z.object({
    filter: filterSchema.describe(
      'Filter to select which records to delete. Supports field-level filters and logical operators (or, and, not). WARNING: A broad filter may delete many records at once. Always verify the filter scope with a find query first.',
    ),
    confirm: z
      .string()
      .optional()
      .describe(
        'Confirmation token. Omit on the first call. If the workspace requires confirmation, the response tells you the exact token to pass here on a second, identical call.',
      ),
  });
```

- [ ] **Step 6: Write the failing gate tests**

Add to `services/__tests__/proposal-gate.service.spec.ts`, in a new `describe('delete confirmation (AUTO mode)', ...)` block.

**Use the harness that is actually in that file.** Verified at `packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval/services/__tests__/proposal-gate.service.spec.ts:49-110` (HEAD `dba03d0907`): there is **no `policyService.resolveMode` mock**. `AiWritePolicyService` is provided *real* (line 87) and the policy is set through `setPolicy(policy)` (line 61), which stubs `keyValuePairService.get`. The file also defines the helpers `crudDescriptor(operation, objectNameSingular = 'person')` (line 21), `staticDescriptor(toolId, category = 'action')` (line 37), `evaluate(descriptor, args)` (line 105) and `savedItem()` (line 110). There is no `updateDescriptor` constant — it is `crudDescriptor('update_one')`. Reuse all of these; do not introduce a mocked policy service.

**This is the task's real-seam test.** The gate → policy resolution runs through the real `AiWritePolicyService`, and the expected confirm token is computed by the real `buildDeleteConfirmationToken` from Step 3 rather than being hard-coded or stubbed — so a divergence between the token the gate emits and the token the util produces fails the suite instead of agreeing with a mock.

```ts
import { buildDeleteConfirmationToken } from 'src/engine/metadata-modules/ai/ai-write-approval/utils/build-delete-confirmation-token.util';

describe('delete confirmation (AUTO mode)', () => {
  // Confirmation only guards the AUTO fast path — a PROPOSE-mode delete
  // already stops at human review, which is the stronger gate.
  beforeEach(() => {
    setPolicy({ default: 'AUTO', overrides: {} });
  });

  it('should require confirmation before an AUTO-mode delete_one executes', async () => {
    const decision = await evaluate(crudDescriptor('delete_one'), {
      id: 'record-1',
    });

    expect(decision.kind).toBe('CONFIRMATION_REQUIRED');
    if (decision.kind !== 'CONFIRMATION_REQUIRED') {
      throw new Error('expected a confirmation-required decision');
    }
    expect(decision.failure.code).toBe('CONFIRMATION_REQUIRED');
    expect(decision.failure.retryable).toBe(true);
    expect(decision.failure.hint).toContain(
      buildDeleteConfirmationToken({
        workspaceId: 'workspace-1',
        objectNameSingular: 'person',
        basis: 'record-1',
      }),
    );
    expect(proposalItemRepository.save).not.toHaveBeenCalled();
  });

  it('should allow the delete once the correct token is echoed back', async () => {
    const first = await evaluate(crudDescriptor('delete_one'), {
      id: 'record-1',
    });

    if (first.kind !== 'CONFIRMATION_REQUIRED') {
      throw new Error('expected a confirmation-required decision');
    }

    // The token is quoted in the hint; extract it the same way an agent
    // reading the hint would.
    const token = first.failure.hint.match(/confirm:\s*"([^"]+)"/)?.[1];

    const second = await evaluate(crudDescriptor('delete_one'), {
      id: 'record-1',
      confirm: token,
    });

    expect(second.kind).toBe('ALLOW');
  });

  it('should reject a wrong token', async () => {
    const decision = await evaluate(crudDescriptor('delete_one'), {
      id: 'record-1',
      confirm: 'not-the-real-token',
    });

    expect(decision.kind).toBe('CONFIRMATION_REQUIRED');
  });

  // I17: delete_many is the case the feature exists for — a broad AUTO-mode
  // bulk delete. The basis is the filter, not a record id.
  it('should require confirmation for an AUTO-mode delete_many, keyed on the filter', async () => {
    const filter = { stage: { eq: 'LOST' } };

    const first = await evaluate(crudDescriptor('delete_many'), { filter });

    expect(first.kind).toBe('CONFIRMATION_REQUIRED');
    if (first.kind !== 'CONFIRMATION_REQUIRED') {
      throw new Error('expected a confirmation-required decision');
    }
    expect(first.failure.hint).toContain(
      buildDeleteConfirmationToken({
        workspaceId: 'workspace-1',
        objectNameSingular: 'person',
        basis: JSON.stringify(filter),
      }),
    );

    const token = first.failure.hint.match(/confirm:\s*"([^"]+)"/)?.[1];

    const second = await evaluate(crudDescriptor('delete_many'), {
      filter,
      confirm: token,
    });

    expect(second.kind).toBe('ALLOW');
  });

  it('should give a different delete_many token for a different filter', async () => {
    const first = await evaluate(crudDescriptor('delete_many'), {
      filter: { stage: { eq: 'LOST' } },
    });
    const second = await evaluate(crudDescriptor('delete_many'), {
      filter: { stage: { eq: 'WON' } },
    });

    if (
      first.kind !== 'CONFIRMATION_REQUIRED' ||
      second.kind !== 'CONFIRMATION_REQUIRED'
    ) {
      throw new Error('expected two confirmation-required decisions');
    }
    expect(first.failure.hint).not.toBe(second.failure.hint);
  });

  it('should not require confirmation for a non-delete AUTO write', async () => {
    const decision = await evaluate(crudDescriptor('update_one'), {
      id: 'record-1',
      jobTitle: 'New title',
    });

    expect(decision.kind).toBe('ALLOW');
  });

  it('should not require confirmation for a PROPOSE-mode delete', async () => {
    setPolicy({ default: 'PROPOSE', overrides: {} });

    const decision = await evaluate(crudDescriptor('delete_one'), {
      id: 'record-1',
    });

    expect(decision.kind).toBe('PROPOSED');
  });
});
```

- [ ] **Step 6b: Write the gate-classification regression tests**

These are the tests that fail loudly if Step 8 is ever rewritten into an allowlist. Add them to the **existing** `describe('denylist', ...)` block (verified present at `proposal-gate.service.spec.ts:311`, alongside `'should gate a CRUD operation nobody has classified'` at line 312 and `'should gate an unknown static tool'` at line 320 — those two must stay green, unchanged, after this task).

```ts
    // C9 regression: the classification is a denylist. A write tool nobody
    // enumerated must still be gated, in AUTO mode as well as PROPOSE.
    it('should still gate an unenumerated write tool under an AUTO default', async () => {
      setPolicy({ default: 'PROPOSE', overrides: {} });

      const decision = await evaluate(
        staticDescriptor('some_tool_added_next_quarter'),
        { anything: true },
      );

      expect(decision.kind).toBe('PROPOSED');
      expect(savedItem()).toMatchObject({
        toolId: 'some_tool_added_next_quarter',
        toolCategory: 'action',
      });
    });

    it('should still gate a CRUD operation nobody has classified, keeping its baseline contract', async () => {
      setPolicy({ default: 'PROPOSE', overrides: {} });

      const decision = await evaluate(crudDescriptor('archive_one'), {
        id: 'record-1',
      });

      expect(decision.kind).toBe('PROPOSED');
      expect(savedItem()).toMatchObject({
        objectNameSingular: 'person',
        recordId: 'record-1',
      });
    });

    it('should keep the delete_one staleness baseline after the confirmation change', async () => {
      setPolicy({ default: 'PROPOSE', overrides: {} });

      await evaluate(crudDescriptor('delete_one'), { id: 'record-1' });

      // baselineFieldNames is ['updatedAt'] for a delete; readBaseline is
      // therefore called and the saved item carries a non-empty baseline.
      expect(findRecordsService.execute).toHaveBeenCalledWith(
        expect.objectContaining({ select: ['updatedAt'] }),
      );
    });
```

- [ ] **Step 7: Run the tests to verify they fail**

```bash
cd packages/searm-server && npx jest proposal-gate.service.spec
```

Expected: FAIL — `CONFIRMATION_REQUIRED` is not a member of `GateDecision` yet and AUTO always returns `ALLOW` unconditionally.

- [ ] **Step 8: Update the gate**

In `services/proposal-gate.service.ts`, add the import:

```ts
import { buildDeleteConfirmationToken } from 'src/engine/metadata-modules/ai/ai-write-approval/utils/build-delete-confirmation-token.util';
```

Extend `GateDecision`:

```ts
export type GateDecision =
  | { kind: 'ALLOW' }
  | { kind: 'FORBID'; failure: ToolFailure }
  | { kind: 'CONFIRMATION_REQUIRED'; failure: ToolFailure }
  | { kind: 'PROPOSED'; output: ToolOutput };
```

> **C9 — read this before touching the file.** An earlier draft of this step replaced `buildGateInput` wholesale with a version written against a file that no longer exists. That replacement inverted the gate from a **denylist** to an **allowlist** (`GATED_CRUD_OPERATIONS`/`GATED_STATIC_TOOL_IDS`, neither of which exists), and deleted `target`, `toolId`, `toolCategory`, and `baselineFieldNames`. It has been deleted. **This task does not change how anything is classified.** It is purely additive: two optional properties on `GateInput`, set in two branches of `buildCrudGateInput`, plus one check in `evaluate()`.
>
> Verified against `packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval/services/proposal-gate.service.ts` at HEAD `dba03d0907`. The live classification, which must survive this task **unchanged**:
> - `UNGATED_CRUD_OPERATIONS = ['find_many','find_one','group_by']` (line 44) — a true denylist; every other CRUD operation, including one added next quarter, is gated. The `buildCrudGateInput` fallback at line 372 gates unclassified operations under `ProposalActionType.STATIC_TOOL`.
> - `UNGATED_STATIC_TOOL_IDS` (line 50) — a static tool is gated unless it appears in this 22-entry list. `code_interpreter` is in it (sandboxed compute, no write path).
> - `isGatedStaticTool` (line 241) — `http_request` is ungated only for `GET`/`HEAD` (`UNGATED_HTTP_METHODS`, line 88); every other method is gated.
> - `GateInput` (line 29) carries `target`, `actionType`, `objectNameSingular`, `recordId`, `toolId`, `toolCategory`, `payload`, `baselineFieldNames`. `evaluate()` reads `gateInput.target` (line 145) for policy resolution and persists `toolId`/`toolCategory` (lines 173-174), which `ProposalExecutionService.applyStaticTool` requires to replay an approved static tool. `DELETE_BASELINE_FIELD_NAMES = ['updatedAt']` (line 107) is the delete staleness witness.
>
> Do not add, remove, or reorder any entry in `UNGATED_CRUD_OPERATIONS`, `UNGATED_STATIC_TOOL_IDS`, or `UNGATED_HTTP_METHODS` in this task. Do not touch `buildGateInput`, `isGatedStaticTool`, or any non-delete branch of `buildCrudGateInput`.

**8a. Extend the `GateInput` type** (the live type at line 29). Add two optional properties at the end; change nothing else:

```ts
type GateInput = {
  target: AiWritePolicyTarget;
  actionType: ProposalActionType;
  objectNameSingular: string | null;
  recordId: string | null;
  toolId: string | null;
  toolCategory: string | null;
  // Exactly what approval replays. Never a policy projection.
  payload: Record<string, unknown>;
  // Fields snapshotted so approval can detect a human edit in between.
  baselineFieldNames: string[];
  // AI-requested deletes only. `confirmationBasis` is what the token hashes
  // over — the record id for delete_one, the stringified filter for
  // delete_many. Absent on every other branch, which is what keeps the
  // confirmation check scoped to deletes.
  confirm?: string | null;
  confirmationBasis?: string | null;
};
```

**8b. Set them in the two delete branches of `buildCrudGateInput`.** Replace only the `delete_one` branch (live lines 291-301):

```ts
    if (operation === 'delete_one') {
      const { id, confirm } = args;

      return {
        ...base,
        target: { kind: 'record', objectNameSingular, fieldNames: [] },
        recordId: typeof id === 'string' ? id : null,
        payload: {},
        baselineFieldNames: DELETE_BASELINE_FIELD_NAMES,
        confirm: typeof confirm === 'string' ? confirm : null,
        confirmationBasis: typeof id === 'string' ? id : null,
      };
    }
```

and only the `delete_many` branch (live lines 359-367):

```ts
    if (operation === 'delete_many') {
      const filter = args.filter ?? {};

      return {
        ...base,
        target: { kind: 'record', objectNameSingular, fieldNames: [] },
        recordId: null,
        payload: { filter },
        baselineFieldNames: [],
        confirm: typeof args.confirm === 'string' ? args.confirm : null,
        // Stringified filter, so two different filters get two different
        // tokens and a confirmed narrow delete cannot be widened on the
        // second call.
        confirmationBasis: JSON.stringify(filter),
      };
    }
```

Both branches already build their `payload` from named fields (`{}` and `{ filter }`), so the `confirm` key can never leak into a replayed payload — no stripping is required, and none is added. `update_one`/`create_one`/`create_many`/`upsert_many`/`update_many` and the unclassified fallback are untouched: they never see a `confirm` key, because Step 5 added it to the delete Zod schemas only.

**8c. Insert the confirmation check in `evaluate()`.** Replace the live `mode === 'AUTO'` branch (lines 148-150):

```ts
    if (mode === 'AUTO') {
      // I17: DELETE_RECORDS as well as DELETE_RECORD — an AUTO-policy bulk
      // delete is the exact case this exists for.
      if (
        (gateInput.actionType === ProposalActionType.DELETE_RECORD ||
          gateInput.actionType === ProposalActionType.DELETE_RECORDS) &&
        isDefined(gateInput.confirmationBasis)
      ) {
        const expectedToken = buildDeleteConfirmationToken({
          workspaceId: context.workspaceId,
          objectNameSingular: gateInput.objectNameSingular ?? '',
          basis: gateInput.confirmationBasis,
        });

        if (gateInput.confirm !== expectedToken) {
          return {
            kind: 'CONFIRMATION_REQUIRED',
            failure: buildToolFailure({
              code: 'CONFIRMATION_REQUIRED',
              message:
                gateInput.actionType === ProposalActionType.DELETE_RECORDS
                  ? `Deleting ${gateInput.objectNameSingular} records matching this filter is irreversible from this tool.`
                  : `Deleting this ${gateInput.objectNameSingular} record is irreversible from this tool.`,
              hint: `Confirm with the user, then repeat this exact call with confirm: "${expectedToken}".`,
              retryable: true,
              allowedActions: ['retry_with_confirm_token'],
            }),
          };
        }
      }

      return { kind: 'ALLOW' };
    }
```

- [ ] **Step 9: Run the tests to verify they pass**

```bash
cd packages/searm-server && npx jest proposal-gate.service.spec
```

Expected: PASS — all pre-existing tests in the file (verified ~19 `it` blocks at HEAD `dba03d0907`, including the two `describe('denylist')` cases this task must keep green) plus the 7 new confirmation tests from Step 6 and the 3 classification-regression tests from Step 6b. Do not "repair" the suite to match a count; if a pre-existing denylist test now fails, Step 8 was applied wrongly — revert it.

- [ ] **Step 10: Update `ToolExecutorService.dispatch()` to handle the new decision kind**

In `services/tool-executor.service.ts`, add a branch right after the `FORBID` branch:

```ts
    if (decision.kind === 'CONFIRMATION_REQUIRED') {
      return toFailedToolOutput(decision.failure);
    }
```

- [ ] **Step 11: Regression-check the surrounding suites**

```bash
cd packages/searm-server && npx jest tool-executor-gate.spec
```

Expected: PASS — the `ALLOW` test still passes because it uses `update_one`, which never reaches the confirmation branch.

- [ ] **Step 12: Lint, typecheck, commit**

```bash
npx nx lint:diff-with-main searm-server
npx nx typecheck searm-server
git add packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval packages/searm-server/src/engine/core-modules/record-crud/zod-schemas packages/searm-server/src/engine/core-modules/tool-provider
git commit -m "feat(agent-api): require confirmation for AI-requested AUTO-mode deletes"
```

---

### Task 6: Idempotent proposal items — dedupe retried writes within one proposal

> **Program integration — this task rewrites a block two other phases also edit.** The replacement below is the *merged* version: it preserves `gateInput.baselineFieldNames` (Launch 1 — a `delete_one` has an empty payload but a `['updatedAt']` baseline; reading the baseline from `Object.keys(payload)` would silently disable staleness detection for every delete) and it preserves the `factIds` lookup (Phase 2 Task 8). Apply this task **after** Phase 2 Task 8 and Phase 4 Tasks 2 and 5. If Phase 2 has not shipped, delete the two `factIds` lines and nothing else changes.
>
> Note also that this item-level dedupe is a *different* mechanism from Phase 3 Task 1's `ProposalEntity.sourceKey`, which is batch-level idempotency for background jobs that have no `threadId`. Both ship; neither replaces the other.

An agent that times out waiting for a tool response and retries the identical call, or an MCP client that resends after a dropped connection, produces two `ProposalItem`s for the same intended write if nothing dedupes them — both get approved, both apply, and the record ends up duplicated. Proposals already batch every write from one agent turn into a single pending proposal keyed by `threadId` (Launch 1's `getOrCreatePendingProposal`); this task uses that same batch to detect and collapse an exact repeat before a second row is ever written. No schema migration is needed — this reuses the proposal that's already loaded.

**Files:**
- Modify: `packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval/services/proposal-gate.service.ts`
- Modify: `packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval/services/__tests__/proposal-gate.service.spec.ts`

**Interfaces:**
- Consumes: `ProposalItemEntity` (Launch 1, unchanged).
- Produces: `ProposalGateService.evaluate()` returns the **existing** item's `PROPOSED` output (with a distinguishing message) instead of writing a new row when an identical pending item already exists in the same proposal.

- [ ] **Step 1: Write the failing test**

Add to `services/__tests__/proposal-gate.service.spec.ts`:

```ts
describe('duplicate write detection', () => {
  it('should reuse an existing pending item instead of creating a duplicate', async () => {
    policyService.resolveMode.mockReturnValue('PROPOSE');
    proposalRepository.findOne.mockResolvedValue({ id: 'proposal-existing' });
    proposalItemRepository.find.mockResolvedValue([
      {
        id: 'item-existing',
        proposalId: 'proposal-existing',
        actionType: 'UPDATE_RECORD',
        objectNameSingular: 'person',
        recordId: 'record-1',
        payload: { jobTitle: 'New title' },
        status: 'PENDING',
      },
    ]);

    const decision = await service.evaluate({
      descriptor: updateDescriptor,
      args: { id: 'record-1', jobTitle: 'New title' },
      context,
    });

    expect(decision.kind).toBe('PROPOSED');
    if (decision.kind !== 'PROPOSED') {
      throw new Error('expected a proposed decision');
    }
    expect(decision.output.result).toMatchObject({
      proposalItemId: 'item-existing',
    });
    expect(proposalItemRepository.save).not.toHaveBeenCalled();
  });

  it('should still create a new item when the payload differs', async () => {
    policyService.resolveMode.mockReturnValue('PROPOSE');
    proposalRepository.findOne.mockResolvedValue({ id: 'proposal-existing' });
    proposalItemRepository.find.mockResolvedValue([
      {
        id: 'item-existing',
        proposalId: 'proposal-existing',
        actionType: 'UPDATE_RECORD',
        objectNameSingular: 'person',
        recordId: 'record-1',
        payload: { jobTitle: 'A different title' },
        status: 'PENDING',
      },
    ]);

    const decision = await service.evaluate({
      descriptor: updateDescriptor,
      args: { id: 'record-1', jobTitle: 'New title' },
      context,
    });

    expect(decision.kind).toBe('PROPOSED');
    expect(proposalItemRepository.save).toHaveBeenCalled();
  });
});
```

Add `find: jest.fn().mockResolvedValue([])` to the `proposalItemRepository` mock object at the top of the file (default: no pre-existing items, so the pre-existing tests in this file are unaffected).

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/searm-server && npx jest proposal-gate.service.spec
```

Expected: FAIL — `proposalItemRepository.find` is never called by `evaluate()` today, so `decision.output.result.proposalItemId` is a freshly-saved id, not `'item-existing'`.

- [ ] **Step 3: Update the gate**

In `services/proposal-gate.service.ts`, replace the write-proposing block inside `evaluate()` (from `const baseline = ...` through the `return { kind: 'PROPOSED', ... }`):

```ts
    const proposal = await this.getOrCreatePendingProposal(context);

    const existingItem = await this.findDuplicatePendingItem({
      proposalId: proposal.id,
      actionType: gateInput.actionType,
      objectNameSingular: gateInput.objectNameSingular,
      recordId: gateInput.recordId,
      payload: gateInput.payload,
    });

    if (isDefined(existingItem)) {
      return {
        kind: 'PROPOSED',
        output: {
          success: true,
          message:
            'This exact change is already awaiting human approval from an earlier call in this turn. Do not retry.',
          result: {
            proposalId: proposal.id,
            proposalItemId: existingItem.id,
            status: existingItem.status,
          },
        },
      };
    }

    const baseline = await this.readBaseline({
      objectNameSingular: gateInput.objectNameSingular,
      recordId: gateInput.recordId,
      // Not Object.keys(payload): a delete has an empty payload but a real
      // ['updatedAt'] staleness witness. This is Launch 1's field list.
      fieldNames: gateInput.baselineFieldNames,
      context,
    });

    // Phase 2 Task 8. Drop these two statements if Phase 2 has not shipped.
    const factIds = await this.factLookupService.findCurrentFactIdsForFields({
      workspaceId: context.workspaceId,
      objectNameSingular: gateInput.objectNameSingular ?? '',
      recordId: gateInput.recordId ?? '',
      fieldNames: Object.keys(gateInput.payload),
    });

    const item = await this.proposalItemRepository.save({
      proposalId: proposal.id,
      actionType: gateInput.actionType,
      objectNameSingular: gateInput.objectNameSingular,
      recordId: gateInput.recordId,
      toolId: gateInput.toolId,
      toolCategory: gateInput.toolCategory,
      payload: gateInput.payload,
      baseline,
      factIds,
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
```

Add the new private method, near `getOrCreatePendingProposal`:

```ts
  // A retried tool call inside the same turn must not create a second
  // reviewable item for the same intended change. Deep-equal payload is
  // enough here because the batch is already scoped to one proposal.
  private async findDuplicatePendingItem(params: {
    proposalId: string;
    actionType: ProposalActionType;
    objectNameSingular: string | null;
    recordId: string | null;
    payload: Record<string, unknown>;
  }): Promise<ProposalItemEntity | undefined> {
    const items = await this.proposalItemRepository.find({
      where: {
        proposalId: params.proposalId,
        status: ProposalItemStatus.PENDING,
      },
    });

    return items.find(
      (item) =>
        item.actionType === params.actionType &&
        item.objectNameSingular === params.objectNameSingular &&
        item.recordId === params.recordId &&
        JSON.stringify(item.payload) === JSON.stringify(params.payload),
    );
  }
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd packages/searm-server && npx jest proposal-gate.service.spec
```

Expected: PASS, all existing plus the 2 new duplicate-detection tests.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npx nx lint:diff-with-main searm-server
npx nx typecheck searm-server
git add packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval
git commit -m "feat(agent-api): dedupe retried AI writes within one pending proposal"
```

---

### Task 7: Stable pagination signal — `hasMore`

Pagination is already stable (`id` is always appended as an `orderBy` tiebreaker) and the total count is already returned. What's missing is an explicit "should I keep paging" boolean — today an agent has to compute `offset + records.length < count` itself, and frequently doesn't.

**Files:**
- Modify: `packages/searm-server/src/engine/core-modules/record-crud/types/find-records-result.type.ts`
- Modify: `packages/searm-server/src/engine/core-modules/record-crud/services/find-records.service.ts`
- Test: `packages/searm-server/src/engine/core-modules/record-crud/services/__tests__/find-records.service.spec.ts`

**Interfaces:**
- Consumes: `CommonFindManyQueryRunnerService.execute` (existing, unchanged).
- Produces: `type FindRecordsResult = { records: unknown[]; count: number; hasMore: boolean }`.

- [ ] **Step 1: Write the failing test**

Create `services/__tests__/find-records.service.spec.ts`:

```ts
import { Test, type TestingModule } from '@nestjs/testing';

import { CommonApiContextBuilderService } from 'src/engine/core-modules/record-crud/services/common-api-context-builder.service';
import { CommonFindManyQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-find-many-query-runner.service';
import { FindRecordsService } from 'src/engine/core-modules/record-crud/services/find-records.service';

describe('FindRecordsService hasMore', () => {
  let service: FindRecordsService;

  const commonFindManyRunner = { execute: jest.fn() };
  const commonApiContextBuilder = {
    build: jest.fn().mockResolvedValue({
      queryRunnerContext: {},
      selectedFields: { id: true },
      flatObjectMetadata: {},
      flatFieldMetadataMaps: {},
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    commonApiContextBuilder.build.mockResolvedValue({
      queryRunnerContext: {},
      selectedFields: { id: true },
      flatObjectMetadata: {},
      flatFieldMetadataMaps: {},
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FindRecordsService,
        {
          provide: CommonFindManyQueryRunnerService,
          useValue: commonFindManyRunner,
        },
        {
          provide: CommonApiContextBuilderService,
          useValue: commonApiContextBuilder,
        },
      ],
    }).compile();

    service = module.get<FindRecordsService>(FindRecordsService);
  });

  it('should set hasMore true when more records exist beyond this page', async () => {
    commonFindManyRunner.execute.mockResolvedValue({
      results: {
        records: [{ id: 'a' }, { id: 'b' }],
        totalCount: 10,
      },
    });

    const output = await service.execute({
      objectName: 'person',
      limit: 2,
      offset: 0,
      shouldBuildEffectiveSelectFields: false,
      authContext: {} as never,
      rolePermissionConfig: {} as never,
    });

    expect(output.result?.hasMore).toBe(true);
  });

  it('should set hasMore false on the last page', async () => {
    commonFindManyRunner.execute.mockResolvedValue({
      results: {
        records: [{ id: 'i' }, { id: 'j' }],
        totalCount: 10,
      },
    });

    const output = await service.execute({
      objectName: 'person',
      limit: 2,
      offset: 8,
      shouldBuildEffectiveSelectFields: false,
      authContext: {} as never,
      rolePermissionConfig: {} as never,
    });

    expect(output.result?.hasMore).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/searm-server && npx jest find-records.service.spec
```

Expected: FAIL — `output.result?.hasMore` is `undefined`.

- [ ] **Step 3: Update the result type**

Edit `types/find-records-result.type.ts`:

```ts
export type FindRecordsResult = {
  records: unknown[];
  count: number;
  hasMore: boolean;
};
```

- [ ] **Step 4: Update the service**

In `services/find-records.service.ts`, replace the `return` at the end of the try block:

```ts
      const hasMore = offset + records.length < totalCount;

      return {
        success: true,
        message: `Found ${records.length} ${objectName} records`,
        result: {
          records,
          count: totalCount,
          hasMore,
        },
        ...(isNonEmptyArray(warnings) ? { warnings: warnings } : {}),
        recordReferences,
      };
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd packages/searm-server && npx jest find-records.service.spec
```

Expected: PASS, 2 tests.

- [ ] **Step 6: Lint, typecheck, commit**

```bash
npx nx lint:diff-with-main searm-server
npx nx typecheck searm-server
git add packages/searm-server/src/engine/core-modules/record-crud
git commit -m "feat(agent-api): add explicit hasMore signal to find_many results"
```

---

### Task 8: Permission-scoped metadata discovery

`get_object_metadata` returns every object's schema regardless of the caller's role — a gap against "read permitted records" for an external, role-scoped OAuth agent. This task filters and annotates the discovery output with the same `FlatObjectPermission` data `DatabaseToolProvider` already uses to decide which CRUD tools to generate, so an agent sees its actual permitted operations up front instead of discovering them by trial and error.

> **Program integration — this task absorbed Phase 3's discovery tool.** Phase 3 Task 5 originally built a second, per-object `describe_custom_fields_<object>` tool because `MetadataToolProvider.isAvailable()` hard-gates the whole METADATA provider behind `PermissionFlagType.DATA_MODEL` (verified on disk: `return this.permissionsService.checkRolesPermissions(context.rolePermissionConfig, context.workspaceId, PermissionFlagType.DATA_MODEL)`), so a record-scoped agent cannot discover custom fields at all. Rather than add N tools to work around one over-broad availability check, **this task fixes the check** and scopes the output — Steps 5, 6 and 7 below. Consequence: the "field-level permission scoping for `FieldMetadataToolsFactory`" row is **removed from this plan's cut table** — relaxing provider availability makes scoping `get_field_metadata` mandatory, not optional, and it is the same filter written twice.

**Files:**
- Modify: `packages/searm-server/src/engine/metadata-modules/object-metadata/tools/object-metadata-tools.factory.ts`
- Modify: `packages/searm-server/src/engine/metadata-modules/field-metadata/tools/field-metadata-tools.factory.ts`
- Modify: `packages/searm-server/src/engine/core-modules/tool-provider/providers/metadata-tool.provider.ts`
- Test: `packages/searm-server/src/engine/metadata-modules/object-metadata/tools/__tests__/object-metadata-tools.factory.spec.ts` (create)
- Test: `packages/searm-server/src/engine/metadata-modules/field-metadata/tools/__tests__/field-metadata-tools.factory.spec.ts` (create)
- Test: `packages/searm-server/src/engine/core-modules/tool-provider/providers/__tests__/metadata-tool.provider.spec.ts` (create — no spec exists for this provider today)

**Interfaces:**
- Consumes:
  - `getObjectsPermissionsFromRolePermissionConfig` — **verified signature** at `src/engine/searm-orm/utils/get-objects-permissions-from-role-permission-config.util.ts:10-16`:
    ```ts
    export const getObjectsPermissionsFromRolePermissionConfig = ({
      rolesPermissions,
      rolePermissionConfig,
    }: {
      rolesPermissions: ObjectsPermissionsByRoleId;
      rolePermissionConfig: RolePermissionConfig;
    }): ObjectsPermissions
    ```
    It takes **one object argument with two keys** and returns a **`Record<objectMetadataId, ObjectPermissions>`** — never an array. `Array.prototype.some` on the result is a type error. It returns `{}` for `{ shouldBypassPermissionChecks: true }` (line 17-19), so an unrestricted context must be short-circuited **before** the result is interpreted, or a bypass caller reads as having no permissions at all. The canonical call site to copy is `src/engine/core-modules/tool-provider/providers/database-tool.provider.ts:73-83`.
  - `WorkspaceCacheService.getOrRecompute(workspaceId, cacheKeyNames)` — verified at `src/engine/workspace-cache/services/workspace-cache.service.ts:122-125`; `'rolesPermissions'` is a valid key (`src/engine/workspace-cache/types/workspace-cache-key.type.ts:34,71`, typed `ObjectsPermissionsByRoleId`).
  - `PermissionsService.checkRolesPermissions(rolePermissionConfig, workspaceId, setting)` — verified at `src/engine/metadata-modules/permissions/permissions.service.ts:386-390`. Note it **returns `true` when role resolution yields `null`** (line 396-398), i.e. a bypass context passes every flag check.
  - Module wiring is already in place: `ObjectMetadataModule` (`object-metadata.module.ts:61,70`) and `FieldMetadataModule` (`field-metadata.module.ts:66,71`) both already import `PermissionsModule` and `WorkspaceCacheModule`. No module edit is needed for either factory.
- Produces:
  - `ObjectMetadataToolsFactory.generateTools(context: ToolProviderContext)` — signature changed from `(workspaceId: string)` (live at `object-metadata-tools.factory.ts:177`); every object in `get_object_metadata`'s output now carries `permittedOperations: { read: boolean; write: boolean; delete: boolean }`, and objects the role cannot read are omitted entirely **unless the caller is unscoped** (see the scope rule below).
  - `FieldMetadataToolsFactory.generateTools(context: ToolProviderContext)` — same signature change (live at `field-metadata-tools.factory.ts:208`); fields on objects the role cannot read are omitted under the same scope rule.
  - `MetadataToolProvider.isAvailable(context)` returns true when the role has `DATA_MODEL` **or** read permission on at least one object.
  - **The scope rule, stated once and used by all three:** a caller is *unscoped* when `'shouldBypassPermissionChecks' in context.rolePermissionConfig` **or** `checkRolesPermissions(..., PermissionFlagType.DATA_MODEL)` is true. An unscoped caller sees every object and every field, exactly as today. A scoped caller sees only what `objectPermissions[objectMetadataId]?.canReadObjectRecords` allows. This rule is why the bypass short-circuit is mandatory: the util returns `{}` for a bypass config, and without the short-circuit an admin's discovery output would collapse to empty.

**Step ordering note (I15):** an earlier draft appended two steps labelled "2b" and "5b" *after* the task's final commit step, and left a sentence in the old Step 4 saying the field factory was out of scope. Both are gone. The steps below run 1 → 8 in execution order, and `FieldMetadataToolsFactory` scoping is in scope (its cut-table row is struck).

- [ ] **Step 1: Write the failing test**

Create `tools/__tests__/object-metadata-tools.factory.spec.ts`:

```ts
import { Test, type TestingModule } from '@nestjs/testing';

import { ObjectMetadataService } from 'src/engine/metadata-modules/object-metadata/object-metadata.service';
import { ObjectMetadataToolsFactory } from 'src/engine/metadata-modules/object-metadata/tools/object-metadata-tools.factory';
import { PermissionsService } from 'src/engine/metadata-modules/permissions/permissions.service';
import { WorkspaceManyOrAllFlatEntityMapsCacheService } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

// Real seam: getObjectsPermissionsFromRolePermissionConfig is NOT mocked in
// this spec. The factory calls the real util with the real cache payload
// shape, so a wrong argument shape or a wrong return-shape assumption fails
// here instead of type-checking against a stub.
const context = {
  workspaceId: 'workspace-1',
  roleId: 'role-1',
  rolePermissionConfig: { unionOf: ['role-1'] },
} as never;

const bypassContext = {
  workspaceId: 'workspace-1',
  rolePermissionConfig: { shouldBypassPermissionChecks: true },
} as never;

describe('ObjectMetadataToolsFactory permittedOperations', () => {
  let factory: ObjectMetadataToolsFactory;

  const objectMetadataService = {
    findManyWithinWorkspace: jest.fn().mockResolvedValue([
      {
        id: 'object-person',
        nameSingular: 'person',
        namePlural: 'people',
        isSystem: false,
      },
      {
        id: 'object-secret',
        nameSingular: 'secret',
        namePlural: 'secrets',
        isSystem: false,
      },
    ]),
  };
  const permissionsService = {
    checkRolesPermissions: jest.fn().mockResolvedValue(false),
  };
  const flatEntityMapsCacheService = {
    getOrRecomputeManyOrAllFlatEntityMaps: jest.fn().mockResolvedValue({
      flatFieldMetadataMaps: { byUniversalIdentifier: {} },
    }),
  };
  const workspaceCacheService = {
    getOrRecompute: jest.fn().mockResolvedValue({
      rolesPermissions: {
        'role-1': {
          'object-person': {
            canReadObjectRecords: true,
            canUpdateObjectRecords: false,
            canSoftDeleteObjectRecords: false,
          },
        },
      },
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    permissionsService.checkRolesPermissions.mockResolvedValue(false);
    workspaceCacheService.getOrRecompute.mockResolvedValue({
      rolesPermissions: {
        'role-1': {
          'object-person': {
            canReadObjectRecords: true,
            canUpdateObjectRecords: false,
            canSoftDeleteObjectRecords: false,
          },
        },
      },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ObjectMetadataToolsFactory,
        { provide: ObjectMetadataService, useValue: objectMetadataService },
        {
          provide: WorkspaceManyOrAllFlatEntityMapsCacheService,
          useValue: flatEntityMapsCacheService,
        },
        { provide: WorkspaceCacheService, useValue: workspaceCacheService },
        { provide: PermissionsService, useValue: permissionsService },
      ],
    }).compile();

    factory = module.get<ObjectMetadataToolsFactory>(
      ObjectMetadataToolsFactory,
    );
  });

  type DiscoveredObject = {
    nameSingular: string;
    permittedOperations?: { read: boolean; write: boolean; delete: boolean };
  };

  const discover = async (callerContext: never) =>
    (await factory
      .generateTools(callerContext)
      .get_object_metadata.execute({})) as DiscoveredObject[];

  it('should annotate a returned object with the caller role permitted operations', async () => {
    const result = await discover(context);

    expect(result[0].permittedOperations).toEqual({
      read: true,
      write: false,
      delete: false,
    });
  });

  it('should omit an object the role cannot read', async () => {
    const result = await discover(context);

    expect(result.map((entry) => entry.nameSingular)).toEqual(['person']);
  });

  it('should return every object to a DATA_MODEL role even when it holds no object permissions', async () => {
    permissionsService.checkRolesPermissions.mockResolvedValue(true);
    workspaceCacheService.getOrRecompute.mockResolvedValue({
      rolesPermissions: { 'role-1': {} },
    });

    const result = await discover(context);

    expect(result.map((entry) => entry.nameSingular)).toEqual([
      'person',
      'secret',
    ]);
  });

  // C10's third bug: the util returns {} for a bypass config, so without the
  // short-circuit an unrestricted caller would discover nothing.
  it('should return every object to a permission-bypassing caller', async () => {
    workspaceCacheService.getOrRecompute.mockResolvedValue({
      rolesPermissions: {},
    });

    const result = await discover(bypassContext);

    expect(result.map((entry) => entry.nameSingular)).toEqual([
      'person',
      'secret',
    ]);
    expect(result[0].permittedOperations).toEqual({
      read: true,
      write: true,
      delete: true,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/searm-server && npx jest object-metadata-tools.factory.spec
```

Expected: FAIL — `factory.generateTools` today takes a `workspaceId` string, not a `context` object, so the test fails to compile/run (TS error on the call, or `permittedOperations` is `undefined` once you loosen it to compile).

- [ ] **Step 3: Update the factory**

In `object-metadata-tools.factory.ts`, add imports (the live import block ends at line 15):

```ts
import { PermissionFlagType } from 'searm-shared/constants';

import { type ToolProviderContext } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider-context.type';
import { PermissionsService } from 'src/engine/metadata-modules/permissions/permissions.service';
import { getObjectsPermissionsFromRolePermissionConfig } from 'src/engine/searm-orm/utils/get-objects-permissions-from-role-permission-config.util';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
```

Add the two new dependencies to the constructor (live at lines 134-137):

```ts
  constructor(
    private readonly objectMetadataService: ObjectMetadataService,
    private readonly flatEntityMapsCacheService: WorkspaceManyOrAllFlatEntityMapsCacheService,
    private readonly workspaceCacheService: WorkspaceCacheService,
    private readonly permissionsService: PermissionsService,
  ) {}
```

Add the shared scope resolver as a private method next to `buildFieldsByObjectId` (live line 139). This is the one place the scope rule is implemented for objects; Step 5 writes the field-side twin:

```ts
  // Discovery scope for one caller. `isUnscoped` covers both a
  // permission-bypassing context and a DATA_MODEL role: the util returns {}
  // for a bypass config, so without this short-circuit an unrestricted caller
  // would discover nothing at all.
  private async resolveDiscoveryScope(context: ToolProviderContext): Promise<{
    isUnscoped: boolean;
    objectPermissions: ObjectsPermissions;
  }> {
    if ('shouldBypassPermissionChecks' in context.rolePermissionConfig) {
      return { isUnscoped: true, objectPermissions: {} };
    }

    const hasDataModelPermission =
      await this.permissionsService.checkRolesPermissions(
        context.rolePermissionConfig,
        context.workspaceId,
        PermissionFlagType.DATA_MODEL,
      );

    const { rolesPermissions } =
      await this.workspaceCacheService.getOrRecompute(context.workspaceId, [
        'rolesPermissions',
      ]);

    return {
      isUnscoped: hasDataModelPermission,
      objectPermissions: getObjectsPermissionsFromRolePermissionConfig({
        rolesPermissions,
        rolePermissionConfig: context.rolePermissionConfig,
      }),
    };
  }
```

`ObjectsPermissions` is `Record<objectMetadataId, ObjectPermissions>` (`searm-shared/src/types/ObjectsPermissions.ts:5`) — import the type from `searm-shared/types`.

Change `generateTools(workspaceId: string): ToolSet` (live line 177) to `generateTools(context: ToolProviderContext): ToolSet`. Inside the method every existing use of the parameter `workspaceId` becomes `context.workspaceId` — there are **seven** occurrences at HEAD `dba03d0907`, not two: `findManyWithinWorkspace` (line 191), `buildFieldsByObjectId` (line 209), `createOneObject` (line 262), `updateOneObject` (line 311), `deleteOneObject` (line 335), and the two inside the batch tools (lines 374 and 423). Missing any of them is a compile error, not a silent bug.

Inside the `get_object_metadata` tool's `execute`, replace the `return flatObjectMetadatas.map(...)` block (live lines 212-234) with:

```ts
          const { isUnscoped, objectPermissions } =
            await this.resolveDiscoveryScope(context);

          return flatObjectMetadatas
            .filter(
              (flatObjectMetadata) =>
                isUnscoped ||
                objectPermissions[flatObjectMetadata.id]
                  ?.canReadObjectRecords === true,
            )
            .map((flatObjectMetadata) => {
              const dto =
                fromFlatObjectMetadataToObjectMetadataDto(flatObjectMetadata);

              const fields = fieldsByObjectId?.get(dto.id) ?? [];

              const permission = objectPermissions[dto.id];
              // An unscoped caller with no explicit row in the permission map
              // is unrestricted, not unpermitted.
              const permittedOperations = {
                read: permission?.canReadObjectRecords ?? isUnscoped,
                write: permission?.canUpdateObjectRecords ?? isUnscoped,
                delete: permission?.canSoftDeleteObjectRecords ?? isUnscoped,
              };

              if (dto.isSystem && !parameters.includeFullSystemObjects) {
                return {
                  id: dto.id,
                  nameSingular: dto.nameSingular,
                  namePlural: dto.namePlural,
                  permittedOperations,
                  ...(parameters.includeFields ? { fields } : {}),
                };
              }

              return {
                ...compactMetadataOutput(
                  {
                    ...dto,
                    ...(parameters.includeFields ? { fields } : {}),
                  },
                  { stripWhenNullish: OBJECT_STRIP_WHEN_NULLISH },
                ),
                permittedOperations,
              };
            });
```

- [ ] **Step 4: Run the object-factory tests to verify they pass**

```bash
cd packages/searm-server && npx jest object-metadata-tools.factory.spec
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Apply the same scope rule to `FieldMetadataToolsFactory`**

`get_field_metadata` is the other half of discovery; relaxing provider availability in Step 6 makes scoping it mandatory, not optional.

In `field-metadata-tools.factory.ts`, add the same four imports as Step 3, add `workspaceCacheService` and `permissionsService` to the constructor (live at lines 177-180), and copy `resolveDiscoveryScope` verbatim from Step 3.

Change `generateTools(workspaceId: string): ToolSet` (live line 208) to `generateTools(context: ToolProviderContext): ToolSet` and replace every use of the parameter with `context.workspaceId` (in `get_field_metadata` alone: `getObjectMetadataIdOrThrow` at line 225 and the two `workspaceId` filter uses at line 232; the create/update/delete field tools further down use it too — change all of them).

Then, inside `get_field_metadata`'s `execute`, replace the `.filter(...)` on the raw results (live lines 243-249) with a scope-aware filter. `fieldMetadataService.query` returns rows carrying `objectMetadataId`, which is exactly the key `ObjectsPermissions` is indexed by:

```ts
          const { isUnscoped, objectPermissions } =
            await this.resolveDiscoveryScope(context);

          const compactedFields = (
            rawResults as unknown as Record<string, unknown>[]
          )
            .filter(
              (field) =>
                !METADATA_TOOL_EXCLUDED_FIELD_NAMES.has(field.name as string),
            )
            // A field is discoverable only if its owning object is readable
            // by this role. Same rule as get_object_metadata, so the two
            // tools can never disagree about what exists.
            .filter(
              (field) =>
                isUnscoped ||
                objectPermissions[field.objectMetadataId as string]
                  ?.canReadObjectRecords === true,
            )
            .map((field) => {
```

Write `tools/__tests__/field-metadata-tools.factory.spec.ts` with the same harness as Step 1 (real `getObjectsPermissionsFromRolePermissionConfig`, mocked `FieldMetadataService.query` returning one `person` field with `objectMetadataId: 'object-person'` and one `secret` field with `objectMetadataId: 'object-secret'`):

```ts
  it('should return only fields on objects the role can read', async () => {
    const result = (await factory
      .generateTools(context)
      .get_field_metadata.execute({})) as Array<{ name: string }>;

    expect(result.map((field) => field.name)).toEqual(['jobTitle']);
  });

  it('should return every field to a DATA_MODEL role', async () => {
    permissionsService.checkRolesPermissions.mockResolvedValue(true);

    const result = (await factory
      .generateTools(context)
      .get_field_metadata.execute({})) as Array<{ name: string }>;

    expect(result.map((field) => field.name)).toEqual([
      'jobTitle',
      'secretValue',
    ]);
  });
```

- [ ] **Step 6: Relax and re-scope provider availability**

`MetadataToolProvider.isAvailable` (live at `metadata-tool.provider.ts:30-36`) hard-gates the whole METADATA provider behind `DATA_MODEL`, so a record-scoped agent cannot discover the schema of objects it can already read and guesses field names instead. Replace it, and update `buildToolSet` (live lines 65-70) to pass the full context to **both** factories:

```ts
  async isAvailable(context: ToolProviderContext): Promise<boolean> {
    const hasDataModelPermission =
      await this.permissionsService.checkRolesPermissions(
        context.rolePermissionConfig,
        context.workspaceId,
        PermissionFlagType.DATA_MODEL,
      );

    if (hasDataModelPermission) {
      return true;
    }

    // A record-scoped agent must be able to discover the schema of the
    // objects it can already read. The output is filtered to exactly those
    // objects by the two factories, so this widens discovery, not access.
    const { rolesPermissions } =
      await this.workspaceCacheService.getOrRecompute(context.workspaceId, [
        'rolesPermissions',
      ]);

    const objectPermissions = getObjectsPermissionsFromRolePermissionConfig({
      rolesPermissions,
      rolePermissionConfig: context.rolePermissionConfig,
    });

    // Object.values, not .some on the result — the util returns a Record
    // keyed by objectMetadataId, never an array.
    return Object.values(objectPermissions).some(
      (permission) => permission.canReadObjectRecords,
    );
  }

  private buildToolSet(context: ToolProviderContext): ToolSet {
    return {
      ...this.objectMetadataToolsFactory.generateTools(context),
      ...this.fieldMetadataToolsFactory.generateTools(context),
    };
  }
```

Add `WorkspaceCacheService` to `MetadataToolProvider`'s constructor and the two imports (`getObjectsPermissionsFromRolePermissionConfig`, `WorkspaceCacheService`). `ToolProviderModule` already imports `WorkspaceCacheModule` (`tool-provider.module.ts:64`) and `PermissionsModule` (line 59) — no module edit.

A bypass context needs no special case here: `checkRolesPermissions` returns `true` when role resolution yields `null` (`permissions.service.ts:396-398`), so it short-circuits on the first branch.

- [ ] **Step 7: Write and run the provider availability tests**

Create `providers/__tests__/metadata-tool.provider.spec.ts` (no spec exists for this provider today — verified). Provide the real `getObjectsPermissionsFromRolePermissionConfig` (do not stub it) and mock only `PermissionsService`, `WorkspaceCacheService`, and the two factories:

```ts
  it('should be available to a role with object read permission but no DATA_MODEL permission', async () => {
    permissionsService.checkRolesPermissions.mockResolvedValue(false);
    workspaceCacheService.getOrRecompute.mockResolvedValue({
      rolesPermissions: {
        'role-1': { 'object-person': { canReadObjectRecords: true } },
      },
    });

    expect(await provider.isAvailable(context)).toBe(true);
  });

  it('should not be available to a role with neither DATA_MODEL nor any readable object', async () => {
    permissionsService.checkRolesPermissions.mockResolvedValue(false);
    workspaceCacheService.getOrRecompute.mockResolvedValue({
      rolesPermissions: {
        'role-1': { 'object-person': { canReadObjectRecords: false } },
      },
    });

    expect(await provider.isAvailable(context)).toBe(false);
  });

  it('should be available to a DATA_MODEL role that holds no object permissions', async () => {
    permissionsService.checkRolesPermissions.mockResolvedValue(true);
    workspaceCacheService.getOrRecompute.mockResolvedValue({
      rolesPermissions: { 'role-1': {} },
    });

    expect(await provider.isAvailable(context)).toBe(true);
    expect(workspaceCacheService.getOrRecompute).not.toHaveBeenCalled();
  });
```

```bash
cd packages/searm-server && npx jest object-metadata-tools.factory.spec field-metadata-tools.factory.spec metadata-tool.provider.spec
```

Expected: PASS, 9 tests (4 + 2 + 3).

- [ ] **Step 8: Lint, typecheck, commit**

```bash
npx nx lint:diff-with-main searm-server
npx nx typecheck searm-server
git add packages/searm-server/src/engine/metadata-modules/object-metadata packages/searm-server/src/engine/metadata-modules/field-metadata packages/searm-server/src/engine/core-modules/tool-provider/providers/metadata-tool.provider.ts
git commit -m "feat(agent-api): scope metadata discovery to the caller's readable objects"
```

---

### Task 9: OAuth-scoped MCP access — verification and hardening

The OAuth authorization server (`engine/core-modules/application/application-oauth/`) already mints workspace-pinned, role-scoped tokens (§"Ground truth" above). This task does not add new auth machinery — it proves the property the charter requires ("OAuth-scoped agent credentials with workspace-limited access") holds end-to-end through the tool layer, and closes one small, concrete gap: `DatabaseToolProvider.isAvailable()` always returns `true`, so a role with zero object permissions still sees an (empty) database-CRUD catalog rather than the category being reported unavailable — harmless functionally (`generateDescriptors` already returns `[]` when `Object.keys(objectPermissions).length === 0`) but worth an explicit regression test since it is the one place a widening bug would first show up silently.

**Files:**
- Create: `packages/searm-server/test/integration/graphql/suites/agent-api/mcp-oauth-scoping.integration-spec.ts`

**Interfaces:**
- Consumes: the existing OAuth token-issuance flow, `McpToolExecutorService.handleToolsListing` (Task 4's file, unchanged signature), `DatabaseToolProvider.generateDescriptors` (existing).

- [ ] **Step 1: Read the harness**

Open `test/integration/graphql/suites/object-generated/tasks.integration-spec.ts` and copy its harness imports and request-helper pattern verbatim, per the same convention Launch 1's Task 8 established. Also open `test/integration/graphql/suites/ai-write-approval/proposal-approval.integration-spec.ts` (produced by Launch 1 Task 8) for the pattern of resolving `ToolExecutorService`/`McpToolExecutorService` from the running Nest application context and calling them directly instead of standing up a real LLM turn.

- [ ] **Step 2: Write the integration test**

Create `test/integration/graphql/suites/agent-api/mcp-oauth-scoping.integration-spec.ts`. Build the suite around:

1. Create two roles in the test workspace: `roleWithPersonRead` (object permission: `person` read-only) and `roleWithNoPermissions` (no object permissions granted).
2. Build two `ToolProviderContext` objects differing only in `roleId`/`rolePermissionConfig`, matching what `McpCoreController`'s auth guards would produce for two different OAuth-issued tokens pinned to those two roles.
3. Resolve `ToolRegistryService` from the app context and call `getCatalog(contextWithPersonRead)` — assert the returned index contains `find_many_people` and does **not** contain `create_one_person`, `update_one_person`, or `delete_one_person` (read-only role).
4. Call `getCatalog(contextWithNoPermissions)` — assert the returned index contains **zero** `database_crud`-category entries.
5. Call `toolRegistryService.resolveAndExecute('find_many_people', {select:['id']}, contextWithNoPermissions)` — assert `success: false` and `failure.code === 'UNKNOWN_TOOL'` (the no-permission role's catalog never contained this tool, so it resolves as unknown, not as a permission error — this is intentional: `get_tool_catalog` never advertises a tool the role cannot see, so "unknown" and "forbidden" collapse to the same agent-facing signal for tools outside the discovered catalog).
6. Call `toolRegistryService.resolveAndExecute('find_many_people', {select:['id']}, contextWithPersonRead)` — assert `success: true`.

- [ ] **Step 3: Run the integration suite**

```bash
npx nx run searm-server:test:integration:with-db-reset
```

Expected: the new suite passes and no existing suite regresses.

- [ ] **Step 4: Commit**

```bash
git add packages/searm-server/test/integration/graphql/suites/agent-api
git commit -m "test(agent-api): verify role-scoped tool discovery and execution end to end"
```

---

### Task 10: Workflow template registry, install service, and GraphQL API

Three starter workflow templates — **`RESEARCH_BRIEF`** (manual trigger, on-demand research), **`FOLLOW_UP_DIGEST`** (daily cron, stale-opportunity follow-ups), and **`ACCOUNT_MONITORING`** (weekly cron, high-value account review) — packaging what Phases 1–3 already deliver: proposal-gated AI writes (Launch 1), and the research/ingestion capabilities the workflow engine's existing `AI_AGENT` action already exposes. Each template is a trigger plus a single `AI_AGENT` step whose prompt drives the agent to use its own tools (`find_many_*`, `group_by_*`, and — because every AI write is gated — any write it attempts becomes a reviewable proposal automatically). This keeps every template's JSON small and avoids hand-authoring `FIND_RECORDS`/`CREATE_RECORD` step input schemas this plan has not verified in full. Modeled directly on the internal helpers of the existing `create_complete_workflow` AI tool (`modules/workflow/workflow-tools/tools/create-complete-workflow.tool.ts`), reusing the same underlying services rather than reimplementing workspace-object repository access.

The task also exposes the install path Phase 5's vertical apps use for their own workflows. **That cross-phase contract is stated in full under "Contract exposed to Phase 5" below — read it before touching Steps 5b and 7.**

> **Program integration — cut from six to three, and one new mutation added.**
> **Cut:** `INBOX_PROCESSING` duplicated Phase 3 Task 4 (event-driven structured extraction from messages and call recordings) with a worse, cron-polled, non-idempotent version that would double-propose against the same messages. `IMPORT_ASSISTANCE` duplicated Phase 3 Tasks 7–8 (per-row identity resolution and validation *before* the write) with an after-the-fact cleanup pass. `ENRICHMENT` was `RESEARCH_BRIEF` on a `person.created` trigger. All three are in the cut table with triggers.
> **Added:** `WorkflowTemplateService.installDefinition(...)` and a matching `installWorkflowDefinition` mutation (Step 5b below), so **Phase 5's vertical apps seed their workflows through this service instead of hand-rolling GraphQL calls from an app's post-install hook.** That removes Phase 5's single highest-risk piece of code and leaves exactly one workflow-creation implementation in the product.

## Contract exposed to Phase 5

Phase 5's `seedWorkflow` helper and both of its app workflows depend on exactly this contract. It is fixed here; the Phase 5 plan is written against it.

| Item | Value | Why (verified) |
| --- | --- | --- |
| **GraphQL schema** | `installWorkflowDefinition` is on the **core** schema (`/graphql`), declared with `@CoreResolver()` on a second resolver class, `WorkflowDefinitionInstallResolver`. `workflowTemplates`/`installWorkflowTemplate` stay on the **metadata** schema for the settings UI. | C11. `@MetadataResolver()` is `@Resolver()` + `SetMetadata(RESOLVER_SCHEMA_SCOPE_KEY, 'metadata')` (`src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator.ts:1-11`); the core driver is built with `resolverSchemaScope: 'core'` and `include: [CoreEngineModule]` (`graphql-config.service.ts:83-86`), the metadata driver with `'metadata'` and `include: [MetadataGraphQLApiModule]` (`metadata.module-factory.ts:36-38`). A metadata-scoped mutation is therefore **absent** from the core endpoint, and Phase 5 calls it through `CoreApiClient`. The scope tag — not the module — decides the schema, so one module can safely hold both resolvers. |
| **Client** | `import { type CoreApiClient } from 'searm-client-sdk/core'` — Phase 5's `seedWorkflow(client: CoreApiClient, …)` signature is correct **as written** and needs no change. | `searm-client-sdk/package.json:8-31` exports `./core` and `./metadata`; `src/core/index.ts:1` exports `CoreApiClient`. |
| **Module registration** | `WorkflowTemplatesModule` is imported by **both** `CoreEngineModule` (`src/engine/core-modules/core-engine.module.ts`) and `MetadataEngineModule`. `CoreEngineModule` already imports modules from `src/modules/**` (`EmailingModule`, `DashboardModule`, `MessagingWebhooksModule`), so this is the established pattern, not a new one. | Without a path from the include root, a resolver is silently absent from the schema. |
| **Required permission flag** | The mutation is behind `SettingsPermissionGuard(PermissionFlagType.WORKFLOWS)`. **An installing application's service role must declare `SystemPermissionFlag.WORKFLOWS` in `permissionFlagUniversalIdentifiers`.** | C12. `PermissionFlagType.WORKFLOWS` exists (`searm-shared/src/constants/PermissionFlagType.ts:9`), its UUID is `SystemPermissionFlag.WORKFLOWS = '6189e7bd-4051-5752-b6b1-5f31358fbaf1'` (`SystemPermissionFlag.ts:10`). `RoleManifest.permissionFlagUniversalIdentifiers?: string[]` (`searm-shared/src/application/roleManifestType.ts:59`) is carried through `RoleConfig` (`searm-sdk/src/sdk/define/roles/role-config.ts:7-13`) and applied at install by `compute-application-manifest-all-universal-flat-entity-maps.service.ts:304-316`. Precedent: `searm-apps/public/people-data-labs/src/roles/default-function.role.ts:40` grants `[SystemPermissionFlag.WORKFLOWS]`. **Phase 5 side:** add that flag to `app-default.role.ts`. **Phase 4 side:** the guard is unchanged and this row is the contract. |
| **Input shape** | `InstallWorkflowDefinitionInput { name: String!, description: String, trigger: JSON!, steps: JSON!, activate: Boolean! = true }`. `steps` entries may be `{ type, name, settings }` only — **`id`, `valid`, and `nextStepIds` are optional and are generated server-side.** | C13. Phase 5's `WorkflowStepTemplate = { type; name; settings }` is accepted as-is. |
| **Step normalisation** | `installDefinition` normalises every supplied step: assigns `id: uuidv4()` where absent, forces `valid: true`, and chains `nextStepIds` in array order (step *n* → `[id of step n+1]`, last step → `[]`). | C13. `BaseWorkflowAction` requires `id: string`, `name: string`, `type`, `settings`, `valid: boolean` and allows `nextStepIds?: string[]` (`workflow-executor/workflow-actions/types/workflow-action.type.ts:24-34`). `steps` is stored as `GraphQLJSON`, so nothing catches a missing `id` at compile time — it fails at execution. |
| **Return shape** | `InstalledWorkflowTemplate { workflowId: ID!, workflowVersionId: ID! }` — the same DTO both mutations return. |
| **Idempotency** | `installDefinition` is keyed on `definition.name` within the workspace: a second call with the same name returns the existing `{ workflowId, workflowVersionId }` and creates nothing. A post-install hook may therefore re-run on every upgrade. |

**Files:**
- Create: `packages/searm-server/src/modules/workflow/workflow-templates/types/workflow-template.type.ts`
- Create: `packages/searm-server/src/modules/workflow/workflow-templates/constants/workflow-templates.const.ts`
- Create: `packages/searm-server/src/modules/workflow/workflow-templates/services/workflow-template.service.ts`
- Create: `packages/searm-server/src/modules/workflow/workflow-templates/dtos/workflow-template.dto.ts`
- Create: `packages/searm-server/src/modules/workflow/workflow-templates/dtos/install-workflow-template.input.ts`
- Create: `packages/searm-server/src/modules/workflow/workflow-templates/dtos/install-workflow-definition.input.ts`
- Create: `packages/searm-server/src/modules/workflow/workflow-templates/utils/normalize-workflow-template-steps.util.ts`
- Create: `packages/searm-server/src/modules/workflow/workflow-templates/resolvers/workflow-template.resolver.ts`
- Create: `packages/searm-server/src/modules/workflow/workflow-templates/resolvers/workflow-definition-install.resolver.ts`
- Create: `packages/searm-server/src/modules/workflow/workflow-templates/workflow-templates.module.ts`
- Modify: `packages/searm-server/src/engine/core-modules/core-engine.module.ts` (import `WorkflowTemplatesModule`)
- Modify: `packages/searm-server/src/engine/metadata-modules/metadata-engine.module.ts` (import `WorkflowTemplatesModule`)
- Test: `packages/searm-server/src/modules/workflow/workflow-templates/services/__tests__/workflow-template.service.spec.ts`
- Test: `packages/searm-server/src/modules/workflow/workflow-templates/utils/__tests__/normalize-workflow-template-steps.util.spec.ts`

**Interfaces:**
- Consumes (each with its **owning module**, verified — I20; no grepping at implementation time):

  | Service | Import path | Owning module to import |
  | --- | --- | --- |
  | `GlobalWorkspaceOrmManager` | `src/engine/searm-orm/global-workspace-datasource/global-workspace-orm.manager` | `GlobalWorkspaceDataSourceModule` (`src/engine/searm-orm/global-workspace-datasource/global-workspace-datasource.module`) — it is `@Global()`, so importing it is optional |
  | `RecordPositionService` | `src/engine/core-modules/record-position/services/record-position.service` | `RecordPositionModule` (`src/engine/core-modules/record-position/record-position.module`, providers/exports L9-10) |
  | `WorkflowVersionCoreSyncService` | `src/engine/core-modules/workflow/services/workflow-version-core-sync.service` | `WorkflowVersionCoreModule` (`src/engine/core-modules/workflow/workflow-version-core.module`, providers L18 / exports L24) |
  | `WorkflowTriggerWorkspaceService` | `src/modules/workflow/workflow-trigger/workspace-services/workflow-trigger.workspace-service` | `WorkflowTriggerModule` (`src/modules/workflow/workflow-trigger/workflow-trigger.module`, providers/exports L29-30) |

  Plus `buildSystemAuthContext` (`src/engine/searm-orm/utils/build-system-auth-context.util`) and `isDefined` (`searm-shared/utils`). `WorkflowToolsModule` already imports `WorkflowTriggerModule`, `RecordPositionModule` and `WorkflowVersionCoreModule` together without a cycle, which is the precedent this module copies.
- Produces:
  - `type WorkflowTemplateKey = 'RESEARCH_BRIEF' | 'FOLLOW_UP_DIGEST' | 'ACCOUNT_MONITORING'`
  - `WorkflowTemplateService.list(): WorkflowTemplateDefinition[]`
  - `WorkflowTemplateService.install(params: { key: WorkflowTemplateKey; workspaceId: string; activate: boolean }): Promise<{ workflowId: string; workflowVersionId: string }>` — **this exact three-property signature everywhere in this document** (N5: the File Structure table's two-property form was wrong and is corrected).
  - `WorkflowTemplateService.installDefinition(params: { definition: WorkflowDefinitionInput; workspaceId: string; activate: boolean }): Promise<{ workflowId: string; workflowVersionId: string }>`
  - `WorkflowTemplateService.findWorkflowByName(workspaceId: string, name: string): Promise<{ workflowId: string; workflowVersionId: string } | null>`
  - `normalizeWorkflowTemplateSteps(steps: WorkflowStepInput[]): WorkflowAction[]`
  - GraphQL, **metadata** schema: `workflowTemplates: [WorkflowTemplate!]!`, `installWorkflowTemplate(input: InstallWorkflowTemplateInput!): InstalledWorkflowTemplate!`.
  - GraphQL, **core** schema: `installWorkflowDefinition(input: InstallWorkflowDefinitionInput!): InstalledWorkflowTemplate!` — the Phase 5 edge.

- [ ] **Step 1: Write the template type**

Create `types/workflow-template.type.ts`:

```ts
import { type WorkflowAction } from 'src/modules/workflow/workflow-executor/workflow-actions/types/workflow-action.type';
import { type WorkflowTrigger } from 'src/modules/workflow/workflow-trigger/types/workflow-trigger.type';

export type WorkflowTemplateKey =
  | 'RESEARCH_BRIEF'
  | 'FOLLOW_UP_DIGEST'
  | 'ACCOUNT_MONITORING';

export type WorkflowTemplateDefinition = {
  key: WorkflowTemplateKey;
  name: string;
  description: string;
  trigger: WorkflowTrigger;
  steps: WorkflowAction[];
};

// What an installable application supplies (Phase 5). id / valid /
// nextStepIds are optional here and generated by
// normalizeWorkflowTemplateSteps — a WorkflowAction requires all three
// (workflow-action.type.ts:24-34), and a stored step missing them fails at
// execution, not at insert.
export type WorkflowStepInput = Omit<
  WorkflowAction,
  'id' | 'valid' | 'nextStepIds'
> &
  Partial<Pick<WorkflowAction, 'id' | 'valid' | 'nextStepIds'>>;

export type WorkflowDefinitionInput = {
  name: string;
  description?: string;
  trigger: WorkflowTrigger;
  steps: WorkflowStepInput[];
};
```

- [ ] **Step 2: Write the template catalog**

Create `constants/workflow-templates.const.ts`. Every step and trigger below type-checks against `WorkflowAction`/`WorkflowTrigger` as read from the real files in "Ground truth": `outputSchema: {}` is a valid empty `Record<string, Leaf | Node>`, `errorHandlingOptions` is mandatory on every step, and an `AI_AGENT` step's `agentId` is intentionally omitted so it runs as an ad-hoc agent against the given `prompt` (verified against `AiAgentWorkflowAction.execute`, which only looks up an agent `if (agentId)`).

```ts
import { WorkflowActionType } from 'searm-shared/workflow';

import { type WorkflowTemplateDefinition } from 'src/modules/workflow/workflow-templates/types/workflow-template.type';
import { WorkflowTriggerType } from 'src/modules/workflow/workflow-trigger/types/workflow-trigger.type';

const errorHandlingOptions = {
  retryOnFailure: { value: false },
  continueOnFailure: { value: false },
};

const buildAiAgentStep = (params: { id: string; name: string; prompt: string }) => ({
  id: params.id,
  name: params.name,
  type: WorkflowActionType.AI_AGENT,
  valid: true,
  settings: {
    outputSchema: {},
    errorHandlingOptions,
    input: { prompt: params.prompt },
  },
});

export const WORKFLOW_TEMPLATES: WorkflowTemplateDefinition[] = [
  {
    key: 'RESEARCH_BRIEF',
    name: 'Research brief',
    description:
      'Run on demand from the command menu. Researches a company or person using existing CRM history and any connected enrichment tools, then proposes record updates for review.',
    trigger: {
      name: 'Manual trigger',
      type: WorkflowTriggerType.MANUAL,
      settings: { outputSchema: {} },
    },
    steps: [
      buildAiAgentStep({
        id: '11111111-1111-4111-8111-111111111101',
        name: 'Research and propose updates',
        prompt:
          'The user wants a research brief on a specific company or person. Use your find and group_by tools to gather existing CRM history (notes, tasks, past opportunities, related people). Summarize what you find, then propose any record updates or a new opportunity via your write tools. Every write you attempt becomes a proposal awaiting human approval — do not assume it applied, and do not retry a write that already returned a pending-approval result.',
      }),
    ],
  },
  {
    key: 'FOLLOW_UP_DIGEST',
    name: 'Daily follow-up digest',
    description:
      'Runs every morning. Finds opportunities with no recent activity and proposes a next action for each.',
    trigger: {
      name: 'Daily at 8am',
      type: WorkflowTriggerType.CRON,
      settings: {
        outputSchema: {},
        type: 'HOURS',
        schedule: { hour: 8, minute: 0 },
      },
    },
    steps: [
      buildAiAgentStep({
        id: '11111111-1111-4111-8111-111111111102',
        name: 'Find stale opportunities and propose follow-ups',
        prompt:
          'Find open opportunities with no activity (no note, task, or stage change) in the last 7 days. For each one, propose a task or a draft follow-up email with a concrete suggested next action, citing what you found. Keep the list short — do not process more than 20 opportunities in one run.',
      }),
    ],
  },
  {
    key: 'ACCOUNT_MONITORING',
    name: 'Weekly account monitoring',
    description:
      'Runs weekly. Reviews high-value accounts for material changes since the last review and proposes updates.',
    trigger: {
      name: 'Weekly',
      type: WorkflowTriggerType.CRON,
      settings: {
        outputSchema: {},
        type: 'DAYS',
        schedule: { day: 1, hour: 8, minute: 0 },
      },
    },
    steps: [
      buildAiAgentStep({
        id: '11111111-1111-4111-8111-111111111106',
        name: 'Check high-value accounts for changes',
        prompt:
          'Find companies flagged as high-value (or the top opportunities by amount, if no such flag exists). For each, check for material changes since your last note on the record — leadership changes, funding news, or CRM activity. Propose record updates for what changed and flag anything that looks risky. Skip accounts with no material change; do not write a no-op note.',
      }),
    ],
  },
];
```

- [ ] **Step 3: Write the failing service test**

Create `services/__tests__/workflow-template.service.spec.ts`:

```ts
import { Test, type TestingModule } from '@nestjs/testing';

import { RecordPositionService } from 'src/engine/core-modules/record-position/services/record-position.service';
import { WorkflowVersionCoreSyncService } from 'src/engine/core-modules/workflow/services/workflow-version-core-sync.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/searm-orm/global-workspace-datasource/global-workspace-orm.manager';
import { WorkflowTriggerWorkspaceService } from 'src/modules/workflow/workflow-trigger/workspace-services/workflow-trigger.workspace-service';
import { WorkflowTemplateService } from 'src/modules/workflow/workflow-templates/services/workflow-template.service';

describe('WorkflowTemplateService', () => {
  let service: WorkflowTemplateService;

  const workflowRepository = {
    insert: jest.fn(),
    update: jest.fn(),
    // findWorkflowByName's idempotency lookup; default "not installed yet".
    findOne: jest.fn().mockResolvedValue(null),
  };
  // Shared, not inline, so Step 5c's tests can inspect the stored steps.
  const workflowVersionRepository = { insert: jest.fn(), findOne: jest.fn() };
  const globalWorkspaceOrmManager = {
    executeInWorkspaceContext: jest.fn((fn: () => unknown) => fn()),
    getRepository: jest.fn(
      async (_workspaceId: string, objectMetadataName: string) =>
        objectMetadataName === 'workflowVersion'
          ? workflowVersionRepository
          : workflowRepository,
    ),
  };
  const recordPositionService = {
    buildRecordPosition: jest.fn().mockResolvedValue(1),
  };
  const workflowVersionCoreSyncService = {
    writeWorkflowVersionAndMirror: jest.fn(
      async (
        _workspaceId: string,
        callback: (repo: unknown, manager: unknown) => Promise<unknown>,
      ) => callback(workflowVersionRepository, {}),
    ),
  };
  const workflowTriggerService = {
    activateWorkflowVersion: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowTemplateService,
        {
          provide: GlobalWorkspaceOrmManager,
          useValue: globalWorkspaceOrmManager,
        },
        { provide: RecordPositionService, useValue: recordPositionService },
        {
          provide: WorkflowVersionCoreSyncService,
          useValue: workflowVersionCoreSyncService,
        },
        {
          provide: WorkflowTriggerWorkspaceService,
          useValue: workflowTriggerService,
        },
      ],
    }).compile();

    service = module.get<WorkflowTemplateService>(WorkflowTemplateService);
  });

  it('should list exactly the three named templates', () => {
    const templates = service.list();

    expect(templates.map((template) => template.key)).toEqual([
      'RESEARCH_BRIEF',
      'FOLLOW_UP_DIGEST',
      'ACCOUNT_MONITORING',
    ]);
  });

  it('should create a workflow row for an installed template', async () => {
    await service.install({
      key: 'RESEARCH_BRIEF',
      workspaceId: 'workspace-1',
      activate: false,
    });

    expect(workflowRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Research brief' }),
    );
  });

  it('should not activate the workflow unless activate is true', async () => {
    await service.install({
      key: 'RESEARCH_BRIEF',
      workspaceId: 'workspace-1',
      activate: false,
    });

    expect(workflowTriggerService.activateWorkflowVersion).not.toHaveBeenCalled();
  });

  it('should activate the workflow and set it ACTIVE when activate is true', async () => {
    await service.install({
      key: 'FOLLOW_UP_DIGEST',
      workspaceId: 'workspace-1',
      activate: true,
    });

    expect(workflowTriggerService.activateWorkflowVersion).toHaveBeenCalled();
    expect(workflowRepository.update).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ statuses: ['ACTIVE'] }),
    );
  });

  it('should throw for an unknown template key', async () => {
    await expect(
      service.install({
        key: 'NOT_A_TEMPLATE' as never,
        workspaceId: 'workspace-1',
        activate: false,
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
cd packages/searm-server && npx jest workflow-template.service.spec
```

Expected: FAIL — module not found.

- [ ] **Step 5: Write the service**

Create `services/workflow-template.service.ts`, mirroring `create-complete-workflow.tool.ts`'s internal `createWorkflow`/`createWorkflowVersion`/`updateWorkflowStatus` helpers (read in full under "Ground truth"):

```ts
import { Injectable } from '@nestjs/common';

import { isDefined } from 'searm-shared/utils';
import { v4 as uuidv4 } from 'uuid';

import { RecordPositionService } from 'src/engine/core-modules/record-position/services/record-position.service';
import { WorkflowVersionCoreSyncService } from 'src/engine/core-modules/workflow/services/workflow-version-core-sync.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/searm-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/searm-orm/utils/build-system-auth-context.util';
import { WorkflowVersionStatus } from 'src/modules/workflow/common/standard-objects/workflow-version.workspace-entity';
import { WorkflowStatus } from 'src/modules/workflow/common/standard-objects/workflow.workspace-entity';
import { WorkflowTriggerWorkspaceService } from 'src/modules/workflow/workflow-trigger/workspace-services/workflow-trigger.workspace-service';
import { WORKFLOW_TEMPLATES } from 'src/modules/workflow/workflow-templates/constants/workflow-templates.const';
import {
  type WorkflowTemplateDefinition,
  type WorkflowTemplateKey,
} from 'src/modules/workflow/workflow-templates/types/workflow-template.type';

@Injectable()
export class WorkflowTemplateService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly recordPositionService: RecordPositionService,
    private readonly workflowVersionCoreSyncService: WorkflowVersionCoreSyncService,
    private readonly workflowTriggerService: WorkflowTriggerWorkspaceService,
  ) {}

  list(): WorkflowTemplateDefinition[] {
    return WORKFLOW_TEMPLATES;
  }

  async install(params: {
    key: WorkflowTemplateKey;
    workspaceId: string;
    activate: boolean;
  }): Promise<{ workflowId: string; workflowVersionId: string }> {
    const { key, workspaceId, activate } = params;

    const template = WORKFLOW_TEMPLATES.find((entry) => entry.key === key);

    if (!template) {
      throw new Error(`Unknown workflow template "${key}"`);
    }

    return this.installDefinition({ definition: template, workspaceId, activate });
  }

  // The one workflow-creation implementation in the product. Built-in
  // templates go through install() above; an installable application supplies
  // its own definition here (Phase 5), instead of hand-rolling createWorkflow /
  // createWorkflowVersionStep / activateWorkflowVersion GraphQL calls from a
  // post-install hook.
  async installDefinition(params: {
    definition: WorkflowDefinitionInput;
    workspaceId: string;
    activate: boolean;
  }): Promise<{ workflowId: string; workflowVersionId: string }> {
    const { definition, workspaceId, activate } = params;

    // Idempotent by name: re-running an app's post-install hook, or reinstalling
    // the app, must not create a second copy of the same workflow.
    const existing = await this.findWorkflowByName(workspaceId, definition.name);

    if (isDefined(existing)) {
      return existing;
    }

    const workflowId = await this.createWorkflow(workspaceId, definition.name);
    const workflowVersionId = await this.createWorkflowVersion(
      workspaceId,
      workflowId,
      {
        trigger: definition.trigger,
        // C13: an app supplies {type, name, settings} only. WorkflowVersion
        // steps are structurally invalid without id/valid, and nothing
        // downstream generates them — GraphQLJSON hides it until the executor
        // tries to run a step with no id.
        steps: normalizeWorkflowTemplateSteps(definition.steps),
      },
    );

    if (activate) {
      await this.workflowTriggerService.activateWorkflowVersion(
        workflowVersionId,
        workspaceId,
      );
      await this.markWorkflowActive(workspaceId, workflowId, workflowVersionId);
    }

    return { workflowId, workflowVersionId };
  }

  private async createWorkflow(
    workspaceId: string,
    name: string,
  ): Promise<string> {
    const authContext = buildSystemAuthContext(workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const workflowRepository =
          await this.globalWorkspaceOrmManager.getRepository(
            workspaceId,
            'workflow',
            { shouldBypassPermissionChecks: true },
          );

        const position = await this.recordPositionService.buildRecordPosition({
          value: 'first',
          objectMetadata: { isCustom: false, nameSingular: 'workflow' },
          workspaceId,
        });

        const workflow = {
          id: uuidv4(),
          name,
          statuses: [WorkflowStatus.DRAFT],
          position,
        };

        await workflowRepository.insert(workflow);

        return workflow.id;
      },
      authContext,
    );
  }

  private async createWorkflowVersion(
    workspaceId: string,
    workflowId: string,
    template: { trigger: WorkflowTrigger; steps: WorkflowAction[] },
  ): Promise<string> {
    const workflowVersionId = uuidv4();

    await this.workflowVersionCoreSyncService.writeWorkflowVersionAndMirror(
      workspaceId,
      async (workflowVersionRepository, entityManager) => {
        const position = await this.recordPositionService.buildRecordPosition({
          value: 'first',
          objectMetadata: { isCustom: false, nameSingular: 'workflowVersion' },
          workspaceId,
        });

        await workflowVersionRepository.insert(
          {
            id: workflowVersionId,
            workflowId,
            name: 'v1',
            status: WorkflowVersionStatus.DRAFT,
            trigger: template.trigger,
            steps: template.steps,
            position,
          },
          entityManager,
        );

        return workflowVersionId;
      },
    );

    return workflowVersionId;
  }

  private async markWorkflowActive(
    workspaceId: string,
    workflowId: string,
    workflowVersionId: string,
  ): Promise<void> {
    const authContext = buildSystemAuthContext(workspaceId);

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const workflowRepository =
          await this.globalWorkspaceOrmManager.getRepository(
            workspaceId,
            'workflow',
            { shouldBypassPermissionChecks: true },
          );

        await workflowRepository.update(workflowId, {
          statuses: [WorkflowStatus.ACTIVE],
          lastPublishedVersionId: workflowVersionId,
        });
      },
      authContext,
    );
  }

  // I18: the whole of installDefinition's idempotency. A post-install hook
  // re-runs on every app upgrade, so "already installed" must be a cheap,
  // total lookup rather than a duplicate workflow.
  async findWorkflowByName(
    workspaceId: string,
    name: string,
  ): Promise<{ workflowId: string; workflowVersionId: string } | null> {
    const authContext = buildSystemAuthContext(workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const workflowRepository =
          await this.globalWorkspaceOrmManager.getRepository<WorkflowWorkspaceEntity>(
            workspaceId,
            'workflow',
            { shouldBypassPermissionChecks: true },
          );

        const workflow = await workflowRepository.findOne({ where: { name } });

        if (!isDefined(workflow)) {
          return null;
        }

        if (isDefined(workflow.lastPublishedVersionId)) {
          return {
            workflowId: workflow.id,
            workflowVersionId: workflow.lastPublishedVersionId,
          };
        }

        // No published version: fall back to the workflow's own draft, which
        // is what install() leaves behind when activate is false. Ordered by
        // createdAt DESC so "latest draft" is deterministic when a user has
        // added versions in the builder since the app installed.
        const workflowVersionRepository =
          await this.globalWorkspaceOrmManager.getRepository<WorkflowVersionWorkspaceEntity>(
            workspaceId,
            'workflowVersion',
            { shouldBypassPermissionChecks: true },
          );

        const draftVersion = await workflowVersionRepository.findOne({
          where: { workflowId: workflow.id, status: WorkflowVersionStatus.DRAFT },
          order: { createdAt: 'DESC' },
        });

        if (!isDefined(draftVersion)) {
          return null;
        }

        return {
          workflowId: workflow.id,
          workflowVersionId: draftVersion.id,
        };
      },
      authContext,
    );
  }
}
```

**The `getRepository` third argument is settled, not a risk.** Its verified overloads (`src/engine/searm-orm/global-workspace-datasource/global-workspace-orm.manager.ts:27-43`) type the third parameter as `permissionOptions?: RolePermissionConfig`, and `{ shouldBypassPermissionChecks: true }` is a member of that union (`src/engine/searm-orm/types/role-permission-config.ts`). `WorkflowCommonWorkspaceService` already calls it in exactly this form for `'workflowVersion'`. `create-complete-workflow.tool.ts:224-230` passes `context.rolePermissionConfig` instead because it has a calling user's role; a template install is system-originated and has none, so the bypass form is the correct one here. `executeInWorkspaceContext(fn, authContext)` takes the callback **first** (line 70-74).

The `where: { name }` lookup is a new query shape for the `workflow` repository (no existing call site filters by name) but is an ordinary `WorkspaceRepository.findOne`, the same call `get-workflow-current-version.tool.ts:52-54` makes by id. The draft-version query mirrors `workflow-version.workspace-service.ts:100-105`.

- [ ] **Step 5b: Write the step normaliser (C13)**

Create `utils/normalize-workflow-template-steps.util.ts`. `BaseWorkflowAction` (verified at `workflow-executor/workflow-actions/types/workflow-action.type.ts:24-34`) requires `id`, `name`, `type`, `settings`, `valid`, and allows `nextStepIds?: string[]`. An app supplies only `{ type, name, settings }`; `installDefinition` → `createWorkflowVersion` inserts `steps` verbatim into a `GraphQLJSON`-typed column, so nothing rejects a step with no `id` until the executor tries to run it.

```ts
import { v4 as uuidv4 } from 'uuid';

import { type WorkflowAction } from 'src/modules/workflow/workflow-executor/workflow-actions/types/workflow-action.type';
import { type WorkflowStepInput } from 'src/modules/workflow/workflow-templates/types/workflow-template.type';

// App-supplied steps carry {type, name, settings} and nothing else. A stored
// WorkflowVersion step without an id or `valid` is structurally invalid and
// fails at execution time, not at insert time — normalise here, once.
export const normalizeWorkflowTemplateSteps = (
  steps: WorkflowStepInput[],
): WorkflowAction[] => {
  const withIds = steps.map((step) => ({
    ...step,
    id: step.id ?? uuidv4(),
    valid: step.valid ?? true,
  }));

  // Linear chain in array order — the only ordering an app-supplied list
  // expresses. An explicit nextStepIds on a step is respected as authored.
  return withIds.map((step, index) => ({
    ...step,
    nextStepIds:
      step.nextStepIds ??
      (index < withIds.length - 1 ? [withIds[index + 1].id] : []),
  })) as WorkflowAction[];
};
```

Create `utils/__tests__/normalize-workflow-template-steps.util.spec.ts`:

```ts
import { WorkflowActionType } from 'searm-shared/workflow';

import { normalizeWorkflowTemplateSteps } from 'src/modules/workflow/workflow-templates/utils/normalize-workflow-template-steps.util';

const appStep = (name: string) => ({
  type: WorkflowActionType.AI_AGENT,
  name,
  settings: {
    outputSchema: {},
    errorHandlingOptions: {
      retryOnFailure: { value: false },
      continueOnFailure: { value: false },
    },
    input: { prompt: 'do the thing' },
  },
});

describe('normalizeWorkflowTemplateSteps', () => {
  it('should assign an id to an app-supplied step that omits one', () => {
    const [step] = normalizeWorkflowTemplateSteps([appStep('Triage')] as never);

    expect(step.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('should mark an app-supplied step valid', () => {
    const [step] = normalizeWorkflowTemplateSteps([appStep('Triage')] as never);

    expect(step.valid).toBe(true);
  });

  it('should chain nextStepIds in array order and terminate the last step', () => {
    const [first, second] = normalizeWorkflowTemplateSteps([
      appStep('Triage'),
      appStep('Notify'),
    ] as never);

    expect(first.nextStepIds).toEqual([second.id]);
    expect(second.nextStepIds).toEqual([]);
  });

  it('should preserve an id the caller already assigned', () => {
    const id = '11111111-1111-4111-8111-111111111101';

    const [step] = normalizeWorkflowTemplateSteps([
      { ...appStep('Triage'), id, valid: true },
    ] as never);

    expect(step.id).toBe(id);
  });
});
```

- [ ] **Step 5c: Add the core-schema `installWorkflowDefinition` mutation (C11, C12)**

Create `dtos/install-workflow-definition.input.ts`:

```ts
import { Field, InputType } from '@nestjs/graphql';

import { IsArray, IsBoolean, IsObject, IsOptional, IsString } from 'class-validator';
import GraphQLJSON from 'graphql-type-json';

@InputType()
export class InstallWorkflowDefinitionInput {
  @Field(() => String)
  @IsString()
  name: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  description?: string;

  // Structurally a WorkflowTrigger; typed as JSON on the wire because the
  // union is server-internal, exactly as createWorkflowVersionStep already
  // accepts step definitions as graphqlTypeJson today.
  @Field(() => GraphQLJSON)
  @IsObject()
  trigger: Record<string, unknown>;

  // Entries need only {type, name, settings}: id, valid and nextStepIds are
  // generated by normalizeWorkflowTemplateSteps.
  @Field(() => GraphQLJSON)
  @IsArray()
  steps: Record<string, unknown>[];

  @Field(() => Boolean, { defaultValue: true })
  @IsBoolean()
  activate: boolean;
}
```

Create `resolvers/workflow-definition-install.resolver.ts` — a **separate resolver class on the core schema**, because Phase 5 calls this through `CoreApiClient` and a `@MetadataResolver()` mutation does not exist on `/graphql`:

```ts
import { UseGuards } from '@nestjs/common';
import { Args, Mutation } from '@nestjs/graphql';

import { PermissionFlagType } from 'searm-shared/constants';

import { CoreResolver } from 'src/engine/api/graphql/graphql-config/decorators/core-resolver.decorator';
import { type FlatWorkspace } from 'src/engine/core-modules/workspace/types/flat-workspace.type';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { SettingsPermissionGuard } from 'src/engine/guards/settings-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { InstallWorkflowDefinitionInput } from 'src/modules/workflow/workflow-templates/dtos/install-workflow-definition.input';
import { InstalledWorkflowTemplateDTO } from 'src/modules/workflow/workflow-templates/dtos/workflow-template.dto';
import { WorkflowTemplateService } from 'src/modules/workflow/workflow-templates/services/workflow-template.service';

// Core schema, not metadata: an installed application seeds its workflows
// through CoreApiClient, and a metadata-scoped mutation is absent from the
// core endpoint entirely.
@UseGuards(
  WorkspaceAuthGuard,
  SettingsPermissionGuard(PermissionFlagType.WORKFLOWS),
)
@CoreResolver()
export class WorkflowDefinitionInstallResolver {
  constructor(
    private readonly workflowTemplateService: WorkflowTemplateService,
  ) {}

  @Mutation(() => InstalledWorkflowTemplateDTO)
  async installWorkflowDefinition(
    @Args('input') input: InstallWorkflowDefinitionInput,
    @AuthWorkspace() workspace: FlatWorkspace,
  ): Promise<InstalledWorkflowTemplateDTO> {
    return this.workflowTemplateService.installDefinition({
      definition: {
        name: input.name,
        description: input.description,
        trigger: input.trigger as unknown as WorkflowTrigger,
        steps: input.steps as unknown as WorkflowStepInput[],
      },
      workspaceId: workspace.id,
      activate: input.activate,
    });
  }
}
```

**The `WORKFLOWS` guard is deliberate and is the Phase 5 obligation (C12).** An app's post-install hook runs with the application's own credentials; those credentials hold only what the app's role manifest declares. `PermissionFlagType.WORKFLOWS` (`searm-shared/src/constants/PermissionFlagType.ts:9`) is therefore a hard requirement on the caller: **Phase 5's `app-default.role.ts` must declare `permissionFlagUniversalIdentifiers: [SystemPermissionFlag.WORKFLOWS]`** (UUID `6189e7bd-4051-5752-b6b1-5f31358fbaf1`, `SystemPermissionFlag.ts:10`), exactly as `searm-apps/public/people-data-labs/src/roles/default-function.role.ts:40` already does. Without it the mutation is rejected and neither Phase 5 workflow installs.

Add the two service tests this step earns:

```ts
  it('should return the existing workflow instead of creating a second one when a workflow with the same name already exists', async () => {
    workflowRepository.findOne.mockResolvedValue({
      id: 'workflow-existing',
      name: 'New ticket triage',
      lastPublishedVersionId: 'version-existing',
    });

    const result = await service.installDefinition({
      definition: {
        name: 'New ticket triage',
        trigger: manualTrigger,
        steps: [appSuppliedStep],
      },
      workspaceId: 'workspace-1',
      activate: true,
    });

    expect(result).toEqual({
      workflowId: 'workflow-existing',
      workflowVersionId: 'version-existing',
    });
    expect(workflowRepository.insert).not.toHaveBeenCalled();
    expect(workflowTriggerService.activateWorkflowVersion).not.toHaveBeenCalled();
  });

  it('should store app-supplied steps with generated ids and valid true', async () => {
    workflowRepository.findOne.mockResolvedValue(null);

    await service.installDefinition({
      definition: {
        name: 'New ticket triage',
        trigger: manualTrigger,
        steps: [appSuppliedStep],
      },
      workspaceId: 'workspace-1',
      activate: false,
    });

    const [insertedVersion] = workflowVersionRepository.insert.mock.calls[0];

    expect(insertedVersion.steps[0]).toMatchObject({ valid: true });
    expect(insertedVersion.steps[0].id).toEqual(expect.any(String));
    expect(insertedVersion.steps[0].nextStepIds).toEqual([]);
  });
```

For these, the Step 3 harness needs `findOne: jest.fn().mockResolvedValue(null)` added to `workflowRepository`, and `writeWorkflowVersionAndMirror`'s mock must call back with a shared `workflowVersionRepository = { insert: jest.fn() }` object rather than a fresh inline one, so the inserted steps are inspectable. **This is the task's real-seam test:** `normalizeWorkflowTemplateSteps` and `WORKFLOW_TEMPLATES` are the real modules here, not doubles, so a step shape that would fail at execution fails in this spec instead.

- [ ] **Step 6: Run the test to verify it passes**

```bash
cd packages/searm-server && npx jest workflow-template.service.spec normalize-workflow-template-steps.util.spec
```

Expected: PASS, 11 tests — 5 from Step 3, the 2 added in Step 5c, and the 4 normaliser tests from Step 5b.

- [ ] **Step 7: Write the GraphQL layer**

Create `dtos/workflow-template.dto.ts`:

```ts
import { Field, ID, ObjectType } from '@nestjs/graphql';

@ObjectType('WorkflowTemplate')
export class WorkflowTemplateDTO {
  @Field(() => String)
  key: string;

  @Field(() => String)
  name: string;

  @Field(() => String)
  description: string;
}

@ObjectType('InstalledWorkflowTemplate')
export class InstalledWorkflowTemplateDTO {
  @Field(() => ID)
  workflowId: string;

  @Field(() => ID)
  workflowVersionId: string;
}
```

Create `dtos/install-workflow-template.input.ts`:

```ts
import { Field, InputType } from '@nestjs/graphql';

import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

import { type WorkflowTemplateKey } from 'src/modules/workflow/workflow-templates/types/workflow-template.type';

const TEMPLATE_KEYS: WorkflowTemplateKey[] = [
  'RESEARCH_BRIEF',
  'FOLLOW_UP_DIGEST',
  'ACCOUNT_MONITORING',
];

@InputType()
export class InstallWorkflowTemplateInput {
  @Field(() => String)
  @IsString()
  @IsIn(TEMPLATE_KEYS)
  key: WorkflowTemplateKey;

  @Field(() => Boolean, { nullable: true })
  @IsBoolean()
  @IsOptional()
  activate?: boolean;
}
```

Create `resolvers/workflow-template.resolver.ts` — the **metadata-schema** resolver behind the settings UI (Task 11). Guard pattern copied from Launch 1's `ProposalResolver` (`ai-write-approval/resolvers/proposal.resolver.ts:25-27`, verified). The core-schema `installWorkflowDefinition` mutation is the separate class written in Step 5c; keep them in separate files so each schema scope is obvious at a glance.

```ts
import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query } from '@nestjs/graphql';

import { PermissionFlagType } from 'searm-shared/constants';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { type FlatWorkspace } from 'src/engine/core-modules/workspace/types/flat-workspace.type';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { SettingsPermissionGuard } from 'src/engine/guards/settings-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { InstallWorkflowTemplateInput } from 'src/modules/workflow/workflow-templates/dtos/install-workflow-template.input';
import {
  InstalledWorkflowTemplateDTO,
  WorkflowTemplateDTO,
} from 'src/modules/workflow/workflow-templates/dtos/workflow-template.dto';
import { WorkflowTemplateService } from 'src/modules/workflow/workflow-templates/services/workflow-template.service';

@UseGuards(
  WorkspaceAuthGuard,
  SettingsPermissionGuard(PermissionFlagType.WORKFLOWS),
)
@MetadataResolver()
export class WorkflowTemplateResolver {
  constructor(private readonly workflowTemplateService: WorkflowTemplateService) {}

  @Query(() => [WorkflowTemplateDTO])
  workflowTemplates(): WorkflowTemplateDTO[] {
    return this.workflowTemplateService.list();
  }

  @Mutation(() => InstalledWorkflowTemplateDTO)
  async installWorkflowTemplate(
    @Args('input') input: InstallWorkflowTemplateInput,
    @AuthWorkspace() workspace: FlatWorkspace,
  ): Promise<InstalledWorkflowTemplateDTO> {
    return this.workflowTemplateService.install({
      key: input.key,
      workspaceId: workspace.id,
      activate: input.activate ?? false,
    });
  }
}
```

Create `workflow-templates.module.ts`. The four owning modules are named in the Interfaces table above — do not grep for them at implementation time (I20):

```ts
import { Module } from '@nestjs/common';

import { RecordPositionModule } from 'src/engine/core-modules/record-position/record-position.module';
import { WorkflowVersionCoreModule } from 'src/engine/core-modules/workflow/workflow-version-core.module';
import { WorkflowDefinitionInstallResolver } from 'src/modules/workflow/workflow-templates/resolvers/workflow-definition-install.resolver';
import { WorkflowTemplateResolver } from 'src/modules/workflow/workflow-templates/resolvers/workflow-template.resolver';
import { WorkflowTemplateService } from 'src/modules/workflow/workflow-templates/services/workflow-template.service';
import { WorkflowTriggerModule } from 'src/modules/workflow/workflow-trigger/workflow-trigger.module';

// GlobalWorkspaceDataSourceModule is @Global(), so GlobalWorkspaceOrmManager
// needs no import here. WorkflowToolsModule already combines the other three
// without a cycle, which is the precedent for this import list.
@Module({
  imports: [
    RecordPositionModule,
    WorkflowVersionCoreModule,
    WorkflowTriggerModule,
  ],
  providers: [
    WorkflowTemplateService,
    WorkflowTemplateResolver,
    WorkflowDefinitionInstallResolver,
  ],
  exports: [WorkflowTemplateService],
})
export class WorkflowTemplatesModule {}
```

Register it in **both** schema include-roots, because the two resolvers live on two different schemas:

- `src/engine/core-modules/core-engine.module.ts` — add `WorkflowTemplatesModule` to `imports`. `CoreEngineModule` is the core driver's `include` root (`graphql-config.service.ts:83-86`) and already imports modules from `src/modules/**` (`EmailingModule`, `DashboardModule`, `MessagingWebhooksModule`), so this follows an existing pattern.
- `src/engine/metadata-modules/metadata-engine.module.ts` — add it there too, so `workflowTemplates`/`installWorkflowTemplate` reach the metadata schema for Task 11's settings page.

Importing one module into both trees is safe: the schema a resolver lands in is decided by the `RESOLVER_SCHEMA_SCOPE` tag its decorator sets (`'core'` vs `'metadata'`), not by which include-root reaches it. If Nest reports a cycle on either import, wrap that one import in `forwardRef(() => WorkflowTemplatesModule)`.

- [ ] **Step 8: Verify the schema builds**

```bash
npx nx typecheck searm-server
npx nx start searm-server
```

Expected: server boots with no GraphQL schema errors; `workflowTemplates` and `installWorkflowTemplate` appear in the **metadata** playground (`/metadata`), and `installWorkflowDefinition` appears in the **core** playground (`/graphql`). Check both. If `installWorkflowDefinition` is missing from `/graphql`, `WorkflowTemplatesModule` is not reachable from `CoreEngineModule` — fix the import rather than moving the mutation, because Phase 5 calls it through `CoreApiClient`.

- [ ] **Step 9: Regenerate front types, lint, typecheck, commit**

```bash
npx nx run searm-front:graphql:generate --configuration=metadata
npx nx lint:diff-with-main searm-server
npx nx typecheck searm-server
git add packages/searm-server/src/modules/workflow/workflow-templates packages/searm-front/src/generated-metadata
git commit -m "feat(agent-api): add starter workflow template catalog and install API"
```

---

### Task 11: Workflow templates settings page

**Files:**
- Modify: `packages/searm-shared/src/types/SettingsPath.ts`
- Modify: `packages/searm-front/src/modules/app/components/SettingsRoutes.tsx`
- Create: `packages/searm-front/src/pages/settings/ai/SettingsWorkflowTemplates.tsx`
- Create: `packages/searm-front/src/modules/settings/workflow-templates/graphql/queries/workflowTemplates.ts`
- Create: `packages/searm-front/src/modules/settings/workflow-templates/graphql/mutations/installWorkflowTemplate.ts`
- Create: `packages/searm-front/src/modules/settings/workflow-templates/components/WorkflowTemplateCard.tsx`
- Test: `packages/searm-front/src/modules/settings/workflow-templates/components/__tests__/WorkflowTemplateCard.test.tsx`

**Interfaces:**
- Consumes: the GraphQL operations from Task 10 via generated metadata hooks.
- Produces: route `SettingsPath.WorkflowTemplates`.

- [ ] **Step 1: Add the route path**

In `packages/searm-shared/src/types/SettingsPath.ts`, add to the `SettingsPath` enum next to the AI entries:

```ts
  WorkflowTemplates = 'ai/workflow-templates',
```

- [ ] **Step 2: Write the GraphQL documents**

Create `modules/settings/workflow-templates/graphql/queries/workflowTemplates.ts`:

```ts
import { gql } from '@apollo/client';

export const WORKFLOW_TEMPLATES = gql`
  query WorkflowTemplates {
    workflowTemplates {
      key
      name
      description
    }
  }
`;
```

Create `modules/settings/workflow-templates/graphql/mutations/installWorkflowTemplate.ts`:

```ts
import { gql } from '@apollo/client';

export const INSTALL_WORKFLOW_TEMPLATE = gql`
  mutation InstallWorkflowTemplate($input: InstallWorkflowTemplateInput!) {
    installWorkflowTemplate(input: $input) {
      workflowId
      workflowVersionId
    }
  }
`;
```

- [ ] **Step 3: Write the failing component test**

Create `modules/settings/workflow-templates/components/__tests__/WorkflowTemplateCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { WorkflowTemplateCard } from '@/settings/workflow-templates/components/WorkflowTemplateCard';

describe('WorkflowTemplateCard', () => {
  it('should show the template name and description', () => {
    render(
      <WorkflowTemplateCard
        template={{
          key: 'RESEARCH_BRIEF',
          name: 'Research brief',
          description: 'Researches a company or person on demand.',
        }}
        onInstall={jest.fn()}
      />,
    );

    expect(screen.getByText('Research brief')).toBeInTheDocument();
    expect(
      screen.getByText('Researches a company or person on demand.'),
    ).toBeInTheDocument();
  });

  it('should call onInstall with the template key when clicked', async () => {
    const onInstall = jest.fn();

    render(
      <WorkflowTemplateCard
        template={{
          key: 'RESEARCH_BRIEF',
          name: 'Research brief',
          description: 'Researches a company or person on demand.',
        }}
        onInstall={onInstall}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /install/i }));

    expect(onInstall).toHaveBeenCalledWith('RESEARCH_BRIEF');
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
cd packages/searm-front && npx jest WorkflowTemplateCard
```

Expected: FAIL — cannot resolve `WorkflowTemplateCard`.

- [ ] **Step 5: Write the component**

Create `modules/settings/workflow-templates/components/WorkflowTemplateCard.tsx`. Match the styling primitives `packages/searm-front/src/pages/settings/ai/SettingsAiApprovals.tsx` (Launch 1 Task 7) already uses — do not invent a different shell:

```tsx
import styled from '@emotion/styled';

import { Button } from 'searm-ui/input';

type WorkflowTemplateSummary = {
  key: string;
  name: string;
  description: string;
};

type WorkflowTemplateCardProps = {
  template: WorkflowTemplateSummary;
  onInstall: (key: string) => void;
};

const StyledCard = styled.div`
  border: 1px solid ${({ theme }) => theme.border.color.light};
  border-radius: ${({ theme }) => theme.border.radius.md};
  padding: ${({ theme }) => theme.spacing(4)};
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing(2)};
`;

const StyledName = styled.h3`
  font-size: ${({ theme }) => theme.font.size.md};
  font-weight: ${({ theme }) => theme.font.weight.medium};
`;

const StyledDescription = styled.p`
  color: ${({ theme }) => theme.font.color.secondary};
`;

export const WorkflowTemplateCard = ({
  template,
  onInstall,
}: WorkflowTemplateCardProps) => (
  <StyledCard>
    <StyledName>{template.name}</StyledName>
    <StyledDescription>{template.description}</StyledDescription>
    <Button title="Install" accent="blue" onClick={() => onInstall(template.key)} />
  </StyledCard>
);
```

Confirm the `Button` import path against `SettingsAiApprovals.tsx`'s own imports; match whatever that file uses if it differs.

- [ ] **Step 6: Run the test to verify it passes**

```bash
cd packages/searm-front && npx jest WorkflowTemplateCard
```

Expected: PASS, 2 tests.

- [ ] **Step 7: Write the page and register the route**

Create `pages/settings/ai/SettingsWorkflowTemplates.tsx`:

```tsx
import { useMutation, useQuery } from '@apollo/client';
import styled from '@emotion/styled';

import { WorkflowTemplateCard } from '@/settings/workflow-templates/components/WorkflowTemplateCard';
import { INSTALL_WORKFLOW_TEMPLATE } from '@/settings/workflow-templates/graphql/mutations/installWorkflowTemplate';
import { WORKFLOW_TEMPLATES } from '@/settings/workflow-templates/graphql/queries/workflowTemplates';

const StyledGrid = styled.div`
  display: grid;
  gap: ${({ theme }) => theme.spacing(4)};
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
`;

export const SettingsWorkflowTemplates = () => {
  const { data, loading } = useQuery(WORKFLOW_TEMPLATES);
  const [installWorkflowTemplate] = useMutation(INSTALL_WORKFLOW_TEMPLATE);

  const templates = data?.workflowTemplates ?? [];

  const handleInstall = async (key: string) => {
    await installWorkflowTemplate({ variables: { input: { key, activate: false } } });
  };

  if (loading) {
    return <div>Loading…</div>;
  }

  return (
    <StyledGrid>
      {templates.map((template) => (
        <WorkflowTemplateCard
          key={template.key}
          template={template}
          onInstall={handleInstall}
        />
      ))}
    </StyledGrid>
  );
};
```

Wrap the returned markup in the same page chrome `pages/settings/ai/SettingsAiApprovals.tsx` uses (its `SubMenuTopBarContainer`/`SettingsPageContainer` wrapper and breadcrumb props), substituting the title "Workflow templates."

In `modules/app/components/SettingsRoutes.tsx`, add the lazy import next to the `SettingsAiApprovals` one:

```tsx
const SettingsWorkflowTemplates = lazy(() =>
  import('~/pages/settings/ai/SettingsWorkflowTemplates').then((module) => ({
    default: module.SettingsWorkflowTemplates,
  })),
);
```

and a `<Route path={SettingsPath.WorkflowTemplates} element={<SettingsWorkflowTemplates />} />` alongside the other AI routes.

- [ ] **Step 8: Verify in the browser**

```bash
yarn start
```

Navigate to Settings → the workflow templates route, confirm the three template cards render, click Install on one, confirm no error toast.

- [ ] **Step 9: Lint, typecheck, commit**

```bash
npx nx lint:diff-with-main searm-front
npx nx typecheck searm-front
git add packages/searm-front packages/searm-shared
git commit -m "feat(agent-api): add workflow templates settings page"
```

---

### Task 12: Agent API contract documentation

Charter Phase 4 explicitly names "self-hosting, API, MCP, admin, and security documentation" as a deliverable. This task writes the one document an external integrator or self-hoster needs: the agent-facing API contract this phase just built.

**Files:**
- Create: `packages/searm-server/docs/AGENT_API_CONTRACT.md`

- [ ] **Step 1: Write the document**

Create `docs/AGENT_API_CONTRACT.md`:

```md
# Agent API Contract

This document describes the machine-readable contract SeaRM's tool layer (chat, agent runs, MCP, `execute_tool`, and workflow AI-agent steps) guarantees to any caller — human-authored client, internal agent, or external OAuth-authorized MCP client.

## Authentication and scope

MCP clients authenticate via OAuth 2.1 (RFC 9728 discovery, RFC 7591 dynamic client registration, PKCE-only public clients — see `engine/core-modules/application/application-oauth/`). A token is minted against exactly one workspace and one role, chosen during the authorize flow, and never silently expands to a workspace added later. Every tool call — CRUD, metadata discovery, or write proposal — is scoped by that role's object, field, and row-level permissions. There is no separate "MCP scope" system: the OAuth `scope` parameter is a thin consent label (`api`, `profile`); the actual boundary is the assigned role, enforced by the same permission checks a human user of that role would hit.

## Discovering what you can do

Call `get_tool_catalog` first. It returns only tools your role can currently use — a role with no object permissions on `person` never sees `find_many_people` in its catalog. Call `get_object_metadata` (`includeFields: true`) to see each object's fields and your `permittedOperations: {read, write, delete}` for it before attempting a write.

## Reading records

`find_many_<object>` is stably paginated: results are always ordered with `id` appended as a tiebreaker, so concurrent writes never shuffle a page you've already fetched. Every result carries `count` (total matches) and `hasMore` (whether another page exists) — check `hasMore`, not the page size, before deciding whether to keep paging.

## Writing records

Every write (`create_*`, `update_*`, `delete_*`, `send_email`, `create_calendar_event`) is evaluated by a per-workspace policy before it executes:

- **AUTO** — executes immediately, exactly like a human using the same permissions.
- **PROPOSE** (the default) — the call returns `success: true` with a `PENDING` proposal id. **Do not retry.** The change applies only after a human approves it in the AI approvals inbox.
- **FORBID** — the call returns `success: false` with a `FORBIDDEN_BY_POLICY` failure. Do not retry; ask a human to change the policy or make the change directly.

An identical write retried inside the same conversation/turn is deduplicated automatically — you will get back the same pending proposal id, not a second one.

## Deleting records

AI-requested deletes under an `AUTO`-mode policy require a two-call confirmation round trip, independent of the proposal system above:

1. Call `delete_one_<object>` (or `delete_many_<object>`) without `confirm`.
2. The response is a `CONFIRMATION_REQUIRED` failure whose `hint` names the exact token to pass.
3. Repeat the identical call with `confirm: "<token>"` set.

Deletes under the default `PROPOSE` policy do not need a confirm token — the human approval step in the proposal inbox already is the confirmation.

Human-initiated deletes through the ordinary product UI are entirely unaffected by this — confirmation tokens exist only on the AI tool-call path.

## Failure shape

Every failure this contract governs — from the gate, the tool executor, the tool registry, or the MCP transport — includes, in addition to the legacy `success`/`error`/`message` fields:

\`\`\`json
{
  "success": false,
  "message": "...",
  "error": "...",
  "failure": {
    "code": "NOT_FOUND | UNKNOWN_TOOL | INVALID_ARGUMENTS | FORBIDDEN_BY_POLICY | PERMISSION_DENIED | CONFIRMATION_REQUIRED | DUPLICATE_PROPOSAL | RATE_LIMITED | INTERNAL_ERROR",
    "message": "...",
    "hint": "an imperative sentence describing exactly what to do next",
    "retryable": true,
    "allowedActions": ["retry", "get_tool_catalog", "..."]
  }
}
\`\`\`

`retryable: false` means retrying the identical call will not succeed — stop and either change the request or ask a human. `retryable: true` means a transient condition (a dropped connection, a wrong confirmation token) may resolve on a corrected retry.

## Workflow templates

Three starter workflow templates (`workflowTemplates` GraphQL query) package the research and proposal capabilities above into ready-to-install automations: research brief, follow-up digest, and weekly account monitoring. Install one with `installWorkflowTemplate`; it is created as a `DRAFT` workflow you can inspect and edit in the workflow builder before activating.
```

- [ ] **Step 2: Commit**

```bash
git add packages/searm-server/docs/AGENT_API_CONTRACT.md
git commit -m "docs(agent-api): document the agent-facing API and MCP contract"
```

---

### Task 13: End-to-end integration test

Proves the whole chain — structured failures, confirmation tokens, dedup, permission-scoped discovery — against a real database.

**Files:**
- Create: `packages/searm-server/test/integration/graphql/suites/agent-api/agent-api-semantics.integration-spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–10.

- [ ] **Step 1: Write the integration test**

Create `test/integration/graphql/suites/agent-api/agent-api-semantics.integration-spec.ts`. Copy the harness pattern from Launch 1's `test/integration/graphql/suites/ai-write-approval/proposal-approval.integration-spec.ts` (resolve `ToolExecutorService` from the running Nest application context and call `dispatch()` directly, exactly as an agent's tool call would). Assertions, in order:

1. With the AI write policy set to `{default: 'PROPOSE', overrides: {}}`, dispatch an `update_one` for a real person record twice with identical args and the same `threadId` in context — assert both calls return the **same** `proposalItemId` (Task 6) and that exactly one `ProposalItem` row exists for that thread.
2. With the policy overridden to `{default: 'AUTO', overrides: {}}` for the `person` object, dispatch a `delete_one` for a real person record without `confirm` — assert `success: false`, `failure.code === 'CONFIRMATION_REQUIRED'`, and the record still exists (soft-deleted-at is still null).
3. Extract the token from the failure's `hint`, dispatch the identical `delete_one` call again with `confirm: <token>` — assert `success: true` and the record is now soft-deleted.
4. Dispatch a `find_many_people` call with `limit: 1` against a workspace seeded with at least 3 people — assert `result.hasMore === true`; repeat with `limit: 100` — assert `result.hasMore === false`.
5. Using two roles (one with `person` read permission, one with none), call `get_object_metadata` and assert the `person` entry's `permittedOperations.read` differs between the two (`true` vs `false`).
6. Call `dispatch()` for an unknown tool name via `ToolRegistryService.resolveAndExecute` — assert `failure.code === 'UNKNOWN_TOOL'` and `failure.retryable === false`.
7. **C9 regression, against a real database.** With the policy at `{default: 'PROPOSE', overrides: {}}`, dispatch a static tool whose `toolId` appears in neither `UNGATED_STATIC_TOOL_IDS` nor `STATIC_TOOL_ID_TO_ACTION_TYPE` — assert the output is the pending-approval shape and that a `ProposalItem` row exists with that `toolId` and a non-null `toolCategory`. Then dispatch a `create_one` for a real object and assert a row is created rather than the record being written. If either passes through ungated, the gate has been inverted to an allowlist and the phase must not ship.
8. **C13/C11 edge, against a real database.** Resolve `WorkflowTemplateService` from the app context and call `installDefinition({ definition: { name: 'Integration test workflow', trigger: <manual trigger>, steps: [{ type: 'AI_AGENT', name: 'Step one', settings: {...} }] }, workspaceId, activate: true })` — assert the stored `WorkflowVersion.steps[0]` has a UUID `id`, `valid: true`, and `nextStepIds: []`, and that the workflow's `statuses` include `ACTIVE`. Call it a second time with the identical definition and assert the same `workflowId`/`workflowVersionId` come back and no second `workflow` row exists. This is the exact call Phase 5's post-install hook makes.

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

Expected: all green.

- [ ] **Step 4: Manual end-to-end verification**

```bash
npx nx database:reset searm-server
yarn start
```

Sign in with "Continue with Email" and the prefilled credentials. From AI chat, instruct the agent to delete a test contact after setting that object's AI write policy override to `AUTO` in Settings → AI write policy. Confirm the agent reports it needs confirmation, repeats the call with the token, and the record disappears from the list view. Then visit Settings → Workflow templates, install "Research brief," and confirm it appears as a `DRAFT` workflow in the workflow builder.

- [ ] **Step 5: Commit**

```bash
git add packages/searm-server/test/integration/graphql/suites/agent-api
git commit -m "test(agent-api): add end-to-end coverage for phase 4 agent semantics"
```

---

## Success criteria mapped to tasks

| Charter/phase requirement | Verified by |
| --- | --- |
| Machine-readable failures — `code`, `message`, `hint`, `allowed_actions`, `retryable` | Task 1 (type + builder), Task 2–4 (funnel + MCP wiring), Task 13 integration step 6 |
| Error envelope migration path (touches every tool without a breaking rewrite) | Task 1 Step 2 (`failure` additive to `ToolOutput`), Task 3/4 (only the failure-construction call sites change; `success`/`error`/`message` keep their existing text) |
| OAuth-scoped agent credentials with workspace-limited access | Ground truth section (already implemented — RFC 9728/8414/7591/7009, workspace-pinned at authorize time), Task 9 (verification integration test) |
| Metadata discovery for external agents: schema, objects, fields, permitted operations | Ground truth section (`get_object_metadata`, `get_tool_catalog` already exist), Task 8 (`permittedOperations` added) |
| Idempotency keys | Task 6 (dedupe retried writes within one proposal) |
| Confirmation tokens for AI-requested destructive actions | Task 5 |
| Human UI deletion behavior unchanged | Task 5 (every change lives inside `ProposalGateService`/Zod schemas on the AI tool path only — the human-facing GraphQL delete mutation is never touched by this plan) |
| Stable pagination | Ground truth section (`id` tiebreaker already existed), Task 7 (`hasMore` added) |
| Compact agent-oriented output | Ground truth section (`compactToolOutput`, `stripEmptyValues`, `estimateToolOutputTokens` already exist and are reused, not rebuilt) |
| Stable tool contracts | Task 3 (funnel-level changes only; no tool's `inputSchema` or success shape changes except the two Zod schemas in Task 5, which only add an optional field) |
| Workflow templates packaging Phases 1–3 capabilities | Task 10 (three templates + `installWorkflowDefinition` for app-supplied templates), Task 11 (install UI) |
| Exit gate: "external authorized agent can discover schema, read permitted records, create proposals, and receive actionable failures" | Task 9 + Task 13 integration test, end to end |
| Self-hosting/API/MCP/admin/security documentation | Task 12 |

## Deliberately cut

| Cut | Trigger to build it |
| --- | --- |
| Rewriting every individual tool's internal error path (record-crud services, metadata tools beyond `get_object_metadata`, logic-function execution) to build its own `ToolFailure` inline | When a specific tool's bare `error` string is observed causing an agent to retry-loop or hallucinate a workaround in practice — convert that one call site, following the exact pattern in Task 3. The funnel-level wiring already guarantees every failure that *reaches* the executor/registry/MCP layer gets a `failure`, even from tools that never set one themselves — Task 3's chokepoints only miss failures a tool constructs *and returns successfully as `success:false`* without going through an exception; those keep their legacy shape until migrated individually. |
| `Evidence`/`Fact`-backed workflow templates (durable, evidence-linked research and account monitoring using `AgentTask`/`AgentRun`) | When Phase 2 ships the `Evidence`/`Fact`/`AgentTask` entities. Today's three templates use the existing synchronous `AI_AGENT` workflow step. Once Phase 2 lands, the agent inside that step can call the `create_agent_task` tool (Phase 2 Task 3 Step 8) to schedule durable, leased, retried research instead of doing it inline — update the three prompts to say so, keeping the same three keys and the same step type. |
| A short, workspace-scoped display alias for record ids (crmkit's handle/id split, §1.6) | When token-cost telemetry on MCP tool responses (once `AgentRun` cost accounting exists, per Phase 2) shows UUID verbosity is a material fraction of agent token spend on read-heavy tool calls. Not built now — SeaRM's UUIDs are the primary key everywhere; a parallel alias table is real ongoing surface area for a benefit that is currently unmeasured. |
| Plain-text-by-default HTTP content negotiation as a whole-API transport (crmkit §1.7) | Never on the current trigger set — SeaRM's transport is GraphQL/MCP-JSON-RPC; a parallel plain-text API duplicates the whole surface for a token saving `compactToolOutput`/`stripEmptyValues` already capture at the payload-shape level. Revisit only if a future compact-transport experiment is explicitly commissioned. |
| A literal free-text query-string filter DSL (crmkit §1.9) | Never — SeaRM's GraphQL filter/orderBy inputs already parameterize by construction; there is no SQL-identifier-injection problem to solve on a typed schema. |
| Confirmation-token requirement extended to `PROPOSE`-mode deletes | If a workspace is observed setting `default: AUTO` broadly and relying on confirmation tokens as its only safety net for high-volume delete automation — today `PROPOSE` already routes every delete through human approval, which is a stronger gate than a token, so adding a second gate there is pure friction with no safety gain. |
| ~~Field-level permission scoping for `FieldMetadataToolsFactory`~~ — **no longer cut.** Task 8 Step 5b builds it; relaxing `MetadataToolProvider.isAvailable()` (to absorb Phase 3's discovery need) makes it mandatory | n/a — built |
| A dedicated OAuth scope per tool category (e.g., a `mcp:write` vs `mcp:read` scope, distinct from the role) | If a workspace admin asks to hand out an OAuth client that can read but never write, independent of any role's own permissions — today the same effect is achieved by assigning the OAuth application a read-only role, which is simpler and reuses the existing permission system rather than adding a second, parallel authorization axis. |
| `INBOX_PROCESSING` workflow template (cron-polled inbox extraction) | Cut by the program review as a duplicate of Phase 3 Task 4, which does the same extraction event-driven, idempotently (`sourceKey`), and with real `Evidence`. Rebuild only if a workspace wants inbox extraction **without** connected-account sync running — i.e. a polling fallback for an ingestion path Phase 3 does not cover. |
| `IMPORT_ASSISTANCE` workflow template (post-hoc duplicate/missing-field sweep over recently created records) | Cut by the program review as a duplicate of Phase 3 Tasks 7–8, which resolve identity and validate *before* the write. Rebuild as a generic "data quality sweep" template if users ask to clean records that arrived through paths Phase 3 does not gate (API, Zapier, older imports). |
| `ENRICHMENT` workflow template (`person.created` → research) | Cut by the program review: identical to `RESEARCH_BRIEF` with a different trigger, and a user can change a template's trigger in the workflow builder after installing. Rebuild when telemetry shows people installing `RESEARCH_BRIEF` and immediately re-triggering it on `person.created`. |
| **`on_behalf_of` — a second principal axis for delegated agent actions** (`crmkit-scout.md` §1.17; charter Principal contract's *"represented user/team"*) — added by the program review, previously uncovered by every plan | `ActorMetadata` already distinguishes `AGENT`/`API`/`WORKFLOW`/`APPLICATION`/`MANUAL`/`SYSTEM`, which covers every principal this product's feature set actually produces — no feature in Phases 1–5 has an agent acting *as a specific user*. Build (as `createdByActor.context.onBehalfOfUserWorkspaceId`, plus a line in the proposal card) when a delegated-assistant mode ships: an agent that reads one user's inbox and acts under that user's identity rather than the workspace's agent identity. |
| **Email step-up escalation for high-risk non-CRUD actions** (`crmkit-scout.md` §1.3) — added by the program review | The charter's approval gate already puts a human in the loop for every AI write and every outbound send, which is strictly stronger than an emailed step-up token. Build only if a workspace opts a high-risk action into `AUTO` policy and then wants an out-of-band confirmation for it specifically — i.e. the Task 5 confirmation-token pattern extended from deletes to sends. |
| **MCP `initialize` server-declared `instructions` field** (`crmkit-scout.md` §1.15) — added by the program review | Trivial and free, but it is a prompt-tuning knob with no consumer today; Task 12's `AGENT_API_CONTRACT.md` is the human-readable equivalent. Build when a real external MCP client is onboarded and needs in-band usage guidance rather than a docs link. |
| **Optimistic concurrency via a `version` field + conditional write on the agent-facing tool API** (`crmkit-scout.md` §1.4) — added by the program review | Launch 1's `ProposalItemEntity.baseline`, re-read and compared at approval time, already prevents the exact failure (agent proposes from stale data, a human edits, the write silently clobbers) — and it does it without an agent-visible protocol. Build an agent-visible `version`/`If-Match` only if `AUTO`-policy writes (which skip approval and therefore skip the baseline check) become common enough to clobber human edits. |
| **Structured computed diffs in the audit log** (`crmkit-scout.md` §1.16) — added by the program review | SeaRM's own audit/timeline already records record changes, and the proposal's `baseline` vs `payload` pair *is* a structured diff for every AI-originated change. Build a dedicated diff-computing audit layer when a compliance requirement asks for field-level before/after on non-AI writes too. |
| **Campaign entity / target-account campaign vertical** (`crmkit-scout.md` §1.13; charter vertical wave 1) — added by the program review | Belongs to the vertical-app framework, not the platform: it is objects + views + a workflow, exactly like Phase 5's customer-support app. Build as the second vertical app once Phase 5 proves the framework; it needs zero core change. |
| `request-approval` workflow action / pause-resume on a human-authored workflow step | Unchanged from Launch 1's own deferral — still true here: no workflow template in this phase needs a workflow to block mid-run on approval, because every AI write inside a workflow's `AI_AGENT` step already routes through the proposal gate automatically. |
| A parallel quota/rate-limit subsystem for MCP tool calls (crmkit §1.11) | If SeaRM's existing billing/entitlement system is found not to cover agent-specific resource caps (e.g., concurrent MCP sessions) when that system is inventoried during a future phase — not investigated in this plan; flagged as a risk below, not assumed either way. |

## Ties to the acceptance narratives

- **Lead to qualified opportunity**, step 3 ("a workflow creates a budgeted research task") and step 6 ("a user approves the proposal batch"): the `RESEARCH_BRIEF` template (Task 10) is the concrete, installable form of that trigger. Once Phase 2 ships, its prompt instructs the agent to call `create_agent_task`, which is where the budget/lease/retry envelope comes from.
- **Pipeline and follow-up**, steps 1–3 ("stage change, inactivity... triggers a workflow... creates tasks or an email/calendar proposal"): the `FOLLOW_UP_DIGEST` template (Task 10) is exactly this, cron-triggered.
- **Inbox and meeting intelligence**, step 3, and **Data import and quality**, steps 2 and 5: **owned entirely by Phase 3**, not by this phase. The `INBOX_PROCESSING` and `IMPORT_ASSISTANCE` templates that previously claimed these steps were cut by the program review as duplicates of Phase 3 Tasks 4 and 7–8.
- **Autonomous account monitoring**, steps 1–3 ("cron... creates leased tasks... material changes create proposals"): the `ACCOUNT_MONITORING` template (Task 10) is the cron-triggered, proposal-gated shape of this without the lease/retry/budget envelope, which is explicitly Phase 2's `AgentTask` — named as a deliberate cut above, not silently missing.
- All five narratives' final "audit history / dashboards show source" steps benefit from Task 1–4's structured failures and Task 9's role-scoping making every agent action attributable and recoverable, but none of the five narratives are fully completed by this phase alone — Phase 4's own exit gate ("an external authorized agent can discover schema, read permitted records, create proposals, and receive actionable failures") is what Task 9 + Task 13 prove directly.

## Risks and unknowns

- ~~**`GlobalWorkspaceOrmManager.getRepository`'s third-argument type for a system-bypass call.**~~ **Resolved.** The overloads at `global-workspace-orm.manager.ts:27-43` type the third parameter as `permissionOptions?: RolePermissionConfig`, of which `{ shouldBypassPermissionChecks: true }` is a member; `WorkflowCommonWorkspaceService` already calls it in that exact form. `create-complete-workflow.tool.ts` passes a role config only because it has a calling user; a template install does not.
- ~~**Exact module wiring for `WorkflowTemplatesModule`'s imports.**~~ **Resolved.** The four owning modules are named in Task 10's Interfaces table and written into Step 7's `@Module`. `WorkflowToolsModule` already combines three of them without a cycle. `forwardRef` remains the fallback if Nest complains at boot.
- **Registering `WorkflowTemplatesModule` in two schema include-roots.** Task 10 Step 7 imports it into both `CoreEngineModule` and `MetadataEngineModule` so its two resolvers reach their two schemas. This relies on the `RESOLVER_SCHEMA_SCOPE` tag filtering per schema, which is how `@CoreResolver`/`@MetadataResolver` are defined and used throughout the repo — but no existing module is imported into *both* roots for this reason specifically. Step 8's two-playground check is what proves it; if the metadata resolver leaks into the core schema (or vice versa), split the module in two rather than moving either mutation, because Phase 5's transport choice depends on `installWorkflowDefinition` staying on core.
- **Whether an `AI_AGENT` workflow step with no `agentId` behaves acceptably in production**, not just in the unit-level type sense confirmed by reading `AiAgentWorkflowAction.execute`. The three templates in Task 10 all omit `agentId` deliberately (to avoid the two-phase "create workflow, then create the agent, then wire it in" flow `create_complete_workflow`'s own tool comment describes) — confirm during Task 10 Step 8's manual verification that `AgentAsyncExecutorService.executeAgent({agent: null, ...})` produces a sensible, capable agent turn (with access to the standard tool catalog) rather than a degraded no-tools fallback. If it degrades, each template needs a real `AgentEntity` seeded alongside it — a materially bigger Task 10, not attempted here.
- **Whether SeaRM's entitlement/billing system already caps agent-specific resources** (concurrent MCP sessions, tool-call rate) independent of the general workspace plan. Not inventoried in this plan (crmkit's quota subsystem was deliberately cut on the assumption SeaRM's existing billing covers it, per the anchors report's own finding for `AiBillingService`) — if a future load test shows uncapped MCP tool-call volume from a single OAuth client, that is a new, unscoped risk this plan does not close.
- **Zod schema strictness beyond the two files this plan edits.** Task 5 confirmed by reading the file that `DeleteToolInputSchema`/`generateBulkDeleteToolInputSchema` use plain (non-strict) `z.object()`, which strips rather than rejects an unknown `confirm` key if omitted from the schema — this plan adds it explicitly rather than relying on passthrough behavior, but did not audit every other generated schema for the same class of problem; out of scope here since no other schema in this plan carries an out-of-band control field.
