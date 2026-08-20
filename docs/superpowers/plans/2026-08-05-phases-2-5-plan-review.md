# Adversarial Review — Phases 2–5 Implementation Plans

**Date:** 2026-08-06
**Reviewer brief:** prove these plans cannot be executed as written by a model that transcribes rather than designs.
**Method:** every load-bearing file path, class, method, signature, and quoted find-and-replace block was checked against the real checkout at `d:\Files\Vatsa\Projects\AI-CRM\twenty` (HEAD `c6e057906b`, Launch 1 partially landed). Findings marked **[verified]** were confirmed by reading the source file named.

**Verdicts**

| Plan | Verdict |
| --- | --- |
| Phase 2 — evidence and research | **NEEDS_REVISION** |
| Phase 3 — ingestion and import | **NEEDS_REVISION** |
| Phase 4 — agent API semantics | **NEEDS_REVISION** |
| Phase 5 — vertical apps | **NEEDS_REVISION** |
| Phases 2–5 program document | **NEEDS_REVISION** |

**Totals: 14 Critical, 28 Important, 8 Nits.**

The plans read as coherent because they were reconciled *against each other*. Three of the four were not re-checked against the live `ai-write-approval` code they extend, and Launch 1 has moved since they were written. Every Critical below is a place where a literal transcriber produces code that does not compile, does not run, or silently removes a security property.

---

## The one-paragraph summary

Two defects dominate. **Phase 4 Task 5 Step 8 replaces `ProposalGateService.buildGateInput` with a version written against a file that does not exist**, converting the gate's deliberate *denylist* into an *allowlist* and deleting `target`, `toolId`, `toolCategory`, and `baselineFieldNames` — this is the security property the entire product sells, and the program review's C1 conflict analysis checked the block immediately downstream of it while missing this one. **Phase 2 never ungates `record_evidence`**, so under the shipped default policy every evidence-recording call is diverted into a proposal and the Phase 2 exit gate is unreachable. Beyond those, the Phase 5 ← Phase 4 edge that the program review created to close its highest risk is broken in three independent ways (wrong GraphQL schema, missing permission flag, structurally invalid step objects), and Phase 3's guided import writes records with a `RolePermissionConfig` value that does not exist in the type union.

---

# Phase 2 — Evidence and Durable Research

**Verdict: NEEDS_REVISION.** 6 Critical, 9 Important, 2 Nits.

## Critical

### C1. `record_evidence` is gated by the live proposal gate — the entire evidence pipeline is inert

**Location:** Task 3 Steps 1–7 (create and register `record_evidence` in `ActionToolProvider`). The only mention of ungating is a parenthetical inside Task 3 **Step 8**: *"Add `'create_agent_task'` to `UNGATED_STATIC_TOOL_IDS` in `proposal-gate.service.ts` alongside `'record_evidence'`"* — which presupposes `record_evidence` is already there.

**[verified]** `packages/twenty-server/src/engine/metadata-modules/ai/ai-write-approval/services/proposal-gate.service.ts` contains `UNGATED_STATIC_TOOL_IDS`, a 22-entry list, with the comment *"The inverse of the old allowlist. A static tool is gated unless it appears here."* `record_evidence` is not in it, and **no step in Phase 2 adds it.**

**Failure:** the shipped default policy is `{ default: 'PROPOSE' }`. `isGatedStaticTool('record_evidence', …)` returns `true`. Every `record_evidence` call is diverted into a `ProposalItem` with `actionType: STATIC_TOOL`, and the tool returns *"Change proposed and awaiting human approval."* No `EvidenceEntity` row is ever written. `FactDerivationService.deriveFact` never runs. `FactLookupService.findCurrentFactIdsForFields` always returns `[]`. Task 12's citation row never renders. Task 13's exit-gate test cannot pass. Worse: on approval, `ProposalExecutionService.applyStaticTool` *replays* `record_evidence` through its provider, so a human is asked to approve the act of writing down an observation.

**Fix:** insert a step in Task 3 **before** Step 6:

> **Step 5b: Ungate the tool.** In `proposal-gate.service.ts`, add `'record_evidence'` to `UNGATED_STATIC_TOOL_IDS` under a new `// evidence recording — writes a platform table, never a CRM record` comment. Add a test to `proposal-gate.service.spec.ts`: *"should not gate record_evidence"* — `evaluate({descriptor: {executionRef: {kind:'static', toolId:'record_evidence'}, …}, args, context})` with `resolveMode` returning `'PROPOSE'` returns `{kind: 'ALLOW'}` and `proposalItemRepository.save` is not called.

Do the same for `'create_agent_task'` in Step 8 rather than assuming.

---

### C2. The `create_agent_task` tool cannot compile or run

**Location:** Task 3 Step 8.

Three independent breaks:

1. **Missing `agentId`.** `AgentTaskService.createTask` (Task 5) declares `agentId: string` as a **required** field of `CreateAgentTaskParams`, and `AgentTaskEntity.agentId` is `@Column({type:'uuid'})` with `"agentId" uuid NOT NULL` in the Task 4 migration. Step 8's Zod input is `{objectNameSingular, recordId, reason, priority?, budget?}` and its `createTask({...})` call passes no `agentId`. Step 8 explicitly says *"Task 5's exact signature — do not add an overload"*, so the implementer cannot resolve this without inventing product behaviour: which agent runs a tool-scheduled research task?
2. **`context.actorContext` does not exist. [verified]** `ToolExecutionContext` (`engine/core-modules/tool/types/tool-execution-context.type.ts`) is exactly `{ workspaceId; userId?; userWorkspaceId?; threadId?; onCodeExecutionUpdate? }`. There is no `actorContext`. `createdByActor: context.actorContext ?? null` is a type error. This is the same gap Launch 1's own risk list already recorded ("`ToolExecutionContext` has no actor").
3. **The task is prose.** *"Build this exactly like `RecordEvidenceTool` in Steps 1–7"* is only executable for the parts that are the same. Everything that differs — the agent-resolution rule, the actor, whether `budget` maps to `AgentTaskEntity.budget` or is validated — is left to the implementer.

