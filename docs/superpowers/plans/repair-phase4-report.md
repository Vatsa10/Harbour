# Phase 4 plan repair — report

**Plan repaired:** `docs/superpowers/plans/2026-08-05-phase-4-agent-api-semantics.md`
**Review answered:** `docs/superpowers/plans/2026-08-05-phases-2-5-plan-review.md` §Phase 4 (C9–C13, I15–I20, N5–N6)
**Verified against commit:** `dba03d0907` — *style(ai-write-approval): apply oxfmt to the fix-wave changes* (`git log --oneline -1`, repo `d:/Files/Vatsa/Projects/AI-CRM/searm`)
**Date:** 2026-08-06
**Method:** every code reference in Tasks 2, 5, 8, 10 and 13 was re-read from the live file. No source file under `packages/` was modified.

---

## C9 — Task 5 Step 8 inverted the gate from denylist to allowlist — **FIXED**

**Verified against:** `packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval/services/proposal-gate.service.ts` — `GateInput` L29-40, `UNGATED_CRUD_OPERATIONS` L44, `UNGATED_STATIC_TOOL_IDS` L50-85, `UNGATED_HTTP_METHODS` L88, `DELETE_BASELINE_FIELD_NAMES` L107, `evaluate()` L127-193, `buildGateInput` L195-239, `isGatedStaticTool` L241-257, `buildCrudGateInput` L262-380 (unclassified-operation fallback L372-379).

**What was wrong:** Step 8 replaced `buildGateInput` wholesale with a version taking `(executionRef, args)`, returning `{keys, actionType, objectNameSingular, recordId, payload, confirm, confirmationBasis}`, gating by `GATED_CRUD_OPERATIONS` / `GATED_STATIC_TOOL_IDS` (neither exists) and calling `this.extractPayload` (does not exist). Transcribed literally it (a) converts the classification into an allowlist so any unenumerated write tool passes ungated, (b) deletes `target`, breaking `resolveMode`, (c) deletes `toolId`/`toolCategory`, so no approved static tool can be replayed, (d) deletes `baselineFieldNames`, killing delete staleness detection.

**What changed:** the replacement block is deleted. Step 8 is now three purely additive edits, each quoted against the live file and prefaced by a blockquote enumerating the live classification and stating that no entry in any of the three ungated lists may be added, removed or reordered by this task:

- **8a** — `GateInput` gains two **optional** properties, `confirm?: string | null` and `confirmationBasis?: string | null`. Every other property is left verbatim.
- **8b** — those two are set in the `delete_one` (L291-301) and `delete_many` (L359-367) branches of `buildCrudGateInput` only. Both branches already build `payload` from named fields (`{}` and `{ filter }`), so `confirm` cannot leak into a replayed payload and no stripping is added. `baselineFieldNames: DELETE_BASELINE_FIELD_NAMES` is preserved on `delete_one`.
- **8c** — the confirmation check goes inside the existing `mode === 'AUTO'` branch (L148-150). `buildGateInput`, `isGatedStaticTool`, and every non-delete branch are untouched.

**Tests added (Step 6b), asserting an unenumerated write tool is still gated:**
- `'should still gate an unenumerated write tool under an AUTO default'` — a static tool named `some_tool_added_next_quarter` must produce a `PROPOSED` decision and a saved item carrying `toolId` and `toolCategory`.
- `'should still gate a CRUD operation nobody has classified, keeping its baseline contract'` — `archive_one` must be proposed with its `objectNameSingular`/`recordId`.
- `'should keep the delete_one staleness baseline after the confirmation change'` — asserts `findRecordsService.execute` is still called with `select: ['updatedAt']`.
- The two pre-existing `describe('denylist')` tests (spec L312, L320) are named as must-stay-green, and Step 9's expectation now says so explicitly instead of quoting a wrong test count.
- Task 13 gains integration assertion 7: the same two properties proved against a real database.

