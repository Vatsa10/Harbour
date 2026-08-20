# Phase 2 plan repair report

**Plan repaired:** `docs/superpowers/plans/2026-08-05-phase-2-evidence-and-research.md`
**Review answered:** `docs/superpowers/plans/2026-08-05-phases-2-5-plan-review.md`, Phase 2 section (6 Critical, 9 Important, 2 Nits)
**Verified against commit:** `dba03d0907` — `style(ai-write-approval): apply oxfmt to the fix-wave changes` (head of `c6e057906b..HEAD`)
**Task count:** 13 before → 15 after (added Task 5b, Task 5c)

Every code reference below was re-read on disk at the named file:line before the plan text was written. Nothing was carried over from the previous revision of the plan or from the review's own quotations.

---

## Critical

### C1 — `record_evidence` is gated, so the evidence pipeline is inert — FIXED

**Verified against:** `proposal-gate.service.ts:46-48` (denylist comment), `:50-85` (`UNGATED_STATIC_TOOL_IDS`, **24** entries — the review said 22), `:241-257` (`isGatedStaticTool`), `:127-193` (`evaluate`), `proposal-execution.service.ts:592-645` (`applyStaticTool` replay), `proposal-gate.service.spec.ts:37-47` (`staticDescriptor` helper), `:68` (default policy `{default:'PROPOSE'}`), `:105-108` (`evaluate` helper), `:110` (`savedItem` helper), `:311-343` (`denylist` describe block).

**Changed:** Task 3 gained Steps 5b–5e as a full TDD cycle — failing test, run, implement, run. Step 5b adds two tests inside the live `describe('denylist')` block using the file's own `staticDescriptor()`/`evaluate()` helpers, each asserting both `kind === 'ALLOW'` **and** `proposalItemRepository.save` not called (kind alone would pass a create-then-allow regression). Step 5d quotes the live end of `UNGATED_STATIC_TOOL_IDS` (lines 81-85) verbatim and adds `'record_evidence'` and `'create_agent_task'` in one array edit with a comment. Step 5e requires the two pre-existing denylist tests (`:312`, `:320`) to stay green. Task 3's header carries a blockquote explaining the whole failure chain. `create_agent_task` was ungated in the same edit deliberately, not "assumed" and not deferred — splitting the array across two tasks is how C1 happened.

### C2 — `create_agent_task` cannot compile — FIXED

**Verified against:** `tool-execution-context.type.ts:1-9` (five fields, **no** `actorContext`), `action-tool.provider.ts:210-216` (constructs the context from exactly those five, so no actor can reach any static tool), `agent.entity.ts:18` (`@Entity('agent')`, core schema, `SyncableEntity` → `universalIdentifier`, no `roleId`), `standard-agent.constant.ts` (one entry, `helper`), `create-standard-flat-agent-metadata.util.ts` (`satisfies` constraint forces the builder pair), `standard-role.constant.ts` (one entry, `admin`), `create-standard-flat-role-metadata.util.ts:25` (`canBeAssignedToAgents: false`), `role-target.entity.ts` (`@Unique(['workspaceId','agentId'])`, `CHK_role_target_single_entity`), `ai-agent-role.service.ts:30-57` (`assignRoleToAgent`), `:145` (`ROLE_CANNOT_BE_ASSIGNED_TO_AGENTS` guard), `role.entity.ts:65-66`.

**Changed:** the prose Step 8 is deleted. Two new tasks replace it.

- **Task 5b** implements Owner Decision 4 as real code: adds `researcher` to `STANDARD_AGENT` + its builder, adds an `aiResearcher` standard role with `canBeAssignedToAgents: true`, and a `ResearchAgentService` that resolves the agent by `universalIdentifier` and idempotently binds the role via `AiAgentRoleService.assignRoleToAgent` — because **`roleTarget` is not in `TWENTY_STANDARD_ALL_METADATA_NAME`**, so the declarative pipeline structurally cannot emit the binding. 5 unit tests plus a `database:reset` + `psql` real-seam check.
- **Task 5c** writes the tool's full `.ts`, `.schema.ts`, and `__tests__/` with 4 tests. `agentId` comes from `resolveResearchAgentId(context.workspaceId)` and is deliberately *not* on the model's input schema. `context.actorContext` is replaced with a literal `{ source: FieldActorSource.AGENT, workspaceMemberId: null, name: 'AI agent', context: {} }`.

