# AI Write Approval — Launch 1 Design

Date: 2026-08-05
Status: approved design, ready for implementation planning
Scope: Phase 1 of the AI-Native CRM consolidation. One feature. Everything else is a later cycle.

## Context

Four CRM codebases sit in `d:\Files\Vatsa\Projects\AI-CRM`. A prior audit ([CRM_CONSOLIDATION_PLAN.md](../../../CRM_CONSOLIDATION_PLAN.md), [CRM_FEATURE_REGISTRY.csv](../../../CRM_FEATURE_REGISTRY.csv)) scored `searm` the winner at 96/100 and named the other three reference implementations to port from, not merge:

| Repo | Stack | Contributes |
| --- | --- | --- |
| `searm` | NestJS, React, PostgreSQL, Redis, Nx | Platform base — target repository |
| `relaticle` | Laravel, Filament | Approval-gated AI writes, custom-field-aware AI tools, guided import review |
| `crm` | NestJS, Next.js, Prisma | Durable autonomous research, evidence-backed facts, identity resolution |
| `crmkit` | Go, SQLite/Postgres | Agent-safe error semantics, OAuth/MCP access, deterministic API behavior |

Exploration of the current `searm` HEAD showed it already ships far more AI machinery than that audit assumed: `ai-agent`, `ai-agent-execution` (runs, turns, messages), `ai-agent-monitor` (turn evaluation), `ai-agent-role`, `ai-billing` (cost accounting), a tool registry with MCP, and workflow actions `ai-agent`, `form`, `record-crud`.

So the actual gap is narrow and specific: **AI writes go straight through to records. Nothing reviews them.** An agent can change six fields on a company and the first anyone knows is when the data is wrong.

Launch 1 closes exactly that gap and nothing else. The differentiator being built is not "CRM with AI agents" — every incumbent has that. It is **accountable agents**: the agent proposes, a human approves, the audit trail names both.

### Two principles this design is held to

1. **KISS.** Simple beats complete. Every element earns its place or gets cut.
2. **Complexity is a crutch for missing PMF or distribution.** The demo that sells is "the agent tried to change 6 fields, you approved 4." Evidence graphs, durable task schedulers, and vertical app SDKs do not make that demo better. They are deferred until users ask.

Applying those principles cut this design roughly in half twice — once on first pass, once after codebase exploration proved several assumed freebies were not free. The cuts are recorded in "What was deliberately cut" below.

## Infrastructure and stack

Self-hosted on our own infrastructure, no dependency on SeaRM Cloud.

- **Runtime**: NestJS 10 + TypeScript (server), React 18 + Recoil (front), Nx monorepo
- **Data**: PostgreSQL 16 (`core` + `metadata` + per-workspace schemas), Redis (cache, queues, sessions)
- **Storage**: S3-compatible object storage (local filesystem driver acceptable in dev)
- **API**: GraphQL (core + metadata schemas), REST, MCP
- **Deploy**: Docker Compose to start; container orchestration when load requires it

The stack is SeaRM's stack. A fork inherits its host's architecture — substituting a layer means fighting thousands of existing tests for no user-visible gain. License is AGPL-3.0; running it as a service is unencumbered, distributing modified source carries source-availability obligations.

## Design

### The gate

**One chokepoint: `ToolExecutorService.dispatch()`** — `packages/searm-server/src/engine/core-modules/tool-provider/services/tool-executor.service.ts`.

Everything an AI writes passes through this one method: AI chat, agent runs, MCP `tools/call`, the `execute_tool` meta-tool, and AI-agent nodes inside workflows. It also covers side-effecting tools that never touch the record layer at all — `send_email`, `create_calendar_event`.

It sees the full `ToolProviderContext` (`actorContext`, `authContext`, `roleId`, `rolePermissionConfig`, `workspaceId`, `userId`, `userWorkspaceId`, `threadId`) and the discriminated `descriptor.executionRef`, so it can classify `database_crud`/`create_one` and `static`/`send_email` uniformly. Its return type is already `ToolOutput`, so diverting a write is a normal return value, not exception plumbing. There is a working precedent for gating here: the `isAvailable` permission check already living in `dispatchStaticTool`.

Alternatives rejected: gating the eight `record-crud` services misses `send_email`/`create_calendar_event` entirely and cannot distinguish agent from workflow (four of them receive no `ActorMetadata` at all, and `create-record.service.ts` silently defaults a missing actor to `WORKFLOW`). Gating `CommonBaseQueryRunnerService` would hit ordinary human traffic.

