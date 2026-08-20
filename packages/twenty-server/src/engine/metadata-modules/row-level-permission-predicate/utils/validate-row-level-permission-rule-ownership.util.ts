// SeaRM — AGPL-3.0. Clean-room, from-scratch design (no Enterprise source
// consulted; the original util and its spec are Enterprise-headered and
// were never opened). Contract designed by this rewrite, evidenced by:
//   - packages/twenty-server/src/engine/metadata-modules/role/tools/upsert-row-level-permission-rules.tool.ts
//     which calls RowLevelPermissionPredicateService.upsertRowLevelPermissionPredicates
//     with { roleId, objectMetadataId, predicates, predicateGroups } and
//     documents "this replaces the full rule set for the role + object" —
//     i.e. predicates/groups are always upserted *within* a single
//     (roleId, objectMetadataId) scope, so any input `id` that resolves to
//     an existing row owned by a *different* role or object is not a
//     legitimate update target.
//   - the workspace-migration validators pattern (e.g.
//     flat-row-level-permission-predicate-validator.service.ts) of failing
//     the whole build rather than silently dropping an invalid entity.
//
// SECURITY BAR: row-level-permission predicates gate user A from reading
// user B's rows. Ownership rules enforced here, and why each exists:
//   1. An input predicate/group carrying an `id` that does not exist in the
//      caller's own (roleId, objectMetadataId) scope is REJECTED (thrown),
//      never silently treated as "create new" or silently skipped — this
//      stops a caller from hijacking (updating/relocating) another role's
//      or another object's predicate by guessing/reusing its id, which
//      would let them either widen their own access or quietly weaken an
//      unrelated role's restriction.
//   2. A predicate's rowLevelPermissionPredicateGroupId must reference a
//      group that is itself part of this same upsert (being created or
//      already owned by this roleId+objectMetadataId) — a dangling or
//      foreign group reference is REJECTED rather than persisted as a
//      predicate with no effective group, because an orphaned/foreign
//      group reference can resolve to "no restriction" downstream.
//   3. A group's parentRowLevelPermissionPredicateGroupId must reference a
//      group owned by this same roleId+objectMetadataId (existing or newly
//      created) — rejecting foreign parents prevents cross-role group tree
//      splicing.
// In every case the failure mode is DENY (throw), never a silent skip,
// per the "fail closed" bar for this domain.

import { isDefined } from 'twenty-shared/utils';

import {
  type RowLevelPermissionPredicateGroupInput,
  type RowLevelPermissionPredicateInput,
} from 'src/engine/metadata-modules/row-level-permission-predicate/dtos/inputs/upsert-row-level-permission-predicates.input';
import {
  generateRowLevelPermissionPredicateGroupExceptionMessage,
  RowLevelPermissionPredicateGroupException,
  RowLevelPermissionPredicateGroupExceptionCode,
  RowLevelPermissionPredicateGroupExceptionMessageKey,
} from 'src/engine/metadata-modules/row-level-permission-predicate/exceptions/row-level-permission-predicate-group.exception';
import {
  generateRowLevelPermissionPredicateExceptionMessage,
  RowLevelPermissionPredicateException,
  RowLevelPermissionPredicateExceptionCode,
  RowLevelPermissionPredicateExceptionMessageKey,
} from 'src/engine/metadata-modules/row-level-permission-predicate/exceptions/row-level-permission-predicate.exception';
import { type FlatRowLevelPermissionPredicateGroupMaps } from 'src/engine/metadata-modules/row-level-permission-predicate/types/flat-row-level-permission-predicate-group-maps.type';
import { type FlatRowLevelPermissionPredicateMaps } from 'src/engine/metadata-modules/row-level-permission-predicate/types/flat-row-level-permission-predicate-maps.type';

export type ValidateRowLevelPermissionRuleOwnershipArgs = {
  roleId: string;
  objectMetadataId: string;
  predicates: RowLevelPermissionPredicateInput[];
  predicateGroups: RowLevelPermissionPredicateGroupInput[];
  existingFlatRowLevelPermissionPredicateMaps: FlatRowLevelPermissionPredicateMaps;
  existingFlatRowLevelPermissionPredicateGroupMaps: FlatRowLevelPermissionPredicateGroupMaps;
};