### C3 — Task 9's find-and-replace blocks do not exist — FIXED

**Verified against:** `proposal-execution.service.ts:108-166` (`approve()` only claims and delegates), `:168-294` (`applyClaimedProposal`), `:267-276` (the real unselected-items handling: a bulk `update({id: In(...)})`, not a `save()` loop), `:320-351` (`reject()` — one bulk `update`, **never loads items**, and covers `CONFLICTED`), `:82` (`userRoleService` constructor position), spec `:24-36` (`buildItem`), `:190-196` (`approve` helper), `:201-210` (`itemStatusWrite`, and the `_value` technique for `In()`), `:393-402`, `:584-611`.

**Changed:** Step 3 rewritten as two quoted edits against the live line ranges. `applyClaimedProposal` keeps the entities (`unselectedItems`) while preserving the bulk `update`; `reject()` gains a `find()` **before** the update, placed after the `rejection.affected === 0` bail, and keeps the `PENDING | CONFLICTED` status set the earlier draft dropped. Step 1 now specifies five precise spec edits and three new tests including a CONFLICTED-item case and a not-called assertion on the early-return path.

### C4 — `Evidence` GraphQL enum omits three source types — FIXED (by deletion)

**Changed:** `EvidenceSourceTypeGraphQL` no longer exists. The over-engineering collapse (below) replaced `EvidenceDTO`/`FactDTO` with a single flat `ProposalItemFactDTO` whose `sourceType` and `strength` are `@Field(() => String)` — the same choice Launch 1's own `ProposalItemDTO` already makes for `toolId` and `error` (`proposal.dto.ts:28-29`, `:40-41`). No mirror enum can drift from the seven-member union again. Task 11 documents the exact runtime error this avoided.

### C5 — Task 12's UI diff matches nothing in the live component — FIXED

**Verified against:** `ProposalDiffTable.tsx` in full (177 lines): `:2-3` (`@linaria/react` + `themeCssVariables`), `:7-17` (local `ProposalItem` type **including `toolId`**), `:30-53` (styled blocks, all using `themeCssVariables`), `:67-90` (`describeItem`, reads `item.toolId` at `:68`), `:92` (`FIELD_DIFF_ACTION_TYPES`), `:117-164` (two-tier render: item `<tr>` with `colSpan={3}` + per-field `StyledFieldRow` beginning with an empty `<StyledCell />`); `pendingProposals.ts:15` (`toolId` already selected); `__tests__/ProposalDiffTable.test.tsx` in full (**six** tests, two-item multi-field fixture, spreads at `:96-102` and `:119`).

**Changed:** Task 12 rewritten end to end. The type is **extended** (`toolId` preserved, `facts?` added optional); the fixture is **extended** on both items rather than replaced; the citation renders inside the existing `StyledFieldRow` field cell so the four-column shape and the six existing tests survive; styled blocks use `themeCssVariables`; the query before-block includes `toolId`. Step 3 states all six pre-existing tests must be green and says explicitly that a red one means the fixture was replaced.

### C6 — self-contradiction on the struck workflow→HTTP path — FIXED

**Changed:** the risk bullet is struck with its reasoning preserved in a "resolved" subsection; the cut-table row now names the `create_agent_task` static tool and the GraphQL mutation as the two front doors; Task 10's blockquote cross-reference corrected from "Task 3 Step 8" to "Task 5c". No remaining text asserts the HTTP-request-action path.

---

## Important