**Not gated:** the four deterministic workflow record-crud actions (`create/update/delete/upsert-record.workflow-action.ts`). A human explicitly configured those steps in the workflow builder. The product line is clean — *AI-originated writes are proposed; human-authored automations run.* AI agents inside workflows are still gated, because they route through the tool executor.

**Not gated:** reads. `find_many`, `find_one`, `group_by` pass through untouched. Agents research freely.

### Policy

Per-workspace JSON blob in the existing `KeyValuePairEntity` — `key: 'AI_WRITE_APPROVAL_POLICY'`, `workspaceId` set, `userId` null, `type: CONFIG_VARIABLE`. No new table, no migration. Read through `KeyValuePairService<AiWriteApprovalPolicyKeyValueTypeMap>` with a locally declared type map (pattern: `engine/core-modules/admin-panel/maintenance-mode.service.ts`).

```json
{
  "default": "PROPOSE",
  "overrides": {
    "person.linkedinLink": "AUTO",
    "send_email": "PROPOSE"
  }
}
```

Modes: `AUTO` (write executes normally) | `PROPOSE` (diverted into a proposal) | `FORBID` (rejected with an instructive `ToolOutput`). Override keys are `<objectNameSingular>.<fieldName>` for record writes, tool name for static tools. Most specific match wins; no match falls to `default`. Ships with `default: "PROPOSE"` and no overrides — default deny.

Mutation guarded by `SettingsPermissionGuard(PermissionFlagType.AI_SETTINGS)`. The policy is deliberately **not** a workspace record: any user with record write permissions could otherwise disable the gate on themselves.

### Data model

Core-schema TypeORM entities, following the pattern of the AI agent-run entities in `engine/metadata-modules/ai/ai-agent-execution/entities/`.

**`Proposal`** — `workspaceId`, `status` (`PENDING | APPLIED | REJECTED | EXPIRED`), `createdByActor` (jsonb `ActorMetadata`), `agentRunId`, `threadId`, `reason`, `expiresAt`, `reviewedByUserWorkspaceId`, `reviewedAt`, timestamps.

**`ProposalItem`** — `proposalId`, `actionType` (`CREATE_RECORD | UPDATE_RECORD | DELETE_RECORD | SEND_EMAIL | CREATE_CALENDAR_EVENT`), `objectNameSingular`, `recordId`, `payload` jsonb (proposed values / message body), `baseline` jsonb (observed current values at proposal time), `status` (`PENDING | APPLIED | REJECTED | CONFLICTED | FAILED`), `rationale`, `error`, `resultRecordId`, timestamps.

Batching: one proposal per originating agent run. The gate lazily opens a `PENDING` proposal keyed on the run identifier and appends items to it, so six tool calls in one turn become one reviewable change set rather than six.

**Why core entities and not standard objects.** The first design put these on the workspace metadata layer to inherit views, filters, search, and notifications for free. Exploration proved that wrong on this codebase version: the decorator-based standard-object system was replaced by a declarative flat-metadata registry, so two new standard objects cost roughly 22 files across `searm-shared/src/metadata/*` and `searm-standard-application/*`, plus snapshot updates and a versioned workspace upgrade command for existing workspaces. Meanwhile the diff UI needs a custom component either way (server `WidgetType` enum + front `WidgetContentRenderer` case), and **there is no in-app notification system in this codebase at all** — only queued email. Core entities are roughly a third the surface area for the same v1 capability. Cost accepted: no saved views, no search, no workflow triggers on proposals. None are needed for the wedge.

### Approval

`ProposalExecutionService.approve(proposalId, selectedItemIds, approverUserWorkspaceId)`.

Two passes, deliberately not one transaction:

1. **Validate** every selected item — permission check plus a baseline re-read. If any targeted field changed since the proposal was created, that item is marked `CONFLICTED` and **the whole batch aborts**, surfacing exactly what changed. Nothing is written.
2. **Apply** sequentially through the existing `record-crud` services and tools, running **as the approver** (`buildUserAuthContext` + `rolePermissionConfig: { unionOf: [approverRoleId] }` resolved via `UserRoleService.getRoleIdForUserWorkspace`). Each item lands `APPLIED` or `FAILED`.

Unselected items are marked `REJECTED`.

