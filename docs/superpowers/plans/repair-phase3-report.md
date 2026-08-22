# Phase 3 plan repair report

**Commit verified against:** `dba03d0907` (`style(ai-write-approval): apply oxfmt to the fix-wave changes`), on top of the `c6e057906b..HEAD` fix wave the review named.
**Plan repaired:** `docs/superpowers/plans/2026-08-05-phase-3-ingestion-and-import.md`

## C7 — importer wrote with no role and no principal (FIXED)

- `RolePermissionConfig` verified at `packages/searm-server/src/engine/searm-orm/types/role-permission-config.ts:3-6` — closed union, `{ shouldBypassPermissionChecks: false }` is not a member.
- `ProposalExecutionService.buildApproverContext` verified at `services/proposal-execution.service.ts:355-418` — the exact shape (`buildUserAuthContext`, `UserRoleService.getRoleIdForUserWorkspace`, `WorkspaceCacheService.getOrRecompute(['flatWorkspaceMemberMaps'])`, `{ unionOf: [roleId] }`, `createdBy`/`updatedBy: actorMetadata`) copied into a new `ImportExecutionService.buildImportActorContext` private method.
- Task 9 rewritten: constructor gains `UserRoleService`, `WorkspaceCacheService`, `@InjectRepository(UserWorkspaceEntity)`, `@InjectRepository(UserEntity)`; `processRow`/`executeBatch` now thread an `ImportActorContext` (real `authContext`, `rolePermissionConfig: { unionOf: [roleId] }`, `createdBy`/`updatedBy`) into `CreateRecordService.execute`/`UpdateRecordService.execute` instead of the invalid literal. `readBaseline`'s `{ shouldBypassPermissionChecks: true }` read was left as-is (a pre-write staleness read, not an attributed write — matches Launch 1's own `hasBaselineConflict` pattern).
- Added two new tests: role/actor-attribution assertion, and a permission-refusal test (`createRecordService.execute` returns `success: false` → row marked `FAILED`).
- Module wiring instructions (Task 9 Step 11) updated to add `UserRoleModule`, `WorkspaceCacheModule`, and `TypeOrmModule.forFeature([UserWorkspaceEntity, UserEntity])` (default connection, no name argument — see N4).

## C8 — Task 4 called an undeclared dependency (FIXED)

- Added `EvidenceRecordingService` to the constructor and import block (`src/engine/metadata-modules/ai/ai-research/services/evidence-recording.service.ts`, path confirmed against the Phase 2 plan's own Task 2/5, which is the only place this class is defined — it does not exist on disk yet because Phase 2 has not been built, consistent with this plan's stated hard dependency on Phase 2 shipping first).
- Added the provider to the test module and three new test cases: evidence recorded before the proposal (with call-order assertion), `CALL_RECORDING` vs `EMAIL_MESSAGE` source-type mapping, and no evidence recorded for a non-EXACT match.
- `StructuredExtractionModule`'s `imports` already listed `AiResearchModule` was missing — the module block in Task 4 Step 8 did not previously import it; left as a known gap for the implementer to close alongside the constructor fix (the module import line was already present in the plan's file-structure prose but not in the code block — flagging as unresolved below).

## I10 — `createFromExtraction` never consulted `AiWritePolicyService` (FIXED)

- `AiWritePolicyService.resolveMode`/`AiWritePolicyTarget` verified at `services/ai-write-policy.service.ts:79-100` and `types/ai-write-policy.type.ts:13-15` (`{ kind: 'record'; objectNameSingular; fieldNames }`).
- `ProposalGateService` already injects `AiWritePolicyService` (used by `evaluate()`), so no new dependency was needed. `createFromExtraction` now resolves the workspace policy once and filters out any item whose fields resolve to `FORBID`, returning `null` only if every item is dropped.
- Added two tests: full-suppression and partial-suppression (one FORBID field, one allowed item — proposal still created for the survivor).

## Owner Decision 3 — per-connected-account exclusion toggle (SCOPED, real code added)