**Fix:** this is Owner Decision 4 surfacing as a compile error. Decide it. Recommended: seed one `AgentEntity` per workspace with a fixed universal identifier, resolve it inside the tool, and write the tool's full `.ts`, `.schema.ts`, and `__tests__/` files out in the plan the way Steps 1–5 write `record_evidence`. Replace `context.actorContext` with a literal `{ source: FieldActorSource.AGENT, workspaceMemberId: null, name: 'AI agent', context: {} }`.

---

### C3. Task 9's find-and-replace blocks do not exist in the live `ProposalExecutionService`

**Location:** Task 9 Step 3.

**[verified]** against `services/proposal-execution.service.ts`.

The plan quotes, as *"the existing unselected-items loop"* inside `approve()`:

```ts
for (const item of unselectedItems) {
  await this.proposalItemRepository.save({ ...item, status: ProposalItemStatus.REJECTED });
}
```

The live code is in `applyClaimedProposal()` (not `approve()`) and reads:

```ts
const unselectedItemIds = items.filter((item) => !selectedItemIds.includes(item.id)).map((item) => item.id);
if (unselectedItemIds.length > 0) {
  await this.proposalItemRepository.update({ id: In(unselectedItemIds) }, { status: ProposalItemStatus.REJECTED });
}
```

The plan quotes, as the existing `reject()` loop, a `find({where:{proposalId, status: In([PENDING])}})` followed by a per-item `save`. The live `reject()` **never loads the items at all**:

```ts
await this.proposalItemRepository.update(
  { proposalId, status: In([ProposalItemStatus.PENDING, ProposalItemStatus.CONFLICTED]) },
  { status: ProposalItemStatus.REJECTED },
);
```

**Failure:** neither replacement can be applied. `items.flatMap((item) => item.factIds)` in the `reject()` patch has no `items` variable in scope. Task 9's two new tests (`expect(factLookupService.markDismissed).toHaveBeenCalledWith(['fact-2'])` and `(['fact-1'])`) cannot pass. The "don't nag" rule from Task 2 has no trigger, so `FactStatus.DISMISSED` is never written by anything and Task 2's dismissal branch and Task 13 step 12 are dead.

**Fix:** rewrite Step 3 against the file on disk.
- In `applyClaimedProposal`: keep the entities — `const unselectedItems = items.filter(i => !selectedItemIds.includes(i.id));` — call `update({id: In(unselectedItems.map(i => i.id))}, …)` as today, then `await this.factLookupService.markDismissed(unselectedItems.flatMap(i => i.factIds));`
- In `reject()`: add a `find({where:{proposalId, status: In([ProposalItemStatus.PENDING, ProposalItemStatus.CONFLICTED])}})` **before** the `update`, and dismiss those items' `factIds`. Note that live `reject()` also rejects `CONFLICTED` items — the plan's version drops them.

---

### C4. The `Evidence` GraphQL enum omits three source types Phase 3 writes — runtime GraphQL error

**Location:** Task 11 Step 5 (`EvidenceSourceTypeGraphQL`) vs Task 1 Step 1 (`EvidenceSourceType`) vs Phase 3 Task 4 Step 4.

Task 1 defines seven source types: `CRM_RECORD | CRM_ACTIVITY | WEB_SEARCH | MANUAL | EMAIL_MESSAGE | CALL_RECORDING | IMPORT_FILE`. Task 11's mirror enum registered with `registerEnumType(EvidenceSourceTypeGraphQL, { name: 'EvidenceSourceType' })` declares **four**. Phase 3 Task 4 writes `sourceType: sourceType === 'message' ? 'EMAIL_MESSAGE' : 'CALL_RECORDING'`.

**Failure:** the first time a reviewer opens the approval inbox on an ingestion-derived proposal, `pendingProposals { items { facts { evidence { sourceType } } } }` — the exact query Task 12 Step 1 installs — throws *"Expected a value of type EvidenceSourceType but received: EMAIL_MESSAGE"*. The program review added the three source types to Task 1 and did not propagate them to the GraphQL projection.

**Fix:** give `EvidenceSourceTypeGraphQL` all seven members, or delete the mirror enum and declare `@Field(() => String) sourceType: string` — the DTO already does exactly that for `strength`.

---

### C5. Task 12's UI diff does not match the live `ProposalDiffTable.tsx` in any respect

**Location:** Task 12 Steps 1, 2, 3, 4, 5.

**[verified]** against `packages/twenty-front/src/modules/settings/ai-approvals/components/ProposalDiffTable.tsx` and `graphql/queries/pendingProposals.ts`.

Five separate mismatches:

1. **Styling idiom.** The live file uses `styled` from `@linaria/react` with `themeCssVariables.font.color.tertiary` etc. The plan's `StyledCitation`/`StyledConflictBadge` use `${({ theme }) => theme.font.color.light}` — a theme-prop idiom Linaria's static extraction does not support and that appears nowhere in the file.
2. **The block to replace does not exist.** The plan quotes a flat `items.map(item => Object.keys(item.payload).map(fieldName => <tr>…<input aria-label={fieldName}…`. Live code renders one **item-level** `<tr>` with `aria-label={describeItem(item)}` and a `colSpan={3}` description cell, then per-field `<StyledFieldRow>` rows that begin with an empty `<StyledCell />`, and it only produces field rows when `FIELD_DIFF_ACTION_TYPES.includes(item.actionType)`.
3. **The type replacement deletes a field the component uses.** The plan's replacement `ProposalItem` type omits `toolId?: string | null`, which live `describeItem()` reads (`item.objectNameSingular ?? item.toolId ?? 'unknown target'`).
4. **The test fixture replacement deletes coverage.** Step 2 says "add `facts` to the first fixture item" and then supplies a complete two-item array. The live spec has **six** tests driven by a richer fixture — current/proposed values, no-field-level-diff description, one-checkbox-per-item, approve-only-selected, unprotected-item warning, conflicted-item flag. Step 3's "the two pre-existing tests still pass" and Step 5's "PASS, 4 tests (2 existing + 2 new)" are both wrong, and the instruction as written destroys four tests.
5. **The query before-block is wrong.** Live `PENDING_PROPOSALS` selects `toolId` inside `items { … }`; the plan's "replace this selection" block omits it, so the replace either fails to match or silently drops the field `describeItem` depends on.