| # | Status | What changed | Verified against |
| --- | --- | --- | --- |
| I1 | FIXED | Worker coalesces `result.steps?.length ?? 0`, `result.creditsUsedMicro ?? 0`, `result.modelId ?? null`, plus a new test feeding a result that omits all three | `agent-execution-result.type.ts:9-12` |
| I2 | FIXED | `maxSteps?: number = AGENT_CONFIG.MAX_STEPS` added to `executeAgent` in the **same** Task 6 diff as `threadId`; `stopWhen` rewritten to `stepCountIs(maxSteps)`; two behaviour-asserting tests on the real SDK predicate; exhaustion defined as `(result.steps?.length ?? 0) >= task.budget` and surfaced in the task outcome text | `agent-async-executor.service.ts:352-354`, `:9` (`stepCountIs` import), `:44`; `agent-config.const.ts:2` (`MAX_STEPS: 300`); spec `:23-40`, `:42` |
| I3 | FIXED | `agentRepository: unknown` replaced with `@InjectRepository(AgentEntity) Repository<AgentEntity>` and the inline cast deleted — resolved by reading the entity, which is core-schema, so the workspace-scoped question does not arise | `agent.entity.ts:18` |
| I4 | FIXED | Dismissal check hoisted above the CURRENT lookup and made unconditional; `findOne` → `find()` + `.some(isSameValue)`; spec restructured onto two distinct repository methods so reordering cannot silently pass; four new tests including both negatives | plan-internal (Task 2) |
| I5 | FIXED | Every absolute count against a Launch 1 suite replaced with "all pre-existing tests plus the N new ones", and a Global Constraint added stating why, citing the real counts (20 and 22 test declarations) | `proposal-gate.service.spec.ts` (20 decls), `proposal-execution.service.spec.ts` (22 decls) |
| I6 | FIXED | Anchor corrected to `'should capture a staleness baseline for a delete'`, with the non-existent name called out | spec `:229-247` |
| I7 | FIXED | The unfalsifiable `.not.toHaveTextContent('WEAK')` replaced with `getAllByText(/WEAK|STRONG/)).toHaveLength(1)` plus a positive locator assertion; a third conflict-badge test added | plan-internal (Task 12) |
| I8 | FIXED | Task 13 rewritten as ~430 lines of real integration code — six tests, real harness helpers copied from Launch 1's suite, no agent fixture hand-rolled (Task 5b's seed supplies it) | `proposal-approval.integration-spec.ts` in full (425 lines); `get-app-provider-by-class-name.util` |
| I9 | FIXED | `AgentRunEntity.workflowRunId: string \| null` added (+ column + index); `FactEntity.lastObservedAt` added as real freshness copied from `Evidence.observedAt`, with monotonic advance on corroboration and two tests | charter trust-layer table |
| N1 | FIXED | Explicit note that `@Processor` has two argument shapes, both used in Task 7, with an instruction to confirm the overloads | `message-queue.constants.ts` |
| N2 | FIXED | Unused `IsNull` import removed from the resolver snippet; the "remove it if lint complains" instruction deleted | plan-internal (Task 10) |

---

## Over-engineering cuts applied

- **`AgentRunEntity.transcript` + `summarizeAgentSteps` + its spec** — removed from the entity, the migration SQL, the File Structure, Task 7's file list, and Task 7 Steps 2-5 (deleted outright). `resultSummary` alone remains. Rationale written into the entity comment and the task.
- **`EvidenceLookupService` + `FactFieldsResolver` + `ProposalItemFieldsResolver` + `FactDTO` + `EvidenceDTO` + two specs** → one `ProposalItemDTO.facts` resolve field over `FactService.findProposalItemFacts`, returning `{id, fieldName, strength, hasConflict, sourceType, sourceLocator, observedAt}`. Two queries per item regardless of fact count. The DataLoader cut-table row is struck because the N+1 it described no longer exists.

## Owner Decision 1 (FactService boundary) — implemented

`FactLookupService` renamed to `FactService` throughout (26 references). It is the only class outside `AiResearchModule` that can reach `Fact`, and it deliberately does **not** expose `findByIds(): FactEntity[]`. `FactDerivationService` is a provider but **not** exported. `TypeOrmModule` removed from `AiResearchModule`'s `exports` so no importing module can inject `Repository<FactEntity>`. Recorded as a Global Constraint.