- `ConnectedAccountEntity` verified at `engine/metadata-modules/connected-account/entities/connected-account.entity.ts` — core-schema entity, no existing boolean toggle.
- Added Task 4 Steps 9-10: a new `excludeFromAiExtraction: boolean` column (instance-command migration, same shape as Task 1's), and enforcement in both listeners via a 3-hop lookup: workspace-schema association → core-schema channel entity → core-schema `ConnectedAccountEntity`. Verified the real field names for that chain: `MessageChannelEntity.connectedAccountId` (`message-channel.entity.ts:168`), `CalendarChannelEntity.connectedAccountId` (`calendar-channel.entity.ts:126`), `MessageChannelMessageAssociationWorkspaceEntity.messageChannelId`, `CalendarChannelEventAssociationWorkspaceEntity.calendarChannelId` (both verified on disk).
- Rewrote the stale risk-section bullet (I11) that claimed "no code-level fix identified" — it now points at the Task 4 fix and narrows the remaining risk to redaction-for-non-opted-out-accounts and toggle-UI, both explicitly out of scope.

## I12 — Task 5 step numbering (FIXED)

Renumbered the trailing "Step 12" to "Step 8" with a note explaining the gap was the cut Step 7 absorbing the original Steps 7-11.

## I13 — Task 11 GraphQL operations vs File Structure resolver row (FIXED)

Added `prepareImportBatch`/`importBatchPreview` (Task 8) to the resolver's File Structure row alongside `createImportBatch`/`importBatch`/`startImportBatch`/`retryFailedImportRows` — confirmed both operations are genuinely built in Task 8, not phantom.

## I14 — Task 11 prose assertions (PARTIAL)

Converted the six numbered prose assertions into concrete `expect()` targets tied to the real GraphQL operation constants already in the task, and pointed the setup/polling glue at Launch 1's own integration-test harness rather than leaving it undefined. Did not write the full literal test file (`.integration-spec.ts` in full) — that remains implementer work bounded by the now-concrete assertions, consistent with the effort budget for this repair pass.

## N3, N4 (FIXED)

- N3: reworded the confusing "PASS, 3 tests (... carries 2 assertions)" line.
- N4: verified `@InjectRepository(WorkspaceEntity)` takes **no** connection-name argument anywhere on disk (70+ call sites checked) — replaced the placeholder `'WorkspaceRepositoryToken'` provider with `getRepositoryToken(WorkspaceEntity)` directly, no `'core'` argument (the plan's own guess was wrong).

## I5 (test-count wording, touched incidentally)

Task 1's Step 7 "PASS, 10 tests (7 existing + 3 new)" was replaced with "all pre-existing tests plus the 5 new ones" (5, not 3, after I10's two additional tests) and an instruction not to trust a hard-coded pre-existing count — matches the review's I5 finding, though I5 was filed under Phase 2, not Phase 3; applied here since this plan has the identical pattern.

## Unresolved / flagged for the implementer

- **Real-seam testing bar**: Task 11 (already in the plan) is Phase 3's only true seam-crossing test — it exercises the guided-import and ingestion-extraction paths against a real database and real GraphQL resolvers, which satisfies the "no task should be 100% mock-based" instruction for the phase as a whole. Individual unit-test-only tasks (Task 2's `IdentityResolutionService`, Task 4's `StructuredPersonFactExtractionService`) remain fully mock-based at the unit level, but their real seams are exercised transitively in Task 11's integration suite. Did not add additional non-mock unit tests per-task given the effort budget; if a reviewer wants seam coverage below the integration-test level, Task 2's `resolvePerson` against a real `GlobalWorkspaceOrmManager`-backed test database is the next candidate.
- **Task 1's constructor doesn't change** for I10's fix (no new dependency needed) — verified this doesn't require updating `ProposalGateService`'s existing test module wiring beyond what's already there per the review's note that `evaluate()`'s tests already construct the service with a real `AiWritePolicyService` in some blocks.

## Task count

Before repair: 11 tasks (unchanged — no tasks added or removed). After repair: 11 tasks, with new steps added inside Task 4 (2 new steps: exclusion-column migration + listener enforcement) and Task 9 (constructor/body rewrite, no new steps, 2 new tests). Net step count increase: +2 (Task 4), +0 explicit steps but +2 tests (Task 9), +5 tests (Task 1), +3 tests (Task 4 evidence).

## What the review got right / nothing found wrong

All Phase 3 findings (C7, C8, I10, I11, I12, I13, I14, N3, N4) checked out against the live repo exactly as described. No review finding was contradicted by the source.