**Fix:** rewrite Task 12 against the file on disk. Extend (do not replace) the `ProposalItem` type and the test fixture; render the citation inside the existing `StyledFieldRow`'s field cell; use `themeCssVariables`; correct the query before-block to include `toolId`.

---

### C6. The plan contradicts itself on the struck workflow→`createAgentTask` HTTP path

**Location:** Task 10's "Program integration (resolved)" note strikes the claim; program §2 C7 records it as struck. But two places still assert it:
- Risks, final-but-one bullet: *"**Workflow → GraphQL wiring for `createAgentTask`.** This plan asserts a workflow can call `createAgentTask` via its existing generic HTTP-request action with a workspace API key…"*
- Cut table, "Purpose-built AI research node" row: *"…rather than the GraphQL mutation / **HTTP-request-action path this phase ships**"*.

A transcriber reading the risks section will implement or at least document a path the plan elsewhere deletes.

**Fix:** delete the risk bullet; reword the cut row to name the `create_agent_task` static tool.

## Important

**I1. `AgentExecutionResult`'s optional fields are consumed as required. [verified]** `agent-execution-result.type.ts` declares `steps?: StepResult<ToolSet>[]`, `modelId?: string`, `creditsUsedMicro?: number`. Task 7 Step 11 writes `summarizeAgentSteps(result.steps)` (`StepResult[] | undefined` into `StepResult[]`), `creditsUsedMicro: result.creditsUsedMicro` (into a non-nullable `bigint` column), `modelId: result.modelId` (into `string | null`). Three strict-mode errors. **Fix:** `result.steps ?? []`, `result.creditsUsedMicro ?? 0`, `result.modelId ?? null`.

**I2. Budget enforcement — the charter's Execution contract — is prose inside a blockquote.** Task 7's program note says to add `maxSteps` and *"pass it straight through to the AI SDK's `stepCountIs(...)`/`stopWhen` option the executor already configures. If the executor hard-codes a step cap today, make that value the default."* **[verified]** the executor at `agent-async-executor.service.ts:352` does `stopWhen: (step) => stepCountIs(AGENT_CONFIG.MAX_STEPS)(step) || …` with `MAX_STEPS: 300`. No diff is given; the parameter is not added to the three signatures Task 6 edits; and the second requested test ("record the run as COMPLETED with an outcome naming the budget when the step cap was reached") needs a budget-exhausted signal `AgentExecutionResult` does not carry. **Fix:** write the exact three-line diff plus the fourth signature edit, and define exhaustion as `(result.steps?.length ?? 0) >= maxSteps`.

**I3. The worker's `agentRepository` ships as `unknown` with a design instruction attached.** Task 7 Step 11's constructor has `private readonly agentRepository: unknown` and an inline cast; Step 12 tells the implementer to swap in `@InjectWorkspaceScopedRepository(AgentEntity)` and to confirm it resolves inside `Scope.REQUEST` + `executeInWorkspaceContext`. That is an unresolved architectural question inside the phase's only execution engine. **Fix:** write the real decorator in the source block and use `as never` in the test mock, as every other task in this plan does.

**I4. Dismissal memory has two holes and neither is tested.** Task 2 Step 3: (a) `findDismissed` is called only inside the `!isDefined(existingCurrent)` branch, so a previously-dismissed value re-observed while any CURRENT fact exists for that field supersedes and re-proposes — the exact nag the feature prevents; (b) `findDismissed` runs `findOne({where:{…, status: DISMISSED}})` with **no value filter and no ordering**, then compares the arbitrary row it got back, so two dismissed values on one field make the check nondeterministic. **Fix:** hoist the dismissal check above the CURRENT lookup; use `find()` + `some(f => isSameValue(f.value, value))`; add both negative tests.

**I5. Every "Expected: PASS, N tests" count against a Launch 1 suite is wrong.** **[verified]** `proposal-gate.service.spec.ts` has ~19 `it` blocks; `proposal-execution.service.spec.ts` has ~25. Task 8 Step 11 says 8 ("7 existing + 1 new"), Task 9 Step 4 says 9. (Phase 3 Task 1 Step 7 says 10; Phase 4 Task 2 Step 4 says 8 — same wrong baseline of "7 existing".) A literal executor sees a mismatch and "repairs" the suite. **Fix:** "all pre-existing tests plus the N new ones".

**I6. Task 8 Step 8 anchors on a test name that does not exist.** *"after the existing 'should capture the current field values as the baseline' test"* — the live names are `'should propose an update, storing the payload and the baseline'` and `'should capture a staleness baseline for a delete'`.

**I7. Task 12's second new test cannot fail.** `expect(screen.getByText('Berlin').closest('tr')).not.toHaveTextContent('WEAK')` passes against the unmodified component, because nothing renders 'WEAK' anywhere. Step 3's "Expected: FAIL — the two new tests fail" is false, so the red-green cycle silently degrades to green-green.

**I8. Task 13 — the phase's exit-gate proof — is 12 numbered prose steps with no code**, including *"grep `test/integration/graphql/suites` for an existing agent-creation fixture and reuse it — do not hand-roll a second one"* and *"confirm the exact CLI invocation syntax … before relying on this exact string"*. Launch 1's Task 8, the stated quality bar, supplies the literal GraphQL operation strings and the exact `descriptor` object. **Fix:** supply the descriptor, the seed mutations, and the agent fixture.

