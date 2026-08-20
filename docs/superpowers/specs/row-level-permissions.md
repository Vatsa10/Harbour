# Row-Level Permissions ("Record Scope") — Implementation Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax for tracking. Every task is TDD: write the assertion first, watch it fail for the stated reason, then make it pass.

**Goal:** a role can be restricted to a subset of an object's *rows* — "this user sees only opportunities they own", "this role sees only records for the EMEA region" — enforced in the ORM on every read and write, and respected by the AI proposal gate on both sides of an approval.

**Architecture:** each `(role, object)` pair may carry zero or more **record scope rules**. A rule is a boolean expression tree over that object's own columns, whose leaves compare a column against either a literal or a closed set of *principal attributes* (`workspaceMemberId`, `userWorkspaceId`, `userId`). Rules are compiled — per request, from the already-cached `ObjectsPermissions` — into a single `CompiledRecordScope`, and that one value drives three evaluators: a parameterised SQL `WHERE` fragment for the query builders, an in-memory predicate for post-image write validation and subscription fan-out, and a `RecordGqlOperationFilter` for the subscription path that already speaks that language. Nothing else in the engine learns what a rule is.

**Tech stack:** NestJS 10, TypeORM, PostgreSQL 16, GraphQL (code-first, metadata schema), React 18 + Jotai + Linaria, Jest.

**Working directory for all paths below:** `d:\Files\Vatsa\Projects\AI-CRM\twenty`