export const validateRowLevelPermissionRuleOwnershipOrThrow = ({
  roleId,
  objectMetadataId,
  predicates,
  predicateGroups,
  existingFlatRowLevelPermissionPredicateMaps,
  existingFlatRowLevelPermissionPredicateGroupMaps,
}: ValidateRowLevelPermissionRuleOwnershipArgs): void => {
  const incomingGroupIds = new Set(
    predicateGroups
      .map((predicateGroup) => predicateGroup.id)
      .filter(isDefined),
  );

  // A group id that does not exist yet is a legitimate client-generated id
  // for a *new* group (see the tool's input schema docs). Ownership only
  // needs to be enforced for ids that already resolve to a persisted group
  // — that is the only case where "update" could hijack someone else's row.
  const existsInGroupMaps = (groupId: string): boolean =>
    isDefined(
      existingFlatRowLevelPermissionPredicateGroupMaps.universalIdentifierById[
        groupId
      ],
    );

  const isGroupOwnedByRoleAndObject = (groupId: string): boolean => {
    const universalIdentifier =
      existingFlatRowLevelPermissionPredicateGroupMaps.universalIdentifierById[
        groupId
      ];

    if (!isDefined(universalIdentifier)) {
      return false;
    }

    const existingGroup =
      existingFlatRowLevelPermissionPredicateGroupMaps.byUniversalIdentifier[
        universalIdentifier
      ];

    return (
      isDefined(existingGroup) &&
      existingGroup.roleId === roleId &&
      existingGroup.objectMetadataId === objectMetadataId
    );
  };

  for (const predicateGroup of predicateGroups) {
    if (
      isDefined(predicateGroup.id) &&
      existsInGroupMaps(predicateGroup.id) &&
      !isGroupOwnedByRoleAndObject(predicateGroup.id)
    ) {
      throw new RowLevelPermissionPredicateGroupException(
        generateRowLevelPermissionPredicateGroupExceptionMessage(
          RowLevelPermissionPredicateGroupExceptionMessageKey.ROW_LEVEL_PERMISSION_PREDICATE_GROUP_NOT_FOUND,
          predicateGroup.id,
        ),
        RowLevelPermissionPredicateGroupExceptionCode.ROW_LEVEL_PERMISSION_PREDICATE_GROUP_NOT_FOUND,
      );
    }

    const parentGroupId =
      predicateGroup.parentRowLevelPermissionPredicateGroupId;

    if (
      isDefined(parentGroupId) &&
      !incomingGroupIds.has(parentGroupId) &&
      !isGroupOwnedByRoleAndObject(parentGroupId)
    ) {
      throw new RowLevelPermissionPredicateGroupException(
        generateRowLevelPermissionPredicateGroupExceptionMessage(
          RowLevelPermissionPredicateGroupExceptionMessageKey.INVALID_ROW_LEVEL_PERMISSION_PREDICATE_GROUP_DATA,
          predicateGroup.id,
        ),
        RowLevelPermissionPredicateGroupExceptionCode.INVALID_ROW_LEVEL_PERMISSION_PREDICATE_GROUP_DATA,
      );
    }
  }

  for (const predicate of predicates) {
    if (isDefined(predicate.id)) {
      const universalIdentifier =
        existingFlatRowLevelPermissionPredicateMaps.universalIdentifierById[
          predicate.id
        ];
      const existingPredicate = isDefined(universalIdentifier)
        ? existingFlatRowLevelPermissionPredicateMaps.byUniversalIdentifier[
            universalIdentifier
          ]
        : undefined;

      if (
        !isDefined(existingPredicate) ||
        existingPredicate.roleId !== roleId ||
        existingPredicate.objectMetadataId !== objectMetadataId
      ) {
        throw new RowLevelPermissionPredicateException(
          generateRowLevelPermissionPredicateExceptionMessage(
            RowLevelPermissionPredicateExceptionMessageKey.ROW_LEVEL_PERMISSION_PREDICATE_NOT_FOUND,
            predicate.id,
          ),
          RowLevelPermissionPredicateExceptionCode.ROW_LEVEL_PERMISSION_PREDICATE_NOT_FOUND,
        );
      }
    }

    const groupId = predicate.rowLevelPermissionPredicateGroupId;

    if (
      isDefined(groupId) &&
      !incomingGroupIds.has(groupId) &&
      !isGroupOwnedByRoleAndObject(groupId)
    ) {
      throw new RowLevelPermissionPredicateException(
        generateRowLevelPermissionPredicateExceptionMessage(
          RowLevelPermissionPredicateExceptionMessageKey.INVALID_ROW_LEVEL_PERMISSION_PREDICATE_DATA,
          predicate.id,
        ),
        RowLevelPermissionPredicateExceptionCode.INVALID_ROW_LEVEL_PERMISSION_PREDICATE_DATA,
      );
    }
  }
};