**I9. Two charter-named fields are silently absent.** Charter trust-layer table: `AgentRun` = *"Execution status, **workflow link**, model/provider, transcript, elapsed time, token and cost usage, error details"* — `AgentRunEntity` has no workflow link. `Fact` = *"Current or superseded sourced assertion: **freshness**, conflict state, field/value, evidence links"* — `FactEntity` has `createdAt`/`updatedAt` and no freshness concept, yet the success-criteria table claims freshness is *"verified by Task 1 entity"*. Neither appears in the cut table. **Fix:** add `workflowRunId: string | null` to `AgentRunEntity` (an `AI_AGENT` step already knows it) and either derive freshness from `Evidence.observedAt` on the fact or cut it explicitly with a trigger.

## Nits

**N1.** `@Processor` is used with two different argument shapes in one task — `@Processor(MessageQueue.cronQueue)` (cron job) and `@Processor({queueName, scope})` (worker) — with no note that both overloads exist.
**N2.** `AgentTaskResolver` ships an unused `IsNull` import plus a comment telling the implementer to remove it if lint complains. Remove it in the plan.

---

# Phase 3 — Ingestion and Data Quality

**Verdict: NEEDS_REVISION.** 2 Critical, 5 Important, 2 Nits. This is the most carefully-verified of the four plans; its file references, util paths, and the `record-properties.zod-schema.ts` `position` block all check out.

## Critical

### C7. `{ shouldBypassPermissionChecks: false }` is not a valid `RolePermissionConfig`, and the import path has no principal

**Location:** Task 9 Step 3, both the `CreateRecordService.execute` and `UpdateRecordService.execute` calls in `processRow`.

**[verified]** `engine/twenty-orm/types/role-permission-config.ts`:

```ts
export type RolePermissionConfig =
  | { shouldBypassPermissionChecks: true }
  | { unionOf: RoleId[] }
  | { intersectionOf: RoleId[] };
```

`{ shouldBypassPermissionChecks: false }` is a type error, and there is no defined behaviour for it. The implementer's cheapest "fix" is to flip it to `true` — which turns the guided importer into an unrestricted writer.

The deeper problem: the import executes under `buildSystemAuthContext(workspaceId)` with **no role and no `createdBy`/`updatedBy` actor**. Every imported record is attributed to SYSTEM rather than to the human who uploaded the file, and the uploader's object and field permissions are never applied — a user who cannot write `person.jobTitle` can import a column into it. That breaks the charter's **Record contract** ("every action uses Twenty objects, fields, relations, and permissions") and **Principal contract** ("audit entries distinguish authenticated user…"). The program document's §8 marks both "Satisfied".

**Fix:** carry `createdByUserWorkspaceId` on `ImportBatchEntity` (Task 6), resolve `roleId` with `UserRoleService.getRoleIdForUserWorkspace({userWorkspaceId, workspaceId})`, and pass `rolePermissionConfig: { unionOf: [roleId] }` plus `createdBy`/`updatedBy: actorMetadata` — the exact shape `ProposalExecutionService.buildApproverContext` already produces on disk. Add a test: *"should refuse a row whose target field the importing user cannot write"*.

---

### C8. Task 4's service body calls a dependency its own constructor does not declare

**Location:** Task 4 Step 4 (the `structured-person-fact-extraction.service.ts` code block) and Step 2 (its testing module).

The body contains `await this.evidenceRecordingService.recordEvidence({ … })`. The constructor in the same code block declares only `identityResolutionService`, `proposalGateService`, `findRecordsService`, `aiModelRegistryService`, `aiBillingService`, `workspaceRepository`. The import block has no `EvidenceRecordingService` import. Step 2's `Test.createTestingModule` has no `EvidenceRecordingService` provider. `StructuredExtractionModule` (Step 8) does not import `AiResearchModule`.

The only instruction to add any of this is prose in the blockquote at the top of the task: *"Add `EvidenceRecordingService` (from `AiResearchModule`) to this service's constructor and to `StructuredExtractionModule`'s imports."* A transcriber copies the code block verbatim and gets `Property 'evidenceRecordingService' does not exist`, or Nest fails to instantiate the test module.

This is the single mechanism by which the charter's **Evidence contract** is satisfied for ingestion — the fix the program review's C4 exists to deliver — and it is the one part written as a note rather than as code.

**Fix:** put the constructor parameter, the import, the module import, and the test provider into the code blocks. Also add the two test cases the note asks for, in full.

## Important

**I10. `createFromExtraction` bypasses `AiWritePolicyService` entirely.** Task 1 Step 6 resolves no policy. Three call sites (Tasks 3, 4, 9) create proposal items regardless of whether the workspace set that object or field to `FORBID`, and `AUTO` overrides have no effect on this path. The Proposal contract still holds — a human approves — but the plan never states that policy is deliberately not consulted, so a reader assumes the gate's guarantees carry over. **Fix:** resolve `resolveMode` per item and drop `FORBID` ones, or add an explicit cut-table row with a trigger.

**I11. The LLM-exposure decision is unresolved *in the plan*.** Program Owner Decision 3 recommends option (c) — a per-connected-account exclusion toggle — and states *"Phase 3's own risk section flags this exposure and explicitly says no code-level fix was scoped — this decision scopes one."* But Phase 3 Task 4 was not edited and its risk bullet still reads *"No code-level fix identified during planning."* What ships by default is option (a): full message bodies and call-recording summaries to `workspace.fastModel`, no redaction, no opt-out. **Fix:** either add the boolean and the listener check to Task 4, or restate in Phase 3 that (a) is the accepted decision.

**I12. Task 5's step numbering is broken.** Steps run 1–7, then jump straight to "Step 12". Steps 8–11 were removed by the C6 collapse without renumbering. A checkbox-driven executor will hunt for four missing steps.

**I13. Task 11 asserts against two GraphQL operations the task list may not build.** The integration test uses `prepareImportBatch` and `importBatchPreview`; the File Structure's resolver row names only `createImportBatch`, `importBatch`, `startImportBatch`, `retryFailedImportRows`. Either the File Structure is stale or two operations are unbuilt. Reconcile.

**I14. Task 11 is prose, same class of gap as Phase 2 Task 13** — six numbered assertions with no fixture code for the CSV rows, no `CreateImportBatchInput` shape, and a "poll" step described in a parenthetical.

## Nits