**Task 5's test harness was also stale.** The live spec (`__tests__/proposal-gate.service.spec.ts` L49-110) provides the **real** `AiWritePolicyService` (L87) and drives it via `setPolicy` (L61); there is no `policyService.resolveMode` mock and no `updateDescriptor` constant. All of Task 5's tests were rewritten onto the real helpers `crudDescriptor` (L21), `staticDescriptor` (L37), `evaluate` (L105), `savedItem` (L110). Task 2 Step 1 carried the same stale harness and was corrected identically.

**No weakening.** After this task the gate is still: `database_crud` gated except `find_many`/`find_one`/`group_by`; static tools gated unless in `UNGATED_STATIC_TOOL_IDS`; `http_request` gated for any method other than GET/HEAD; `code_interpreter` ungated.

---

## C10 — wrong argument shape *and* return shape in metadata-discovery availability — **FIXED**

**Verified against:** `src/engine/searm-orm/utils/get-objects-permissions-from-role-permission-config.util.ts:10-16` (object argument `{rolesPermissions, rolePermissionConfig}`, returns `ObjectsPermissions`), L17-19 (returns `{}` for `shouldBypassPermissionChecks`); `searm-shared/src/types/ObjectsPermissions.ts:5` (`Record<ObjectMetadataId, ObjectPermissions>`); canonical call site `tool-provider/providers/database-tool.provider.ts:73-83`; `workspace-cache.service.ts:122-125` and `workspace-cache-key.type.ts:34,71`; `permissions.service.ts:386-398`.

**What changed:** Step 2b's single-positional-argument call and `.some()` on a Record are gone. Task 8 now states one **scope rule** used by all three call sites — a caller is *unscoped* when the config is a bypass config **or** the role holds `DATA_MODEL`; otherwise output is filtered by `objectPermissions[objectMetadataId]?.canReadObjectRecords`. It is implemented once as a `resolveDiscoveryScope(context)` private method (bypass short-circuit first, then `getOrRecompute(workspaceId, ['rolesPermissions'])`, then the object-form util call), copied into both factories, and mirrored in `MetadataToolProvider.isAvailable` with `Object.values(objectPermissions).some(...)`. The semantic bug is closed: a bypass or DATA_MODEL caller sees everything with `permittedOperations` defaulting to `true`, instead of discovering nothing.

Verified no module edit is needed: `object-metadata.module.ts:61,70` and `field-metadata.module.ts:66,71` already import `PermissionsModule` and `WorkspaceCacheModule`; `tool-provider.module.ts:59,64` likewise.

**Also fixed in Task 8:** I15 (Steps "2b"/"5b" sat *after* the commit step and contradicted a sentence in Step 4 — renumbered to a single 1→8 sequence, contradicting sentence deleted, cut-table row confirmed struck); I16 (Step 5b was prose — `FieldMetadataToolsFactory.generateTools` is now written as code against the live body at `field-metadata-tools.factory.ts:208-270`, filtering on `field.objectMetadataId`); the claim that `generateTools` had "two" `workspaceId` uses (there are **seven**: L191, 209, 262, 311, 335, 374, 423).

**Real-seam test:** the factory specs call the real `getObjectsPermissionsFromRolePermissionConfig` against the real cache payload shape — four object-factory tests (annotation, omission, DATA_MODEL, bypass), two field-factory tests, three provider-availability tests.

---

## C11 — `installWorkflowDefinition` on the wrong GraphQL schema — **FIXED**

**Verified against:** `graphql-config/decorators/metadata-resolver.decorator.ts:1-11` and `core-resolver.decorator.ts:7-11` (both are `@Resolver()` plus a `RESOLVER_SCHEMA_SCOPE` tag); `graphql-config.service.ts:83-86` (`include: [CoreEngineModule]`, `resolverSchemaScope: 'core'`); `metadata.module-factory.ts:36-38` (`include: [MetadataGraphQLApiModule]`, `'metadata'`); `searm-client-sdk/package.json:8-31` and `src/core/index.ts:1` (`CoreApiClient` at `searm-client-sdk/core`); `core-engine.module.ts` already imports `src/modules/**` modules (`EmailingModule`, `DashboardModule`, `MessagingWebhooksModule`).