True cross-item DB atomicity was rejected on cost: the record-crud services accept no external transaction manager, so it would require threading one through eight services plus the common query runners (touching shared core code every other caller depends on), or bypassing record-crud and writing via repositories directly — which would discard the permission enforcement and query hooks this feature exists to guarantee. Validate-then-apply makes post-validation failure rare and, when it happens, visible per item.

**Authorization** needs no new concept: execution runs as the approver, so object and field permissions are enforced by the existing ORM path. If you could type the change yourself, you can approve it.

**Outbound sends** (`SEND_EMAIL`, `CREATE_CALENDAR_EVENT`) execute after record writes, keyed by item id for idempotency. They are external calls and cannot be rolled back — stated plainly rather than pretended away.

**Expiry** is computed from `expiresAt` at query and approve time. No cron job.

### Agent feedback

The gate returns a normal successful `ToolOutput` describing the pending state, not an error — an agent that believes its write failed will retry, duplicate, or hallucinate a workaround:

```ts
{
  success: true,
  message: 'Change proposed and awaiting human approval. Do not retry.',
  result: { proposalId, proposalItemId, status: 'PENDING' }
}
```

`FORBID` returns `success: false` with an actionable message naming what is not permitted.

### Frontend

One route, minimum components:
- **Inbox** — list of `PENDING` proposals for the workspace: source agent, target, item count, age.
- **Diff view** — per item: field, current value, proposed value, rationale, conflict badge. Checkbox per item, `Approve selected` / `Reject` actions.

Core-schema GraphQL, generated through the existing front codegen path.

## What was deliberately cut

Recorded so the cuts are decisions, not oversights, and so the upgrade path is known.

| Cut | Add when |
| --- | --- |
| `Evidence` / `Fact` entities and provenance graph | Users ask "why did it propose this?" more than once |
| `AgentTask` durable scheduler, leases, retries, budgets | Autonomous background monitoring is actually built |
| Policy table with its own audit trail | Policy changes need to be audited, or per-role policy is required |
| `ProposalTarget` morph relation, record-page timeline chip | Proposals need to be discoverable from the record rather than the inbox |
| `request-approval` workflow action, pause/resume | A human-authored workflow step genuinely needs to block on approval |
| Expiry cron job | Query-time computation proves insufficient |
| Notification on new proposal | Reviewers miss proposals — and note this needs building from scratch, no primitive exists |
| Standard-object registration for proposals | Saved views, filters, or search over proposals are requested |
| MCP OAuth scoping, vertical app SDK, guided import review | Their own cycles, after this ships |

## Success criteria

1. An agent instructed to update a record produces a `PENDING` proposal and writes nothing.
2. The agent receives a success-shaped result and does not retry.
3. A reviewer sees a field-level diff, deselects one item, approves the rest.
4. Approved items apply once. Deselected items are `REJECTED`. Records reflect exactly the approved set.
5. A field edited by a human between proposal and approval aborts the batch as `CONFLICTED`, showing the change.
6. An approver lacking write permission on a target cannot apply it — enforced by the existing permission path, not by new code.
7. `FORBID` policy blocks the write with an instructive message.
8. Setting an override to `AUTO` makes that specific write execute directly, unchanged from today.
9. Reads are never gated.
10. No new bypass: a newly added AI tool that writes is gated by default, because the gate sits above the tool layer.

## Verification

- **Unit**: policy resolution (specificity, default fallback, all three modes), conflict detection against baseline.
- **Integration**: agent write diverted rather than applied; approval applies as approver with permissions enforced; validation abort leaves zero writes; unselected items rejected; reads ungated. Existing suites: `npx nx run searm-server:test:integration:with-db-reset`.
- **Manual end-to-end**: `npx nx database:reset searm-server`, start the stack, run an agent from AI chat instructed to update a company, confirm the proposal appears in the inbox, approve a subset, confirm the record.
- **Regression**: full server suite must stay green — the gate sits on a hot path used by every AI feature.

## Open items for the implementation plan

- Exact identifier available in `ToolProviderContext` for correlating tool calls to one agent run (`threadId` is present; whether a run id is reachable needs confirming at implementation time).
- Which service reads the baseline for `UPDATE_RECORD` / `DELETE_RECORD`, and under which auth context.
- Core-schema migration generation command and naming convention in this repo.
- Front route registration for a non-record custom page.