**Depends on:** `.superpowers/sdd/enterprise-rewrite/enterprise-audit.md` Cluster 2, and on Cluster 1 having already removed the billing/entitlement imports from the row-level-permission module (the audit's sequencing step 3). This spec assumes no entitlement check exists and does not port one — record scoping is a security control, and on a self-hostable product a security control never sits behind a license key.

---

## 0. Provenance — read this before writing a line

Twenty's row-level permission cluster (43 files) is `@license Enterprise`. **No file in this spec was derived from it.** The model below was designed from the textbook predicate/row-level-access-control pattern and from the AGPL half of Twenty's own permission system, all of which was read directly:

| Read (AGPL) | What it fixed in this design |
| --- | --- |
| `src/engine/twenty-orm/types/role-permission-config.ts` | The three-way `RolePermissionConfig` is the only authorization principal shape; scope composition must be defined for each arm of it |
| `src/engine/twenty-orm/utils/get-objects-permissions-from-role-permission-config.util.ts` | Bypass returns `{}`; a missing role must deny, not widen |
| `src/engine/twenty-orm/utils/resolve-role-permission-config.util.ts` | `{ shouldBypassPermissionChecks: true }` is emitted **only** for `authContext.type === 'system'` |
| `src/engine/twenty-orm/utils/compute-permission-intersection.util.ts` | Existing intersection is unsound for row scope (§2.4); this spec replaces it |
| `src/engine/metadata-modules/role/services/workspace-roles-permissions-cache.service.ts` | Rules load per workspace into `ObjectsPermissions`, alongside `restrictedFields` — same cache, same shape |
| `src/engine/twenty-orm/repository/permissions.utils.ts` | Object/field checks throw `PermissionsException(PERMISSION_DENIED)`; scope denials must be indistinguishable from them at the API boundary |
| `src/engine/twenty-orm/entity-manager/workspace-entity-manager.ts:139-195` | The single place a `RolePermissionConfig` becomes an `ObjectsPermissions` |
| `src/engine/twenty-orm/utils/get-field-metadata-id-to-column-names-map.util.ts` | `Map<fieldMetadataId, string[]>` — a scope subject must resolve to **exactly one** column |
| `src/engine/metadata-modules/ai/ai-write-approval/services/proposal-gate.service.ts` and `proposal-execution.service.ts` | The whole of §5 |

Naming, file layout, storage shape, composition algebra and the write-side guard are all different from the enterprise cluster by construction, and §1.6 records *why* each departure is the better fit for our product rather than merely a different one.

---

## 1. The predicate model

### 1.1 Definitions

- **Record scope rule** — one row in `core."recordScopeRule"`, binding `(roleId, objectMetadataId)` to a boolean **expression**.
- **Expression** — a tree. Internal nodes are `and` / `or` / `not`; leaves are **comparisons**.
- **Comparison** — `<column of this object> <operator> <value>`.
- **Value** — either a literal (or literal list) supplied by the admin, or a **principal attribute** resolved per request.
- **Principal** — the identity the query runs as, derived from `WorkspaceAuthContext`, never from client input.
- **Compiled scope** — the single `CompiledRecordScope` produced for one `(RolePermissionConfig, objectMetadataId)` pair. One of `unrestricted`, `denyAll`, or `expression`.

Three properties are non-negotiable and each has a test that pins it:

1. **Closure.** A comparison may only reference a column of the object being scoped. No joins, no subqueries, no cross-object references. This is what makes a scope safe to append to *any* query on that object — main alias, joined relation, subquery, `RETURNING` guard — without the shape of the surrounding query mattering.
2. **No free text reaches SQL.** Column names come from `getFieldMetadataIdToColumnNamesMap`; values are always bound parameters. A rule is data, never a fragment.
3. **Unresolvable ⇒ the whole rule is false.** Not the node — the rule (§1.5). Node-level falsity would let a `not` invert a missing principal into a grant.

### 1.2 Types (`twenty-shared`)

New files under `packages/twenty-shared/src/types/`, exported from the types barrel exactly as `ObjectPermissions.ts` is.

`RecordScopePrincipalAttribute.ts`:

```ts
// The closed set of request-time values a rule may compare against. Closed on
// purpose: anything open-ended here becomes an injection surface, and anything
// derived from client input becomes a privilege-escalation surface.
export const RECORD_SCOPE_PRINCIPAL_ATTRIBUTES = [
  'workspaceMemberId',
  'userWorkspaceId',
  'userId',
] as const;

export type RecordScopePrincipalAttribute =
  (typeof RECORD_SCOPE_PRINCIPAL_ATTRIBUTES)[number];
```

`RecordScopeOperator.ts`:

```ts
export const RECORD_SCOPE_OPERATORS = [
  'eq',
  'neq',
  'in',
  'notIn',
  'isNull',
  'isNotNull',
] as const;

export type RecordScopeOperator = (typeof RECORD_SCOPE_OPERATORS)[number];
```

`RecordScopeNode.ts`:

```ts
import { type RecordScopeOperator } from './RecordScopeOperator';
import { type RecordScopePrincipalAttribute } from './RecordScopePrincipalAttribute';

export type RecordScopeLiteral = string | number | boolean | null;

export type RecordScopeValue =
  | { source: 'literal'; value: RecordScopeLiteral }
  | { source: 'literalList'; values: RecordScopeLiteral[] }
  | { source: 'principal'; attribute: RecordScopePrincipalAttribute };

export type RecordScopeComparisonNode = {
  type: 'comparison';
  // Always a field of the object the rule is attached to. Enforced at write
  // time by the validator and again at compile time by column resolution.
  fieldMetadataId: string;
  operator: RecordScopeOperator;
  // Absent for isNull / isNotNull.
  value?: RecordScopeValue;
};

export type RecordScopeGroupNode = {
  type: 'group';
  operator: 'and' | 'or';
  children: RecordScopeNode[];
};

export type RecordScopeNotNode = {
  type: 'not';
  child: RecordScopeNode;
};

export type RecordScopeNode =
  | RecordScopeComparisonNode
  | RecordScopeGroupNode
  | RecordScopeNotNode;
```

`RecordScopeRule.ts`:

```ts
import { type RecordScopeNode } from './RecordScopeNode';

// The cache-facing projection of one recordScopeRule row. The entity carries
// more (timestamps, universalIdentifier); the hot path needs only this.
export type RecordScopeRule = {
  id: string;
  roleId: string;
  objectMetadataId: string;
  expression: RecordScopeNode;
};
```

`ObjectPermissions.ts` (AGPL, **modified**) drops the two enterprise arrays and gains one:

```ts
import { type RecordScopeRule } from './RecordScopeRule';
import { type RestrictedFieldsPermissions } from './RestrictedFieldsPermissions';

export type ObjectPermissions = {
  canReadObjectRecords: boolean;
  canUpdateObjectRecords: boolean;
  canSoftDeleteObjectRecords: boolean;
  canDestroyObjectRecords: boolean;
  restrictedFields: RestrictedFieldsPermissions;
  recordScopeRules: RecordScopeRule[];
};
```

### 1.3 Storage

One table, one JSONB column. `packages/twenty-server/src/engine/metadata-modules/record-scope/entities/record-scope-rule.entity.ts`:

```ts
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

import { type RecordScopeNode } from 'twenty-shared/types';

import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';

@Entity('recordScopeRule')
@Index('IDX_RECORD_SCOPE_RULE_WORKSPACE_ID_ROLE_ID', ['workspaceId', 'roleId'])
@Unique('UQ_RECORD_SCOPE_RULE_UNIVERSAL_IDENTIFIER', [
  'workspaceId',
  'universalIdentifier',
])
export class RecordScopeRuleEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: false, type: 'uuid' })
  workspaceId: string;

  @Column({ nullable: false, type: 'uuid' })
  universalIdentifier: string;

  @Column({ nullable: false, type: 'uuid' })
  roleId: string;

  @ManyToOne(() => RoleEntity, (role) => role.recordScopeRules, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'roleId' })
  role: Relation<RoleEntity>;

  @Column({ nullable: false, type: 'uuid' })
  objectMetadataId: string;

  @ManyToOne(() => ObjectMetadataEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'objectMetadataId' })
  objectMetadata: Relation<ObjectMetadataEntity>;

  // Admin-facing name, e.g. "Own opportunities". Shown in settings and in the
  // denial message, so an admin can find the rule that blocked something.
  @Column({ nullable: false, type: 'varchar' })
  label: string;

  // The whole boolean tree as one value. A rule is not a graph of rows.
  @Column({ nullable: false, type: 'jsonb' })
  expression: RecordScopeNode;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt: Date | null;
}
```

Registration is automatic — `core.datasource.ts` globs `engine/metadata-modules/**/*.entity.{ts,js}`. Do **not** add it to a registry list. The physical table ships as an instance command, not a TypeORM migration (§Task 3).

### 1.4 Compiled form

`packages/twenty-server/src/engine/twenty-orm/record-scope/types/compiled-record-scope.type.ts`:

```ts
import { type RecordScopeNode } from 'twenty-shared/types';

// A tagged result rather than `RecordScopeNode | null`, because "no rules" and
// "rules that can never match" are opposite answers and a nullable return
// makes them one keystroke apart at every call site.
export type CompiledRecordScope =
  | { kind: 'unrestricted' }
  | { kind: 'denyAll' }
  | { kind: 'expression'; node: RecordScopeNode };

export const RECORD_SCOPE_UNRESTRICTED: CompiledRecordScope = {
  kind: 'unrestricted',
};
export const RECORD_SCOPE_DENY_ALL: CompiledRecordScope = { kind: 'denyAll' };
```

### 1.5 The principal

`packages/twenty-server/src/engine/twenty-orm/record-scope/types/record-scope-principal.type.ts`:

```ts
import { type RecordScopePrincipalAttribute } from 'twenty-shared/types';

export type RecordScopePrincipal = Partial<
  Record<RecordScopePrincipalAttribute, string>
>;
```

Resolution, from `WorkspaceAuthContext` only:

| `authContext.type` | `workspaceMemberId` | `userWorkspaceId` | `userId` |
| --- | --- | --- | --- |
| `user` | `authContext.workspaceMemberId` | `authContext.userWorkspaceId` | `authContext.user.id` |
| `pendingActivationUser` | — | `authContext.userWorkspaceId` | `authContext.user.id` |
| `apiKey` | — | — | — |
| `application` | — | — | — |
| `system` | — | — | — (never reached: bypass short-circuits first) |

**The unresolvable rule.** If any comparison in a rule's tree references a principal attribute that the principal does not carry, that entire rule compiles to `false` and is dropped from the role's `or` set. It is *not* compiled node-by-node. Rationale, stated once and tested once:

```
rule = not(ownerId eq principal.workspaceMemberId)
```

Under node-level falsity, an API key (no `workspaceMemberId`) gets `not(false) = true` — total access, from a rule whose author meant to *exclude* their own records. Under rule-level falsity the API key gets nothing from this rule, which is the safe reading of "this rule is about a human and there is no human".

Consequence, and it must be documented in the settings UI: **an API key or application principal sees no rows on any object whose role carries a principal-parameterised rule.** That is intentional. If a workspace wants an API key to have broad access, it gets a role with no scope rules.

### 1.6 Departures from Twenty's enterprise design, and why

| Their shape (from the audit, not from reading) | Ours | Why ours fits SeaRM |
| --- | --- | --- |
| Two entities — predicate rows plus predicate-group rows composing them | One entity, one JSONB expression | A boolean tree is a *value*. Modelling it as rows drags in flat maps, group maps, four create/update/delete migration action handlers, validators and action builders — 18 of the cluster's 43 files exist only to keep a tree in normal form. We pay a JSON validator instead. |
| Enterprise-gated by `BillingEntitlementKey` | No gate | Charter: "Cloud and self-hosted ship from the same codebase… never become a dependency of self-hosting." A tenancy control cannot be a paid add-on in an open-source CRM. |
| Predicates carry a `fieldMetadataId` used by the insert guard to *exempt* scope fields from field-permission checks | No exemption; scope fields obey field permissions | The exemption exists so a user can set a field they cannot otherwise write, in order to satisfy their own scope. That is a hole: it lets a caller write any value into a field they were denied, as long as a rule mentions it. We instead require the *post-image* to satisfy the scope (§3.4) and leave field permissions alone. |
| Predicate arrays intersected by field-overlap when several roles apply | Per-role scopes ANDed as whole expressions | §2.4. |
| Postgres RLS groundwork in migrations | Application-level only | Postgres RLS needs a per-request `SET LOCAL` on a pooled connection, which is a correctness hazard under TypeORM's pooling and gives us nothing the query builder cannot. Cut, with a trigger recorded in §8. |

---

## 2. Composition

Four levels, innermost first. Each has its own test block in Task 5.

### 2.1 Within a rule — the tree

Ordinary boolean logic, three-valued at the SQL edge only. `and` over zero children is `true`; `or` over zero children is `false`. The validator (Task 4) rejects empty groups at write time, so the compiler's handling of them is defence in depth, not a supported input.

### 2.2 Within one `(role, object)` — rules OR together

A rule is a **grant**. A role with `Own opportunities` and `EMEA opportunities` sees the union. Adding a rule can only widen; removing one can only narrow. This is the property that makes the settings UI comprehensible, and it is the opposite of a filter stack, so it must be stated in the UI copy.

- Zero rules ⇒ `unrestricted`. Not `denyAll`: the object permission has already decided *whether* the role touches this object; a scope decides *which rows*, and silence means all of them.
- All rules unresolvable ⇒ `denyAll`, not `unrestricted`. A role that *has* scope rules and cannot evaluate any of them must not fall open.

### 2.3 `{ unionOf: [roleIds] }` — scopes OR together

Union of roles is union of grants. A role contributing `unrestricted` makes the union `unrestricted` — correct: one of your roles genuinely does grant every row.

### 2.4 `{ intersectionOf: [roleIds] }` — scopes AND together

Intersection of roles is intersection of grants, so a *deny* from any bound survives. A role contributing `unrestricted` contributes `true` and therefore does not widen. A role id present in the config but absent from `rolesPermissions` contributes `denyAll`, matching `getObjectsPermissionsFromRolePermissionConfig`'s existing "an unresolvable bound denies" behaviour at `workspace-entity-manager.ts:179`.

**This replaces `computePermissionIntersection`'s current row-level behaviour, which is unsound.** Today (AGPL, `compute-permission-intersection.util.ts:10-26`) intersection keeps the *first* role's predicates, filtered to those whose `fieldMetadataId` every other role also constrains, and hard-codes `rowLevelPermissionPredicateGroups: []`. Two consequences:

- Role A restricted to `ownerId = me`, role B restricted to `region = 'EMEA'`: no field is constrained by both, so **every predicate is dropped and the intersection is unrestricted** — strictly more access than either role alone.
- Any grouped (`or`) composition is discarded outright by the `[]`.

The fix is not a patch to that filter; it is that predicates from different roles are not comparable objects to be intersected element-wise. Each role compiles to one expression, and expressions AND. Task 5 Step 2 is exactly this regression, written first as a failing test.

### 2.5 `{ shouldBypassPermissionChecks: true }`

`unrestricted`, unconditionally, and short-circuited before any rule is read. See §4.

### 2.6 Truth table

| Config | Role A scope | Role B scope | Result |
| --- | --- | --- | --- |
| bypass | anything | anything | `unrestricted` |
| `unionOf: [A]` | none | — | `unrestricted` |
| `unionOf: [A]` | `owner=me` | — | `expression(owner=me)` |
| `unionOf: [A,B]` | `owner=me` | none | `unrestricted` |
| `unionOf: [A,B]` | `owner=me` | `region=EMEA` | `expression(or(owner=me, region=EMEA))` |
| `intersectionOf: [A,B]` | `owner=me` | none | `expression(owner=me)` |
| `intersectionOf: [A,B]` | `owner=me` | `region=EMEA` | `expression(and(owner=me, region=EMEA))` |
| `intersectionOf: [A,B]` | `owner=me` | *role missing* | `denyAll` |
| `unionOf: [A]` | `owner=me`, principal has no `workspaceMemberId` | — | `denyAll` |
| `intersectionOf: [A,B]` | `owner=me`, no principal | none | `denyAll` |

---

## 3. Where evaluation hooks in

Every hook point already exists in AGPL code and already calls an enterprise util. The rewrite substitutes ours at the same line. Nothing new is inserted into the hot path.

| # | AGPL file | Line (HEAD) | Today | Becomes |
| --- | --- | --- | --- | --- |
| 1 | `twenty-orm/repository/workspace-select-query-builder.ts` | 407 `applyRowLevelPermissionPredicates()` | `applyRowLevelPermissionPredicates({...})` | `applyRecordScopeToQueryBuilder({...})` |
| 2 | same | 434 `applyRowLevelPermissionPredicatesToJoinedRelations()` | resolve → render → `AND` into `joinAttribute.condition` | same flow, `compileRecordScope` → `renderRecordScopeToSql` |
| 3 | same | 387 public `applyRowLevelPermissionPredicatesToMainAliasAndJoinedRelations()` | called by 3 outside files | renamed `applyRecordScopeToMainAliasAndJoins()` |
| 4 | `twenty-orm/repository/workspace-update-query-builder.ts` | 634 | `applyRowLevelPermissionPredicates` | `applyRecordScopeToQueryBuilder` (narrows the `WHERE`) |
| 5 | same | 661 | `validateRLSPredicatesForRecords({ records: updatedRecordsFormatted, … })` | `assertRecordsWithinRecordScope({ records, … })` — post-image guard |
| 6 | `twenty-orm/repository/workspace-insert-query-builder.ts` | 339 | `validateRLSPredicatesForRecords({ records: valuesToInsertFormatted, … })` | `assertRecordsWithinRecordScope` |
| 7 | `twenty-orm/repository/workspace-delete-query-builder.ts` | 182 | `applyRowLevelPermissionPredicates({ queryBuilder: this as unknown as WorkspaceSelectQueryBuilder<T>, … })` | `applyRecordScopeToQueryBuilder` |
| 8 | `twenty-orm/repository/workspace-soft-delete-query-builder.ts` | 211 | same | same |
| 9 | `api/common/common-nested-relations-processor/process-nested-relations-v2.helper.ts` | 510 | calls #3 | call renamed method |
| 10 | `api/common/common-query-runners/utils/build-mutation-query-builder.util.ts` | 46 | calls #3 | call renamed method |
| 11 | `api/graphql/graphql-query-runner/group-by/services/group-by-with-records.service.ts` | 203 | calls #3 | call renamed method |
| 12 | `subscriptions/object-record-event/object-record-event-publisher.ts` | 411-436 `buildSubscriberRLSFilter` | `buildRowLevelPermissionRecordFilter(...)` | `buildRecordScopeGqlFilter(...)` |
| 13 | `metadata-modules/role/services/workspace-roles-permissions-cache.service.ts` | 53-56, 80-85, 104-113, 234-243 | two repositories, two arrays | one repository, one `recordScopeRules` array |
| 14 | `twenty-orm/utils/compute-permission-intersection.util.ts` | 10-26, 117-120 | field-overlap predicate filter | `recordScopeRules: [...a, ...b]` is **wrong** — see Task 5 Step 4 |
| 15 | `twenty-orm/interfaces/workspace-internal-context.interface.ts` | 18-19 | two flat map fields | both deleted; the cache-derived `ObjectsPermissions` already carries the rules |

Hook #15 is the structural win: the enterprise design threads two extra flat-map tables through `WorkspaceInternalContext` — i.e. through every repository, every query builder and every ORM manager — because predicates live in their own normalised store. Ours ride in `ObjectsPermissions`, which the query builders already hold as `this.objectRecordsPermissions`. Two fields leave the interface and nothing replaces them.

### 3.1 The single enforcement entry point

`packages/twenty-server/src/engine/twenty-orm/record-scope/apply-record-scope-to-query-builder.util.ts`:

```ts
import { isDefined } from 'twenty-shared/utils';
import { Brackets, type SelectQueryBuilder } from 'typeorm';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type FlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/types/flat-entity-maps.type';
import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type ObjectsPermissions } from 'twenty-shared/types';
import { compileRecordScope } from 'src/engine/twenty-orm/record-scope/compile-record-scope.util';
import { renderRecordScopeToSql } from 'src/engine/twenty-orm/record-scope/render-record-scope-to-sql.util';
import { resolveRecordScopePrincipal } from 'src/engine/twenty-orm/record-scope/resolve-record-scope-principal.util';

export const applyRecordScopeToQueryBuilder = ({
  queryBuilder,
  objectMetadata,
  objectsPermissions,
  authContext,
  flatFieldMetadataMaps,
  shouldBypassPermissionChecks,
}: {
  queryBuilder: SelectQueryBuilder<never>;
  objectMetadata: FlatObjectMetadata;
  objectsPermissions: ObjectsPermissions;
  authContext: WorkspaceAuthContext | undefined;
  flatFieldMetadataMaps: FlatEntityMaps<FlatFieldMetadata>;
  shouldBypassPermissionChecks: boolean;
}): void => {
  if (shouldBypassPermissionChecks) {
    return;
  }

  const scope = compileRecordScope({
    recordScopeRules:
      objectsPermissions[objectMetadata.id]?.recordScopeRules ?? [],
    principal: resolveRecordScopePrincipal(authContext),
  });

  if (scope.kind === 'unrestricted') {
    return;
  }

  const alias = queryBuilder.expressionMap.mainAlias?.name;

  if (!isDefined(alias)) {
    // No alias means no table to qualify. Denying is the only safe answer:
    // silently skipping would return unscoped rows.
    queryBuilder.andWhere('1 = 0');

    return;
  }

  if (scope.kind === 'denyAll') {
    queryBuilder.andWhere('1 = 0');

    return;
  }

  const rendered = renderRecordScopeToSql({
    node: scope.node,
    tableAlias: alias,
    objectMetadata,
    flatFieldMetadataMaps,
    parameterPrefix: `recordScope_${alias}`,
  });

  queryBuilder.andWhere(
    new Brackets((qb) => qb.where(rendered.sql, rendered.parameters)),
  );
};
```

Three deliberate details:

- **`Brackets`**, so the scope survives a caller's later `orWhere`. An unbracketed `AND a OR b` is the classic row-level-security bypass.
- **`1 = 0` on `denyAll`**, not "throw". A read that matches nothing is an empty list; a read that throws leaks the existence of a policy. Writes still throw, from the post-image guard, because a silent zero-row write is worse than an error (§3.4).
- **`parameterPrefix` includes the alias**, because a single query applies the scope to the main alias and to every joined relation, and TypeORM parameters are one flat namespace.

### 3.2 Rendering to SQL

`render-record-scope-to-sql.util.ts` returns `{ sql: string, parameters: Record<string, unknown> }`. Contract:

| Node | SQL |
| --- | --- |
| `and` / `or` | `(<child> AND <child> …)` / `(<child> OR <child> …)`; empty children ⇒ `TRUE` / `FALSE` |
| `not` | `NOT (<child>)` |
| `eq` literal `null` | `"alias"."col" IS NULL` — never `= NULL` |
| `eq` | `"alias"."col" = :p0` |
| `neq` | `("alias"."col" IS DISTINCT FROM :p0)` — a NULL column must not silently fail a `neq` |
| `in` | `"alias"."col" = ANY(:p0)`; empty list ⇒ `FALSE` |
| `notIn` | `("alias"."col" IS NULL OR NOT ("alias"."col" = ANY(:p0)))`; empty list ⇒ `TRUE` |
| `isNull` / `isNotNull` | `"alias"."col" IS NULL` / `IS NOT NULL` |

Column resolution:

```ts
const columnNames = getFieldMetadataIdToColumnNamesMap(
  objectMetadata,
  flatFieldMetadataMaps,
).get(node.fieldMetadataId);

// A composite field maps to several columns and a rule that names one has no
// single truth value. Rules like this are rejected by the validator, so
// reaching here means the metadata changed underneath a stored rule.
if (!isDefined(columnNames) || columnNames.length !== 1) {
  throw new PermissionsException(
    PermissionsExceptionMessage.PERMISSION_DENIED,
    PermissionsExceptionCode.PERMISSION_DENIED,
  );
}
```

Throwing rather than dropping is the point: a rule that stopped resolving must fail closed and loudly, because the alternative is a field rename silently unscoping an object.

### 3.3 In-memory evaluation

`evaluate-record-scope.util.ts` takes the *same* `RecordScopeNode` and a plain record keyed by column name, and returns `boolean`. It exists for two callers — the write-side guard (§3.4) and subscription fan-out — and its whole reason for being separate is that neither has a query to append to.

The two evaluators must agree. Task 6 is a single parity spec: one table of `(node, row)` cases, asserted twice — once against `evaluateRecordScope`, once against a real Postgres `SELECT` using `renderRecordScopeToSql`. Divergence here is exactly how a user writes a row they cannot then read.

### 3.4 The write-side guard

`assert-records-within-record-scope.util.ts` runs on the **post-image** of an insert or update — the record as it will exist after the write — and throws `PermissionsException(PERMISSION_DENIED)` if it does not satisfy the compiled scope.

This is the rule that closes the escape hatch: without it, a user scoped to `ownerId = me` could `UPDATE … SET ownerId = <someone else>`, because the `WHERE` narrowing at hook #4 checks the *pre*-image and passes. The row would leave their scope, which is a write they can never see the result of and never undo.

It also means **scope is not a hand-off mechanism.** Reassigning a record out of your own scope is refused. That is a real product constraint and is recorded in §8 with its trigger.

Interaction with hook #4: the update path applies both. Pre-image narrowing decides *which rows you may touch*; post-image validation decides *what they may become*. Neither subsumes the other, and the update builder already calls both (lines 634 and 661), so the shape is unchanged.

**Zero-affected-rows.** Pre-image narrowing turns an out-of-scope update into `UPDATE … WHERE id = $1 AND <scope>` affecting zero rows. Task 8 pins that the mutation path surfaces this as `PERMISSION_DENIED` and not as a success with an empty result — otherwise the proposal executor (§5) marks the item `APPLIED` having applied nothing.

---

## 4. Interaction with `shouldBypassPermissionChecks`

`shouldBypassPermissionChecks` is a property of the `RolePermissionConfig`, and `resolveRolePermissionConfig` (AGPL, read in full) emits it in exactly one case:

```ts
if (isSystemAuthContext(authContext)) {
  return { shouldBypassPermissionChecks: true };
}
```

Everything else — user, apiKey, application, pendingActivationUser — gets `{ intersectionOf: roleIds }` or `null`. So the invariant to protect is: **bypass is reachable only from `authContext.type === 'system'`, i.e. from jobs, crons and commands that have no principal at all.**

Rules for record scope:

1. **Bypass short-circuits before rules are read.** Every entry point checks it first (`applyRecordScopeToQueryBuilder` line 1, `assertRecordsWithinRecordScope` line 1), matching the existing early returns at `workspace-select-query-builder.ts:408` and `:435` and `permissions.utils.ts:278`. The scope compiler is never even called, so a corrupt rule cannot break a system job.
2. **Bypass is not "admin".** No role, and no permission flag, produces it. An admin with `canReadAllObjectRecords` still gets their scope applied. If a workspace wants unscoped humans, it gives them a role with no rules. Task 9 asserts this by enumerating every `WorkspaceAuthContext` variant against `resolveRolePermissionConfig`.
3. **Bypass reads used to *answer* a scoped question are allowed; bypass reads whose result reaches the user are not.** There is exactly one sanctioned use in this spec: the approval pre-flight's existence probe (§5.3), which converts a bypass read into a single boolean and never returns a field value. Any other bypass read on a user-facing path is a defect.
4. **Event emission already bypasses and must keep doing so.** `workspace-entity-manager.ts:1218` and `:1323` pass `{ shouldBypassPermissionChecks: true }` explicitly "for event emission" — the emitter needs the full before/after record to build the event. Scope is applied *later*, per subscriber, at hook #12. Removing that bypass would emit truncated events to everyone.

---

## 5. Interaction with the proposal gate

This is the section the rest of the spec exists to support. A proposal is created by one principal (an agent, under its own role) and executed by another (the approver, under theirs). Record scope must hold at both ends and the two ends can disagree.

### 5.1 The three moments

| Moment | Code | Principal | Scope question |
| --- | --- | --- | --- |
| Gate / baseline capture | `proposal-gate.service.ts:562-604` `readBaseline` | the agent | May the agent *see* the row it proposes to change? |
| Approval pre-flight | `proposal-execution.service.ts:200-239` | the approver | May the approver see and write this row? |
| Apply | `proposal-execution.service.ts:510-613` `applyItem` | the approver | Enforced by the ORM, as for any human write |

### 5.2 Moment 1 — the gate reads the baseline with the wrong principal

`readBaseline` today:

```ts
const output = await this.findRecordsService.execute({
  objectName: objectNameSingular,
  filter: { id: { eq: recordId } },
  limit: 1,
  select: fieldNames,
  shouldBuildEffectiveSelectFields: true,
  authContext: buildSystemAuthContext(context.workspaceId),   // ← system
  rolePermissionConfig: context.rolePermissionConfig,          // ← the agent's role
});
```

The comment above it says "Uses the agent's own role config, so a field the agent cannot read never lands in the baseline" — true for *field* permissions, which come from `rolePermissionConfig`. It is false for record scope, which needs the **principal**, and the principal comes from `authContext`. A `SystemWorkspaceAuthContext` carries no `workspaceMemberId`, so under §1.5 every principal-parameterised rule on the agent's role compiles to `denyAll`, the read returns nothing, `readBaseline` swallows it (`if (!isDefined(record)) return {}`), and the proposal is written with `baseline: {}`.

An empty baseline is not a loud failure. `hasBaselineConflict` returns `false` when `baselineFieldNames.length === 0`, so **conflict detection silently switches off for every proposal against a scoped object.** A human edits the record between proposal and approval, and the approval overwrites it with no warning.

Fix (Task 10): pass the agent's real auth context.

```ts
authContext: context.authContext,
```

`ToolProviderContext` already carries it — `proposal-execution.service.ts:719-727` builds one with `authContext` populated, and the gate receives the same type. Two supporting changes:

- `readBaseline` must distinguish "record not visible" from "record unchanged". Returning `{}` for both is what hides the bug. It gains a `{ baseline, visible }` result, and the gate refuses to create an item for a record the proposing principal cannot see, with a `FORBID` verdict rather than a silent `PROPOSE`. An agent must not be able to launder a write to a row it cannot read through the approval queue.
- The existing `this.logger.warn` on read failure is upgraded to a gate-level failure, because it is now load-bearing.

### 5.3 Moment 2 — the approver's scope, and why "conflict" is the wrong word for it

`buildApproverContext` (`proposal-execution.service.ts:403-466`) already does the right thing structurally: a real `UserWorkspaceAuthContext` via `buildUserAuthContext`, and `rolePermissionConfig: { unionOf: [roleId] }`. Record scope therefore applies to the approver with no change.

But the pre-flight loop is:

```ts
for (const item of selectedItems) {
  const hasConflict = await this.hasBaselineConflict(item, approver);
  ...
}
```

and `hasBaselineConflict` returns `true` when the read comes back empty:

```ts
if (!isDefined(record)) {
  return true;
}
```

Under record scope, "empty" now has two causes: the row was deleted, or **the row is outside the approver's scope**. Both are reported as `CONFLICTED`, whose message tells the reviewer the record changed. It did not. The reviewer re-reads the record — and cannot, because they cannot see it — and has no path forward.

Fix (Task 11): a scope pre-flight that runs *before* conflict detection and produces its own item status.

```ts
// types/proposal-status.type.ts
export enum ProposalItemStatus {
  PENDING = 'PENDING',
  APPLIED = 'APPLIED',
  REJECTED = 'REJECTED',
  CONFLICTED = 'CONFLICTED',
  OUT_OF_SCOPE = 'OUT_OF_SCOPE', // new
  FAILED = 'FAILED',
  SUPERSEDED = 'SUPERSEDED',
}
```

`OUT_OF_SCOPE` is the only new member; the other five exist today at `types/proposal-status.type.ts:18-25`.

```ts
// Distinguishes "row is gone" from "row is invisible to you". The probe reads
// with bypass, but returns only a boolean — no field value crosses back — so
// it answers the scope question without becoming a scope hole.
private async isItemWithinApproverScope(
  item: ProposalItemEntity,
  approver: ApproverContext,
): Promise<{ exists: boolean; visible: boolean }> {
  if (!isDefined(item.objectNameSingular) || !isDefined(item.recordId)) {
    // Outbound sends and static-tool items target no record. They are
    // governed by tool permission flags at applyOutboundSend/applyStaticTool,
    // not by record scope.
    return { exists: true, visible: true };
  }

  const asApprover = await this.findRecordsService.execute({
    objectName: item.objectNameSingular,
    filter: { id: { eq: item.recordId } },
    limit: 1,
    select: ['id'],
    authContext: approver.authContext,
    rolePermissionConfig: approver.rolePermissionConfig,
  });

  const visible = isDefined(
    (asApprover.result as { records?: { id: string }[] })?.records?.[0],
  );

  if (visible) {
    return { exists: true, visible: true };
  }

  const asSystem = await this.findRecordsService.execute({
    objectName: item.objectNameSingular,
    filter: { id: { eq: item.recordId } },
    limit: 1,
    select: ['id'],
    authContext: buildSystemAuthContext(approver.workspaceId),
    rolePermissionConfig: { shouldBypassPermissionChecks: true },
  });

  return {
    exists: isDefined(
      (asSystem.result as { records?: { id: string }[] })?.records?.[0],
    ),
    visible: false,
  };
}
```

Batch behaviour deliberately mirrors the existing conflict path rather than inventing a second one: any `OUT_OF_SCOPE` item marks those items, returns the proposal to `PENDING`, and aborts with `aborted: true`. The reviewer sees which items they cannot act on, deselects them, and re-approves the rest. `ApprovalResult` gains `outOfScopeItemIds: string[]`.

Rejected alternative — silently skipping out-of-scope items and applying the rest: it turns "approve this batch" into "approve some of this batch" with no signal, which breaks the charter's proposal contract ("atomic batch execution") and hands a narrow-scoped approver a way to partially apply an agent's plan without anyone seeing which half.

Rejected alternative — letting the approval run with bypass because "a human approved it": this is the single most tempting shortcut in the whole feature and it voids the layer. The charter's principal contract requires audit entries to distinguish the approver, and `buildApproverContext`'s own comment states the intent — "Runs as the approver so object and field permissions are enforced by the ordinary ORM path". Row scope is not different in kind from object and field permissions; it is the third axis of the same check.

### 5.4 The `applyAutomationBlockedRecordWrite` branch

`proposal-execution.service.ts:623-650` deliberately bypasses the *automation blocklist* for human-approved updates, passing `isHumanApproved: true`. That flag must not grow to mean "bypass record scope". It reaches `UpdateRecordService`, which still runs the ordinary ORM path with `approver.rolePermissionConfig` and `approver.authContext`, so scope applies. Task 12 asserts that specifically, because the two exemptions live four lines apart and the next reader will assume they are the same exemption.

### 5.5 Agent scope ≠ approver scope, by design

A research agent typically runs under a broad read role so it can gather evidence; the approver is a rep scoped to their own accounts. The composition of the two is: **an item is appliable only if both the proposing principal could see the record (§5.2) and the approving principal can see and write it (§5.3).** Neither side widens the other. That is the property to state in the settings UI, and it is what makes "approval executes as the approver" a real security boundary rather than a naming convention.

---

## 6. File structure

**New — `twenty-shared`** (`packages/twenty-shared/src/types/`):

| File | Responsibility |
| --- | --- |
| `RecordScopeOperator.ts` | Operator union + const array |
| `RecordScopePrincipalAttribute.ts` | Closed principal-attribute set |
| `RecordScopeNode.ts` | Expression tree types |
| `RecordScopeRule.ts` | Cache-facing rule projection |

**New — server, model + enforcement** (`packages/twenty-server/src/engine/twenty-orm/record-scope/`):

| File | Responsibility |
| --- | --- |
| `types/compiled-record-scope.type.ts` | `CompiledRecordScope` + sentinels |
| `types/record-scope-principal.type.ts` | `RecordScopePrincipal` |
| `resolve-record-scope-principal.util.ts` | `WorkspaceAuthContext` → principal |
| `compile-record-scope.util.ts` | rules + principal → `CompiledRecordScope` (§2.2) |
| `compose-record-scopes.util.ts` | `RolePermissionConfig` arms → one scope (§2.3/2.4) |
| `render-record-scope-to-sql.util.ts` | node → `{ sql, parameters }` |
| `evaluate-record-scope.util.ts` | node + record → boolean |
| `build-record-scope-gql-filter.util.ts` | node → `RecordGqlOperationFilter` for subscriptions |
| `apply-record-scope-to-query-builder.util.ts` | the one enforcement entry point |
| `assert-records-within-record-scope.util.ts` | post-image write guard |

**New — server, metadata** (`packages/twenty-server/src/engine/metadata-modules/record-scope/`):

| File | Responsibility |
| --- | --- |
| `entities/record-scope-rule.entity.ts` | `RecordScopeRuleEntity` |
| `validators/validate-record-scope-expression.util.ts` | Structural + semantic validation at write time |
| `services/record-scope-rule.service.ts` | CRUD + cache invalidation |
| `dtos/record-scope-rule.dto.ts` | GraphQL object type (expression as `GraphQLJSON`) |
| `dtos/upsert-record-scope-rule.input.ts` | Create/update input |
| `resolvers/record-scope-rule.resolver.ts` | `recordScopeRules`, `upsertRecordScopeRule`, `deleteRecordScopeRule` |
| `record-scope.module.ts` | Nest wiring |

**Modified — server:** the fifteen rows of §3, plus `metadata-modules/role/role.entity.ts` (`recordScopeRules` one-to-many replacing the two predicate relations), `role.dto.ts`, `role.resolver.ts`, the seven `flat-entity/constant/all-*.constant.ts` tables (`all-entity-properties-configuration-by-metadata-name`, `all-many-to-one-metadata-foreign-key`, `all-many-to-one-metadata-relations`, `all-metadata-entity-by-metadata-name`, `all-metadata-required-metadata-for-validation`, `all-metadata-serialized-relation`, `all-one-to-many-metadata-relations`) plus the two constant snapshots under `flat-entity/constant/__tests__/__snapshots__/` (one metadata name `recordScopeRule` replacing two), `workspace-cache-key.type.ts`, and the role manifest converters.

**Deleted — server:** the 43-file enterprise cluster listed in the audit, plus its two `twenty-shared` predicate type files and the three remaining `RowLevelPermissionPredicate*` shared types.

---

## 7. Tasks

Global constraints (from `CLAUDE.md`, identical to the AI-write-approval plan): named exports only; no `any`; types over interfaces; string-literal unions except GraphQL enums; kebab-case filenames with suffix; `//` comments explaining WHY; `isDefined()` from `twenty-shared/utils`; services under 500 lines; entities auto-registered by glob; schema changes ship as instance commands.

Memory constraint: **never bare `npx jest`.** Use `cd packages/twenty-server && bash ../../scripts/lowmem.sh test|itest|types|full [pattern]`.

---

### Task 1: Shared types

**Files:** the four `twenty-shared/src/types/Record Scope*.ts` files of §1.2, plus the barrel export, plus the `ObjectPermissions.ts` edit.

- [ ] **Step 1:** Write the four type files exactly as §1.2.
- [ ] **Step 2:** Add them to `packages/twenty-shared/src/types/index.ts` in alphabetical position.
- [ ] **Step 3:** Edit `ObjectPermissions.ts` to replace `rowLevelPermissionPredicates` / `rowLevelPermissionPredicateGroups` with `recordScopeRules: RecordScopeRule[]`.
- [ ] **Step 4:** `bash ../../scripts/lowmem.sh types`. Expect failures — every producer and consumer of `ObjectPermissions`. Record the list; it is the work queue for Tasks 5, 7 and 13.

---

### Task 2: Principal resolution

**Files:**
- Create: `twenty-orm/record-scope/types/record-scope-principal.type.ts`
- Create: `twenty-orm/record-scope/resolve-record-scope-principal.util.ts`
- Test: `twenty-orm/record-scope/__tests__/resolve-record-scope-principal.util.spec.ts`

- [ ] **Step 1: Failing test**

```ts
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { resolveRecordScopePrincipal } from 'src/engine/twenty-orm/record-scope/resolve-record-scope-principal.util';

const workspace = { id: 'ws-1' } as WorkspaceAuthContext['workspace'];

describe('resolveRecordScopePrincipal', () => {
  it('should resolve all three attributes for a user context', () => {
    expect(
      resolveRecordScopePrincipal({
        type: 'user',
        workspace,
        userWorkspaceId: 'uw-1',
        user: { id: 'u-1' },
        workspaceMemberId: 'wm-1',
        workspaceMember: { id: 'wm-1' },
      } as WorkspaceAuthContext),
    ).toEqual({
      workspaceMemberId: 'wm-1',
      userWorkspaceId: 'uw-1',
      userId: 'u-1',
    });
  });

  it('should omit workspaceMemberId for a pending activation user', () => {
    const principal = resolveRecordScopePrincipal({
      type: 'pendingActivationUser',
      workspace,
      userWorkspaceId: 'uw-2',
      user: { id: 'u-2' },
    } as WorkspaceAuthContext);

    expect(principal.workspaceMemberId).toBeUndefined();
    expect(principal.userWorkspaceId).toBe('uw-2');
  });

  it('should return an empty principal for an api key context', () => {
    expect(
      resolveRecordScopePrincipal({
        type: 'apiKey',
        workspace,
        apiKey: { id: 'ak-1' },
      } as WorkspaceAuthContext),
    ).toEqual({});
  });

  it('should return an empty principal for an application context', () => {
    expect(
      resolveRecordScopePrincipal({
        type: 'application',
        workspace,
        application: { id: 'app-1' },
      } as WorkspaceAuthContext),
    ).toEqual({});
  });

  it('should return an empty principal for a system context', () => {
    expect(
      resolveRecordScopePrincipal({
        type: 'system',
        workspace,
      } as WorkspaceAuthContext),
    ).toEqual({});
  });

  it('should return an empty principal when there is no auth context at all', () => {
    expect(resolveRecordScopePrincipal(undefined)).toEqual({});
  });
});
```

- [ ] **Step 2:** Run `bash ../../scripts/lowmem.sh test resolve-record-scope-principal`. Expect `Cannot find module`.
- [ ] **Step 3: Implement**, using the existing guards `isUserAuthContext` / `isApiKeyAuthContext` / `isApplicationAuthContext` from `core-modules/auth/guards/` rather than raw `type ===` comparisons, matching `resolve-role-ids-from-auth-context.util.ts`.
- [ ] **Step 4:** Re-run. Expect 6 passing.
- [ ] **Step 5: Mutation check.** Make the `apiKey` branch return `{ workspaceMemberId: authContext.apiKey.id }`. The api-key test must fail. Revert.

---

### Task 3: Entity and instance command

**Files:**
- Create: `metadata-modules/record-scope/entities/record-scope-rule.entity.ts` (§1.3)
- Create: an instance command (path produced by the generator)
- Modify: `metadata-modules/role/role.entity.ts`

- [ ] **Step 1:** Write the entity.
- [ ] **Step 2:** On `RoleEntity`, replace the two predicate one-to-many relations with:

```ts
@OneToMany(
  () => RecordScopeRuleEntity,
  (recordScopeRule) => recordScopeRule.role,
  { cascade: true },
)
recordScopeRules: Relation<RecordScopeRuleEntity[]>;
```

- [ ] **Step 3:** Generate the schema change:

```bash
npx nx run twenty-server:database:migrate:generate --name addRecordScopeRule --type fast
```

- [ ] **Step 4:** Verify the emitted SQL creates `core."recordScopeRule"` with a `jsonb` `expression` column, the `(workspaceId, roleId)` index and the `(workspaceId, universalIdentifier)` unique constraint, and drops the two predicate tables. Paste the SQL into the task record.
- [ ] **Step 5:** Apply against the local database (PG 5433) and confirm with `\d+ core."recordScopeRule"`.

---

### Task 4: Expression validation

A stored expression is executed against the database on every request. It is validated once, on write, and never trusted again.

**Files:**
- Create: `metadata-modules/record-scope/validators/validate-record-scope-expression.util.ts`
- Test: `metadata-modules/record-scope/validators/__tests__/validate-record-scope-expression.util.spec.ts`

Rules enforced, each with a test:

| Check | Failure code |
| --- | --- |
| Tree depth ≤ 8 | `INVALID_ARG` |
| Node count ≤ 64 | `INVALID_ARG` |
| Every `group` has ≥ 1 child | `INVALID_ARG` |
| `operator` ∈ `RECORD_SCOPE_OPERATORS` | `INVALID_ARG` |
| `value` present iff operator is not `isNull`/`isNotNull` | `INVALID_ARG` |
| `value.attribute` ∈ `RECORD_SCOPE_PRINCIPAL_ATTRIBUTES` | `INVALID_ARG` |
| `in`/`notIn` take `literalList`, others take `literal` or `principal` | `INVALID_ARG` |
| `fieldMetadataId` exists on this object | `FIELD_METADATA_NOT_FOUND` |
| That field resolves to exactly one column | `INVALID_ARG` |
| The object is not a system object | `CANNOT_ADD_OBJECT_PERMISSION_ON_SYSTEM_OBJECT` |

- [ ] **Step 1:** Write the spec with one `it` per row above plus a happy path. Depth and node-count tests build their input programmatically, not by hand.
- [ ] **Step 2:** Run, expect module-not-found.
- [ ] **Step 3:** Implement as a pure function taking `{ expression, objectMetadata, flatFieldMetadataMaps }` and throwing `PermissionsException`.
- [ ] **Step 4:** Re-run. Expect 11 passing.
- [ ] **Step 5: Mutation check.** Raise the depth limit to 800; the depth test must fail. Revert.

The depth and node-count limits exist because the expression is attacker-adjacent in one specific sense: a workspace admin who is not a server operator can author it, and an unbounded tree is an unbounded `WHERE` clause on every query in the workspace.

---

### Task 5: Compilation and composition

**Files:**
- Create: `twenty-orm/record-scope/types/compiled-record-scope.type.ts`
- Create: `twenty-orm/record-scope/compile-record-scope.util.ts`
- Create: `twenty-orm/record-scope/compose-record-scopes.util.ts`
- Test: `twenty-orm/record-scope/__tests__/compile-record-scope.util.spec.ts`
- Test: `twenty-orm/record-scope/__tests__/compose-record-scopes.util.spec.ts`

- [ ] **Step 1: Failing test for `compileRecordScope`** — §2.2 in full:

```ts
import {
  type RecordScopeNode,
  type RecordScopeRule,
} from 'twenty-shared/types';

import { compileRecordScope } from 'src/engine/twenty-orm/record-scope/compile-record-scope.util';

const ownedByMe: RecordScopeNode = {
  type: 'comparison',
  fieldMetadataId: 'field-owner',
  operator: 'eq',
  value: { source: 'principal', attribute: 'workspaceMemberId' },
};

const emea: RecordScopeNode = {
  type: 'comparison',
  fieldMetadataId: 'field-region',
  operator: 'eq',
  value: { source: 'literal', value: 'EMEA' },
};

const rule = (id: string, expression: RecordScopeNode): RecordScopeRule => ({
  id,
  roleId: 'role-1',
  objectMetadataId: 'object-1',
  expression,
});

describe('compileRecordScope', () => {
  it('should be unrestricted when the role has no rules', () => {
    expect(
      compileRecordScope({ recordScopeRules: [], principal: {} }),
    ).toEqual({ kind: 'unrestricted' });
  });

  it('should return the single rule expression untouched', () => {
    expect(
      compileRecordScope({
        recordScopeRules: [rule('r1', emea)],
        principal: {},
      }),
    ).toEqual({ kind: 'expression', node: emea });
  });

  it('should OR several rules of the same role together', () => {
    expect(
      compileRecordScope({
        recordScopeRules: [rule('r1', ownedByMe), rule('r2', emea)],
        principal: { workspaceMemberId: 'wm-1' },
      }),
    ).toEqual({
      kind: 'expression',
      node: { type: 'group', operator: 'or', children: [ownedByMe, emea] },
    });
  });

  it('should drop a whole rule whose principal attribute is unresolvable', () => {
    expect(
      compileRecordScope({
        recordScopeRules: [rule('r1', ownedByMe), rule('r2', emea)],
        principal: {},
      }),
    ).toEqual({ kind: 'expression', node: emea });
  });

  it('should deny all when every rule is unresolvable', () => {
    expect(
      compileRecordScope({
        recordScopeRules: [rule('r1', ownedByMe)],
        principal: {},
      }),
    ).toEqual({ kind: 'denyAll' });
  });

  // The reason rule-level (not node-level) falsity is the contract: a negated
  // reference to a missing principal must not become a grant.
  it('should deny rather than grant when a NOT wraps an unresolvable reference', () => {
    expect(
      compileRecordScope({
        recordScopeRules: [rule('r1', { type: 'not', child: ownedByMe })],
        principal: {},
      }),
    ).toEqual({ kind: 'denyAll' });
  });

  it('should drop a rule whose unresolvable reference is nested under an OR', () => {
    expect(
      compileRecordScope({
        recordScopeRules: [
          rule('r1', {
            type: 'group',
            operator: 'or',
            children: [ownedByMe, emea],
          }),
        ],
        principal: {},
      }),
    ).toEqual({ kind: 'denyAll' });
  });
});
```

The last case is the one that will feel wrong to an implementer: `or(unresolvable, emea)` could plausibly reduce to `emea`. It must not. The rule's author wrote a single statement of intent, and silently evaluating half of it for a principal it was not written for is how a rule means something different for an API key than for a human. Deny, and make the admin write two rules if they want two behaviours.

- [ ] **Step 2:** Run, expect module-not-found. Implement `compileRecordScope`.
- [ ] **Step 3: Failing test for `composeRecordScopes`** — the §2.6 truth table verbatim, one `it` per row, driven by a `RolePermissionConfig` and an `ObjectsPermissionsByRoleId`.
- [ ] **Step 4: The `computePermissionIntersection` regression, written first:**

```ts
it('should AND scopes from disjoint roles rather than dropping both', () => {
  const scope = composeRecordScopes({
    rolePermissionConfig: { intersectionOf: ['role-a', 'role-b'] },
    rolesPermissions: {
      'role-a': { 'object-1': permissionsWith([rule('r1', ownedByMe)]) },
      'role-b': { 'object-1': permissionsWith([rule('r2', emea)]) },
    },
    objectMetadataId: 'object-1',
    principal: { workspaceMemberId: 'wm-1' },
  });

  // Today's compute-permission-intersection.util.ts:21-25 filters role A's
  // predicates to those whose fieldMetadataId role B also constrains. Owner
  // and region are different fields, so both are dropped and the caller ends
  // up unrestricted — strictly more access than either role alone grants.
  expect(scope).toEqual({
    kind: 'expression',
    node: { type: 'group', operator: 'and', children: [ownedByMe, emea] },
  });
});
```

- [ ] **Step 5:** Implement `composeRecordScopes`. It must not delegate row scope to `computePermissionIntersection`; that function keeps its object/field responsibilities and loses `recordScopeRules` entirely (its output field becomes `[]`, with a comment pointing here).
- [ ] **Step 6:** Run both specs. Expect 7 + 11 passing.
- [ ] **Step 7: Mutation check.** Change the `intersectionOf` arm to `or`. The disjoint-roles test must fail. Revert.

---

### Task 6: SQL rendering and in-memory evaluation, proven equivalent

**Files:**
- Create: `twenty-orm/record-scope/render-record-scope-to-sql.util.ts`
- Create: `twenty-orm/record-scope/evaluate-record-scope.util.ts`
- Test: `twenty-orm/record-scope/__tests__/render-record-scope-to-sql.util.spec.ts` (unit, string assertions)
- Test: `test/integration/.../record-scope-evaluator-parity.integration-spec.ts` (real Postgres)

- [ ] **Step 1: Unit test the rendered SQL**, asserting the exact string and the exact parameter map for each row of the §3.2 table. Example:

```ts
it('should render neq as IS DISTINCT FROM so a null column still matches', () => {
  expect(
    renderRecordScopeToSql({
      node: {
        type: 'comparison',
        fieldMetadataId: 'field-region',
        operator: 'neq',
        value: { source: 'literal', value: 'EMEA' },
      },
      tableAlias: 'opportunity',
      objectMetadata,
      flatFieldMetadataMaps,
      parameterPrefix: 'recordScope_opportunity',
    }),
  ).toEqual({
    sql: '("opportunity"."region" IS DISTINCT FROM :recordScope_opportunity_0)',
    parameters: { recordScope_opportunity_0: 'EMEA' },
  });
});

it('should throw PERMISSION_DENIED when the field resolves to several columns', () => {
  expect(() =>
    renderRecordScopeToSql({
      node: {
        type: 'comparison',
        fieldMetadataId: 'field-linkedin-link',
        operator: 'eq',
        value: { source: 'literal', value: 'x' },
      },
      tableAlias: 'opportunity',
      objectMetadata,
      flatFieldMetadataMaps,
      parameterPrefix: 'p',
    }),
  ).toThrow(PermissionsException);
});
```

- [ ] **Step 2:** Implement `renderRecordScopeToSql`. Parameter names are `${parameterPrefix}_${counter}`; the counter is threaded through the recursion, never a module-level variable.
- [ ] **Step 3:** Implement `evaluateRecordScope` against the same table.
- [ ] **Step 4: The parity integration spec.** One shared case table; each case is asserted twice.

```ts
const CASES: {
  name: string;
  node: RecordScopeNode;
  row: Record<string, unknown>;
  expected: boolean;
}[] = [
  { name: 'eq match',        node: eqEmea,      row: { region: 'EMEA' }, expected: true },
  { name: 'eq miss',         node: eqEmea,      row: { region: 'AMER' }, expected: false },
  { name: 'eq vs null',      node: eqEmea,      row: { region: null },   expected: false },
  { name: 'neq vs null',     node: neqEmea,     row: { region: null },   expected: true },
  { name: 'in empty list',   node: inEmpty,     row: { region: 'EMEA' }, expected: false },
  { name: 'notIn empty',     node: notInEmpty,  row: { region: 'EMEA' }, expected: true },
  { name: 'notIn vs null',   node: notInAmer,   row: { region: null },   expected: true },
  { name: 'not(eq) vs null', node: notEqEmea,   row: { region: null },   expected: true },
  { name: 'isNull',          node: isNullRegion,row: { region: null },   expected: true },
  { name: 'or short',        node: orNode,      row: { region: 'AMER', ownerId: 'wm-1' }, expected: true },
  { name: 'and both',        node: andNode,     row: { region: 'AMER', ownerId: 'wm-1' }, expected: false },
];

describe.each(CASES)('record scope parity: $name', ({ node, row, expected }) => {
  it('should agree in memory', () => {
    expect(evaluateRecordScope({ node, record: row, principal })).toBe(expected);
  });

  it('should agree in postgres', async () => {
    const rendered = renderRecordScopeToSql({ node, tableAlias: 't', ... });
    const result = await dataSource.query(
      `SELECT ${rendered.sql.replace(/:(\w+)/g, (_, k) => quote(rendered.parameters[k]))} AS matched
       FROM (SELECT $1::text AS region, $2::uuid AS "ownerId") t`,
      [row.region, row.ownerId],
    );

    expect(result[0].matched).toBe(expected);
  });
});
```

`neq vs null`, `notIn vs null` and `not(eq) vs null` are the three cases where naive SQL and naive JavaScript disagree, and each of them is a read/write inconsistency in production: the user inserts a row the guard accepts and then cannot see it.

- [ ] **Step 5:** `bash ../../scripts/lowmem.sh itest record-scope-evaluator-parity`. Expect 22 passing.
- [ ] **Step 6: Mutation check.** Change `neq` rendering to `<>`. The `neq vs null` Postgres assertion must fail while the in-memory one passes — proving the parity harness catches exactly the class of bug it exists for. Revert.

---

### Task 7: The cache and `ObjectPermissions`

**Files:**
- Modify: `metadata-modules/role/services/workspace-roles-permissions-cache.service.ts`
- Modify: `twenty-orm/utils/compute-permission-intersection.util.ts`
- Test: `metadata-modules/role/services/__tests__/workspace-roles-permissions-cache.service.spec.ts`

- [ ] **Step 1:** In the cache service, replace the two injected predicate repositories (lines 53-56) with one `WorkspaceScopedRepository<RecordScopeRuleEntity>`, the two `find` calls (80-85) with one, the two `regroupEntitiesByRelatedEntityId` calls (104-113) with one keyed on `roleId`, and the two output arrays (234-243) with:

```ts
recordScopeRules: roleRecordScopeRules
  .filter((rule) => rule.objectMetadataId === objectMetadataId)
  .map(({ id, roleId, objectMetadataId: ruleObjectMetadataId, expression }) => ({
    id,
    roleId,
    objectMetadataId: ruleObjectMetadataId,
    expression,
  })),
```

The projection is deliberate: entities carry timestamps and relations that would otherwise be serialised into the workspace cache on every recompute.

- [ ] **Step 2:** Assert that a soft-deleted rule never reaches the cache (the existing `where: { deletedAt: IsNull() }` must survive the rewrite) and that a rule on role A never appears under role B.
- [ ] **Step 3:** In `compute-permission-intersection.util.ts`, delete `intersectRowLevelPermissionPredicates` and set `recordScopeRules: []` with the comment `// Row scope is composed by composeRecordScopes, not element-wise here — see specs/row-level-permissions.md §2.4.`
- [ ] **Step 4:** `bash ../../scripts/lowmem.sh test compute-permission-intersection` and `... test workspace-roles-permissions-cache`.

---

### Task 8: Query-builder enforcement

**Files:**
- Create: `twenty-orm/record-scope/apply-record-scope-to-query-builder.util.ts` (§3.1)
- Create: `twenty-orm/record-scope/assert-records-within-record-scope.util.ts` (§3.4)
- Modify: the five query builders and the three outside callers of §3 rows 1-11
- Modify: `twenty-orm/interfaces/workspace-internal-context.interface.ts` (delete the two flat-map fields)
- Test: `twenty-orm/record-scope/__tests__/apply-record-scope-to-query-builder.util.spec.ts`
- Test: `test/integration/.../record-scope-orm.integration-spec.ts`

- [ ] **Step 1: Unit assertions** on a stub query builder capturing `andWhere` calls:
  - bypass ⇒ `andWhere` never called
  - `unrestricted` ⇒ `andWhere` never called
  - `denyAll` ⇒ `andWhere('1 = 0')`
  - missing main alias ⇒ `andWhere('1 = 0')`, **not** a silent return
  - expression ⇒ `andWhere` called with a `Brackets` instance
- [ ] **Step 2:** Implement; wire rows 1-11.
- [ ] **Step 3: Integration assertions** against a real workspace with two workspace members and an `opportunity` object, role scoped to `ownerId = principal.workspaceMemberId`:

| Assertion | Why it is here |
| --- | --- |
| `findMany` returns only own rows | the base case |
| `findOne` on another's row returns null | not an error — an empty read must not confirm existence |
| `count` counts only own rows | aggregates go through the same builder and are the classic leak |
| `groupBy` buckets only own rows | hits row 11 |
| a joined relation to a scoped object returns only own rows | hits row 2 |
| `update` of another's row throws `PERMISSION_DENIED` and affects 0 rows | **the zero-affected assertion of §3.4** |
| `update` setting `ownerId` to another member throws `PERMISSION_DENIED` | post-image guard, row 5 |
| `insert` with `ownerId` = another member throws `PERMISSION_DENIED` | row 6 |
| `insert` with `ownerId` = self succeeds | the guard must not block legitimate writes |
| `softDelete` / `delete` of another's row affect 0 rows | rows 7-8 |
| a scoped query followed by a caller's `orWhere` still excludes others' rows | the `Brackets` assertion, end to end |
| a system-context job sees all rows | §4 rule 1 |

- [ ] **Step 4:** `bash ../../scripts/lowmem.sh itest record-scope-orm`. Expect 12 passing.
- [ ] **Step 5: Mutation check.** Replace `new Brackets(...)` with a bare `andWhere(rendered.sql, rendered.parameters)`. The `orWhere` assertion must fail. Revert. Then delete the `andWhere('1 = 0')` from the missing-alias branch; no test may still pass that should not — if all 12 stay green, the missing-alias case is untested and a case must be added before proceeding.

---

### Task 9: Bypass invariants

**Files:**
- Test: `twenty-orm/record-scope/__tests__/record-scope-bypass-invariants.spec.ts`

This task adds no production code. It pins §4 so a later refactor cannot widen bypass without a red test.

- [ ] **Step 1:**

```ts
describe('record scope bypass invariants', () => {
  it.each([
    ['user', userAuthContext],
    ['apiKey', apiKeyAuthContext],
    ['application', applicationAuthContext],
    ['pendingActivationUser', pendingAuthContext],
  ])(
    'should never produce a bypass config for a %s auth context',
    (_type, authContext) => {
      const config = resolveRolePermissionConfig({
        authContext,
        userWorkspaceRoleMap,
        apiKeyRoleMap,
      });

      expect(config === null || !('shouldBypassPermissionChecks' in config)).toBe(
        true,
      );
    },
  );

  it('should produce a bypass config only for a system auth context', () => {
    expect(
      resolveRolePermissionConfig({
        authContext: systemAuthContext,
        userWorkspaceRoleMap,
        apiKeyRoleMap,
      }),
    ).toEqual({ shouldBypassPermissionChecks: true });
  });

  it('should not bypass for a role that can read all object records', () => {
    // canReadAllObjectRecords is an object-level grant. It says nothing about
    // which rows, and must not be mistaken for a scope exemption.
    const scope = composeRecordScopes({
      rolePermissionConfig: { unionOf: ['role-admin'] },
      rolesPermissions: {
        'role-admin': {
          'object-1': {
            canReadObjectRecords: true,
            canUpdateObjectRecords: true,
            canSoftDeleteObjectRecords: true,
            canDestroyObjectRecords: true,
            restrictedFields: {},
            recordScopeRules: [rule('r1', ownedByMe)],
          },
        },
      },
      objectMetadataId: 'object-1',
      principal: { workspaceMemberId: 'wm-1' },
    });

    expect(scope).toEqual({ kind: 'expression', node: ownedByMe });
  });
});
```

- [ ] **Step 2:** Run. All must pass against unmodified code; if any fails, the invariant is already broken and that is the finding.

---

### Task 10: Fix the gate's baseline principal

**Files:**
- Modify: `metadata-modules/ai/ai-write-approval/services/proposal-gate.service.ts`
- Test: `metadata-modules/ai/ai-write-approval/services/__tests__/proposal-gate.service.spec.ts`

- [ ] **Step 1: Failing test** — the §5.2 defect, written before the fix:

```ts
it('should read the baseline as the proposing principal, not as system', async () => {
  findRecordsService.execute.mockResolvedValue({
    success: true,
    result: { records: [{ id: 'rec-1', stage: 'NEW' }] },
  });

  await service.evaluate(updateStageDispatch, toolProviderContext);

  expect(findRecordsService.execute).toHaveBeenCalledWith(
    expect.objectContaining({
      authContext: toolProviderContext.authContext,
      rolePermissionConfig: toolProviderContext.rolePermissionConfig,
    }),
  );
});

it('should forbid rather than propose when the proposing principal cannot see the record', async () => {
  findRecordsService.execute.mockResolvedValue({
    success: true,
    result: { records: [] },
  });

  const decision = await service.evaluate(updateStageDispatch, toolProviderContext);

  // A blind write laundered through the approval queue is still a blind write.
  expect(decision.kind).toBe('FORBID');
  expect(proposalCreationService.create).not.toHaveBeenCalled();
});

it('should still propose with an empty baseline for a create, which targets no existing record', async () => {
  const decision = await service.evaluate(createDispatch, toolProviderContext);

  expect(decision.kind).toBe('PROPOSED');
});
```

- [ ] **Step 2:** Run. The first must fail on `buildSystemAuthContext`, the second on `PROPOSED !== FORBID`.
- [ ] **Step 3:** Change `readBaseline` to return `{ baseline, visible }`, pass `context.authContext`, and add the `FORBID` branch in `evaluate` for `visible === false` on any item carrying a `recordId`. Delete the now-unused `buildSystemAuthContext` import if nothing else in the file uses it.
- [ ] **Step 4:** Re-run the whole gate spec. Every pre-existing test must still pass — this is a permission tightening, and a create/send path that starts failing means the `recordId` guard is too broad.
- [ ] **Step 5: Mutation check.** Restore `buildSystemAuthContext(...)`. The first test must fail. Revert.

---

### Task 11: Approver scope pre-flight

**Files:**
- Modify: `metadata-modules/ai/ai-write-approval/types/proposal-status.type.ts` (add `OUT_OF_SCOPE`)
- Modify: `metadata-modules/ai/ai-write-approval/services/proposal-execution.service.ts`
- Modify: `metadata-modules/ai/ai-write-approval/dtos/proposal.dto.ts` (`outOfScopeItemIds`)
- Test: `.../__tests__/proposal-execution.service.spec.ts`
- Test: `test/integration/.../proposal-approval-record-scope.integration-spec.ts`

- [ ] **Step 1: Failing unit tests:**

```ts
it('should mark an item OUT_OF_SCOPE when the approver cannot see the target record', async () => {
  findRecordsService.execute
    .mockResolvedValueOnce({ success: true, result: { records: [] } })      // as approver
    .mockResolvedValueOnce({ success: true, result: { records: [{ id: 'rec-1' }] } }); // as system

  const result = await service.approve({ ...approveParams });

  expect(result.outOfScopeItemIds).toEqual(['item-1']);
  expect(result.conflictedItemIds).toEqual([]);
  expect(result.aborted).toBe(true);
  expect(updateRecordService.execute).not.toHaveBeenCalled();
});

it('should mark an item CONFLICTED, not OUT_OF_SCOPE, when the record is genuinely gone', async () => {
  findRecordsService.execute
    .mockResolvedValueOnce({ success: true, result: { records: [] } })
    .mockResolvedValueOnce({ success: true, result: { records: [] } });

  const result = await service.approve({ ...approveParams });

  expect(result.conflictedItemIds).toEqual(['item-1']);
  expect(result.outOfScopeItemIds).toEqual([]);
});

it('should return the proposal to PENDING so the reviewer can deselect the blocked items', async () => {
  await service.approve({ ...approveParams });

  expect(proposalRepository.update).toHaveBeenCalledWith(
    { id: 'proposal-1', workspaceId: 'ws-1', status: ProposalStatus.APPLYING },
    { status: ProposalStatus.PENDING },
  );
});

it('should not scope-check an outbound send, which targets no record', async () => {
  const result = await service.approve({ ...sendEmailApproveParams });

  expect(result.outOfScopeItemIds).toEqual([]);
  expect(sendEmailTool.execute).toHaveBeenCalled();
});

it('should never approve with a bypass config', async () => {
  await service.approve({ ...approveParams });

  for (const call of updateRecordService.execute.mock.calls) {
    expect(call[0].rolePermissionConfig).toEqual({ unionOf: ['role-approver'] });
  }
});
```

- [ ] **Step 2:** Run, expect five failures.
- [ ] **Step 3:** Implement `isItemWithinApproverScope` (§5.3) and call it in `applyClaimedProposal` before the conflict loop. Order matters: an out-of-scope item must never reach `hasBaselineConflict`, which would mislabel it.
- [ ] **Step 4: Integration test** — real workspace, agent proposes an update to an opportunity owned by member B, approver is member A scoped to `ownerId = A`:
  - approval aborts with `outOfScopeItemIds = [itemId]` and the record is unchanged in the database
  - the same proposal approved by member B applies, and `updatedBy.workspaceMemberId` is B
  - a proposal whose items are all within A's scope applies normally, proving the pre-flight is not blanket-blocking
- [ ] **Step 5:** `bash ../../scripts/lowmem.sh itest proposal-approval-record-scope`.
- [ ] **Step 6: Mutation check.** Change the bypass probe to return `{ exists: true, visible: true }` unconditionally. The first integration assertion must fail. Revert.

---

### Task 12: The `isHumanApproved` boundary

**Files:**
- Test: `.../__tests__/proposal-execution.service.spec.ts`

- [ ] **Step 1:**

```ts
it('should still pass the approver role config on the automation-blocked branch', async () => {
  await service.approve({ ...blockedObjectApproveParams });

  expect(updateRecordService.execute).toHaveBeenCalledWith(
    expect.objectContaining({
      isHumanApproved: true,
      rolePermissionConfig: { unionOf: ['role-approver'] },
      authContext: expect.objectContaining({ type: 'user' }),
    }),
  );
});
```

- [ ] **Step 2:** Run against unmodified `applyAutomationBlockedRecordWrite`. It should pass today. Then mutate the branch to pass `{ shouldBypassPermissionChecks: true }` and confirm the test goes red. Revert.

The test is worth its two minutes because the automation-blocklist exemption and a scope exemption look identical from four lines away, and the next person to touch this method will be tempted to make them one.

---

### Task 13: Metadata surface, migration graph and manifests

**Files:**
- Create: the `metadata-modules/record-scope/` service, DTOs, resolver, module
- Modify: the seven `flat-entity/constant/all-*.constant.ts` tables (`all-entity-properties-configuration-by-metadata-name`, `all-many-to-one-metadata-foreign-key`, `all-many-to-one-metadata-relations`, `all-metadata-entity-by-metadata-name`, `all-metadata-required-metadata-for-validation`, `all-metadata-serialized-relation`, `all-one-to-many-metadata-relations`) plus the two constant snapshots under `flat-entity/constant/__tests__/__snapshots__/`, `all-metadata-names-sorted-atomically.constant.ts`, `workspace-cache-key.type.ts`, `role.dto.ts`, `role.resolver.ts`, the role manifest converters
- Modify: `packages/twenty-apps/public/customer-support/.twenty/output/manifest.json`

- [ ] **Step 1:** Register one metadata name `recordScopeRule` where the two predicate names appear today, in all seven constant tables. `ALL_METADATA_NAMES_SORTED_ATOMICALLY` is *derived* — `sortMetadataNamesChildrenFirst()` — so ordering follows automatically from the relation tables, provided `all-many-to-one-metadata-relations.constant.ts` declares `recordScopeRule`'s parents as `role` and `objectMetadata`. Assert the derived order in the existing constant spec rather than hand-editing it, and regenerate the two `__snapshots__` files.
- [ ] **Step 2:** Replace the two arrays in the role manifest converter with `recordScopeRules`, and update the app manifest's `"rowLevelPermissionPredicateGroups": []` / `"rowLevelPermissionPredicates": []` (lines 544-545, 575-576) with `"recordScopeRules": []`.
- [ ] **Step 3:** Resolver, guarded by `PermissionFlagType.ROLES` exactly as the object-permission resolvers are. `upsertRecordScopeRule` calls the Task 4 validator before writing and invalidates the `rolesPermissions` cache key after.
- [ ] **Step 4:** Assert cache invalidation directly: create a rule, then read `getOrRecompute(workspaceId, ['rolesPermissions'])` and expect the new rule present. A rule that does not invalidate is a rule that takes effect on the next deploy, which reads as "permissions do nothing".
- [ ] **Step 5:** `bash ../../scripts/lowmem.sh full`. Expect green. Paste the summary line.

---

### Task 14: Subscriptions

**Files:**
- Create: `twenty-orm/record-scope/build-record-scope-gql-filter.util.ts`
- Modify: `subscriptions/object-record-event/object-record-event-publisher.ts` (rows 12)
- Test: `.../__tests__/object-record-event-publisher.spec.ts`

- [ ] **Step 1: Failing test:** a subscriber scoped to `ownerId = wm-1` receives an event for their own record and does **not** receive one for `wm-2`'s record, with the same event emitted once.
- [ ] **Step 2:** Implement `buildRecordScopeGqlFilter`, translating the node into `RecordGqlOperationFilter` (`and`/`or`/`not` map to the filter's own `and`/`or`/`not`; comparisons map to `{ [fieldName]: { eq | neq | in | is } }`). Where the filter language cannot express a node, return `null` **and** fall back to `evaluateRecordScope` on the event payload rather than publishing unfiltered.
- [ ] **Step 3:** Assert the fallback explicitly: a node the filter language cannot express must still suppress the event for a non-matching subscriber.
- [ ] **Step 4: Mutation check.** Make the untranslatable branch `return null` with no fallback. The Step 3 assertion must fail. Revert.

---

### Task 15: Settings UI

**Files:** `packages/twenty-front/src/modules/settings/roles/record-scope/…`, `SettingsPath.ts`, `SettingsRoutes.tsx`.

- [ ] Rule list per (role, object), each row showing `label` and a human rendering of the expression.
- [ ] A builder restricted to what the model supports: pick a field, pick an operator, pick a literal or a principal attribute; group with AND/OR; negate.
- [ ] Copy that states the three things a user will otherwise get wrong: **rules add access, they do not filter it**; **several roles intersect, so the narrowest wins**; **API keys see nothing on an object whose rules mention a person**.
- [ ] An empty state that says "no rules — this role sees every record it has object access to", because a blank list must not read as "no access".

---

## 8. Deliberately cut

Per the charter, nothing is dropped silently. Each row has the concrete trigger that reopens it.

| Cut | Trigger to build |
| --- | --- |
| Range operators (`lt`/`lte`/`gt`/`gte`) | The first request for a date- or amount-bounded scope. The compiler and renderer already dispatch on operator; adding them is one case each plus parity rows. |
| Composite-field subfield subjects (`emails.primaryEmail`) | A workspace asks to scope by a composite subfield. Requires a `subFieldName` on the comparison node and relaxing the one-column rule in §3.2. |
| Cross-object predicates ("opportunities whose company is in my region") | Two workspaces ask. Breaks §1.1 closure and needs an `EXISTS` subquery, so it is a genuine redesign, not an extension. |
| Scope-aware record hand-off (reassigning a record out of your own scope) | The first support ticket where a rep cannot reassign their own account on leaving a territory. Likely shape: a per-object `allowScopeExit` flag consulted by `assertRecordsWithinRecordScope`. |
| Postgres-native RLS policies | An auditor requires enforcement below the application, or a direct-SQL analytics consumer appears. Needs a solved answer to `SET LOCAL` on a pooled connection first. |
| Per-operation scopes (read vs. write scoped differently) | A workspace asks for "see all, edit own". Today that is expressed with two roles and intersection, which is why it is cut. |
| Scope on `workspaceMember` itself | Never, without a separate design. `permissions.utils.ts:117-124` already treats `workspaceMember` as a special case, and scoping the directory breaks mentions, assignment and the approver lookup. |
| Audit records for scope denials | When the event-logs rewrite (audit Cluster 4.2) lands. Until then a denial is a structured log line plus, for approvals, the item's `error` column. |

---

## 9. Exit gate

The feature is done when all of the following have been run and their output recorded — not when the tasks are checked off.

1. `bash ../../scripts/lowmem.sh full` green from a clean install.
2. `record-scope-orm.integration-spec` — 12/12, including the `orWhere` bracket case and the zero-affected update case.
3. `record-scope-evaluator-parity.integration-spec` — 22/22.
4. `proposal-approval-record-scope.integration-spec` — an agent proposes a change to a record its approver cannot see; approval aborts with `OUT_OF_SCOPE`, the database row is byte-identical afterwards, and the correctly-scoped approver applies the same item successfully.
5. `grep -rl "@license Enterprise" packages | grep -i "row-level\|RowLevelPermission"` returns nothing.
6. `grep -rn "rowLevelPermissionPredicate" packages/twenty-server/src packages/twenty-front/src packages/twenty-shared/src packages/twenty-apps` returns nothing.
7. Each mutation check named in Tasks 5, 6, 8, 10, 11, 12 and 14 was performed and the named test went red.

Gate 4 is the one that matters. It is the only assertion in this document that proves the two halves of the product — the permission system and the approval layer — agree about who a write belongs to.