**Decision: the mutation moves to the core schema.** `workflowTemplates` / `installWorkflowTemplate` stay on metadata for the settings UI (Task 11's codegen is unaffected); a second resolver class, `WorkflowDefinitionInstallResolver`, carries `installWorkflowDefinition` with `@CoreResolver()`. `WorkflowTemplatesModule` is imported by **both** `CoreEngineModule` and `MetadataEngineModule`; the scope tag, not the include-root, decides which schema each resolver lands in. Step 8 now requires checking both playgrounds, and a new risk bullet says: if the tag does not filter cleanly, split the module — never move the mutation, because Phase 5's transport depends on it.

**Phase 5 needs no change here:** `seedWorkflow(client: CoreApiClient, …)` and `import { type CoreApiClient } from 'searm-client-sdk/core'` are correct as originally written.

---

## C12 — app service role lacks the `WORKFLOWS` permission flag — **FIXED (Phase 4 half)**

**Verified against:** `searm-shared/src/constants/PermissionFlagType.ts:9` (`WORKFLOWS`); `SystemPermissionFlag.ts:10` (`'6189e7bd-4051-5752-b6b1-5f31358fbaf1'`); `searm-shared/src/application/roleManifestType.ts:59` (`permissionFlagUniversalIdentifiers?: string[]`, and `canBeAssignedToAgents` at L53); `searm-sdk/src/sdk/define/roles/role-config.ts:7-13`; `from-role-config-to-role-manifest.ts:35-36`; server-side application at `compute-application-manifest-all-universal-flat-entity-maps.service.ts:304-316`; precedent `searm-apps/public/people-data-labs/src/roles/default-function.role.ts:40` grants `[SystemPermissionFlag.WORKFLOWS]`.

**What changed:** the guard `SettingsPermissionGuard(PermissionFlagType.WORKFLOWS)` is kept deliberately, and the requirement it imposes on the caller is now written into the contract table and restated at the resolver: an installing application's role manifest **must** declare `permissionFlagUniversalIdentifiers: [SystemPermissionFlag.WORKFLOWS]`. The false reassurance ("an app's post-install hook runs with the application's own credentials, so no new authorization path is introduced") is replaced with the statement that those credentials hold only what the manifest declares. The `app-default.role.ts` edit itself is Phase 5's half.

---

## C13 — app-supplied steps carry no `id` and no `valid` — **FIXED**

**Verified against:** `workflow-executor/workflow-actions/types/workflow-action.type.ts:24-34` — `BaseWorkflowAction` requires `id: string`, `name`, `type`, `settings`, `valid: boolean`, and allows `nextStepIds?: string[]`.

**What changed:** a new `normalizeWorkflowTemplateSteps` util (with its own four-test spec) assigns `id: uuidv4()` where absent, forces `valid: true`, and chains `nextStepIds` in array order with the last step terminating at `[]`; an explicitly authored `id`/`nextStepIds` is preserved. `installDefinition` runs every supplied step through it before `createWorkflowVersion` inserts. New types `WorkflowStepInput` and `WorkflowDefinitionInput` make `id`/`valid`/`nextStepIds` optional at the boundary. `createWorkflowVersion`'s parameter is retyped from `WorkflowTemplateDefinition` to `{trigger, steps}`. The service spec harness now shares one `workflowVersionRepository` mock so the stored steps are inspectable, and Task 13 gains a real-database assertion (item 8) on `steps[0].id` / `valid` / `nextStepIds`.

**Also fixed in Task 10:** I18 (`findWorkflowByName` was an unfinished prose sentence — now real code: `where: { name }` on the `workflow` repository, `lastPublishedVersionId` first, falling back to the latest `DRAFT` `workflowVersion` ordered `createdAt DESC`, mirroring `workflow-version.workspace-service.ts:100-105`); I19 (the damaged introduction — the three templates are enumerated again and the orphaned fragment reattached); I20 (the four owning modules are named — `RecordPositionModule`, `WorkflowVersionCoreModule`, `WorkflowTriggerModule`, and `GlobalWorkspaceDataSourceModule` which is `@Global()` — and written into the `@Module`); N5 (`install({key, workspaceId, activate})` everywhere); N6 (counts corrected to 11).

Two risk bullets were resolved rather than restated: `getRepository`'s third parameter is `permissionOptions?: RolePermissionConfig` (`global-workspace-orm.manager.ts:27-43`), of which `{shouldBypassPermissionChecks: true}` is a member; and the module wiring is now named.

---

## Interface contract exposed to Phase 5

Written into the plan as a table under Task 10 ("Contract exposed to Phase 5"). Summary:

| Item | Value |
| --- | --- |
| Operation | `installWorkflowDefinition(input: InstallWorkflowDefinitionInput!): InstalledWorkflowTemplate!` |
| Schema / endpoint | **core** (`/graphql`), declared `@CoreResolver()` on `WorkflowDefinitionInstallResolver` |
| Client | `import { type CoreApiClient } from 'searm-client-sdk/core'` — Phase 5's `seedWorkflow(client: CoreApiClient, …)` is correct unchanged |
| Input | `{ name: String!, description: String, trigger: JSON!, steps: JSON!, activate: Boolean! = true }` |
| Step shape accepted | `{ type, name, settings }` — `id`, `valid`, `nextStepIds` are **optional** and generated server-side |
| Normalisation guarantee | `id: uuidv4()` where absent; `valid: true`; `nextStepIds` chained in array order, last step `[]` |
| Return | `{ workflowId: ID!, workflowVersionId: ID! }` |
| Idempotency | keyed on `definition.name` per workspace; a repeat call returns the existing pair and creates nothing, so a post-install hook may re-run on every upgrade |
| **Caller obligation** | the app's service role must declare `permissionFlagUniversalIdentifiers: [SystemPermissionFlag.WORKFLOWS]` (`'6189e7bd-4051-5752-b6b1-5f31358fbaf1'`) — the mutation is behind `SettingsPermissionGuard(PermissionFlagType.WORKFLOWS)` |

---

## Cross-cutting

- **Real-seam rule** added to Global Constraints, naming each task's real seam (T1 real util; T2/T5/T6 the real `AiWritePolicyService` in the gate spec plus T5's real token util; T3 real registry + real `findSimilarToolNames`; T4 real MCP envelope; T7 real `FindRecordsService`; T8 the real permissions util; T9/T13 real-database suites; T10 the real normaliser and real template constants; T11 a real render).
- **Ground-truth header** now records HEAD `dba03d0907`, notes that the fix wave `c6e057906b..HEAD` rewrote the gate/policy/execution services, and states that quoted line numbers are from that commit and reality wins if HEAD has moved.
- **I17** — confirmation now fires for `DELETE_RECORDS` as well as `DELETE_RECORD`, with two `delete_many` tests (token keyed on the stringified filter; a different filter yields a different token, so a confirmed narrow delete cannot be widened on the second call).
- Wrong "Expected: PASS, N tests" baselines in Tasks 2, 5, 8 and 10 replaced with either a correct count or "all pre-existing tests plus the N new ones" (the gate spec has ~19 `it` blocks, not 7).

## Status

C9 FIXED · C10 FIXED · C11 FIXED · C12 FIXED (Phase 4 half) · C13 FIXED · I15–I20 FIXED · N5, N6 FIXED.
No files under `packages/` were modified.
