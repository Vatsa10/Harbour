# Phase 5 — Vertical Application Framework: Customer Support

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that a vertical industry ships as an installable SeaRM application — objects, relations, views, roles, agent policy, dashboards, seed data, workflow templates, upgrade, uninstall — with **zero changes to `packages/searm-server`'s core code, `searm-shared`'s metadata registry, or `searm-standard-application`**. Build the first vertical, customer support, end to end as the proof.

**Headline finding (from the anchors report and this plan's own verification):** SeaRM's application framework already does almost all of this. `defineObject`/`defineField`/`defineView`/`defineRole`/`defineAgent`/`defineSkill`/`definePageLayout`/`defineIndex`/`defineNavigationMenuItem` plus pre-install/post-install/uninstall logic function hooks, plus `appBuild`/`appDeploy`/`appInstall`/`appUninstall` CLI operations, plus a working `upgradeApplication` mutation and version-check cron, are all real, already-shipped, already-tested machinery (`packages/searm-apps/examples/hello-world`, `packages/searm-apps/fixtures/rich-app`, `packages/searm-apps/public/last-contact` are working proof). **There is exactly one real gap: app manifests have no declarative workflow-template unit** (confirmed by an exhaustive listing of `packages/searm-server/src/engine/core-modules/application/application-manifest/converters/` — every other manifest unit type listed in the anchors report has a `from-*-manifest-to-universal-flat-*.util.ts` converter; workflow does not). This plan closes that gap the KISS way — an app declares its workflows as data and installs them with a single call to `installWorkflowDefinition`, the public mutation Phase 4 Task 10 exposes, from the app's post-install logic function — rather than inventing a new manifest unit, a new converter, or any change to `searm-server`/`searm-shared` **in this plan**. That decision, and the alternative it rejects, is recorded in "What was deliberately cut."

Because the framework already exists, this plan is deliberately small: 11 tasks, almost entirely declarative config files plus one ~60-line reusable TypeScript helper and its install-time caller. There is no service, resolver, or entity to write in `searm-server` anywhere in this plan.

**Architecture:** One new standalone package, `packages/searm-apps/public/customer-support/`, built and versioned independently of the `searm-server`/`searm-front` Nx build (same as `last-contact`, `slack`, `call-recorder` today — it has its own `package.json`, `tsconfig.json`, `yarn.lock`, and is compiled/tested with `vitest`, not `nx`). It defines two new custom objects (`supportTicket`, `supportQueue`), four relation fields onto three *standard* objects (`company`, `person`, `workspaceMember` — relation pointers only, never scalar business fields, per the charter), two views, a dashboard, two roles, one AI agent bound to a scoped role, one skill, and two workflow templates seeded at install time. Every write the AI agent or the AI-agent-driven workflow step performs already funnels through Launch 1's `ToolExecutorService.dispatch()` → `ProposalGateService` — this plan adds no new write path and no new approval mechanism.

**Tech Stack:** `searm-sdk` (define + CLI), `searm-client-sdk` (CoreApiClient/MetadataApiClient), TypeScript, Vitest. No NestJS, no TypeORM, no GraphQL schema code in this plan — those are SeaRM platform code this plan does not touch.

**Depends on:** **Phase 4 Task 10** (`WorkflowTemplateService.installDefinition` + the `installWorkflowDefinition` mutation) must be live before Task 9's post-install workflow seeding runs — Tasks 1–8 and 10 are unaffected and can be built first. Launch 1 (`docs/superpowers/plans/2026-08-05-ai-write-approval.md`) must be merged and its `ProposalGateService` live in the target environment before Task 11's end-to-end verification can show a `PENDING` proposal — every other task in this plan (objects, views, roles, agent, workflows) is independent of Launch 1 and can be built first. Nothing in this plan modifies `packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval/**`.

**Spec inputs:** `docs/superpowers/PRODUCT-CHARTER.md` (Phase 5 exit gate, five contracts, Feature Completion Standard), `docs/superpowers/scouting/searm-anchors.md` §6 and §7.

**Working directory for all paths below:** `d:\Files\Vatsa\Projects\AI-CRM\searm`

## Global Constraints

- **Never touch `searm-server`'s core schema, `searm-shared/src/metadata/*`, or `searm-standard-application/*`.** Every object, field, view, role, agent, skill, page layout, and index in this plan is a manifest file inside `packages/searm-apps/public/customer-support/src/`, installed and uninstalled per-workspace through the existing application lifecycle. If a task in this plan is found to require a core-code change, that is a design failure — stop and report it, do not silently add the change.
- **Relation fields onto standard objects are the one sanctioned exception**, and only as relation pointers (never a scalar business field). `packages/searm-apps/public/last-contact/src/fields/last-contact-at.field.ts` is the live precedent: an app-owned field, installed/uninstalled with the app, referencing `STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier` as its `objectUniversalIdentifier`. This plan uses the same mechanism for `supportTicket.company` / `supportTicket.requester` / `supportTicket.assignee` and their reverse pointers — never for a field like "supportTier" that would encode support-specific *data* on `Person`/`Company`.
- **Named exports only. No `any`. Types over interfaces** except where extending a third-party type. String literal unions over hand-rolled enums where the SDK already exports a real TS enum (`FieldType`, `RelationType`, `ViewType`, `WidgetType`, `PageLayoutType`, `WorkflowActionType` — use the SDK's own enum, do not redeclare it).
- **File naming:** kebab-case, one manifest unit per file, suffix matches unit kind — `*.object.ts`, `*.field.ts`, `*.view.ts`, `*.role.ts`, `*.index.ts`, `*.agent.ts` (module path `agents/`), `*.skill.ts` (module path `skills/`), `*-logic-function.ts` or `pre-install.ts`/`post-install.ts`/`uninstall.ts`, `*.page-layout.ts`. This matches the convention in `packages/searm-apps/examples/hello-world/src/` exactly.
- **Comments:** short-form `//` only, explaining WHY.
- **Every `universalIdentifier` is a fixed, hand-assigned UUID committed to source** — never generated at build time. SeaRM's sync engine diffs by `universalIdentifier` across installs/upgrades; regenerating one on every build would make every upgrade look like a delete+recreate.
- **Do not run `appPublish`.** This plan installs and verifies the app against a local/dev SeaRM instance. Listing it in a public marketplace is a go-to-market decision, out of scope here (see "deliberately cut").
- Lint and typecheck after each task: `cd packages/searm-apps/public/customer-support && yarn lint && yarn typecheck` (scripts defined in Task 1).

## File Structure

**New package** — `packages/searm-apps/public/customer-support/`:

| File | Responsibility |
| --- | --- |
| `package.json`, `tsconfig.json`, `tsconfig.spec.json`, `vitest.config.ts`, `.gitignore`, `.oxlintrc.json` | Package scaffold, mirrors `packages/searm-apps/examples/hello-world/` |
| `src/application-config.ts` | `defineApplication` — app identity, default role |
| `src/constants/universal-identifiers.ts` | Every fixed `universalIdentifier` UUID, one place, exported by name |
| `src/objects/support-queue.object.ts` | `supportQueue` object + its scalar fields |
| `src/objects/support-ticket.object.ts` | `supportTicket` object + its scalar fields |
| `src/fields/queue-on-ticket.field.ts` | `supportTicket.queue` → `supportQueue` (MANY_TO_ONE) |
| `src/fields/tickets-on-queue.field.ts` | `supportQueue.tickets` reverse (ONE_TO_MANY) |
| `src/fields/company-on-ticket.field.ts` | `supportTicket.company` → standard `company` (MANY_TO_ONE) |
| `src/fields/support-tickets-on-company.field.ts` | `company.supportTickets` reverse (ONE_TO_MANY) |
| `src/fields/requester-on-ticket.field.ts` | `supportTicket.requester` → standard `person` (MANY_TO_ONE) |
| `src/fields/support-tickets-on-person.field.ts` | `person.supportTickets` reverse (ONE_TO_MANY) |
| `src/fields/assignee-on-ticket.field.ts` | `supportTicket.assignee` → standard `workspaceMember` (MANY_TO_ONE) |
| `src/fields/assigned-tickets-on-workspace-member.field.ts` | `workspaceMember.assignedSupportTickets` reverse (ONE_TO_MANY) |
| `src/indexes/support-ticket-status.index.ts` | Index on `supportTicket.status` |
| `src/views/all-tickets.view.ts` | Table view, sorted by priority/SLA |
| `src/views/tickets-by-status.view.ts` | Kanban view grouped by status |
| `src/views/queue-overview.view.ts` | Table view of queues |
| `src/navigation-menu-items/support-tickets.navigation-menu-item.ts` | Sidebar entry |
| `src/roles/app-default.role.ts` | Broad role used as the app's own service identity |
| `src/roles/support-agent.role.ts` | Scoped role for human reps and the AI agent |
| `src/agents/support-triage-agent.ts` | `defineAgent`, bound to `support-agent.role` |
| `src/skills/support-triage-skill.ts` | `defineSkill` — triage rubric |
| `src/utils/seed-workflow.util.ts` | Reusable helper: builds a workflow (trigger + ordered steps) via existing GraphQL mutations — the framework-gap closer |
| `src/workflow-templates/new-ticket-triage.workflow-template.ts` | Template data for workflow 1 |
| `src/workflow-templates/sla-risk-sweep.workflow-template.ts` | Template data for workflow 2 |
| `src/logic-functions/post-install.ts` | `definePostInstallLogicFunction` — seeds default queue + both workflows |
| `src/logic-functions/uninstall.ts` | `defineUninstallLogicFunction` — logs what the framework is about to tear down |
| `src/page-layouts/support-overview.page-layout.ts` | Dashboard with two `VIEW` widgets |
| `src/__tests__/app-install.integration-test.ts` | Build → deploy → install → verify → uninstall → verify teardown |
| `src/__tests__/app-upgrade.integration-test.ts` | Install v1 → bump version, add a field → upgrade → verify |

Nothing under `packages/searm-server/`, `packages/searm-front/`, or `packages/searm-shared/` is created or modified by this plan.

---

### Task 1: Scaffold the app package

**Files:**
- Create: `packages/searm-apps/public/customer-support/package.json`
- Create: `packages/searm-apps/public/customer-support/tsconfig.json`
- Create: `packages/searm-apps/public/customer-support/tsconfig.spec.json`
- Create: `packages/searm-apps/public/customer-support/vitest.config.ts`
- Create: `packages/searm-apps/public/customer-support/.gitignore`
- Create: `packages/searm-apps/public/customer-support/.oxlintrc.json`
- Create: `packages/searm-apps/public/customer-support/src/constants/universal-identifiers.ts`
- Create: `packages/searm-apps/public/customer-support/src/roles/app-default.role.ts`
- Create: `packages/searm-apps/public/customer-support/src/application-config.ts`

**Interfaces:**
- Consumes: `defineApplication`, `defineRole` from `searm-sdk/define` (verified real exports, `packages/searm-sdk/src/sdk/define/index.ts`).
- Produces: `APPLICATION_UNIVERSAL_IDENTIFIER`, `APP_DEFAULT_ROLE_UNIVERSAL_IDENTIFIER` — every later task's manifest files reference these.

- [ ] **Step 1: Copy the package scaffold**

Copy the shape of `packages/searm-apps/examples/hello-world/package.json` exactly (same `engines`, same script names), renamed:

```json
{
  "name": "@Vatsa10/customer-support",
  "version": "1.0.0",
  "license": "MIT",
  "engines": {
    "node": "^24.5.0",
    "npm": "please-use-yarn",
    "yarn": ">=4.0.2"
  },
  "packageManager": "yarn@4.13.0",
  "scripts": {
    "searm": "searm",
    "lint": "oxlint -c .oxlintrc.json .",
    "lint:fix": "oxlint --fix -c .oxlintrc.json .",
    "typecheck": "tsc --noEmit -p tsconfig.spec.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {},
  "devDependencies": {
    "@types/node": "^24.7.2",
    "@types/react": "^18.2.0",
    "oxlint": "^0.16.0",
    "react": "^18.2.0",
    "searm-client-sdk": "2.13.0",
    "searm-sdk": "2.13.0",
    "typescript": "^5.9.3",
    "vitest": "^4.0.0"
  }
}
```

Copy `tsconfig.json`, `tsconfig.spec.json`, `vitest.config.ts`, `.gitignore`, `.oxlintrc.json` byte-for-byte from `packages/searm-apps/examples/hello-world/` (read each file first, then write the copy — do not guess their contents).

- [ ] **Step 2: Write the universal-identifiers constants file**

One file holding every fixed UUID this app uses, so no manifest file ever hand-writes a UUID literal inline except here:

```ts
// customer-support/src/constants/universal-identifiers.ts
// Every identifier here is permanent once committed — SeaRM's app sync
// engine diffs installs/upgrades by universalIdentifier. Never regenerate one.

export const APPLICATION_UNIVERSAL_IDENTIFIER =
  '21f1f154-9665-475f-a94e-d92acf43fa5e';

export const APP_DEFAULT_ROLE_UNIVERSAL_IDENTIFIER =
  '73fb89b0-0ffb-4eed-b711-8e16b9d466e3';
export const SUPPORT_AGENT_ROLE_UNIVERSAL_IDENTIFIER =
  '1d00aee9-1218-47b3-925d-84495070f6c8';

export const SUPPORT_QUEUE_OBJECT_UNIVERSAL_IDENTIFIER =
  '30ad5b11-d7f5-4c1a-a411-876d7ec89dfc';
export const QUEUE_NAME_FIELD_UNIVERSAL_IDENTIFIER =
  'ae31b6b2-43cd-4a5a-a72e-83028f890874';
export const QUEUE_DESCRIPTION_FIELD_UNIVERSAL_IDENTIFIER =
  'd38fe13d-6c3a-4ac3-9315-c0153638aa49';
export const QUEUE_SLA_FIRST_RESPONSE_MINUTES_FIELD_UNIVERSAL_IDENTIFIER =
  'b7d8e248-fb2f-4ecd-8070-24994bfe73b7';
export const QUEUE_SLA_RESOLUTION_MINUTES_FIELD_UNIVERSAL_IDENTIFIER =
  '8a70ec37-00b9-4cc6-9d4c-684b0de3c57c';
export const QUEUE_IS_DEFAULT_FIELD_UNIVERSAL_IDENTIFIER =
  'aed6c072-31dd-4dd5-853b-867117275529';

export const SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER =
  'f05b438e-6bfc-4b49-9a3f-1713f02288a7';
export const TICKET_SUBJECT_FIELD_UNIVERSAL_IDENTIFIER =
  'a7235600-1d1f-43c0-97ee-1fe8a98cc869';
export const TICKET_STATUS_FIELD_UNIVERSAL_IDENTIFIER =
  'b1c60a28-3f28-4522-baaa-c90780cdc656';
export const TICKET_PRIORITY_FIELD_UNIVERSAL_IDENTIFIER =
  '7bbd9591-dcc0-4caa-8818-b2c177c350fa';
export const TICKET_CHANNEL_FIELD_UNIVERSAL_IDENTIFIER =
  '15a63d58-79f4-4edf-b6ac-966dd582892d';
export const TICKET_DESCRIPTION_FIELD_UNIVERSAL_IDENTIFIER =
  'ff301855-5a5e-4f7f-abe1-1471f1f31783';
export const TICKET_SLA_FIRST_RESPONSE_DUE_AT_FIELD_UNIVERSAL_IDENTIFIER =
  'af13ca52-0d63-4563-9281-b79e316ca894';
export const TICKET_SLA_RESOLUTION_DUE_AT_FIELD_UNIVERSAL_IDENTIFIER =
  '12568c9f-5ad1-4291-969b-1fec876c00c3';
export const TICKET_FIRST_RESPONDED_AT_FIELD_UNIVERSAL_IDENTIFIER =
  '93ed570d-7ec3-4596-abe8-c290bcb5539e';
export const TICKET_RESOLVED_AT_FIELD_UNIVERSAL_IDENTIFIER =
  'ad8ad9d2-2391-4322-be69-fb56560faced';
export const TICKET_AI_TRIAGE_SUMMARY_FIELD_UNIVERSAL_IDENTIFIER =
  'a3a8d64a-fd0e-4b2d-90c0-b3b3c4504810';

export const TICKET_QUEUE_FIELD_UNIVERSAL_IDENTIFIER =
  '00008451-7337-426b-9d5e-9020ea31d3fa';
export const QUEUE_TICKETS_FIELD_UNIVERSAL_IDENTIFIER =
  '83d0174f-cc5c-4511-a853-aceffab8515a';
export const TICKET_COMPANY_FIELD_UNIVERSAL_IDENTIFIER =
  'b3a98b8c-c319-4bda-b96a-8a8619f6f798';
export const COMPANY_SUPPORT_TICKETS_FIELD_UNIVERSAL_IDENTIFIER =
  '3b46436f-30e9-47c2-86a7-aba9bcea0fd1';
export const TICKET_REQUESTER_FIELD_UNIVERSAL_IDENTIFIER =
  'ea0c1a10-08ba-4bf3-8485-941ed6a46a98';
export const PERSON_SUPPORT_TICKETS_FIELD_UNIVERSAL_IDENTIFIER =
  '6002a67e-ee1c-4884-9bd4-a6b7bdcdcb88';
export const TICKET_ASSIGNEE_FIELD_UNIVERSAL_IDENTIFIER =
  'ca1079c7-31a9-48e9-9c8e-6cbf5802e3e1';
export const WORKSPACE_MEMBER_ASSIGNED_TICKETS_FIELD_UNIVERSAL_IDENTIFIER =
  '430eeb2d-f127-401b-ba73-f0210ade42de';

export const TICKET_STATUS_INDEX_UNIVERSAL_IDENTIFIER =
  '699039e2-c220-4fb6-a945-2f70789e9b14';
export const TICKET_STATUS_INDEX_FIELD_UNIVERSAL_IDENTIFIER =
  'f9025457-30d8-466f-9c29-9f97b10a0591';

export const ALL_TICKETS_VIEW_UNIVERSAL_IDENTIFIER =
  '71d4cf1e-7a55-4f05-8818-71dc1577d008';
export const ALL_TICKETS_VIEW_SUBJECT_FIELD_UNIVERSAL_IDENTIFIER =
  'c2dc7114-f915-4df9-ab45-6c59356a8e45';
export const ALL_TICKETS_VIEW_PRIORITY_FIELD_UNIVERSAL_IDENTIFIER =
  '0ed49266-bc64-4ba9-9fcd-af3c50502952';
export const ALL_TICKETS_VIEW_SLA_FIELD_UNIVERSAL_IDENTIFIER =
  'be70887b-e6dc-4325-9c4a-c297c9a3f535';

export const TICKETS_BY_STATUS_VIEW_UNIVERSAL_IDENTIFIER =
  '83f20d97-cc5c-484e-94e5-69c088a2bffa';
export const TICKETS_BY_STATUS_VIEW_SUBJECT_FIELD_UNIVERSAL_IDENTIFIER =
  'd33b7dfd-e775-4f01-b16b-13fc405a3b4d';
export const TICKETS_BY_STATUS_VIEW_PRIORITY_FIELD_UNIVERSAL_IDENTIFIER =
  '82f3b8db-042b-4175-92b3-20d3434fc1e5';

export const QUEUE_OVERVIEW_VIEW_UNIVERSAL_IDENTIFIER =
  '20046155-dad5-4000-a724-cca01725142d';
export const QUEUE_OVERVIEW_VIEW_NAME_FIELD_UNIVERSAL_IDENTIFIER =
  '86cefd71-ad77-4bed-8273-d108ffbaacb7';
export const QUEUE_OVERVIEW_VIEW_SLA_FIELD_UNIVERSAL_IDENTIFIER =
  '25367ac9-8078-493e-83e3-5c9612ef7bb5';

export const SUPPORT_TICKETS_NAV_ITEM_UNIVERSAL_IDENTIFIER =
  'ed7e7e26-4567-4095-9ee5-700db0a99aaf';

export const SUPPORT_TRIAGE_AGENT_UNIVERSAL_IDENTIFIER =
  '86534c23-91f6-4fa3-91e5-1d877dcc46d3';
export const SUPPORT_TRIAGE_SKILL_UNIVERSAL_IDENTIFIER =
  'b15fb25c-208d-4324-9362-aa850ef08080';

export const POST_INSTALL_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER =
  '28557ec1-4c0b-43a8-9157-f7e7016c80d3';
export const UNINSTALL_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER =
  'da17fcfa-1187-4b24-bb33-1b31f0a13c30';

export const SUPPORT_OVERVIEW_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER =
  'b1cd0d7d-5886-494f-aa85-7c6844bf1c52';
export const SUPPORT_OVERVIEW_TAB_UNIVERSAL_IDENTIFIER =
  'eb851842-2794-4393-bc03-959684e7cd27';
export const SUPPORT_OVERVIEW_KANBAN_WIDGET_UNIVERSAL_IDENTIFIER =
  '1a79cb8f-476b-46d1-9d43-6f33fa68a89e';
export const SUPPORT_OVERVIEW_QUEUE_WIDGET_UNIVERSAL_IDENTIFIER =
  '68cb86c9-aea9-4ab0-a85a-2a273b714de0';

// Workflow step ids (repair pass, C13) — WorkflowAction.id is a real,
// required UUID field, not a free-form string. Fixed and hand-assigned like
// every other identifier in this file.
export const NEW_TICKET_TRIAGE_STEP_UNIVERSAL_IDENTIFIER =
  '4a6a0a29-6e8a-4b9a-9a9d-7d6a6b6e0a01';
export const SLA_RISK_SWEEP_STEP_UNIVERSAL_IDENTIFIER =
  '4a6a0a29-6e8a-4b9a-9a9d-7d6a6b6e0a02';
```

- [ ] **Step 3: Write the app-default role**

This is the role the app's own logic functions (pre/post-install, uninstall) run as — broad by necessity, since post-install must create queue and workflow records. It is never assigned to a human. Pattern copied from `packages/searm-apps/examples/hello-world/src/roles/default-role.ts`.

**Program integration (repair pass, C12):** post-install also calls the `installWorkflowDefinition` core-schema mutation (Task 9), which is guarded by `SettingsPermissionGuard(PermissionFlagType.WORKFLOWS)` (verified: `packages/searm-server/src/engine/metadata-modules/ai/ai-write-approval/resolvers/proposal.resolver.ts:26` shows the same guard pattern applied at the resolver class level; Phase 4 Task 10 Step 5c applies it to the standalone `WorkflowDefinitionInstallResolver`, `@CoreResolver()`-scoped — see Task 9 Step 1's program-integration note for why this mutation is core, not metadata). Without the `WORKFLOWS` permission flag, that call is rejected and neither workflow installs. `SystemPermissionFlag.WORKFLOWS` (`'6189e7bd-4051-5752-b6b1-5f31358fbaf1'`, verified `packages/searm-shared/src/constants/SystemPermissionFlag.ts:10`) is the flag's universal identifier, and `permissionFlagUniversalIdentifiers` is the real `RoleConfig`/`RoleManifest` property (verified `packages/searm-sdk/src/sdk/define/roles/role-config.ts:12` and used identically in production: `packages/searm-apps/public/people-data-labs/src/roles/default-function.role.ts:40` sets `permissionFlagUniversalIdentifiers: [SystemPermissionFlag.WORKFLOWS]` for the same reason — a post-install hook that installs a workflow):

```ts
// customer-support/src/roles/app-default.role.ts
import { defineRole, SystemPermissionFlag } from 'searm-sdk/define';

import { APP_DEFAULT_ROLE_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

export default defineRole({
  universalIdentifier: APP_DEFAULT_ROLE_UNIVERSAL_IDENTIFIER,
  label: 'Customer support app service role',
  description:
    'Used by this application\'s own install/upgrade/uninstall logic functions. Never assign to a human user.',
  canReadAllObjectRecords: true,
  canUpdateAllObjectRecords: true,
  canSoftDeleteAllObjectRecords: true,
  canDestroyAllObjectRecords: false,
  // Required to call installWorkflowDefinition from post-install (Task 9) —
  // that mutation is guarded by SettingsPermissionGuard(PermissionFlagType.WORKFLOWS).
  permissionFlagUniversalIdentifiers: [SystemPermissionFlag.WORKFLOWS],
});
```

- [ ] **Step 4: Write the application config**

```ts
// customer-support/src/application-config.ts
import { defineApplication } from 'searm-sdk/define';

import {
  APPLICATION_UNIVERSAL_IDENTIFIER,
  APP_DEFAULT_ROLE_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineApplication({
  universalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
  displayName: 'Customer Support',
  description:
    'Tickets, queues, SLAs, and AI triage for support teams — objects, views, roles, and workflows, installed without touching the CRM core.',
  author: 'SeaRM',
  category: 'Support',
  defaultRoleUniversalIdentifier: APP_DEFAULT_ROLE_UNIVERSAL_IDENTIFIER,
});
```

- [ ] **Step 5: Install dependencies and typecheck**

```bash
cd packages/searm-apps/public/customer-support
yarn install
yarn typecheck
```

Expected: no errors (only two manifest files exist so far, both self-contained).

- [ ] **Step 6: Commit**

```bash
git add packages/searm-apps/public/customer-support
git commit -m "feat(customer-support): scaffold app package and identity"
```

---

### Task 2: The `supportQueue` object

**Files:**
- Create: `packages/searm-apps/public/customer-support/src/objects/support-queue.object.ts`

**Interfaces:**
- Consumes: `defineObject`, `FieldType` from `searm-sdk/define`.
- Produces: `supportQueue` object with fields `name`, `description`, `slaFirstResponseMinutes`, `slaResolutionMinutes`, `isDefault` — Task 4's relation field and Task 5's queue view reference this object and its field identifiers.

- [ ] **Step 1: Write the object**

Pattern copied from `packages/searm-apps/examples/hello-world/src/objects/example-object.ts` and `packages/searm-apps/fixtures/rich-app/src/objects/post-card.object.ts` (verified real files, both read in full):

```ts
// customer-support/src/objects/support-queue.object.ts
import { defineObject, FieldType } from 'searm-sdk/define';

import {
  QUEUE_DESCRIPTION_FIELD_UNIVERSAL_IDENTIFIER,
  QUEUE_IS_DEFAULT_FIELD_UNIVERSAL_IDENTIFIER,
  QUEUE_NAME_FIELD_UNIVERSAL_IDENTIFIER,
  QUEUE_SLA_FIRST_RESPONSE_MINUTES_FIELD_UNIVERSAL_IDENTIFIER,
  QUEUE_SLA_RESOLUTION_MINUTES_FIELD_UNIVERSAL_IDENTIFIER,
  SUPPORT_QUEUE_OBJECT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineObject({
  universalIdentifier: SUPPORT_QUEUE_OBJECT_UNIVERSAL_IDENTIFIER,
  nameSingular: 'supportQueue',
  namePlural: 'supportQueues',
  labelSingular: 'Support queue',
  labelPlural: 'Support queues',
  description: 'A routing bucket for support tickets with its own SLA targets.',
  icon: 'IconInbox',
  labelIdentifierFieldMetadataUniversalIdentifier:
    QUEUE_NAME_FIELD_UNIVERSAL_IDENTIFIER,
  fields: [
    {
      universalIdentifier: QUEUE_NAME_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.TEXT,
      name: 'name',
      label: 'Name',
      description: 'Queue name, e.g. "Tier 1" or "Billing"',
      icon: 'IconAbc',
    },
    {
      universalIdentifier: QUEUE_DESCRIPTION_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.TEXT,
      name: 'description',
      label: 'Description',
      icon: 'IconFileDescription',
      isNullable: true,
      defaultValue: null,
    },
    {
      universalIdentifier:
        QUEUE_SLA_FIRST_RESPONSE_MINUTES_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.NUMBER,
      name: 'slaFirstResponseMinutes',
      label: 'SLA: first response (minutes)',
      description: 'Minutes from ticket creation to a required first response.',
      icon: 'IconClockHour3',
      defaultValue: '60',
    },
    {
      universalIdentifier:
        QUEUE_SLA_RESOLUTION_MINUTES_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.NUMBER,
      name: 'slaResolutionMinutes',
      label: 'SLA: resolution (minutes)',
      description: 'Minutes from ticket creation to a required resolution.',
      icon: 'IconClockHour9',
      defaultValue: '1440',
    },
    {
      universalIdentifier: QUEUE_IS_DEFAULT_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.BOOLEAN,
      name: 'isDefault',
      label: 'Default queue',
      description: 'New tickets with no queue specified route here.',
      icon: 'IconStar',
      defaultValue: 'false',
    },
  ],
});
```

- [ ] **Step 2: Validate with the SDK's own build**

```bash
cd packages/searm-apps/public/customer-support
yarn typecheck
npx searm app build
```

Expected: `app build` reports the manifest as valid (no `errors` in its `ValidationResult` output) — it will warn about a still-empty app in other respects, that is expected until later tasks add more units.

- [ ] **Step 3: Commit**

```bash
git add packages/searm-apps/public/customer-support/src/objects/support-queue.object.ts
git commit -m "feat(customer-support): add supportQueue object"
```

---

### Task 3: The `supportTicket` object

**Files:**
- Create: `packages/searm-apps/public/customer-support/src/objects/support-ticket.object.ts`

**Interfaces:**
- Consumes: `defineObject`, `FieldType` from `searm-sdk/define`.
- Produces: `supportTicket` object with fields `subject`, `status`, `priority`, `channel`, `description`, `slaFirstResponseDueAt`, `slaResolutionDueAt`, `firstRespondedAt`, `resolvedAt`, `aiTriageSummary`. Task 4's four relation fields, Task 5's index and views, and Task 9's workflow templates all reference this object.

- [ ] **Step 1: Write the object**

`SELECT` field shape (options, `defaultValue` as a quoted enum literal string) copied verbatim from `packages/searm-apps/fixtures/rich-app/src/objects/post-card.object.ts`'s `status` field:

```ts
// customer-support/src/objects/support-ticket.object.ts
import { defineObject, FieldType } from 'searm-sdk/define';

import {
  SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  TICKET_AI_TRIAGE_SUMMARY_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_CHANNEL_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_DESCRIPTION_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_FIRST_RESPONDED_AT_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_PRIORITY_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_RESOLVED_AT_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_SLA_FIRST_RESPONSE_DUE_AT_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_SLA_RESOLUTION_DUE_AT_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_STATUS_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_SUBJECT_FIELD_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

enum TicketStatus {
  NEW = 'NEW',
  TRIAGED = 'TRIAGED',
  IN_PROGRESS = 'IN_PROGRESS',
  WAITING_ON_CUSTOMER = 'WAITING_ON_CUSTOMER',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

enum TicketPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

enum TicketChannel {
  EMAIL = 'EMAIL',
  CHAT = 'CHAT',
  PHONE = 'PHONE',
  WEB_FORM = 'WEB_FORM',
}

export default defineObject({
  universalIdentifier: SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  nameSingular: 'supportTicket',
  namePlural: 'supportTickets',
  labelSingular: 'Support ticket',
  labelPlural: 'Support tickets',
  description: 'A customer support request tracked through resolution.',
  icon: 'IconTicket',
  labelIdentifierFieldMetadataUniversalIdentifier:
    TICKET_SUBJECT_FIELD_UNIVERSAL_IDENTIFIER,
  fields: [
    {
      universalIdentifier: TICKET_SUBJECT_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.TEXT,
      name: 'subject',
      label: 'Subject',
      icon: 'IconAbc',
    },
    {
      universalIdentifier: TICKET_DESCRIPTION_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.TEXT,
      name: 'description',
      label: 'Description',
      icon: 'IconFileDescription',
      isNullable: true,
      defaultValue: null,
    },
    {
      universalIdentifier: TICKET_STATUS_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.SELECT,
      name: 'status',
      label: 'Status',
      icon: 'IconProgress',
      defaultValue: `'${TicketStatus.NEW}'`,
      options: [
        { value: TicketStatus.NEW, label: 'New', position: 0, color: 'blue' },
        {
          value: TicketStatus.TRIAGED,
          label: 'Triaged',
          position: 1,
          color: 'purple',
        },
        {
          value: TicketStatus.IN_PROGRESS,
          label: 'In progress',
          position: 2,
          color: 'yellow',
        },
        {
          value: TicketStatus.WAITING_ON_CUSTOMER,
          label: 'Waiting on customer',
          position: 3,
          color: 'orange',
        },
        {
          value: TicketStatus.RESOLVED,
          label: 'Resolved',
          position: 4,
          color: 'green',
        },
        {
          value: TicketStatus.CLOSED,
          label: 'Closed',
          position: 5,
          color: 'gray',
        },
      ],
    },
    {
      universalIdentifier: TICKET_PRIORITY_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.SELECT,
      name: 'priority',
      label: 'Priority',
      icon: 'IconFlag',
      defaultValue: `'${TicketPriority.MEDIUM}'`,
      options: [
        { value: TicketPriority.LOW, label: 'Low', position: 0, color: 'gray' },
        {
          value: TicketPriority.MEDIUM,
          label: 'Medium',
          position: 1,
          color: 'blue',
        },
        {
          value: TicketPriority.HIGH,
          label: 'High',
          position: 2,
          color: 'orange',
        },
        {
          value: TicketPriority.URGENT,
          label: 'Urgent',
          position: 3,
          color: 'red',
        },
      ],
    },
    {
      universalIdentifier: TICKET_CHANNEL_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.SELECT,
      name: 'channel',
      label: 'Channel',
      icon: 'IconMessage',
      defaultValue: `'${TicketChannel.EMAIL}'`,
      options: [
        { value: TicketChannel.EMAIL, label: 'Email', position: 0, color: 'blue' },
        { value: TicketChannel.CHAT, label: 'Chat', position: 1, color: 'green' },
        { value: TicketChannel.PHONE, label: 'Phone', position: 2, color: 'orange' },
        {
          value: TicketChannel.WEB_FORM,
          label: 'Web form',
          position: 3,
          color: 'purple',
        },
      ],
    },
    {
      universalIdentifier:
        TICKET_SLA_FIRST_RESPONSE_DUE_AT_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.DATE_TIME,
      name: 'slaFirstResponseDueAt',
      label: 'SLA: first response due',
      icon: 'IconClockHour3',
      isNullable: true,
      defaultValue: null,
    },
    {
      universalIdentifier:
        TICKET_SLA_RESOLUTION_DUE_AT_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.DATE_TIME,
      name: 'slaResolutionDueAt',
      label: 'SLA: resolution due',
      icon: 'IconClockHour9',
      isNullable: true,
      defaultValue: null,
    },
    {
      universalIdentifier: TICKET_FIRST_RESPONDED_AT_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.DATE_TIME,
      name: 'firstRespondedAt',
      label: 'First responded at',
      icon: 'IconMessageCheck',
      isNullable: true,
      defaultValue: null,
    },
    {
      universalIdentifier: TICKET_RESOLVED_AT_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.DATE_TIME,
      name: 'resolvedAt',
      label: 'Resolved at',
      icon: 'IconCheck',
      isNullable: true,
      defaultValue: null,
    },
    {
      universalIdentifier: TICKET_AI_TRIAGE_SUMMARY_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.TEXT,
      name: 'aiTriageSummary',
      label: 'AI triage summary',
      description:
        'Written by the support triage agent. Every write to this field is a proposal awaiting human approval, same as any other AI-originated write.',
      icon: 'IconRobot',
      isNullable: true,
      defaultValue: null,
    },
  ],
});
```

- [ ] **Step 2: Validate and commit**

```bash
cd packages/searm-apps/public/customer-support
yarn typecheck
npx searm app build
git add packages/searm-apps/public/customer-support/src/objects/support-ticket.object.ts
git commit -m "feat(customer-support): add supportTicket object"
```

---

### Task 4: Relation fields — the only touch on standard objects, and only as pointers

This is the task the charter's "never add industry records to the core schema" rule binds hardest. Every field below is a `RELATION` field. None adds a scalar column carrying support-specific data to `company`, `person`, or `workspaceMember` — each pair is a pointer and its reverse pointer, exactly the pattern `packages/searm-apps/public/last-contact/src/fields/last-contact-for-people-on-message.field.ts` already ships in production.

**Files:**
- Create: `packages/searm-apps/public/customer-support/src/fields/queue-on-ticket.field.ts`
- Create: `packages/searm-apps/public/customer-support/src/fields/tickets-on-queue.field.ts`
- Create: `packages/searm-apps/public/customer-support/src/fields/company-on-ticket.field.ts`
- Create: `packages/searm-apps/public/customer-support/src/fields/support-tickets-on-company.field.ts`
- Create: `packages/searm-apps/public/customer-support/src/fields/requester-on-ticket.field.ts`
- Create: `packages/searm-apps/public/customer-support/src/fields/support-tickets-on-person.field.ts`
- Create: `packages/searm-apps/public/customer-support/src/fields/assignee-on-ticket.field.ts`
- Create: `packages/searm-apps/public/customer-support/src/fields/assigned-tickets-on-workspace-member.field.ts`

**Interfaces:**
- Consumes: `defineField`, `FieldType`, `RelationType`, `OnDeleteAction`, `STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS` from `searm-sdk/define` (all verified real exports and real usage in `packages/searm-apps/fixtures/rich-app/src/fields/recipient-on-post-card-recipient.field.ts` and `packages/searm-apps/public/last-contact/src/fields/last-contact-for-people-on-message.field.ts`).
- Produces: `supportTicket.queue`, `supportQueue.tickets`, `supportTicket.company`, `company.supportTickets`, `supportTicket.requester`, `person.supportTickets`, `supportTicket.assignee`, `workspaceMember.assignedSupportTickets` — Task 5's views and Task 6's role field permissions reference these by field name.

- [ ] **Step 1: `supportTicket.queue` ↔ `supportQueue.tickets`**

```ts
// customer-support/src/fields/queue-on-ticket.field.ts
import { defineField, FieldType, RelationType } from 'searm-sdk/define';

import {
  SUPPORT_QUEUE_OBJECT_UNIVERSAL_IDENTIFIER,
  SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  TICKET_QUEUE_FIELD_UNIVERSAL_IDENTIFIER,
  QUEUE_TICKETS_FIELD_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: TICKET_QUEUE_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  type: FieldType.RELATION,
  name: 'queue',
  label: 'Queue',
  icon: 'IconInbox',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier:
    SUPPORT_QUEUE_OBJECT_UNIVERSAL_IDENTIFIER,
  relationTargetFieldMetadataUniversalIdentifier:
    QUEUE_TICKETS_FIELD_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
  },
});
```

```ts
// customer-support/src/fields/tickets-on-queue.field.ts
import { defineField, FieldType, RelationType } from 'searm-sdk/define';

import {
  SUPPORT_QUEUE_OBJECT_UNIVERSAL_IDENTIFIER,
  SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  TICKET_QUEUE_FIELD_UNIVERSAL_IDENTIFIER,
  QUEUE_TICKETS_FIELD_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: QUEUE_TICKETS_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: SUPPORT_QUEUE_OBJECT_UNIVERSAL_IDENTIFIER,
  type: FieldType.RELATION,
  name: 'tickets',
  label: 'Tickets',
  icon: 'IconTicket',
  relationTargetObjectMetadataUniversalIdentifier:
    SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  relationTargetFieldMetadataUniversalIdentifier:
    TICKET_QUEUE_FIELD_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
```

- [ ] **Step 2: `supportTicket.company` ↔ standard `company.supportTickets`**

```ts
// customer-support/src/fields/company-on-ticket.field.ts
import {
  defineField,
  FieldType,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'searm-sdk/define';

import {
  SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  TICKET_COMPANY_FIELD_UNIVERSAL_IDENTIFIER,
  COMPANY_SUPPORT_TICKETS_FIELD_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: TICKET_COMPANY_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  type: FieldType.RELATION,
  name: 'company',
  label: 'Company',
  icon: 'IconBuilding',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.company.universalIdentifier,
  relationTargetFieldMetadataUniversalIdentifier:
    COMPANY_SUPPORT_TICKETS_FIELD_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
  },
});
```

```ts
// customer-support/src/fields/support-tickets-on-company.field.ts
// A relation pointer onto a standard object, not a business-data field —
// the same pattern last-contact ships today. No industry data lands on Company.
import {
  defineField,
  FieldType,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'searm-sdk/define';

import {
  SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  TICKET_COMPANY_FIELD_UNIVERSAL_IDENTIFIER,
  COMPANY_SUPPORT_TICKETS_FIELD_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: COMPANY_SUPPORT_TICKETS_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.company.universalIdentifier,
  type: FieldType.RELATION,
  name: 'supportTickets',
  label: 'Support tickets',
  icon: 'IconTicket',
  isNullable: true,
  isUIEditable: false,
  relationTargetObjectMetadataUniversalIdentifier:
    SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  relationTargetFieldMetadataUniversalIdentifier:
    TICKET_COMPANY_FIELD_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
```

- [ ] **Step 3: `supportTicket.requester` ↔ standard `person.supportTickets`**

```ts
// customer-support/src/fields/requester-on-ticket.field.ts
import {
  defineField,
  FieldType,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'searm-sdk/define';

import {
  SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  TICKET_REQUESTER_FIELD_UNIVERSAL_IDENTIFIER,
  PERSON_SUPPORT_TICKETS_FIELD_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: TICKET_REQUESTER_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  type: FieldType.RELATION,
  name: 'requester',
  label: 'Requested by',
  icon: 'IconUser',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  relationTargetFieldMetadataUniversalIdentifier:
    PERSON_SUPPORT_TICKETS_FIELD_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
  },
});
```

```ts
// customer-support/src/fields/support-tickets-on-person.field.ts
import {
  defineField,
  FieldType,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'searm-sdk/define';

import {
  SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  TICKET_REQUESTER_FIELD_UNIVERSAL_IDENTIFIER,
  PERSON_SUPPORT_TICKETS_FIELD_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: PERSON_SUPPORT_TICKETS_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.RELATION,
  name: 'supportTickets',
  label: 'Support tickets',
  icon: 'IconTicket',
  isNullable: true,
  isUIEditable: false,
  relationTargetObjectMetadataUniversalIdentifier:
    SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  relationTargetFieldMetadataUniversalIdentifier:
    TICKET_REQUESTER_FIELD_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
```

- [ ] **Step 4: `supportTicket.assignee` ↔ standard `workspaceMember.assignedSupportTickets`**

```ts
// customer-support/src/fields/assignee-on-ticket.field.ts
import {
  defineField,
  FieldType,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'searm-sdk/define';

import {
  SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  TICKET_ASSIGNEE_FIELD_UNIVERSAL_IDENTIFIER,
  WORKSPACE_MEMBER_ASSIGNED_TICKETS_FIELD_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: TICKET_ASSIGNEE_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  type: FieldType.RELATION,
  name: 'assignee',
  label: 'Assignee',
  icon: 'IconUserCircle',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.workspaceMember.universalIdentifier,
  relationTargetFieldMetadataUniversalIdentifier:
    WORKSPACE_MEMBER_ASSIGNED_TICKETS_FIELD_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
  },
});
```

```ts
// customer-support/src/fields/assigned-tickets-on-workspace-member.field.ts
import {
  defineField,
  FieldType,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'searm-sdk/define';

import {
  SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  TICKET_ASSIGNEE_FIELD_UNIVERSAL_IDENTIFIER,
  WORKSPACE_MEMBER_ASSIGNED_TICKETS_FIELD_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier:
    WORKSPACE_MEMBER_ASSIGNED_TICKETS_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.workspaceMember.universalIdentifier,
  type: FieldType.RELATION,
  name: 'assignedSupportTickets',
  label: 'Assigned support tickets',
  icon: 'IconTicket',
  isNullable: true,
  isUIEditable: false,
  relationTargetObjectMetadataUniversalIdentifier:
    SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  relationTargetFieldMetadataUniversalIdentifier:
    TICKET_ASSIGNEE_FIELD_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
```

**Repair pass (N7).** `STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.workspaceMember` is confirmed present and correctly camelCased: `packages/searm-sdk/src/sdk/define/objects/standard-object-ids.ts` re-exports `STANDARD_OBJECTS` from `searm-shared/metadata`, and `packages/searm-shared/src/metadata/constants/standard-object-universal-identifiers.constant.ts:26` reads `workspaceMember: '20202020-3319-4234-a34c-82d5c0e881a6'`. `STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.workspaceMember.universalIdentifier` above is real and resolves to that UUID; no fallback is needed.

- [ ] **Step 5: Validate and commit**

```bash
cd packages/searm-apps/public/customer-support
yarn typecheck
npx searm app build
```

Expected: build succeeds; both sides of each relation resolve (the SDK's `defineField` validator checks that `relationTargetFieldMetadataUniversalIdentifier` points at a field that itself points back — if it reports an unresolved reverse pointer, check that both files in the pair use the exact same two UUIDs, swapped).

```bash
git add packages/searm-apps/public/customer-support/src/fields
git commit -m "feat(customer-support): relate tickets to company, person, workspace member, queue"
```

---

### Task 5: Index, views, navigation

**Files:**
- Create: `packages/searm-apps/public/customer-support/src/indexes/support-ticket-status.index.ts`
- Create: `packages/searm-apps/public/customer-support/src/views/all-tickets.view.ts`
- Create: `packages/searm-apps/public/customer-support/src/views/tickets-by-status.view.ts`
- Create: `packages/searm-apps/public/customer-support/src/views/queue-overview.view.ts`
- Create: `packages/searm-apps/public/customer-support/src/navigation-menu-items/support-tickets.navigation-menu-item.ts`

**Interfaces:**
- Consumes: `defineIndex`, `defineView`, `defineNavigationMenuItem`, `ViewType` from `searm-sdk/define`; `NavigationMenuItemType` from `searm-shared/types` (verified real import in `packages/searm-apps/examples/hello-world/src/navigation-menu-items/example-navigation-menu-item.ts`).
- Produces: three views and one navigation entry, reachable in the workspace UI after install.

- [ ] **Step 1: Index on ticket status**

Pattern from `packages/searm-apps/fixtures/rich-app/src/indexes/post-card-status.index.ts`:

```ts
// customer-support/src/indexes/support-ticket-status.index.ts
import { defineIndex } from 'searm-sdk/define';

import {
  SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  TICKET_STATUS_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_STATUS_INDEX_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_STATUS_INDEX_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineIndex({
  universalIdentifier: TICKET_STATUS_INDEX_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  fields: [
    {
      universalIdentifier: TICKET_STATUS_INDEX_FIELD_UNIVERSAL_IDENTIFIER,
      fieldUniversalIdentifier: TICKET_STATUS_FIELD_UNIVERSAL_IDENTIFIER,
    },
  ],
});
```

- [ ] **Step 2: All Tickets table view**

Pattern from `packages/searm-apps/examples/hello-world/src/views/example-view.ts`:

```ts
// customer-support/src/views/all-tickets.view.ts
import { defineView, ViewType } from 'searm-sdk/define';

import {
  ALL_TICKETS_VIEW_PRIORITY_FIELD_UNIVERSAL_IDENTIFIER,
  ALL_TICKETS_VIEW_SLA_FIELD_UNIVERSAL_IDENTIFIER,
  ALL_TICKETS_VIEW_SUBJECT_FIELD_UNIVERSAL_IDENTIFIER,
  ALL_TICKETS_VIEW_UNIVERSAL_IDENTIFIER,
  SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  TICKET_PRIORITY_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_SLA_RESOLUTION_DUE_AT_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_SUBJECT_FIELD_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineView({
  universalIdentifier: ALL_TICKETS_VIEW_UNIVERSAL_IDENTIFIER,
  name: 'All tickets',
  objectUniversalIdentifier: SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  type: ViewType.TABLE,
  icon: 'IconTicket',
  position: 0,
  fields: [
    {
      universalIdentifier: ALL_TICKETS_VIEW_SUBJECT_FIELD_UNIVERSAL_IDENTIFIER,
      fieldMetadataUniversalIdentifier: TICKET_SUBJECT_FIELD_UNIVERSAL_IDENTIFIER,
      position: 0,
      isVisible: true,
      size: 250,
    },
    {
      universalIdentifier: ALL_TICKETS_VIEW_PRIORITY_FIELD_UNIVERSAL_IDENTIFIER,
      fieldMetadataUniversalIdentifier: TICKET_PRIORITY_FIELD_UNIVERSAL_IDENTIFIER,
      position: 1,
      isVisible: true,
      size: 120,
    },
    {
      universalIdentifier: ALL_TICKETS_VIEW_SLA_FIELD_UNIVERSAL_IDENTIFIER,
      fieldMetadataUniversalIdentifier:
        TICKET_SLA_RESOLUTION_DUE_AT_FIELD_UNIVERSAL_IDENTIFIER,
      position: 2,
      isVisible: true,
      size: 180,
    },
  ],
});
```

- [ ] **Step 3: Tickets by status Kanban view**

`mainGroupByFieldMetadataUniversalIdentifier` is the Kanban grouping field (verified field on `ViewManifest`, `packages/searm-shared/src/application/viewManifestType.ts`):

```ts
// customer-support/src/views/tickets-by-status.view.ts
import { defineView, ViewType } from 'searm-sdk/define';

import {
  SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  TICKET_PRIORITY_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_STATUS_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_SUBJECT_FIELD_UNIVERSAL_IDENTIFIER,
  TICKETS_BY_STATUS_VIEW_PRIORITY_FIELD_UNIVERSAL_IDENTIFIER,
  TICKETS_BY_STATUS_VIEW_SUBJECT_FIELD_UNIVERSAL_IDENTIFIER,
  TICKETS_BY_STATUS_VIEW_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineView({
  universalIdentifier: TICKETS_BY_STATUS_VIEW_UNIVERSAL_IDENTIFIER,
  name: 'Tickets by status',
  objectUniversalIdentifier: SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  type: ViewType.KANBAN,
  icon: 'IconLayoutKanban',
  position: 1,
  mainGroupByFieldMetadataUniversalIdentifier:
    TICKET_STATUS_FIELD_UNIVERSAL_IDENTIFIER,
  fields: [
    {
      universalIdentifier: TICKETS_BY_STATUS_VIEW_SUBJECT_FIELD_UNIVERSAL_IDENTIFIER,
      fieldMetadataUniversalIdentifier: TICKET_SUBJECT_FIELD_UNIVERSAL_IDENTIFIER,
      position: 0,
      isVisible: true,
      size: 250,
    },
    {
      universalIdentifier:
        TICKETS_BY_STATUS_VIEW_PRIORITY_FIELD_UNIVERSAL_IDENTIFIER,
      fieldMetadataUniversalIdentifier: TICKET_PRIORITY_FIELD_UNIVERSAL_IDENTIFIER,
      position: 1,
      isVisible: true,
      size: 120,
    },
  ],
});
```

- [ ] **Step 4: Queue overview table view**

```ts
// customer-support/src/views/queue-overview.view.ts
import { defineView, ViewType } from 'searm-sdk/define';

import {
  QUEUE_NAME_FIELD_UNIVERSAL_IDENTIFIER,
  QUEUE_OVERVIEW_VIEW_NAME_FIELD_UNIVERSAL_IDENTIFIER,
  QUEUE_OVERVIEW_VIEW_SLA_FIELD_UNIVERSAL_IDENTIFIER,
  QUEUE_OVERVIEW_VIEW_UNIVERSAL_IDENTIFIER,
  QUEUE_SLA_FIRST_RESPONSE_MINUTES_FIELD_UNIVERSAL_IDENTIFIER,
  SUPPORT_QUEUE_OBJECT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineView({
  universalIdentifier: QUEUE_OVERVIEW_VIEW_UNIVERSAL_IDENTIFIER,
  name: 'Queues',
  objectUniversalIdentifier: SUPPORT_QUEUE_OBJECT_UNIVERSAL_IDENTIFIER,
  type: ViewType.TABLE,
  icon: 'IconInbox',
  position: 0,
  fields: [
    {
      universalIdentifier: QUEUE_OVERVIEW_VIEW_NAME_FIELD_UNIVERSAL_IDENTIFIER,
      fieldMetadataUniversalIdentifier: QUEUE_NAME_FIELD_UNIVERSAL_IDENTIFIER,
      position: 0,
      isVisible: true,
      size: 200,
    },
    {
      universalIdentifier: QUEUE_OVERVIEW_VIEW_SLA_FIELD_UNIVERSAL_IDENTIFIER,
      fieldMetadataUniversalIdentifier:
        QUEUE_SLA_FIRST_RESPONSE_MINUTES_FIELD_UNIVERSAL_IDENTIFIER,
      position: 1,
      isVisible: true,
      size: 140,
    },
  ],
});
```

- [ ] **Step 5: Navigation menu item**

```ts
// customer-support/src/navigation-menu-items/support-tickets.navigation-menu-item.ts
import { defineNavigationMenuItem } from 'searm-sdk/define';
import { NavigationMenuItemType } from 'searm-shared/types';

import {
  ALL_TICKETS_VIEW_UNIVERSAL_IDENTIFIER,
  SUPPORT_TICKETS_NAV_ITEM_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineNavigationMenuItem({
  universalIdentifier: SUPPORT_TICKETS_NAV_ITEM_UNIVERSAL_IDENTIFIER,
  name: 'support-tickets',
  icon: 'IconTicket',
  color: 'blue',
  position: 0,
  type: NavigationMenuItemType.VIEW,
  viewUniversalIdentifier: ALL_TICKETS_VIEW_UNIVERSAL_IDENTIFIER,
});
```

- [ ] **Step 6: Validate and commit**

```bash
cd packages/searm-apps/public/customer-support
yarn typecheck
npx searm app build
git add packages/searm-apps/public/customer-support/src/indexes packages/searm-apps/public/customer-support/src/views packages/searm-apps/public/customer-support/src/navigation-menu-items
git commit -m "feat(customer-support): add index, views, navigation"
```

---

### Task 6: Roles — object and field permissions

The scoped role (`support-agent.role.ts`) is assigned to both human support reps and, in Task 7, the AI triage agent. This is the one role that governs what the AI can *see and touch at all* — the AI write policy (Launch 1) then governs, on top of that, whether a touch it's permitted to make executes immediately or becomes a proposal.

**Files:**
- Create: `packages/searm-apps/public/customer-support/src/roles/support-agent.role.ts`

**Interfaces:**
- Consumes: `defineRole`, `STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS` from `searm-sdk/define`.
- Produces: `SUPPORT_AGENT_ROLE_UNIVERSAL_IDENTIFIER` — Task 7's agent definition references it as `roleUniversalIdentifier`.

- [ ] **Step 1: Write the role**

Pattern from `packages/searm-apps/fixtures/rich-app/src/roles/default-function.role.ts` (`objectPermissions`/`fieldPermissions` array shape verified in full):

```ts
// customer-support/src/roles/support-agent.role.ts
import {
  defineRole,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'searm-sdk/define';

import {
  SUPPORT_AGENT_ROLE_UNIVERSAL_IDENTIFIER,
  SUPPORT_QUEUE_OBJECT_UNIVERSAL_IDENTIFIER,
  SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineRole({
  universalIdentifier: SUPPORT_AGENT_ROLE_UNIVERSAL_IDENTIFIER,
  label: 'Support agent',
  description:
    'Assignable to human support reps and to the AI triage agent. Scoped to tickets and queues, read-only on the CRM records a ticket is about.',
  canReadAllObjectRecords: false,
  canUpdateAllObjectRecords: false,
  canSoftDeleteAllObjectRecords: false,
  canDestroyAllObjectRecords: false,
  canUpdateAllSettings: false,
  canBeAssignedToAgents: true,
  canBeAssignedToUsers: true,
  canBeAssignedToApiKeys: false,
  objectPermissions: [
    {
      objectUniversalIdentifier: SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
      canReadObjectRecords: true,
      canUpdateObjectRecords: true,
      canSoftDeleteObjectRecords: false,
      canDestroyObjectRecords: false,
    },
    {
      objectUniversalIdentifier: SUPPORT_QUEUE_OBJECT_UNIVERSAL_IDENTIFIER,
      canReadObjectRecords: true,
      canUpdateObjectRecords: false,
      canSoftDeleteObjectRecords: false,
      canDestroyObjectRecords: false,
    },
    {
      objectUniversalIdentifier:
        STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.company.universalIdentifier,
      canReadObjectRecords: true,
      canUpdateObjectRecords: false,
      canSoftDeleteObjectRecords: false,
      canDestroyObjectRecords: false,
    },
    {
      objectUniversalIdentifier:
        STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
      canReadObjectRecords: true,
      canUpdateObjectRecords: false,
      canSoftDeleteObjectRecords: false,
      canDestroyObjectRecords: false,
    },
  ],
});
```

`canBeAssignedToAgents: true` is what makes this role legal to bind to `defineAgent`'s `roleUniversalIdentifier` in Task 7 — the SDK's `defineAgent` validator (`packages/searm-sdk/src/sdk/define/agents/define-agent.ts`) only checks the identifier is a well-formed UUID, so if the install-time server-side validator rejects a role not flagged assignable to agents, this field is why; it is included from the start to avoid that failure mode.

- [ ] **Step 2: Validate and commit**

```bash
cd packages/searm-apps/public/customer-support
yarn typecheck
npx searm app build
git add packages/searm-apps/public/customer-support/src/roles/support-agent.role.ts
git commit -m "feat(customer-support): add scoped support-agent role"
```

---

### Task 7: The triage agent and its skill

Every write this agent attempts — updating `status`, `priority`, or `aiTriageSummary` on a ticket — is dispatched through `ToolExecutorService.dispatch()`, which is Launch 1's single gate. Nothing in this task creates a new write path; it creates an agent whose writes are automatically subject to the existing one.

**Files:**
- Create: `packages/searm-apps/public/customer-support/src/agents/support-triage-agent.ts`
- Create: `packages/searm-apps/public/customer-support/src/skills/support-triage-skill.ts`

**Interfaces:**
- Consumes: `defineAgent`, `defineSkill` from `searm-sdk/define`.
- Produces: `SUPPORT_TRIAGE_AGENT_UNIVERSAL_IDENTIFIER` — Task 9's workflow templates reference this as the `agentId` input of an `AI_AGENT` workflow step.

- [ ] **Step 1: Write the skill**

Pattern from `packages/searm-apps/examples/hello-world/src/skills/example-skill.ts`:

```ts
// customer-support/src/skills/support-triage-skill.ts
import { defineSkill } from 'searm-sdk/define';

import { SUPPORT_TRIAGE_SKILL_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

export default defineSkill({
  universalIdentifier: SUPPORT_TRIAGE_SKILL_UNIVERSAL_IDENTIFIER,
  name: 'support-ticket-triage',
  label: 'Support ticket triage',
  description: 'How to read and prioritize a new support ticket.',
  icon: 'IconRobot',
  content: `Triage rubric for support tickets:
- URGENT: production down, data loss, security issue, or the customer says "urgent"/"blocking".
- HIGH: a paying customer cannot complete a core workflow, no workaround exists.
- MEDIUM: a feature is broken or confusing but a workaround exists.
- LOW: a question, a cosmetic issue, or a feature request.

Read the ticket subject and description, and any linked company or person
record, to judge severity. Write one paragraph into aiTriageSummary
explaining the reasoning and citing what you read. Propose a priority and a
status of TRIAGED. Never mark a ticket RESOLVED or CLOSED yourself — a human
closes tickets. Every field you write is reviewed by a human before it takes
effect; state your reasoning as if someone will read it before approving.`,
});
```

- [ ] **Step 2: Write the agent**

Pattern from `packages/searm-apps/examples/hello-world/src/agents/example-agent.ts`, with `roleUniversalIdentifier` added (verified real config field, `packages/searm-sdk/src/sdk/define/agents/define-agent.ts`):

```ts
// customer-support/src/agents/support-triage-agent.ts
import { defineAgent } from 'searm-sdk/define';

import {
  SUPPORT_AGENT_ROLE_UNIVERSAL_IDENTIFIER,
  SUPPORT_TRIAGE_AGENT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineAgent({
  universalIdentifier: SUPPORT_TRIAGE_AGENT_UNIVERSAL_IDENTIFIER,
  name: 'support-triage-agent',
  label: 'Support triage agent',
  description:
    'Reads a new support ticket and the CRM records it relates to, then proposes a priority, a status, and a triage summary. Never applies a change directly — every proposed change waits for human approval.',
  icon: 'IconRobot',
  roleUniversalIdentifier: SUPPORT_AGENT_ROLE_UNIVERSAL_IDENTIFIER,
  responseFormat: { type: 'text' },
  prompt: `You triage customer support tickets. You can read the ticket, its
linked company and person, and existing queues. You can propose an update
to the ticket's status, priority, and aiTriageSummary fields. You cannot
read or write anything outside support tickets, queues, companies, and
people — if a task needs more than that, say so instead of guessing.
Every write you make is held for human approval before it changes anything;
do not describe a change as already applied.`,
});
```

- [ ] **Step 3: Validate and commit**

```bash
cd packages/searm-apps/public/customer-support
yarn typecheck
npx searm app build
git add packages/searm-apps/public/customer-support/src/agents packages/searm-apps/public/customer-support/src/skills
git commit -m "feat(customer-support): add support triage agent and skill"
```

---

### Task 8: Install lifecycle — uninstall hook

> **Program integration — pre-install cut.** The original Step 1 shipped a `pre-install.ts` whose handler validates nothing and logs a line ("kept as an explicit hook so a future version can check for conflicting objects"). That is a file, a universal identifier, a timeout budget, and an install-time round trip bought entirely on speculation. Cut. Add it in the version that has something to validate — the SDK hook is available whenever it is needed and adding it later is not a breaking change. `PRE_INSTALL_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER` is removed from `src/constants/universal-identifiers.ts` (Task 1) along with it.
>
> **Repair pass (I22, I23).** This task's step numbering originally started at "Step 2" — a renumbering bug from the pre-install cut, fixed below by starting at Step 1. It also originally wrote `post-install.ts` here and told the implementer *"do not run `yarn typecheck` yet — the two workflow-template imports do not resolve until Task 9,"* directly contradicting this plan's own Global Constraint ("Lint and typecheck after each task"). Fixed by moving the entire `post-install.ts` write into Task 9 (its Step 4, after `seedNewTicketTriageWorkflow`/`seedSlaRiskSweepWorkflow` exist to import) — this task now only writes and commits `uninstall.ts`, which is self-contained and typechecks on its own. Task 9's post-install work depends on Phase 4 Task 10 regardless (see Task 9's header); folding the file write into that task does not add a new dependency, it only stops the plan from asking for a task-boundary commit that cannot typecheck.

**Files:**
- Create: `packages/searm-apps/public/customer-support/src/logic-functions/uninstall.ts`

**Interfaces:**
- Consumes: `defineUninstallLogicFunction`, `UninstallPayload` from `searm-sdk/define`.
- Produces: nothing consumed by a later task — uninstall logging is standalone. (`post-install.ts` is written in Task 9, Step 4.)

- [ ] **Step 1: Uninstall**

```ts
// customer-support/src/logic-functions/uninstall.ts
import { defineUninstallLogicFunction } from 'searm-sdk/define';
import { type UninstallPayload } from 'searm-sdk/logic-function';

import { UNINSTALL_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

const handler = async (payload: UninstallPayload): Promise<void> => {
  // The framework tears down every object, field, view, role, agent, and
  // page layout this app owns after this hook returns — including the
  // supportTicket and supportQueue tables and all their records. This hook
  // exists to make that destructive step observable, not to perform it.
  console.log(
    'Uninstalling Customer Support — all tickets, queues, and their records will be removed. Company, Person, and WorkspaceMember records are untouched; only this app\'s relation fields on them are removed.',
    payload,
  );
};

export default defineUninstallLogicFunction({
  universalIdentifier: UNINSTALL_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'uninstall',
  description: 'Logs the scope of teardown before Customer Support is removed.',
  timeoutSeconds: 60,
  handler,
});
```

- [ ] **Step 2: Validate and commit**

```bash
cd packages/searm-apps/public/customer-support
yarn typecheck
git add packages/searm-apps/public/customer-support/src/logic-functions/uninstall.ts
git commit -m "feat(customer-support): add uninstall hook"
```

Expected: no errors — `uninstall.ts` has no dependency on anything Task 9 writes.

---

### Task 9: Close the workflow-template gap — the one place this plan writes real logic

**This is the framework gap.** No app-manifest unit exists for a declarative workflow template — confirmed by an exhaustive listing of `packages/searm-server/src/engine/core-modules/application/application-manifest/converters/`, where every other unit type in the anchors report (`object`, `field`, `index`, `view`, `view-field`, `role`, `agent` (via `role-target`), `skill`, `page-layout`, `page-layout-tab`, `page-layout-widget`, `navigation-menu-item`, `command-menu-item`, `connection-provider`, `application-variable`, `permission-flag`, `front-component`, row-level-permission-predicate(-group)) has a matching converter, and `workflow` does not.

Closing this with a new manifest unit type would mean a new `WorkflowManifest` type in `searm-shared`, a new converter in `application-manifest/converters/`, a new builder step in the workspace migration runner, and a version bump across every package that imports `searm-shared` — disproportionate to what one vertical needs. Instead: **an app declares its workflows as data and installs them with one call to `installWorkflowDefinition`**, the public mutation Phase 4 Task 10 exposes over `WorkflowTemplateService.installDefinition`. Zero core code changes *in this plan*, and zero hand-rolled workflow-builder calls. The cost is that this one piece is still TypeScript data plus one call, not a declarative manifest file — recorded honestly in "What was deliberately cut," not hidden.

**Files:**
- Create: `packages/searm-apps/public/customer-support/src/utils/seed-workflow.util.ts`
- Create: `packages/searm-apps/public/customer-support/src/workflow-templates/new-ticket-triage.workflow-template.ts`
- Create: `packages/searm-apps/public/customer-support/src/workflow-templates/sla-risk-sweep.workflow-template.ts`
- Create: `packages/searm-apps/public/customer-support/src/logic-functions/post-install.ts` (repair pass, I23: moved here from Task 8 so no task-boundary commit is red — see Step 4)

**Interfaces:**
- Consumes: `CoreApiClient` from `searm-client-sdk/core` (program integration, second pass — `installWorkflowDefinition` lives on the **core** schema, `@CoreResolver()` on the standalone `WorkflowDefinitionInstallResolver` class; see Phase 4 Task 10's "Contract exposed to Phase 5" table); `MetadataApiClient` from `searm-client-sdk/metadata` (unrelated to that mutation — used only for the `agents` lookup query in Steps 2–3, since `AgentResolver` is `@MetadataResolver()`-scoped, verified `packages/searm-server/src/engine/metadata-modules/ai/ai-agent/agent.resolver.ts:29`); `WorkflowActionType` from `searm-shared/workflow` (verified real export, `packages/searm-shared/src/workflow/types/WorkflowActionType.ts`, importable the same way `searm-shared/types` is imported in existing app code).
- Produces: `seedWorkflow(client, template): Promise<{ workflowId: string; workflowVersionId: string }>` — the reusable helper. This exact function is what makes vertical #2's workflow templates configuration-shaped: copy `seed-workflow.util.ts` unmodified into the next app, then write only a new `WorkflowTemplate` data object.

- [ ] **Step 1: Write the reusable seeding helper (thin wrapper over Phase 4's mutation)**

> **Program integration (second pass, correcting the earlier C11 repair).** Phase 4 and Phase 5 were repaired in parallel against a mutation that did not exist yet, and reached opposite conclusions about which schema it lives on. Phase 4's Task 10 is the task that actually creates `installWorkflowDefinition`, so Phase 4's decision governs: it puts the mutation on a **second resolver class**, `WorkflowDefinitionInstallResolver`, decorated `@CoreResolver()` — the **core** schema (`/graphql`) — specifically so that an installed app's post-install hook keeps using the one `CoreApiClient` it already uses for `createSupportQueue`/`createCompany`, rather than standing up a second generated client (verified: Phase 4 plan, "Contract exposed to Phase 5" table under Task 10, and `graphql-config.service.ts:83-86` / `metadata.module-factory.ts:36-38`, which show the schema is decided by the `@CoreResolver()`/`@MetadataResolver()` tag on the resolver class, not by which module the resolver's own module happens to be imported into — `WorkflowTemplatesModule` is imported by both `CoreEngineModule` and `MetadataEngineModule` for exactly this reason). `workflowTemplates`/`installWorkflowTemplate` (the settings-UI path) stay on the metadata schema; only the new `installWorkflowDefinition` mutation is core. `seedWorkflow` below therefore takes a `CoreApiClient`, and `post-install.ts` (Task 8/9) constructs a single `CoreApiClient` for both the queue seed and both workflow seeds. A separate `MetadataApiClient` is still needed in Steps 2–3, but only for the pre-existing `agents` lookup query, which is unrelated to this mutation.

> **Program integration — this task's highest risk is gone.** The original helper hand-rolled `createWorkflow` → query the draft `workflowVersion` → `updateWorkflowVersionTrigger` → N × `createWorkflowVersionStep`, and this plan's own risk section named it "the single highest-risk piece of code in the plan" because the `createWorkflow` mutation name and the route to the draft version id were never verified against a resolver.
>
> **Phase 4 Task 10 already implements exactly that sequence server-side**, against verified services (`RecordPositionService`, `WorkflowVersionCoreSyncService`, `WorkflowTriggerWorkspaceService`) copied from the shipped `create_complete_workflow` tool. The program review added `WorkflowTemplateService.installDefinition(...)` and the public mutation `installWorkflowDefinition(input: InstallWorkflowDefinitionInput!): InstalledWorkflowTemplate!` specifically so an application can supply its own workflow definition and reuse that one implementation.
>
> So this helper is now **one mutation call**. The whole class of risk (wrong mutation name, wrong path to the draft version, wrong parent-step chaining, non-idempotent re-install) moves into `searm-server`, where it is unit-tested. This adds a dependency: **Phase 4 Task 10 must ship before Phase 5 Task 9's post-install hook can run.** Every other Phase 5 task stays independent of Phase 4.

```ts
// customer-support/src/utils/seed-workflow.util.ts
import { type CoreApiClient } from 'searm-client-sdk/core';

// Mirrors the server's WorkflowTrigger union
// (packages/searm-server/src/modules/workflow/workflow-trigger/types/workflow-trigger.type.ts),
// which is not exported from searm-shared. The GraphQL argument is typed as
// arbitrary JSON server-side, so a structurally correct plain object works
// without importing that type.
export type WorkflowTriggerTemplate =
  | {
      type: 'DATABASE_EVENT';
      settings: { eventName: string; outputSchema: Record<string, never> };
    }
  | {
      type: 'CRON';
      settings: {
        outputSchema: Record<string, never>;
        type: 'MINUTES';
        schedule: { minute: number };
      };
    };

export type WorkflowStepTemplate = {
  // Real WorkflowAction fields (verified:
  // packages/searm-shared/src/workflow/schemas/base-workflow-action-schema.ts).
  // Only { type, name, settings } are required by
  // InstallWorkflowDefinitionInput — id, valid and nextStepIds are optional
  // and normalizeWorkflowTemplateSteps (Phase 4 Task 10, server-side)
  // generates any that are absent: id: uuidv4(), valid: true always, and
  // nextStepIds chained in array order with the last step terminating at
  // []. Supplying them explicitly is not required, but is not rejected or
  // overridden either — normalizeWorkflowTemplateSteps preserves an
  // explicitly authored id/nextStepIds, so a fixed UUID here follows the
  // same stable-identity convention as every other universalIdentifier in
  // this app without fighting the server's normalisation.
  id: string;
  // A WorkflowActionType value.
  type: string;
  name: string;
  valid: true;
  // Chains steps in execution order. Null marks the final step; preserved
  // as authored (not regenerated) by the server-side normalisation above.
  nextStepIds: string[] | null;
  settings: Record<string, unknown>;
};

export type WorkflowTemplate = {
  name: string;
  description?: string;
  trigger: WorkflowTriggerTemplate;
  // Executed in array order; the server chains them.
  steps: WorkflowStepTemplate[];
};

// One call into searm-server's WorkflowTemplateService.installDefinition,
// which owns workflow creation, step chaining, activation, and
// idempotency-by-name for both built-in templates and app-supplied ones.
// Copy this file unmodified into the next vertical app; only the template
// data objects change.
export const seedWorkflow = async (
  client: CoreApiClient,
  template: WorkflowTemplate,
): Promise<{ workflowId: string; workflowVersionId: string }> => {
  const result = await client.mutation({
    installWorkflowDefinition: {
      __args: {
        input: {
          name: template.name,
          description: template.description ?? null,
          trigger: {
            name: `${template.name} trigger`,
            type: template.trigger.type,
            settings: template.trigger.settings,
          },
          steps: template.steps,
          activate: true,
        },
      },
      workflowId: true,
      workflowVersionId: true,
    },
  });

  const installed = (
    result as {
      installWorkflowDefinition?: {
        workflowId: string;
        workflowVersionId: string;
      };
    }
  ).installWorkflowDefinition;

  if (!installed) {
    throw new Error(`Failed to install workflow "${template.name}".`);
  }

  return installed;
};
```

Note the step shape changed with the mutation: a step is the real `WorkflowAction` shape — `{ id, type, name, valid, nextStepIds, settings }` (verified against `base-workflow-action-schema.ts` above), not `{ stepType, defaultSettings }`. Update both template files in Steps 2–3 accordingly — each step object becomes:

```ts
      {
        id: '<fixed UUID for this step>',
        type: WorkflowActionType.AI_AGENT,
        name: 'Triage the ticket',
        valid: true,
        nextStepIds: null,
        settings: {
          outputSchema: {},
          errorHandlingOptions: {
            retryOnFailure: { value: false },
            continueOnFailure: { value: false },
          },
          input: { agentId: ..., prompt: ... },
        },
      },
```


- [ ] **Step 2: Write the "new ticket triage" template**

`agentId` in a workflow step's `settings.input` is read as an agent's row **id** at execution time (`packages/searm-server/src/modules/workflow/workflow-executor/workflow-actions/ai-agent/ai-agent.workflow-action.ts`: `agentRepository.findOne(workspaceId, { where: { id: agentId } })`) — not the manifest `universalIdentifier`. Rather than assume the two are equal, resolve the real row id unconditionally with a metadata query before building the template. Two clients are needed here, for two different reasons: `metadataClient` because `AgentResolver` is `@MetadataResolver()`-scoped (verified `packages/searm-server/src/engine/metadata-modules/ai/ai-agent/agent.resolver.ts:29`), `coreClient` because `installWorkflowDefinition` (inside `seedWorkflow`) is `@CoreResolver()`-scoped:

```ts
// customer-support/src/workflow-templates/new-ticket-triage.workflow-template.ts
import { type CoreApiClient } from 'searm-client-sdk/core';
import { type MetadataApiClient } from 'searm-client-sdk/metadata';
import { WorkflowActionType } from 'searm-shared/workflow';

import {
  NEW_TICKET_TRIAGE_STEP_UNIVERSAL_IDENTIFIER,
  SUPPORT_TRIAGE_AGENT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';
import { seedWorkflow } from 'src/utils/seed-workflow.util';

export const seedNewTicketTriageWorkflow = async (
  metadataClient: MetadataApiClient,
  coreClient: CoreApiClient,
): Promise<void> => {
  // The installed agent row's id is not guaranteed to equal its manifest
  // universalIdentifier — resolve it for real rather than assume they match.
  const { agents } = await metadataClient.query({
    agents: {
      __args: {
        filter: {
          universalIdentifier: { eq: SUPPORT_TRIAGE_AGENT_UNIVERSAL_IDENTIFIER },
        },
      },
      id: true,
    },
  });

  const agentId = agents[0]?.id;

  if (!agentId) {
    throw new Error(
      `Support triage agent (${SUPPORT_TRIAGE_AGENT_UNIVERSAL_IDENTIFIER}) not found — cannot seed the new-ticket-triage workflow.`,
    );
  }

  await seedWorkflow(coreClient, {
    name: 'New ticket triage',
    trigger: {
      type: 'DATABASE_EVENT',
      settings: { eventName: 'supportTicket.created', outputSchema: {} },
    },
    steps: [
      {
        id: NEW_TICKET_TRIAGE_STEP_UNIVERSAL_IDENTIFIER,
        type: WorkflowActionType.AI_AGENT,
        name: 'Triage the ticket',
        valid: true,
        nextStepIds: null,
        settings: {
          outputSchema: {},
          errorHandlingOptions: {
            retryOnFailure: { value: false },
            continueOnFailure: { value: false },
          },
          input: {
            agentId,
            prompt:
              'A new support ticket was just created: {{trigger.subject}} — {{trigger.description}}. Read it, its linked company and person, and propose a priority, a status of TRIAGED, and an aiTriageSummary.',
          },
        },
      },
    ],
  });
};
```

- [ ] **Step 3: Write the "SLA risk sweep" template**

Deliberately reuses the same `AI_AGENT` step shape as the first template rather than the unverified `FIND_RECORDS`/`ITERATOR` step chain — see "What was deliberately cut" for why a deterministic bulk-escalation workflow is not built in this phase:

```ts
// customer-support/src/workflow-templates/sla-risk-sweep.workflow-template.ts
import { type CoreApiClient } from 'searm-client-sdk/core';
import { type MetadataApiClient } from 'searm-client-sdk/metadata';
import { WorkflowActionType } from 'searm-shared/workflow';

import {
  SLA_RISK_SWEEP_STEP_UNIVERSAL_IDENTIFIER,
  SUPPORT_TRIAGE_AGENT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';
import { seedWorkflow } from 'src/utils/seed-workflow.util';

export const seedSlaRiskSweepWorkflow = async (
  metadataClient: MetadataApiClient,
  coreClient: CoreApiClient,
): Promise<void> => {
  // Same unconditional lookup as the triage workflow — do not assume the
  // installed agent row id equals its manifest universalIdentifier.
  const { agents } = await metadataClient.query({
    agents: {
      __args: {
        filter: {
          universalIdentifier: { eq: SUPPORT_TRIAGE_AGENT_UNIVERSAL_IDENTIFIER },
        },
      },
      id: true,
    },
  });

  const agentId = agents[0]?.id;

  if (!agentId) {
    throw new Error(
      `Support triage agent (${SUPPORT_TRIAGE_AGENT_UNIVERSAL_IDENTIFIER}) not found — cannot seed the SLA-risk-sweep workflow.`,
    );
  }

  await seedWorkflow(coreClient, {
    name: 'SLA risk sweep',
    trigger: {
      type: 'CRON',
      settings: { outputSchema: {}, type: 'MINUTES', schedule: { minute: 15 } },
    },
    steps: [
      {
        id: SLA_RISK_SWEEP_STEP_UNIVERSAL_IDENTIFIER,
        type: WorkflowActionType.AI_AGENT,
        name: 'Assess SLA risk',
        valid: true,
        nextStepIds: null,
        settings: {
          outputSchema: {},
          errorHandlingOptions: {
            retryOnFailure: { value: false },
            continueOnFailure: { value: false },
          },
          input: {
            agentId,
            prompt:
              'Find open support tickets (status not RESOLVED or CLOSED) whose slaResolutionDueAt has passed or is within 30 minutes. For each one, propose raising its priority to URGENT and add a note to aiTriageSummary explaining the SLA risk.',
          },
        },
      },
    ],
  });
};
```

- [ ] **Step 4: Write `post-install.ts`, wiring both workflow seeders (repair pass, I23 — moved here from Task 8 so no task-boundary commit is red)**

```ts
// customer-support/src/logic-functions/post-install.ts
import { CoreApiClient } from 'searm-client-sdk/core';
import { MetadataApiClient } from 'searm-client-sdk/metadata';
import { definePostInstallLogicFunction } from 'searm-sdk/define';
import { type InstallPayload } from 'searm-sdk/logic-function';

import { POST_INSTALL_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { seedNewTicketTriageWorkflow } from 'src/workflow-templates/new-ticket-triage.workflow-template';
import { seedSlaRiskSweepWorkflow } from 'src/workflow-templates/sla-risk-sweep.workflow-template';

const handler = async (payload: InstallPayload): Promise<void> => {
  // createSupportQueue and installWorkflowDefinition (called inside the two
  // seeders below) are both core-schema operations — one CoreApiClient
  // serves all three. See Task 9 Step 1's program-integration note for why
  // installWorkflowDefinition ended up on core, not metadata.
  const coreClient = new CoreApiClient();
  // metadataClient is still needed by the two seeders below, but only for
  // their agents lookup query (AgentResolver is @MetadataResolver()-scoped)
  // — unrelated to installWorkflowDefinition.
  const metadataClient = new MetadataApiClient();

  // Fresh install only — an upgrade re-runs post-install, and creating a
  // second default queue on every upgrade would be a bug, not a feature.
  if (payload.previousVersion) {
    console.log('Upgrade detected, skipping queue seed.', payload.previousVersion);
  } else {
    const { createSupportQueue } = await coreClient.mutation({
      createSupportQueue: {
        __args: {
          data: {
            name: 'General Support',
            description: 'Default queue for new tickets.',
            slaFirstResponseMinutes: 60,
            slaResolutionMinutes: 1440,
            isDefault: true,
          },
        },
        id: true,
        name: true,
      },
    });

    if (!createSupportQueue?.id) {
      throw new Error('Failed to seed the default support queue.');
    }

    console.log(`Seeded default queue "${createSupportQueue.name}" (${createSupportQueue.id}).`);
  }

  await seedNewTicketTriageWorkflow(metadataClient, coreClient);
  await seedSlaRiskSweepWorkflow(metadataClient, coreClient);
};

export default definePostInstallLogicFunction({
  universalIdentifier: POST_INSTALL_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'post-install',
  description: 'Seeds a default queue and the two workflow templates.',
  timeoutSeconds: 120,
  handler,
});
```

`createSupportQueue` follows the exact confirmed pattern in `packages/searm-apps/examples/hello-world/src/logic-functions/create-hello-world-company.ts` (`client.mutation({ createCompany: { __args: { data: {...} }, id: true, name: true } })`) — SeaRM's `CoreApiClient` names its generic-object mutations `create<PascalCaseObjectName>`, not `createOne<PascalCaseObjectName>`.

- [ ] **Step 5: Typecheck the whole package now that all imports resolve**

```bash
cd packages/searm-apps/public/customer-support
yarn typecheck
npx searm app build
```

Expected: no errors — every file this task and Task 8 wrote is present, so this is the first point at which the full package typechecks.

- [ ] **Step 6: Commit**

```bash
git add packages/searm-apps/public/customer-support/src/utils packages/searm-apps/public/customer-support/src/workflow-templates packages/searm-apps/public/customer-support/src/logic-functions/post-install.ts
git commit -m "feat(customer-support): seed workflow templates via existing workflow-builder API"
```

---

### Task 10: Support overview dashboard

**Files:**
- Create: `packages/searm-apps/public/customer-support/src/page-layouts/support-overview.page-layout.ts`

**Interfaces:**
- Consumes: `definePageLayout`, `PageLayoutType` from `searm-sdk/define`; `WidgetType` — imported from `searm-shared/types` the same way `NavigationMenuItemType` is (the `WidgetType` enum lives server-side at `packages/searm-server/src/engine/metadata-modules/page-layout-widget/enums/widget-type.enum.ts`; if it is not re-exported from `searm-shared/types`, use the string literal `'VIEW'` directly — the manifest type accepts `type: string`, verified in `packages/searm-shared/src/application/pageLayoutManifestType.ts`).
- Produces: one `DASHBOARD`-type page layout with two `VIEW`-configuration widgets.

- [ ] **Step 1: Write the dashboard**

`ViewConfiguration = { configurationType: 'VIEW' }` verified in full — `packages/searm-shared/src/types/page-layout/page-layout-widget-configuration.type.ts`, lines 89–91. A `VIEW` widget's `objectUniversalIdentifier` (top-level, sibling of `configuration`) selects which object's default view renders:

```ts
// customer-support/src/page-layouts/support-overview.page-layout.ts
import { definePageLayout, PageLayoutTabLayoutMode } from 'searm-sdk/define';

import {
  SUPPORT_OVERVIEW_KANBAN_WIDGET_UNIVERSAL_IDENTIFIER,
  SUPPORT_OVERVIEW_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
  SUPPORT_OVERVIEW_QUEUE_WIDGET_UNIVERSAL_IDENTIFIER,
  SUPPORT_OVERVIEW_TAB_UNIVERSAL_IDENTIFIER,
  SUPPORT_QUEUE_OBJECT_UNIVERSAL_IDENTIFIER,
  SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default definePageLayout({
  universalIdentifier: SUPPORT_OVERVIEW_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
  name: 'Support overview',
  type: 'DASHBOARD',
  tabs: [
    {
      universalIdentifier: SUPPORT_OVERVIEW_TAB_UNIVERSAL_IDENTIFIER,
      title: 'Overview',
      position: 0,
      icon: 'IconTicket',
      layoutMode: PageLayoutTabLayoutMode.CANVAS,
      widgets: [
        {
          universalIdentifier: SUPPORT_OVERVIEW_KANBAN_WIDGET_UNIVERSAL_IDENTIFIER,
          title: 'Tickets by status',
          type: 'VIEW',
          objectUniversalIdentifier: SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
          configuration: { configurationType: 'VIEW' },
          gridPosition: { row: 0, column: 0, rowSpan: 4, columnSpan: 8 },
        },
        {
          universalIdentifier: SUPPORT_OVERVIEW_QUEUE_WIDGET_UNIVERSAL_IDENTIFIER,
          title: 'Queues',
          type: 'VIEW',
          objectUniversalIdentifier: SUPPORT_QUEUE_OBJECT_UNIVERSAL_IDENTIFIER,
          configuration: { configurationType: 'VIEW' },
          gridPosition: { row: 4, column: 0, rowSpan: 3, columnSpan: 8 },
        },
      ],
    },
  ],
});
```

- [ ] **Step 2: Validate and commit**

```bash
cd packages/searm-apps/public/customer-support
yarn typecheck
npx searm app build
git add packages/searm-apps/public/customer-support/src/page-layouts
git commit -m "feat(customer-support): add support overview dashboard"
```

---

### Task 11: End-to-end proof — install, use, upgrade, uninstall

This task is the actual deliverable of the phase: it proves the vertical installs cleanly, is usable, survives an upgrade, and uninstalls without leaving CRM core data damaged.

**Files:**
- Create: `packages/searm-apps/public/customer-support/src/__tests__/app-install.integration-test.ts`
- Create: `packages/searm-apps/public/customer-support/src/__tests__/app-upgrade.integration-test.ts`

**Interfaces:**
- Consumes: `appBuild`, `appDeploy`, `appInstall`, `appUninstall` from `searm-sdk/cli`; `MetadataApiClient` from `searm-client-sdk/metadata`; `CoreApiClient` from `searm-client-sdk/core` (all verified real exports/usage, `packages/searm-apps/examples/hello-world/src/__tests__/app-install.integration-test.ts`, read in full).

- [ ] **Step 1: Write the install/uninstall test**

Pattern copied from `packages/searm-apps/examples/hello-world/src/__tests__/app-install.integration-test.ts`, extended with the assertions this plan's success criteria require:

```ts
// customer-support/src/__tests__/app-install.integration-test.ts
import { CoreApiClient } from 'searm-client-sdk/core';
import { MetadataApiClient } from 'searm-client-sdk/metadata';
import { appBuild, appDeploy, appInstall, appUninstall } from 'searm-sdk/cli';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  APPLICATION_UNIVERSAL_IDENTIFIER,
  SUPPORT_TRIAGE_AGENT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

const APP_PATH = process.cwd();

describe('Customer Support app installation', () => {
  beforeAll(async () => {
    const buildResult = await appBuild({ appPath: APP_PATH, tarball: true });

    if (!buildResult.success) {
      throw new Error(`Build failed: ${buildResult.error?.message ?? 'unknown'}`);
    }

    const deployResult = await appDeploy({
      tarballPath: buildResult.data.tarballPath!,
    });

    if (!deployResult.success) {
      throw new Error(`Deploy failed: ${deployResult.error?.message ?? 'unknown'}`);
    }

    const installResult = await appInstall({ appPath: APP_PATH });

    if (!installResult.success) {
      throw new Error(`Install failed: ${installResult.error?.message ?? 'unknown'}`);
    }
  });

  afterAll(async () => {
    const uninstallResult = await appUninstall({ appPath: APP_PATH });

    if (!uninstallResult.success) {
      console.warn(`Uninstall failed: ${uninstallResult.error?.message ?? 'unknown'}`);
    }
  });

  it('should find the installed app', async () => {
    const metadataClient = new MetadataApiClient();
    const result = await metadataClient.query({
      findManyApplications: { id: true, name: true, universalIdentifier: true },
    });

    const installed = result.findManyApplications.find(
      (application: { universalIdentifier: string }) =>
        application.universalIdentifier === APPLICATION_UNIVERSAL_IDENTIFIER,
    );

    expect(installed).toBeDefined();
  });

  it('should seed exactly one default queue on fresh install', async () => {
    const coreClient = new CoreApiClient();
    const result = await coreClient.query({
      supportQueues: { id: true, name: true, isDefault: true },
    });

    const defaultQueues = result.supportQueues.filter(
      (queue: { isDefault: boolean }) => queue.isDefault,
    );

    expect(defaultQueues).toHaveLength(1);
    expect(defaultQueues[0].name).toBe('General Support');
  });

  it('should let a support ticket be created and related to a company', async () => {
    const coreClient = new CoreApiClient();

    const { createCompany } = await coreClient.mutation({
      createCompany: { __args: { data: { name: 'Acme Corp' } }, id: true },
    });

    const { createSupportTicket } = await coreClient.mutation({
      createSupportTicket: {
        __args: {
          data: {
            subject: 'Cannot export report',
            description: 'Export button does nothing.',
            companyId: createCompany.id,
          },
        },
        id: true,
        subject: true,
        status: true,
      },
    });

    expect(createSupportTicket.status).toBe('NEW');

    const { supportTicket } = await coreClient.query({
      supportTicket: {
        __args: { filter: { id: { eq: createSupportTicket.id } } },
        id: true,
        company: { id: true, name: true },
      },
    });

    expect(supportTicket.company.name).toBe('Acme Corp');
  });

  it('should install both workflow templates as ACTIVE (repair pass, C12)', async () => {
    // Proves post-install's installWorkflowDefinition calls actually landed —
    // the failure mode C12 fixes (missing WORKFLOWS permission flag on the
    // app's service role) surfaces exactly here: both workflows silently
    // never install and this is the first place that would show it.
    // Workflow is a workspace-entity standard object (WorkflowWorkspaceEntity),
    // so this is an ordinary generic-object query on the core schema, same
    // as `companies` below — CoreApiClient, not MetadataApiClient.
    const coreClient = new CoreApiClient();
    const result = await coreClient.query({
      workflows: {
        __args: { filter: { name: { in: ['New ticket triage', 'SLA risk sweep'] } } },
        name: true,
        statuses: true,
      },
    });

    expect(result.workflows).toHaveLength(2);
    for (const workflow of result.workflows) {
      expect(workflow.statuses).toContain('ACTIVE');
    }
  });

  it("should give the support triage agent a usable role after install (repair pass, I24)", async () => {
    // Risk 4 in "Risks — not resolved by reading code" could not be closed by
    // reading code alone (Phase 4's agent-manifest install path isn't built
    // yet). This is the install-time fallback: if canBeAssignedToAgents were
    // insufficient, the agent would install with no role-target row and
    // silently lose every registry tool (Phase 2's risk section documents
    // this exact failure mode) — this assertion catches that directly.
    const metadataClient = new MetadataApiClient();
    const { agents } = await metadataClient.query({
      agents: {
        __args: {
          filter: {
            universalIdentifier: { eq: SUPPORT_TRIAGE_AGENT_UNIVERSAL_IDENTIFIER },
          },
        },
        id: true,
        roleId: true,
      },
    });

    expect(agents).toHaveLength(1);
    expect(agents[0].roleId).toBeTruthy();
  });

  it('should remove the ticket object and its relation field on uninstall, and leave Company untouched', async () => {
    const uninstallResult = await appUninstall({ appPath: APP_PATH });

    expect(uninstallResult.success).toBe(true);

    const metadataClient = new MetadataApiClient();
    const objects = await metadataClient.query({
      findManyObjectMetadataItems: { nameSingular: true },
    });

    const stillHasTicketObject = objects.findManyObjectMetadataItems.some(
      (object: { nameSingular: string }) => object.nameSingular === 'supportTicket',
    );

    expect(stillHasTicketObject).toBe(false);

    const coreClient = new CoreApiClient();
    const { companies } = await coreClient.query({
      companies: { __args: { filter: { name: { eq: 'Acme Corp' } } }, id: true },
    });

    expect(companies).toHaveLength(1);
  });
});
```

The exact GraphQL field names used here (`findManyObjectMetadataItems`, `companies`, `supportQueues`, `supportTicket`) are SeaRM's standard generic-object CRUD naming convention (plural query, `create<PascalCase>` mutation) inferred from `create-hello-world-company.ts`'s confirmed `createCompany` and this repo's broader convention — run this test against a real dev instance first and correct any field name that doesn't match before treating it as passing. The `workflows { statuses }` and `agents { roleId }` field names in the two repair-pass tests above have the same status: `AgentEntity`/its GraphQL DTO does not exist on disk yet (Phase 4/agent-manifest install code is unbuilt as of this repair pass — verified by its absence under `packages/searm-server/src/engine/metadata-modules/`), so the exact field name for "this agent's assigned role" could not be confirmed against a resolver. Confirm both field names against Phase 4's shipped `AgentDTO`/`WorkflowDTO` before this test is treated as passing.

- [ ] **Step 2: Run it**

```bash
cd packages/searm-apps/public/customer-support
npx searm login   # or the equivalent auth step your dev instance requires
yarn test src/__tests__/app-install.integration-test.ts
```

Expected: 6 passing tests against a running local SeaRM instance (the original 4 plus the two added by the repair pass: workflows installed and ACTIVE (C12), agent has a usable role (I24)). This requires a live server — it is not a unit test and does not run in a sandboxed CI step without one.

- [ ] **Step 3: Write the upgrade test**

Proves the "upgrade migration" bullet of the Phase 5 exit gate: bump the app version, add one new field, redeploy, call `upgradeApplication`, confirm the field exists and existing data survived.

```ts
// customer-support/src/__tests__/app-upgrade.integration-test.ts
import { MetadataApiClient } from 'searm-client-sdk/metadata';
import { appBuild, appDeploy, appInstall, appUninstall } from 'searm-sdk/cli';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const APP_PATH = process.cwd();

describe('Customer Support app upgrade', () => {
  beforeAll(async () => {
    const buildResult = await appBuild({ appPath: APP_PATH, tarball: true });

    if (!buildResult.success) {
      throw new Error(`Build failed: ${buildResult.error?.message ?? 'unknown'}`);
    }

    const deployResult = await appDeploy({
      tarballPath: buildResult.data.tarballPath!,
    });

    if (!deployResult.success) {
      throw new Error(`Deploy failed: ${deployResult.error?.message ?? 'unknown'}`);
    }

    const installResult = await appInstall({ appPath: APP_PATH });

    if (!installResult.success) {
      throw new Error(`Install failed: ${installResult.error?.message ?? 'unknown'}`);
    }
  });

  afterAll(async () => {
    await appUninstall({ appPath: APP_PATH });
  });

  it('should report the installed version matches package.json', async () => {
    // Reads package.json's own version rather than hardcoding it, so this
    // test does not need editing every time the app version bumps.
    const packageJson = await import('../../package.json');
    const metadataClient = new MetadataApiClient();

    const result = await metadataClient.query({
      findManyApplications: { name: true, version: true },
    });

    const installed = result.findManyApplications.find(
      (application: { name: string }) => application.name === 'Customer Support',
    );

    expect(installed?.version).toBe(packageJson.version);
  });
});
```

This is intentionally thin: it proves the version-reporting half of upgrade behavior against the always-current package version, rather than hand-simulating a version bump inside the test (which would require checking out two different manifest states mid-test-run — not worth the complexity this phase). A real upgrade rehearsal — bump `package.json`'s version, add a field to `support-ticket.object.ts`, rebuild, redeploy, call the `upgradeApplication` mutation with the new `targetVersion`, and confirm the field appears without disturbing existing ticket rows — should be run manually once before this vertical ships, using the exact steps above, and is the way to validate any future version bump.

- [ ] **Step 4: Commit**

```bash
git add packages/searm-apps/public/customer-support/src/__tests__
git commit -m "test(customer-support): install, use, and uninstall the app end to end"
```

---

## Success criteria — mapped to the Phase 5 exit gate

| Charter requirement (Phase 5 exit gate + five contracts) | Proven by |
| --- | --- |
| "A new industry composes standard objects, relations, views, workflow templates, and agent policies" | Tasks 2–10 build exactly that list for customer support |
| "...without changing the CRM core" | No file under `packages/searm-server/`, `packages/searm-front/`, or `packages/searm-shared/` is touched anywhere in this plan — Task 4's Global Constraints callout and Task 11's uninstall assertion both verify it |
| Objects | Tasks 2–3 (`supportQueue`, `supportTicket`) |
| Views | Task 5 (table, Kanban, queue overview) |
| Dashboards | Task 10 |
| Workflows | Task 9 (two seeded templates) |
| Permissions | Task 6 (`support-agent.role.ts`, object + field permissions) |
| Agent instructions | Task 7 (`support-triage-agent.ts` + `support-triage-skill.ts`) |
| Seed data | Task 8 Step 3 (default queue) |
| Upgrade migration | Task 11 Step 3, plus the manual rehearsal it documents |
| Uninstall | Task 11 Step 1, fourth test |
| Record contract — every action uses SeaRM objects/fields/relations/permissions | All fields in Tasks 2–4 are ordinary metadata fields; the agent's role in Task 6 is an ordinary permission role |
| Proposal contract — AI changes are visible diffs requiring approval | Every write the triage agent makes (Task 7, Task 9) executes through `AgentAsyncExecutorService.executeAgent` → `ToolExecutorService.dispatch()` → Launch 1's `ProposalGateService`, unmodified by this plan |
| Principal contract — audit distinguishes agent from user/workflow | The agent's `AgentEntity` row and its bound role (Task 6, Task 7) are what Launch 1's `createdByActor: ActorMetadata` capture already carries through to the proposal — this plan supplies the agent identity, not a new audit mechanism |
| Custom objects are the only extension mechanism for business-specific records | Tasks 2–3; Task 4's relation fields are pointers only, never business-data fields, on standard objects |

## Acceptance narratives this phase advances

- **Pipeline and follow-up**, step 1 ("stage change... triggers a workflow") → Task 9's "New ticket triage" workflow, triggered on `supportTicket.created`.
- **Pipeline and follow-up**, step 3 ("creates tasks or a proposal with evidence and a suggested next action") → Task 9's "SLA risk sweep" workflow proposes an escalation with reasoning in `aiTriageSummary`.
- **Pipeline and follow-up**, step 4 ("the user approves outbound communication") and step 6 ("audit history records user, workflow, agent... approval") → inherited unmodified from Launch 1, exercised for the first time by a non-core object in Task 11.
- This phase does not advance "lead to qualified opportunity," "inbox and meeting intelligence," or "data import and quality" — those are Phase 2–4 concerns (evidence, ingestion, import) that a vertical app consumes once built, not something a vertical app itself builds. No task in this plan claims to.

## What was deliberately cut

| Cut | Why | Trigger to build it |
| --- | --- | --- |
| A declarative `*.workflow.ts` manifest unit + `application-manifest` converter for workflows — the app instead installs workflows via Phase 4's `installWorkflowDefinition` mutation | Would require a `searm-shared` type, a `searm-server` converter, and a workspace-migration builder change — a core-code change this plan's constraints forbid, for a capability the existing public GraphQL API already provides. (Repair pass, N8: this row previously appeared twice, once marked "(restated)" — collapsed into one.) | A third vertical needs workflow templates and the one-call `seed-workflow.util.ts` pattern has caused an install-time bug twice, or an app author outside this team asks for it |
| The app's `pre-install` logic function (no-op validation hook) | Cut by the program review: it validated nothing, and an empty hook is a file, a UUID, and an install-time round trip bought on speculation | The app needs to refuse installation on a real precondition — a conflicting object name, an incompatible SeaRM version, a missing connected account |
| A dedicated `supportTicketComment` object | SeaRM's built-in Notes/Tasks already attach to any record via polymorphic `NoteTarget`/`TaskTarget` relations — a second, ticket-specific comment object would duplicate that for no new capability | Support reps need comment-specific fields (internal-vs-customer-visible flag, macro/canned-response linkage) that generic Notes cannot express |
| `FIND_RECORDS` + `ITERATOR` bulk SLA-breach workflow (deterministic, non-AI escalation for every breaching ticket in one cron tick) | The exact `ITERATOR`/`FIND_RECORDS` step settings shape was not independently verified against a resolver or converter file in this research pass, unlike every other step type this plan uses; shipping an unverified shape in a plan meant for literal transcription is worse than shipping a verified, slightly less powerful alternative | SLA escalation needs to run even when AI credits are exhausted or the triage agent is disabled — deterministic bulk escalation becomes a hard requirement, not a nice-to-have |
| Row-level permission predicates (e.g., "a rep only sees tickets in their own queue") | `support-agent.role.ts` ships with object/field-level permissions only; row-level predicates are a real, already-supported manifest capability (`row-level-permission-predicate(-group)` converters exist) this plan simply doesn't need for a first vertical | A customer asks for queue-scoped visibility between reps |
| A purpose-built ticket console front component (SLA countdown timers, macro buttons, etc.) | Task 10's dashboard and Task 5's views use only the framework's stock `VIEW`/table/Kanban widgets — a custom `*.front-component.tsx` is real, supported (see `hello-world`'s `front-components/hello-world.tsx`), and unnecessary for proving the framework | Reps ask for a purpose-built console beyond what generic record views and a Kanban board provide |
| Multi-channel ticket ingestion (auto-creating tickets from inbound email/chat) | This is Phase 3's ingestion-and-evidence pipeline's job (`modules/messaging`, `contact-creation-manager`), not the app framework's — a vertical app consumes that pipeline once it exists, it does not rebuild it | Phase 3 ships email→record creation; wire a ticket-creation logic function or workflow trigger to it then |
| SLA business-hours calendars (holidays, working hours, timezones) | `slaFirstResponseMinutes`/`slaResolutionMinutes` are naive elapsed-time counters in this plan — real SLA contracts often require business-hours-only counting, which is a meaningfully bigger feature (holiday calendars, per-workspace business hours) | A customer's SLA contract requires business-hours-only counting |
| CSAT / customer satisfaction survey object and workflow | No inventoried requirement asked for it; adding it now would be speculative scope for a "prove the framework" phase | A paying support-vertical customer asks for it |
| Publishing to the app marketplace (`appPublish`) | Distinct go-to-market decision (pricing, review, listing copy), unrelated to proving the framework | Go-to-market decides to list verticals in the marketplace |
| The second, third, and later vertical waves (target-account campaigns, fundraising/nonprofit, events, real estate, partner management) | Explicitly out of scope for this phase per the phase brief ("Plan ONE vertical") | Each ships in its own phase, reusing `seed-workflow.util.ts` and this plan's file layout as the template |

## Risks — not resolved by reading code

- ~~**The exact mutation/query names for creating a `Workflow` record and reaching its first draft `WorkflowVersion` id**~~ — **closed by the program review.** Task 9 no longer creates workflows itself; it calls Phase 4 Task 10's `installWorkflowDefinition` mutation, backed by `WorkflowTemplateService`, which uses the verified `create_complete_workflow` service path (`RecordPositionService`, `WorkflowVersionCoreSyncService`, `WorkflowTriggerWorkspaceService`) and targets the workspace-object `WorkflowWorkspaceEntity` path explicitly. The core-vs-workspace-entity ambiguity is resolved there, once, with unit tests — not in an app package. **New dependency introduced by this resolution: Phase 4 Task 10 must ship before Phase 5's post-install hook runs.**
- ~~**Whether `STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS` exports a `workspaceMember` key**~~ — **closed (repair pass, N7).** Confirmed present: `packages/searm-shared/src/metadata/constants/standard-object-universal-identifiers.constant.ts:26`, re-exported unchanged through `packages/searm-sdk/src/sdk/define/objects/standard-object-ids.ts`. Task 4 no longer carries a fallback note.
- **Whether `WidgetType` is re-exported from `searm-shared/types`** (it is defined server-side at `packages/searm-server/src/engine/metadata-modules/page-layout-widget/enums/widget-type.enum.ts`) was not confirmed; Task 10 falls back to the string literal `'VIEW'`, which the manifest type accepts either way (`type: string` on `PageLayoutWidgetManifest`), so this risk has no blocking effect on the task, only a minor loss of type-checking.
- **Whether `canBeAssignedToAgents: true` on a role is sufficient, on its own, for the install-time server-side validator to accept that role as an agent's `roleUniversalIdentifier`.** **Repair pass (I24):** re-checked against `application-manifest/services/compute-application-manifest-all-universal-flat-entity-maps.service.ts` and `application-manifest/converters/from-agent-manifest-to-universal-flat-role-target.util.ts` (the converter that turns a `defineAgent`'s `roleUniversalIdentifier` into a `UniversalFlatRoleTarget` row) — neither file reads or checks `canBeAssignedToAgents`; the converter builds the role-target row unconditionally from whatever `roleUniversalIdentifier` the agent manifest supplies. This is consistent with, but does not prove, "any role works regardless of the flag" — the flag could still be enforced by a manifest-sync validation pass not reached by this search, and Phase 4 (which owns agent-manifest install code) has not shipped yet to test against directly. **Still unresolved. Fallback applied per the review's suggested fix:** Task 11 gains an install-time assertion (see Task 11 Step 1) that the agent's role-target row exists after install, so a silent "agent installed with no usable role" failure is caught by the exit-gate test even if the underlying question stays open.
- **Whether an app-owned custom object's records survive or are hard-deleted on uninstall**, and whether records in SeaRM's built-in Notes/Tasks that were attached to a since-deleted `supportTicket` record become orphaned `NoteTarget`/`TaskTarget` rows or are cleaned up automatically, was inferred from `ApplicationSyncService.uninstallApplication`'s behavior (tears down all app-owned metadata via `getApplicationSubAllFlatEntityMaps`) rather than traced through to the workspace-schema table-drop and its cascade behavior. Task 11's uninstall test checks that the object itself disappears and that unrelated `Company` data survives, but does not check for orphaned Note/Task rows — worth adding an explicit assertion for once a real instance is available to observe the actual behavior.
