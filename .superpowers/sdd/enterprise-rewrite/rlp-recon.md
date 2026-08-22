# RLP clean-room rewrite — recon (SETTLED, do not re-derive)

Three agent cycles produced this recon and no code. It is complete. The next
run must OPEN WITH FILE WRITES.

## Clean-room status
Zero Enterprise-headered files have been opened at any point across all runs.

## Call-site contract (grep-verified)

Two entry points:
- `applyRowLevelPermissionPredicates` — private, main alias only
- `applyRowLevelPermissionPredicatesToMainAliasAndJoinedRelations` — used by
  delete / mutation / group-by / nested-relation subqueries

Both invoked with:
`{ queryBuilder, objectMetadata, internalContext, authContext, featureFlagMap }`

The join loop consults `hasRowLevelPermissionPredicateApplied` and
`shouldBypassPermissionChecks`.

Confirmed AGPL call sites:
- `searm-orm/repository/workspace-delete-query-builder.ts:27,76`
- `api/common/common-nested-relations-processor/process-nested-relations-v2.helper.ts:510`
- `api/common/common-query-runners/utils/build-mutation-query-builder.util.ts:46`
- `api/graphql/graphql-query-runner/group-by/services/group-by-with-records.service.ts:203`
- `workspace-select-query-builder.ts` (~:425)

## Safe to READ (non-Enterprise) — these are the specification

4 mappers in `flat-row-level-permission-predicate/utils/`:
- `from-create-row-level-permission-predicate-group-input-to-flat-*`
- `from-create-row-level-permission-predicate-input-to-flat-*`
- the two `from-update-*` equivalents

5 specs:
- `row-level-permission-predicate-graphql-api-exception-handler.util.spec.ts`
- `searm-orm/utils/__tests__/apply-row-level-permission-predicates*`
- `searm-orm/utils/__tests__/build-row-level-permission-record-filter*`
- `searm-orm/utils/__tests__/is-record-matching-rls-row-level-permission-predicate*`
- `searm-orm/utils/__tests__/render-row-level-permission-filter-to-sql*`

## FORBIDDEN to open
`validate-row-level-permission-rule-ownership.util.spec.ts` — re-confirmed
Enterprise-headered. Not opened. Plus all 31 Enterprise sources.

## Why one-shot dispatch keeps failing
The chain spec -> 31 files -> deletions -> migration -> typecheck -> tests ->
isolation mutation proof -> boot is multi-hour. Agents reach budget during
recon and correctly refuse to fabricate verification.

## Required shape: three phases, COMMIT AT EACH BOUNDARY
1. Spec + implementation (write files; do not delete originals)
2. Delete Enterprise originals + migration/INSTANCE_COMMANDS
3. Verification: typecheck, specs, isolation RED/GREEN mutation proof, boot

## The security bar that does not move
RLP is what stops user A reading user B's rows, and billing's
`hasRowLevelPermissionFeature()` gate was removed in 2b59a3620f, so this code
is now unconditionally live for every workspace. A rewrite that applies no
predicate leaks every row across roles and looks green in any test asserting
only "the query returned rows". Missing/empty predicate set MUST mean DENY,
structurally. The isolation test (select, join, delete) mutation-checked by
no-oping the predicate is the single most important deliverable.