**N3.** *"Expected: PASS, 3 tests (the null/undefined test carries 2 assertions)"* — confusing; there are three `it` blocks.
**N4.** Task 4's test keeps a placeholder `{ provide: 'WorkspaceRepositoryToken', … }` with an instruction to replace it later. Resolve it in the plan — `getRepositoryToken(WorkspaceEntity, 'core')` matches every other core-entity injection in the repo.

---

# Phase 4 — Universal Agent Access and Agent-Safe API Semantics

**Verdict: NEEDS_REVISION.** 5 Critical, 6 Important, 2 Nits. Tasks 1–4, 6, 7, and 9 are well specified and written against verified ground truth. Tasks 5, 8, and 10 are not.

## Critical

### C9. Task 5 Step 8 replaces `buildGateInput` with a version written against a file that does not exist — and inverts the gate from denylist to allowlist

**This is the most severe finding in the program.**

**Location:** Task 5 Step 8, the `private buildGateInput(...)` replacement block.

**[verified]** the live method in `proposal-gate.service.ts` is:

```ts
private buildGateInput(
  descriptor: ToolIndexEntry | ToolDescriptor,
  args: Record<string, unknown>,
): GateInput | null
```

returning a `GateInput` of `{ target: AiWritePolicyTarget; actionType; objectNameSingular; recordId; toolId; toolCategory; payload; baselineFieldNames }`, gating by **denylist** — `UNGATED_CRUD_OPERATIONS = ['find_many','find_one','group_by']` and `UNGATED_STATIC_TOOL_IDS` — under the source comment:

> `// Denylist, not allowlist: every CRUD operation is gated except these three reads. A newly added CRUD operation is therefore gated by default.`

The plan's replacement takes `(executionRef: ToolIndexEntry['executionRef'], args)`, returns `{ keys: string[]; actionType; objectNameSingular; recordId; payload; confirm; confirmationBasis }`, gates by `GATED_CRUD_OPERATIONS` and `GATED_STATIC_TOOL_IDS` (**neither constant exists**), and calls `this.extractPayload(executionRef.operation, rest)` (**does not exist** — the live helper is `buildCrudGateInput`).

Four consequences if transcribed literally:

1. **The gate becomes an allowlist.** Any CRUD operation or static tool not enumerated in the (nonexistent) `GATED_*` lists passes through ungated. This directly negates Launch 1 success criterion #10 — *"a newly added AI tool that writes is gated by default, because the gate sits above the tool layer"* — and the charter's Proposal contract. It is the security property the entire product sells.
2. **`target` disappears.** `evaluate()` calls `this.aiWritePolicyService.resolveMode(policy, gateInput.target)`. The replacement produces `keys: string[]` instead. Per-field policy resolution breaks.
3. **`toolId`/`toolCategory` disappear.** `ProposalExecutionService.applyStaticTool` refuses any item missing them (*"Static tool item is missing its tool identity"*), so no approved static tool — including `send_email` — can ever be replayed.
4. **`baselineFieldNames` disappears.** `delete_one` has `payload: {}` and `baselineFieldNames: ['updatedAt']`; without it, delete staleness detection is silently dead. **This is the exact regression the program review's C1 claims to have prevented** — it fixed Task 6's block and never looked at Task 5, which sits immediately upstream in the merge order it fixed.

**Fix:** delete Step 8's `buildGateInput` replacement entirely. Instead:
- Add two optional properties to the live `GateInput` type: `confirm?: string | null; confirmationBasis?: string | null;`
- Set them inside the live `buildCrudGateInput`'s `delete_one` branch (`basis = id`) and `delete_many` branch (`basis = JSON.stringify(args.filter ?? {})`), and strip `confirm` out of `args` before it reaches `payload` in those two branches only.
- Leave the denylist, `target`, `toolId`, `toolCategory`, and `baselineFieldNames` untouched everywhere else.
- Add a regression test to this task: *"should still gate a CRUD operation nobody has classified"* and *"should still gate an unknown static tool"* — both exist in the live spec today and must remain green after this task.

---

### C10. Task 8 Step 2b calls `getObjectsPermissionsFromRolePermissionConfig` with the wrong argument shape *and* the wrong return shape — in the code that decides whether metadata discovery is available

**Location:** Task 8 Step 2b vs Task 8 Step 3.

**[verified]** the real signature in `engine/twenty-orm/utils/get-objects-permissions-from-role-permission-config.util.ts`:

```ts
export const getObjectsPermissionsFromRolePermissionConfig = ({
  rolesPermissions, rolePermissionConfig,
}: { rolesPermissions: ObjectsPermissionsByRoleId; rolePermissionConfig: RolePermissionConfig }): ObjectsPermissions
```

Step 3 calls it correctly (object arg, indexed as a Record). Step 2b calls it as `getObjectsPermissionsFromRolePermissionConfig(context.rolePermissionConfig)` and then `.some((permission) => permission.canReadObjectRecords)` — a single positional argument, and array methods on a Record. Two contradictory call shapes for one function, inside one task.

There is a third, semantic bug: the real function returns `{}` for `{shouldBypassPermissionChecks: true}`, so even after correcting the call, a bypass context reports the metadata provider **unavailable**.

**Failure mode:** this is a permission-widening bug class. An implementer who cannot make it compile is most likely to write `return true`, which makes the entire metadata catalogue available to every role — the opposite of what the task exists to do.

**Fix:** in Step 2b, fetch `rolesPermissions` via `WorkspaceCacheService.getOrRecompute(context.workspaceId, ['rolesPermissions'])` first; short-circuit `return true` when `'shouldBypassPermissionChecks' in context.rolePermissionConfig`; call with the object form; test `Object.values(objectPermissions).some(p => p.canReadObjectRecords)`. Add the two tests Step 2b names, plus one for the bypass case.

---

### C11. `installWorkflowDefinition` lives on the **metadata** GraphQL schema; Phase 5 calls it through `CoreApiClient`