## Real-seam rule — applied to every task

Added as a Global Constraint citing Launch 1's own precedent (`proposal-gate.service.spec.ts:53-55`, which uses the real `AiWritePolicyService` for exactly this reason). Per task: T1 hash util is pure; T2 evidence-recording spec now uses the **real** `FactDerivationService`; T3 gained a fourth test wiring real `EvidenceRecordingService` + `FactDerivationService` behind doubled repositories; T3 Step 5b uses the spec's real policy service; T5 and T9 declare their coverage as deferred to named Task 13 steps rather than claiming it; T5b Step 10 is a `database:reset` + `psql` check; T6's `stopWhen` test exercises the real AI SDK predicate; T7 asserts the real coalescing paths; T11 Step 7 runs the live GraphQL query; T12 asserts rendered DOM; T13 is entirely real-seam.

---

## Where the plan disagreed with reality

Each of these was a plan claim that the checkout contradicted. Listed separately as requested.

1. `UNGATED_STATIC_TOOL_IDS` has **24** entries, not 22 (the review's count was also wrong), and contains neither new tool.
2. `GateInput` is module-local and **unexported**, declared inline at `proposal-gate.service.ts:29-40` — there is no `types/gate-input.type.ts`.
3. The unselected-items marking is in the private `applyClaimedProposal()`, not `approve()`, and is a bulk `update`, not a `save()` loop.
4. `reject()` never loads items; the plan's patch referenced an `items` variable that does not exist in that scope. Live `reject()` also covers `CONFLICTED`, which the plan's version dropped.
5. `ToolExecutionContext` has five fields and no `actorContext`; `ActionToolProvider.executeStaticTool` cannot supply one.
6. `AgentEntity` is a **core-schema** entity. The plan's Task 4 comment asserted it "lives in the workspace schema (metadata-managed, per-workspace), not core" — the opposite of the truth. Corrected.
7. `AgentEntity` has no `roleId`; the agent→role edge is `RoleTargetEntity`.
8. There is **no** declarative standard-role-target mechanism — `roleTarget` is absent from `TWENTY_STANDARD_ALL_METADATA_NAME`, and `createStandardRoleFlatMetadata` hard-codes `roleTargetIds: []`. The seeded `helper` agent is role-less today.
9. Every shipped role (`admin`, member, guest) sets `canBeAssignedToAgents: false`, so `assignRoleToAgent` would throw against all of them. A new role was required.
10. `ProposalDiffTable.tsx` uses Linaria + `themeCssVariables`; the plan's `${({ theme }) => …}` idiom appears nowhere and does not build.
11. The component's render is two-tier with a `colSpan={3}` item row and an empty leading spacer cell; the plan quoted a flat one-row-per-field map.
12. The component's `ProposalItem` type already has `toolId`, which `describeItem` reads; the plan's replacement deleted it.
13. `PENDING_PROPOSALS` already selects `toolId`; the plan's "before" block omitted it, so the replace would not have matched.
14. The component spec has six tests, not two; the plan's "2 existing + 2 new" would have destroyed four.
15. The spec's policy service is real and driven by a `setPolicy(...)` helper; the plan's `policyService.resolveMode.mockReturnValue(...)` would throw.
16. The anchor test name `'should capture the current field values as the baseline'` does not exist.
17. `cron-register-all.command.ts` registers commands through an `allCommands` array plus a loop, not a sequence of `.run()` calls; the plan's instruction described the wrong structure.
18. `MessageQueue`'s last member is `aiStreamQueue`, not `aiQueue`.
19. `AGENT_CONFIG.MAX_STEPS` is 300 and `stopWhen` is at line 352-354 — a three-line expression, not a bare `stepCountIs(...)` call.
20. `AgentExecutionResult.steps/modelId/creditsUsedMicro` are all optional; three plan lines fed them straight into non-optional targets.
21. No agent-creation fixture exists anywhere under `test/integration/graphql/suites` — the plan's "grep for one and reuse it" instruction had no referent.
22. `pendingProposals` is served from `/metadata`, not `/graphql`; the plan's verification steps did not say which endpoint.

## Not resolved

1. **The seeded role's `canUpdateAllObjectRecords` flag.** Decision 4 says "write-nothing-directly". Setting it `false` may strip write tools from the agent's catalog before the gate ever sees them, producing an agent that can observe but never propose — the exact degraded run the decision exists to prevent. The plan ships `true` with the gate as the write barrier, flags the deviation in a blockquote for the owner, and makes Task 5b **Step 1** a mandatory grep of `database-tool.provider.ts` to settle it before the flag is written. **Owner-visible: this is a product-security default, and I chose the functional reading over the literal one.**
2. **Whether `claimDueTasks` re-claims a still-`LEASED` row whose lease expired.** The claim query filters `status = PENDING` first, which suggests a crashed worker's row may never be re-claimed — i.e. the "survives restart" half of the exit gate may not actually hold. Task 13's test writes `status = PENDING` alongside the expired lease and therefore does not settle it. The plan names this in Task 13 Step 1 and in the risks section, and instructs the implementer to widen the query or record the gap rather than weaken the test. Not fixed here because fixing it means changing `AgentTaskService`'s claim semantics, which is a design change beyond repairing the review's findings.
3. **`threadId` through the lazy tool-loading path.** `ActionToolProvider.executeStaticTool` forwards it (verified), but whether `createExecuteToolTool` forwards its `ToolContext` into `ToolRegistryService`'s dispatch was not read. Task 7's worker uses `toolLoadingStrategy: 'lazy'`, so if it drops `threadId`, `record_evidence` refuses every call and the pipeline is inert for a second, unrelated reason. Flagged as the highest-value open item in the risks section with an instruction to read `tool-registry.service.ts` before Task 7 ships.
4. **`AiAgentRoleService.assignRoleToAgent`'s exact parameter object.** Reported as `{ workspaceId, agentId, roleId }` by a verification pass, but I did not read the signature line myself. Task 5b Step 7 carries an explicit instruction to confirm it against `ai-agent-role.service.ts:30-57` before writing the call.
5. **`themeCssVariables.font.size.xs` / `spacing[1]`.** The component uses `font.size.sm` and `spacing[2]`/`spacing[3]`; the two tokens the citation styling wants were not confirmed to exist. Task 12 Step 4 says to confirm and names the fallback, because a missing Linaria token is a silent empty string, not a build error.
6. **The single-cron CLI invocation** for manual testing. No precedent exists in this repo — every cron command is registered in bulk via `cron:register:all`. Left as an explicit "confirm against `project.json`" instruction rather than an asserted string.

## Findings the review got wrong

- **C1's entry count.** `UNGATED_STATIC_TOOL_IDS` is a 24-entry list, not 22.
- **I5's suite counts.** The review said "~19" and "~25" `it` blocks. The real figures are 20 test declarations in `proposal-gate.service.spec.ts` (18 `it` + 2 `it.each`, expanding to 27 executed cases) and 22 in `proposal-execution.service.spec.ts`. The finding stands; the numbers were off, which is why the plan now avoids absolute counts entirely.
- **C2's recommended fix was under-specified against reality.** It proposed "seed one `AgentEntity` per workspace with a fixed universal identifier" as though that were sufficient. It is not: there is no declarative role-target mechanism and no agent-assignable role exists, so a seeded agent gets no tools. The repair required a second standard role and a run-time binding service.
- **I3's recommended fix would have been wrong.** It said to "write the real decorator" `@InjectWorkspaceScopedRepository(AgentEntity)`. `AgentEntity` is core-schema, so the correct fix is a plain `@InjectRepository`. Following the review here would have preserved the confusion rather than removing it.

---

# Open items settled

Follow-up investigation, same checkout. Every claim below was read on disk at the named file:line; nothing is inferred from the plan.

## Q1 — Can a seeded agent actually use tools? **Yes, but only with Task 5b. Without it the agent has zero tools, not a reduced set.**

**How an agent is bound to a role.** There is exactly one edge and one writer:

- `AgentEntity` has no `roleId`. The edge is a `RoleTargetEntity` row with `agentId` set (`@Unique(['workspaceId','agentId'])`).
- The only writer is `AiAgentRoleService.assignRoleToAgent` → `RoleTargetService.create({ createRoleTargetInput: { roleId, targetId: agentId, targetMetadataForeignKey: 'agentId' }, workspaceId })`.
- `RoleTargetService.create` is not a repository insert. It goes through `createMany`, which loads four flat-entity maps, resolves the workspace's custom application, and runs `WorkspaceMigrationValidateBuildAndRunService.validateBuildAndRunWorkspaceMigration({ allFlatEntityOperationByMetadataName: { roleTarget: … } })`. **Cost:** a full migration build plus flat-map recompute per binding. Acceptable once per workspace on first use; unacceptable per task. Task 5b's existence check in front of it is load-bearing, not defensive.
- The read side at execution time is `AgentAsyncExecutorService.getAgentRoleId()` (`agent-async-executor.service.ts:108-120`) — `roleTargetRepository.findOne(workspaceId, { where: { agentId }, select: ['roleId'] })`.

**What `canBeAssignedToAgents` gates.** Two independent layers, both of which reject every shipped role:

1. `ai-agent-role.service.ts:145` throws `AiException(ROLE_CANNOT_BE_ASSIGNED_TO_AGENTS)`.
2. `validate-flat-role-target-assignation-availability.util.ts:22-28` emits `ROLE_CANNOT_BE_ASSIGNED_TO_ENTITY` inside the migration validator, so bypassing the service does not help.

No shipped role sets it true: `create-standard-flat-role-metadata.util.ts:25` (`admin`), `role.service.ts:472` (`createMemberRole`), `:499` (`createGuestRole`). The **column default is `true`** (`1700140427984-setupMetadataTables.ts:117`) and both `createRoleInput` (`from-create-role-input-to-flat-role-to-create.util.ts:45`) and the app-manifest converter (`from-role-manifest-to-universal-flat-role.util.ts:30`) default to `true` — so a user-created or application-supplied role *can* be agent-assignable. Only the three hard-coded seeds opt out.

**Can `roleTarget` be created at seeding time?** The *role* can (declaratively — `'role'` is in `TWENTY_STANDARD_ALL_METADATA_NAME`, and adding a `STANDARD_ROLE` key forces the matching builder via the `satisfies` constraint). The *roleTarget* cannot: `'roleTarget'` is absent from that list and `createStandardRoleFlatMetadata` hard-codes `roleTargetIds: []`. Note the migration engine itself *does* understand `roleTarget` — `RoleTargetService.createMany` passes it as a metadata name — so the gap is purely in the standard-application seed list. Adding it there would mean inventing standard-roleTarget constants and builders and is a larger change than Task 5b's runtime binding. Task 5b's approach is correct.

**The decisive test — what does a role-less agent resolve to? Nothing.** `agent-async-executor.service.ts:295-325`:

```ts
let registryTools: ToolSet = {};

// Registry tools are scoped exclusively by the agent permission-tab
// role. No role means no registry tools.
if (isDefined(agentRoleId)) {
  …lazy or preload…
}
```

There is no `else`. A role-less agent receives only `this.nativeToolBinder.bind(...)` — provider-native web/Twitter search. Not the full catalog, not a read-only subset: **zero registry tools**, so `record_evidence`, `create_agent_task` and every CRUD tool are unreachable and the Phase 2 evidence pipeline is inert. This is the single fact that makes Task 5b a blocker rather than a nicety.

**Once a role exists, `record_evidence` does reach the catalog.** Its category `ToolCategory.ACTION` is one of the two in `WORKFLOW_AGENT_REGISTRY_TOOL_CATEGORIES` (`DATABASE_CRUD`, `ACTION`), `ActionToolProvider.isAvailable()` returns `true` unconditionally (`:70-72`), and tools registered like `search_help_center`/`navigate_app` (`:140-171`) carry no `hasToolPermission` check — unlike `http_request`, `send_email`, `create_calendar_event`, `code_interpreter`, which are each behind a `PermissionFlagType`. Register `record_evidence` in the unconditional block; a permission-flagged registration would need a `rolePermissionFlagId` the standard-role builder hard-codes to `[]`.

**Owner Decision 4 survives contact with the code**, unchanged in intent, with Task 5b as its implementation and one deviation now demonstrated rather than assumed (below). No new task was required.

## Not-resolved #1 also settled — the seeded role must keep `canUpdateAllObjectRecords: true`

`database-tool.provider.ts:144-146` derives `canUpdateRecords` from the role's object permissions, and `:262` guards the entire write-tool descriptor block — `create_one_*`, `create_many_*`, `update_one_*`, `update_many_*`, upsert — with `if (canUpdateRecords && canBeManagedByAutomation)`. With the flag `false`, the agent's catalog contains no write tool of any kind, so it can never trip `ProposalGateService` and never produce a proposal. The plan's choice of `true` with the gate as the write barrier is now demonstrated correct; the deviation from Decision 4's literal "write-nothing-directly" phrasing stands and remains flagged for the owner. Task 5b Step 1 was rewritten from "grep and decide" into a two-line regression guard against both this line and the `isDefined(agentRoleId)` blackout.

## Q2 — Does the durable lease survive a restart? **No. The plan's SQL was wrong. Fixed.**

The plan's `claimDueTasks` selected `task.status = :pending AND task."dueAt" <= :now AND (task."leasedUntil" IS NULL OR task."leasedUntil" < :now) AND task.attempts < task."maxAttempts"`, then bulk-updated with `.andWhere('status = :pending')`.

Row-by-row: a crashed worker leaves `status = 'LEASED'` and a `leasedUntil` that later goes into the past. Nothing else in the system resets that status — `completeTask`/`failTask` are only called by the worker that died, and there is no reaper. The `status = PENDING` conjunct is therefore never satisfied and **the row is stranded forever**. The `leasedUntil` disjunct was dead weight: for a `PENDING` row the lease is `NULL` or already stale anyway. So the exit gate's "survives restart" half could not have passed, and Task 13's test hid it by writing `status = 'PENDING'` alongside the expired lease — simulating a *rescheduled* task, not a crash.

**Corrected statement** (now in the plan):

```sql
-- candidate select
WHERE (task.status = 'PENDING'
       OR (task.status = 'LEASED' AND task."leasedUntil" < :now))
  AND task."dueAt" <= :now
  AND task.attempts < task."maxAttempts"

-- conditional UPDATE guard (the compare-and-swap)
WHERE id IN (:...ids)
  AND (status = 'PENDING'
       OR (status = 'LEASED' AND "leasedUntil" < :now))
```

The CAS still holds: the first tick sets `status = LEASED` with `leasedUntil` in the future, which makes the predicate false for any concurrent tick. `attempts < maxAttempts` bounds the reclaim loop.

That exposed a second hole: a row that burns through `maxAttempts` while leased is neither claimable nor terminal, so it sits `LEASED` forever with no operator surface. Added `AgentTaskService.reapAbandonedTasks()` (`status = LEASED AND "leasedUntil" < now() AND attempts >= "maxAttempts"` → `FAILED` with an outcome string), called at the top of the dispatch tick.

**Should Phase 2 reuse existing machinery instead?** Partly, and it now does. Twenty's queue is BullMQ over Redis; `buildJobsOptions` (`bullmq.driver.ts:330-352`) exposes only `attempts`, `priority`, `delay` and retention. Jobs are not SQL-queryable and are dropped by `removeOnComplete`/`removeOnFail`, so they cannot hold the `budget`/`attempts`/`outcome` state the approvals UI and Task 13 read — the durable record has to stay in `core."agentTask"`. But the *recovery pattern* is already in the repo and is now cited as the model: `getStaledRunsFindOptions()` matches `status = ENQUEUED AND enqueuedAt < now() - STALED_RUNS_THRESHOLD_MS` (1 hour) and `WorkflowHandleStaledRunsWorkspaceService` re-enqueues, driven by the `cron:workflow:handle-staled-runs` cron. The corrected `claimDueTasks` plus `reapAbandonedTasks` is that same pattern with a per-row deadline instead of a global threshold. No second scheduler.

## Q3 — `threadId` through the lazy `execute_tool` path: **reaches the tool, once the source object carries it**

Chain read end to end: `createExecuteToolTool` closes over the `ToolContext` it is constructed with and passes it **unchanged** to `toolRegistry.resolveAndExecute(toolName, args, context, …)` (`execute-tool.tool.ts:66-69`) → `buildContextFromToolContext` copies `threadId` explicitly onto the `ToolProviderContext` (`tool-registry.service.ts`) → `ToolExecutorService.dispatch` → `ActionToolProvider.executeStaticTool` forwards `threadId: context.threadId` into the five-field `ToolExecutionContext` (`action-tool.provider.ts:210-216`). No reconstruction anywhere.

The one real gap is upstream and the plan already fixes it: `buildLazyRegistryTools` builds its `ToolContext` from `workspaceId, roleId, authContext, actorContext, userId, userWorkspaceId` with **no** `threadId` (`agent-async-executor.service.ts:183-191`). Task 6 Step 6 adds it. Task 6 Step 1 gained a second test that exercises `toolLoadingStrategy: 'lazy'` — the preload-only test would have passed while the worker's actual path dropped the field.

## Q4 — `assignRoleToAgent` signature: **confirmed exactly as reported**

`ai-agent-role.service.ts:31-39`: `assignRoleToAgent({ workspaceId, agentId, roleId }: { workspaceId: string; agentId: string; roleId: string }): Promise<void>`. All required, returns void. Idempotent by design — `validateAssignRoleInput` returns `roleToAssignIsSameAsCurrentRole: true` when a `roleTarget` on `{ agentId, roleId }` exists and the method returns before touching `RoleTargetService`.

## Q5 — Linaria tokens: **both exist**

`themeCssVariables.font.size.xs` → `themeCssVariables.ts:204` (`font.size` = `xxs, xs, sm, md, lg, xl, xxl`). `themeCssVariables.spacing[1]` → `:60` (`spacing` has string integer keys `'0'`–`'32'` plus half-steps). Task 12's fallback instruction was deleted; the "missing token is a silent empty string" caveat was kept as the reason for verifying.

## Q6 — single-cron CLI: **`npx nx run twenty-server:command cron:<name>`**

`packages/twenty-server/project.json`'s `command` target is `{"cwd": "packages/twenty-server", "command": "node dist/command/command.js"}`; Nx appends the trailing args, and `cron:register:all` is just one registered nest-commander name among many (`cron:workflow:handle-staled-runs`, `cron:billing:reminder`, …) — nothing privileges the bulk registrar. Two caveats now in Task 13 Step 4: the target runs `dist/`, so build first or use `npx ts-node -r tsconfig-paths/register src/command/command.ts <name>`; and a `cron:*` command *registers* the recurring job rather than executing one tick.

## What this invalidated in the plan

1. **Task 5's `claimDueTasks` was incorrect** — strict-`PENDING` claim, crashed rows stranded forever, exit gate unpassable. Rewritten, plus a new `reapAbandonedTasks()`, plus the dispatch-tick call, plus three new unit tests and three rewritten/new integration tests.
2. **Task 13's lease-expiry test was self-defeating** — it wrote `status = 'PENDING'` alongside the expired lease, so it would have gone green against the broken query. Rewritten to touch only `"leasedUntil"`, with an explicit assertion that the row is still `LEASED` before the re-claim.
3. Nothing else in the plan was invalidated. Q1, Q3, Q4, Q5 and Q6 all confirmed what the plan already assumed; the changes there replace hedged instructions with demonstrated facts and quoted line numbers.