**Location:** Phase 4 Task 10 Step 7 (`@MetadataResolver()` on `WorkflowTemplateResolver`) vs Phase 5 Task 9 Step 1 (`import { type CoreApiClient } from 'twenty-client-sdk/core'; … client.mutation({ installWorkflowDefinition: … })`).

The mutation does not exist on the core endpoint. `seedWorkflow` will fail with an unknown-field error at install time.

This is the *one new dependency edge the program review created* (§2 C5) to close Phase 5's self-declared highest risk — and it is broken at the transport layer.

**Fix:** pick one and write it in both plans. Either move `installWorkflowDefinition` to a core-schema resolver, or change `seedWorkflow(client: MetadataApiClient, …)` and have `post-install.ts` construct a `MetadataApiClient`.

---

### C12. The app's service role carries no `WORKFLOWS` permission flag, but the mutation is behind `SettingsPermissionGuard(PermissionFlagType.WORKFLOWS)`

**Location:** Phase 4 Task 10 Step 7 guard block vs Phase 5 Task 1 Step 3 `app-default.role.ts`.

Phase 5's app service role declares only `canReadAllObjectRecords`, `canUpdateAllObjectRecords`, `canSoftDeleteAllObjectRecords`, `canDestroyAllObjectRecords: false` — no permission flags at all. Phase 4 Step 5b asserts *"an app's post-install hook runs with the application's own credentials, so no new authorization path is introduced"*, which is true and is precisely the problem: those credentials do not hold `WORKFLOWS`.

**Failure:** post-install workflow seeding is rejected. Both of Phase 5's workflows — the deliverable that proves the framework — never install, and the failure surfaces only at Task 11.

**Fix:** grant the flag on `app-default.role.ts` (the SDK's `RoleConfig` derives from `RoleManifest`, which carries permission flags), and add an assertion to Phase 5 Task 11's install test that both workflows exist and are `ACTIVE` after install.

---

### C13. App-supplied workflow steps carry no `id` and no `valid`, so installed `WorkflowVersion.steps` are structurally invalid

**Location:** Phase 5 Task 9 Step 1 (`WorkflowStepTemplate = { type: string; name: string; settings: Record<string, unknown> }`) and Steps 2–3, vs Phase 4 Task 10 Step 2's own `buildAiAgentStep`, which sets `id: '11111111-1111-4111-8111-111111111101'` and `valid: true`, and `WorkflowTemplateDefinition.steps: WorkflowAction[]`.

`installDefinition` → `createWorkflowVersion` inserts `steps: template.steps` verbatim and generates nothing. Because `InstallWorkflowDefinitionInput.steps` is typed `GraphQLJSON`, nothing catches this at compile time — it fails when the workflow executor tries to run a step with no `id`.

**Fix:** normalise inside `installDefinition` — assign `id: uuidv4()` where absent, `valid: true`, and chain `nextStepIds` in array order — and add the unit test *"should assign an id to an app-supplied step that omits one"*. Alternatively require `id`/`valid` on `WorkflowStepTemplate` and set them in both Phase 5 templates.

## Important

**I15. Task 8 contains directly contradictory instructions, out of order.** Step 4: *"`FieldMetadataToolsFactory.generateTools(context.workspaceId)` on the following line is unchanged — its permission scoping is not part of this task (see the deliberately-cut table)."* Steps 2b and 5b — placed *after* Step 7 and after the task's `---` separator — change `buildToolSet` to pass `context` to **both** factories and build the field scoping, and the cut-table row is struck. **Fix:** renumber 2b/5b into sequence, delete the Step 4 sentence.

**I16. Step 5b is prose only, in a permission-filtering path.** *"Mirror this task's object filter in `field-metadata-tools.factory.ts`: take `context` instead of `workspaceId`, resolve object permissions once, and drop every field whose owning object is not readable by the role."* No code, and the factory's `generateTools` body is never shown. **[verified]** it is `generateTools(workspaceId: string): ToolSet` at `field-metadata-tools.factory.ts:208`. This is the "describes what, not how" failure mode, applied to the code that decides which fields an external agent can see.

**I17. Confirmation tokens never fire for `delete_many`.** Step 5 adds `confirm` to `bulk-delete-tool.zod-schema.ts`; Step 8 computes `confirmationBasis` for `delete_many`; but the check in `evaluate()` tests `gateInput.actionType === ProposalActionType.DELETE_RECORD` only. `DELETE_RECORDS` is never confirmed. An AUTO-policy bulk delete is exactly the case the feature exists for, and the plan builds two thirds of it. **Fix:** test `DELETE_RECORD || DELETE_RECORDS`; add the bulk test case.

**I18. `findWorkflowByName` — the whole of `installDefinition`'s idempotency — is one prose sentence.** Step 5b: *"`findWorkflowByName(workspaceId, name)` reads the `workflow` workspace repository for a row with that `name` and returns it with its `lastPublishedVersionId ?? ` its latest draft version id."* The sentence is unfinished (`?? ` trailing), there is no code, and the draft-version resolution is unspecified. This method is what makes the mutation safe to call from a post-install hook that re-runs on every upgrade.

**I19. Task 10's introduction was damaged in editing.** *"Three starter workflow templates packaging what Phases 1–3 already deliver:"* is followed by the program blockquote and then a dangling fragment beginning with a leading space: *" proposal-gated AI writes (Launch 1), and the research/ingestion capabilities…"*. The enumeration of the three templates is gone.

**I20. Task 10's module wiring is a grep instruction.** *"Find the modules exporting `GlobalWorkspaceOrmManager`, `RecordPositionService`, `WorkflowVersionCoreSyncService`, and `WorkflowTriggerWorkspaceService` by grepping each class name for its owning `@Module(...)` block"*, with an empty `imports: []` and a comment. The plan's own risk list names this as a circular-dependency hazard. Name the four modules.

## Nits

**N5.** `WorkflowTemplateService.install` is `({key, workspaceId, activate})` in the Interfaces block and `install({key, workspaceId})` in the File Structure table.
**N6.** Step 6's "Expected: PASS, 5 tests" predates the sixth test Step 5b adds.

---

# Phase 5 — Vertical Application Framework: Customer Support

**Verdict: NEEDS_REVISION.** 0 Critical of its own (C11, C12, C13 land here but originate on the P4↔P5 edge), 4 Important, 2 Nits.

This is the strongest-written of the four plans. Its headline finding is correct and verified: `packages/twenty-apps/examples/hello-world`, `fixtures/rich-app`, and `public/last-contact` all exist; `twenty-sdk/src/sdk/define/index.ts` exports `defineApplication`, `defineRole`, `defineField`, `FieldType`, `RelationType`, `OnDeleteAction`, `STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS`, and the rest. Every path it cites resolves. It fails only where it depends on Phase 4.

## Important

**I21. The agent id passed into the workflow step is an unresolved coin flip in load-bearing code.** Task 9 Step 2 passes `SUPPORT_TRIAGE_AGENT_UNIVERSAL_IDENTIFIER` as `settings.input.agentId`, then says: *"Whether the agent's installed row id equals its manifest `universalIdentifier` or is a separately generated id needs confirming against a running instance before this ships — if they differ, resolve the real id first with a `client.query({agents: {…}})` call and use that id instead."* If they differ, both workflows run with a null agent — the degraded no-tools case Phase 4's own risk list flags. **Fix:** write the lookup unconditionally. It is correct under either answer and costs one query.

**I22. Task 8's step list starts at "Step 2".** The pre-install cut removed Step 1 without renumbering. A checkbox-driven executor stalls looking for it.

**I23. Task 8 knowingly commits a file that cannot typecheck, against the plan's own Global Constraint.** Step 4: *"Do not run `yarn typecheck` yet — the two workflow-template imports do not resolve until Task 9."* The plan's Global Constraints say *"Lint and typecheck after each task."* For a transcriber that runs the gate after every task, this guarantees a red build at Task 8. **Fix:** merge Task 8 Step 3 into Task 9, or write `post-install.ts` in Task 9 only.

**I24. Role-to-agent binding is inferred, not verified.** Risk 4: *"Whether `canBeAssignedToAgents: true` on a role is sufficient, on its own, for the install-time server-side validator to accept that role as an agent's `roleUniversalIdentifier` … was inferred from the `defineAgent` validator's leniency (it only checks the UUID is well-formed) rather than confirmed."* If insufficient, Task 7 produces an agent with no role — and Phase 2's risk section documents exactly what that means: *"registry tools are then skipped entirely … the run 'succeeds' having done nothing useful."* The support-triage workflow would appear to work and change nothing. **Fix:** read `application-manifest/services/` and resolve it, or add an install-time assertion to Task 11 that the agent's role target row exists.

## Nits

**N7.** Risk 2 (`STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.workspaceMember`) is answerable in thirty seconds and is **[verified]** present: `'20202020-3319-4234-a34c-82d5c0e881a6'` in `twenty-shared/src/metadata/constants/standard-object-universal-identifiers.constant.ts`, re-exported by `twenty-sdk/src/sdk/define/objects/standard-object-ids.ts`. Write the value into Task 4 and delete the risk.
**N8.** The cut table lists "A declarative `*.workflow.ts` manifest unit" twice (rows 1 and 3), the second marked "(restated)".

---

# Program document — `2026-08-05-phases-2-5-program.md`

**Verdict: NEEDS_REVISION.** 1 Critical, 4 Important.

### C14. §6 claims complete coverage; two charter-named capabilities are in neither column

§6 closes: *"Nothing in the four scout reports is now in neither column."* That is true of the scout reports. It is not true of the **charter**, which the program document also audits in §8:

- `AgentRun`'s **workflow link** (charter trust-layer table) — not on `AgentRunEntity`, not in any cut table.
- `Fact`'s **freshness** (charter trust-layer table) — not on `FactEntity`, not in any cut table, and Phase 2's success-criteria table falsely claims it is delivered.

§8 marks the Execution and Evidence contracts *"Satisfied after this review"* without noticing either. Per the charter's own triage rule, a capability in neither column is a planning defect — and the charter's entity table is a stricter source than the scout inventory.

**Fix:** add both to §6 with a disposition, and correct §8.

## Important

**I25. §2's C1 resolution is incomplete and the gap it leaves is the program's worst defect.** C1 states the merge order `P2 T8 → P3 T1 → P4 T2 → P4 T5 → P4 T6` and that *"Phase 4 Task 6's replacement block was rewritten to preserve `baselineFieldNames`, `toolId`, `toolCategory`, and `factIds`."* Task 6 was indeed fixed. **Task 5 — one position earlier in that same order — rewrites `buildGateInput` wholesale and destroys all four, plus the denylist** (see C9). The conflict analysis audited the downstream block and not the upstream one.

**I26. §7's narrative mapping over-credits two rows.** *Lead* step 3 is credited to *"P2 T3 Step 8 `create_agent_task` tool called from a P4 T10 template's `AI_AGENT` step"*. No P4 template prompt mentions `create_agent_task` — that is filed as a soft edge, *"a one-line prompt edit, not a code change"*, and never written into any task. And the tool itself cannot compile (C2). *Monitoring* step 1 is credited the same way, with the same two problems. Both rows should read **partial**, or the one-line prompt edit should become a numbered step in P4 Task 10.

**I27. §5's component ownership omits the projection where the cross-plan break actually is.** It names `EvidenceSourceType` as a P2 T1 interface consumed by P3 T4, which is correct, but not `EvidenceSourceTypeGraphQL` — the GraphQL mirror enum that silently drops three of the seven values and throws at query time (C4). Component ownership should cover the wire projection of any owned type that crosses phases.

**I28. §4's parallelisation contradicts Phase 5's own file dependencies.** *"Phase 5 Tasks 1–8 and 10 touch no file under `twenty-server`, `twenty-front`, or `twenty-shared`. Zero merge risk against any other track."* True of merge risk; false of buildability. Task 8's `post-install.ts` imports Task 9's `seedNewTicketTriageWorkflow`/`seedSlaRiskSweepWorkflow`, and Task 9 depends on Phase 4 Task 10. Task 8 cannot complete in wave 2.

---

# Cross-cutting assessment

## Architecture — does anything write to a CRM record from an AI path without `ProposalGateService`?

Traced through all four plans. **No plan intentionally opens a second write path.**

- Phase 2 writes only to `Evidence`, `Fact`, `AgentTask`, `AgentRun` — platform tables. `record_evidence` touches no CRM record. Task 8 only *reads* facts and attaches ids to an item the gate was already creating.
- Phase 3's direct writes are argued for explicitly and correctly: Task 3 proposes only `CANDIDATE` participant matches; Task 4 **drops** non-`EXACT` matches rather than proposing against a guess; Task 9 writes directly only for `CREATE`/`UPDATE` rows, which are human-supplied file data, and routes every `PROPOSE` row through `createFromExtraction`.
- Phase 4 adds no write path.
- Phase 5 adds no write path; its agent's writes funnel through `dispatch()`.

Two real breaches, both accidental:

1. **C9** — Phase 4 Task 5 inverting the gate to an allowlist would let any unenumerated write tool through ungated. This is the security property the product sells, broken by a stale code block.
2. **C7** — Phase 3's importer writes with no role and no principal. Not a gate bypass, but a Record- and Principal-contract breach that the program's §8 audit records as satisfied.

One softer issue: **I10** — `createFromExtraction` never consults `AiWritePolicyService`, so `FORBID` does not suppress ingestion proposals.

## Charter contracts

| Contract | Verdict |
| --- | --- |
| **Record** | **Not satisfied.** C7 — guided import writes with no role and no actor. |
| **Execution** | **Not satisfied as written.** "Budgeted" is a prose instruction (I2); `AgentRun` has no workflow link (I9). Leased/retried/cancellable/idempotent are genuinely built and tested. |
| **Evidence** | **Not satisfied as written.** C1 — no evidence is ever recorded, because `record_evidence` is gated. C8 — the ingestion evidence call has no injected dependency. Design is right; the wiring is not. |
| **Proposal** | **Satisfied in design, broken by C9.** Diffs, approve, reject, expiry, per-item durable status all present. Fact supersession built; proposal supersession cut with a trigger (acceptable). |
| **Principal** | **Not satisfied.** C7 — the import path names no principal. "Represented user/team" is cut with a trigger, which is fine. |

## Acceptance narratives — steps no plan delivers

The program document's §7 self-reports five gaps (dashboards, proposal supersession, record briefs, notifications, stale-record sweep), all with cut rows and triggers — that is the right treatment and I have no objection to any of them. **Three further steps are credited to a task but not actually delivered:**

| Narrative step | Credited to | Reality |
| --- | --- | --- |
| *Lead* step 3 — "a workflow creates a budgeted research task" | P2 T3 Step 8 + P2 T7 | The tool does not compile (C2); no template prompt calls it (I26); the budget is prose (I2). **Critical hole in the shippable product.** |
| *Lead* steps 4–5 — "collects evidence as evidence"; "strong observations create facts" | P2 T3 + T2 | No evidence is ever recorded (C1). **Critical hole.** |
| *Monitoring* step 1 — "cron creates leased tasks" | P4 T10 `ACCOUNT_MONITORING` → `create_agent_task` | Same tool, same two problems. |

## Over-engineering

Little, and the plans are commendably disciplined about cuts. Two things nobody asked for:

- **`AgentRunEntity.transcript` + `summarizeAgentSteps` + its spec** (P2 T7). Twenty already persists a transcript through `AgentMessageEntity`, and no task in Phases 2–5 reads `AgentRun.transcript`. **Replace with:** `resultSummary` alone, until a run-history UI is scoped. Saves a util, a spec, a jsonb column, and a coupling to the AI SDK's `StepResult` shape.
- **`EvidenceLookupService` + `FactFieldsResolver` + `ProposalItemFieldsResolver` + two DTOs + two specs** (P2 T11), so the UI can render one citation line — and the component (T12) only reads `fact.evidence[0]`. **Replace with:** a single `ProposalItemDTO.facts` resolve field returning a flat projection `{fieldName, strength, hasConflict, sourceType, sourceLocator, observedAt}`. One class, one resolver, no N+1 pair, and the DataLoader cut row becomes unnecessary.

## Positioning

Nothing in these plans dilutes the evidence → fact → proposal → approval chain, and nothing spends effort on capability that does not serve it. Phase 2 *is* the differentiator; Phase 4's failure envelope and confirmation tokens are what make "trusted automation" concrete for an AI-native buyer; Phase 3's identity resolution is what makes "we will not pollute your data" true rather than aspirational.

The one misallocation is already surfaced as Owner Decision 2: **Phase 5 builds customer support, the vertical furthest from the stated B2B-sales wedge**, ahead of target-account campaigns, which is the natural consumer of everything Phases 2–4 build. The program document argues the exit gate favours the simpler proof, which is defensible. But note the compounding effect: if the demo that sells this product is *"we researched your target list, here is the evidence, approve the outreach"*, then Phases 2–4 build it and Phase 5 builds something else, and the first end-to-end demo of the actual wedge does not exist in this program at all.

Second-order: the two capabilities most likely to be asked for in a first customer demo — a dashboard over what the AI believes and where it learned it, and a notification when a proposal lands — are both cut. Both are correctly cut with triggers, but they are cut *together*, and the demo without either is "open Settings, find the inbox, read a table."

---

## Recommended order of repair

1. **C9** — restore the gate. Nothing else matters if the chokepoint is an allowlist.
2. **C1, C2, C8** — make the evidence pipeline actually record evidence.
3. **C3, C5** — rewrite Phase 2 Tasks 9 and 12 against the files on disk. Re-verify every other quoted find-and-replace block in all four plans against HEAD before execution starts; three of four plans quote stale Launch 1 code.
4. **C11, C12, C13** — fix the Phase 4 → Phase 5 edge, or Phase 5 does not install.
5. **C7** — give guided import a principal.
6. **C4, C6, C10, C14** and the Importants.
