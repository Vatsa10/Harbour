// SeaRM: clean-room AGPL-3.0 rewrite. See
// .superpowers/sdd/enterprise-rewrite/rlp-recon.md for design notes.
// Resolves the set of row level permission predicates that apply to a given
// object for a set of role ids into a single RecordGqlOperationFilter-shaped
// object. A role with no predicates for this object is UNRESTRICTED for that
// role only — the caller combines multiple roles by intersecting (AND) their
// individual filters, so an unrestricted role never widens access granted by
// a restricted one. No predicates resolved at all (empty roleIds, or none of
// the roles have any predicate) returns null, meaning "apply no additional
// restriction" — this is intentional: RLP predicates are opt-in restrictions
// layered on top of object/field permission checks, not the sole gate.
import { isDefined } from 'searm-shared/utils';
import {
  FieldMetadataType,
  type RecordGqlOperationFilter,
} from 'searm-shared/types';

import { findFlatEntityByIdInFlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/utils/find-flat-entity-by-id-in-flat-entity-maps.util';
import { type FlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/types/flat-entity-maps.type';
import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { RowLevelPermissionPredicateOperand } from 'searm-shared/types';
import { RowLevelPermissionPredicateGroupLogicalOperator } from 'searm-shared/types';
import { type FlatRowLevelPermissionPredicate } from 'src/engine/metadata-modules/row-level-permission-predicate/types/flat-row-level-permission-predicate.type';
import { type FlatRowLevelPermissionPredicateGroup } from 'src/engine/metadata-modules/row-level-permission-predicate/types/flat-row-level-permission-predicate-group.type';
import { type FlatRowLevelPermissionPredicateMaps } from 'src/engine/metadata-modules/row-level-permission-predicate/types/flat-row-level-permission-predicate-maps.type';
import { type FlatRowLevelPermissionPredicateGroupMaps } from 'src/engine/metadata-modules/row-level-permission-predicate/types/flat-row-level-permission-predicate-group-maps.type';

const resolveFieldKeyAndFieldMetadata = ({
  predicate,
  flatFieldMetadataMaps,
}: {
  predicate: FlatRowLevelPermissionPredicate;
  flatFieldMetadataMaps: FlatEntityMaps<FlatFieldMetadata>;
}): { key: string; fieldMetadata: FlatFieldMetadata } => {
  const fieldMetadata = findFlatEntityByIdInFlatEntityMaps({
    flatEntityId: predicate.fieldMetadataId,
    flatEntityMaps: flatFieldMetadataMaps,
  });

  if (!isDefined(fieldMetadata)) {
    throw new Error(
      `Row level permission predicate references an unknown field metadata id "${predicate.fieldMetadataId}"`,
    );
  }

  const joinColumnName =
    fieldMetadata.type === FieldMetadataType.RELATION
      ? (fieldMetadata.settings as { joinColumnName?: string } | undefined)
          ?.joinColumnName
      : undefined;

  return {
    key: joinColumnName ?? fieldMetadata.name,
    fieldMetadata,
  };
};

const UNSATISFIABLE_UUID = '00000000-0000-0000-0000-000000000000';

const renderPredicateToFilter = ({
  predicate,
  flatFieldMetadataMaps,
  workspaceMember,
}: {
  predicate: FlatRowLevelPermissionPredicate;
  flatFieldMetadataMaps: FlatEntityMaps<FlatFieldMetadata>;
  workspaceMember: { id: string } | undefined;
}): RecordGqlOperationFilter => {
  const { key } = resolveFieldKeyAndFieldMetadata({
    predicate,
    flatFieldMetadataMaps,
  });

  // A predicate anchored to "the current workspace member" (e.g. "assigned
  // to me") cannot be evaluated without a workspace member in context (API
  // key / application auth). Deny by default rather than silently dropping
  // the restriction: render an always-false condition instead of skipping.
  if (isDefined(predicate.workspaceMemberFieldMetadataId)) {
    if (!isDefined(workspaceMember)) {
      return {
        [key]: { eq: UNSATISFIABLE_UUID },
      } as unknown as RecordGqlOperationFilter;
    }

    return {
      [key]: { eq: workspaceMember.id },
    } as unknown as RecordGqlOperationFilter;
  }

  const buildOperatorCondition = (): Record<string, unknown> => {
    switch (predicate.operand) {
      case RowLevelPermissionPredicateOperand.CONTAINS:
        return { ilike: `%${predicate.value}%` };
      case RowLevelPermissionPredicateOperand.DOES_NOT_CONTAIN:
        return { ilike: `%${predicate.value}%` };
      case RowLevelPermissionPredicateOperand.LESS_THAN_OR_EQUAL:
      case RowLevelPermissionPredicateOperand.IS_BEFORE:
        return { lte: predicate.value };
      case RowLevelPermissionPredicateOperand.GREATER_THAN_OR_EQUAL:
      case RowLevelPermissionPredicateOperand.IS_AFTER:
        return { gte: predicate.value };
      case RowLevelPermissionPredicateOperand.IS:
        return { eq: predicate.value };
      case RowLevelPermissionPredicateOperand.IS_NOT:
        return { eq: predicate.value };
      case RowLevelPermissionPredicateOperand.IS_EMPTY:
        return { is: 'NULL' };
      case RowLevelPermissionPredicateOperand.IS_NOT_EMPTY:
      case RowLevelPermissionPredicateOperand.IS_NOT_NULL:
        return { is: 'NOT_NULL' };
      default:
        // Deny-by-default: an operand we cannot faithfully render must never
        // silently degrade into "no restriction" — that would widen access.
        throw new Error(
          `Row level permission predicate operand "${predicate.operand}" is not supported by this build`,
        );
    }
  };

  const operatorCondition = buildOperatorCondition();

  const negate =
    predicate.operand === RowLevelPermissionPredicateOperand.DOES_NOT_CONTAIN ||
    predicate.operand === RowLevelPermissionPredicateOperand.IS_NOT;

  const leafFilter: RecordGqlOperationFilter = isDefined(
    predicate.subFieldName,
  )
    ? ({
        [key]: { [predicate.subFieldName]: operatorCondition },
      } as unknown as RecordGqlOperationFilter)
    : ({ [key]: operatorCondition } as unknown as RecordGqlOperationFilter);

  return negate
    ? ({ not: leafFilter } as unknown as RecordGqlOperationFilter)
    : leafFilter;
};

const combineFilters = (
  filters: RecordGqlOperationFilter[],
  operator: 'and' | 'or',
): RecordGqlOperationFilter | null => {
  if (filters.length === 0) {
    return null;
  }

  if (filters.length === 1) {
    return filters[0];
  }

  return { [operator]: filters } as unknown as RecordGqlOperationFilter;
};

const renderGroupToFilter = ({
  group,
  roleId,
  flatFieldMetadataMaps,
  flatRowLevelPermissionPredicateMaps,
  flatRowLevelPermissionPredicateGroupMaps,
  workspaceMember,
}: {
  group: FlatRowLevelPermissionPredicateGroup;
  roleId: string;
  flatFieldMetadataMaps: FlatEntityMaps<FlatFieldMetadata>;
  flatRowLevelPermissionPredicateMaps: FlatRowLevelPermissionPredicateMaps;
  flatRowLevelPermissionPredicateGroupMaps: FlatRowLevelPermissionPredicateGroupMaps;
  workspaceMember: { id: string } | undefined;
}): RecordGqlOperationFilter | null => {
  const predicateFilters = group.rowLevelPermissionPredicateIds
    .map((predicateId) =>
      findFlatEntityByIdInFlatEntityMaps({
        flatEntityId: predicateId,
        flatEntityMaps: flatRowLevelPermissionPredicateMaps,
      }),
    )
    .filter(isDefined)
    .filter((predicate) => predicate.roleId === roleId)
    .map((predicate) =>
      renderPredicateToFilter({ predicate, flatFieldMetadataMaps, workspaceMember }),
    );

  const childGroupFilters = group.childRowLevelPermissionPredicateGroupIds
    .map((childGroupId) =>
      findFlatEntityByIdInFlatEntityMaps({
        flatEntityId: childGroupId,
        flatEntityMaps: flatRowLevelPermissionPredicateGroupMaps,
      }),
    )
    .filter(isDefined)
    .map((childGroup) =>
      renderGroupToFilter({
        group: childGroup,
        roleId,
        flatFieldMetadataMaps,
        flatRowLevelPermissionPredicateMaps,
        flatRowLevelPermissionPredicateGroupMaps,
        workspaceMember,
      }),
    )
    .filter(isDefined);

  const logicalOperator =
    group.logicalOperator === RowLevelPermissionPredicateGroupLogicalOperator.OR
      ? 'or'
      : 'and';

  return combineFilters(
    [...predicateFilters, ...childGroupFilters],
    logicalOperator,
  );
};

const buildFilterForRole = ({
  roleId,
  objectMetadata,
  flatFieldMetadataMaps,
  flatRowLevelPermissionPredicateMaps,
  flatRowLevelPermissionPredicateGroupMaps,
  workspaceMember,
}: {
  roleId: string;
  objectMetadata: FlatObjectMetadata;
  flatFieldMetadataMaps: FlatEntityMaps<FlatFieldMetadata>;
  flatRowLevelPermissionPredicateMaps: FlatRowLevelPermissionPredicateMaps;
  flatRowLevelPermissionPredicateGroupMaps: FlatRowLevelPermissionPredicateGroupMaps;
  workspaceMember: { id: string } | undefined;
}): RecordGqlOperationFilter | null => {
  const ungroupedPredicateFilters = Object.values(
    flatRowLevelPermissionPredicateMaps.byUniversalIdentifier,
  )
    .filter(isDefined)
    .filter(
      (predicate) =>
        predicate.roleId === roleId &&
        predicate.objectMetadataId === objectMetadata.id &&
        !isDefined(predicate.rowLevelPermissionPredicateGroupId),
    )
    .map((predicate) =>
      renderPredicateToFilter({ predicate, flatFieldMetadataMaps, workspaceMember }),
    );

  const topLevelGroupFilters = Object.values(
    flatRowLevelPermissionPredicateGroupMaps.byUniversalIdentifier,
  )
    .filter(isDefined)
    .filter(
      (group) =>
        group.roleId === roleId &&
        group.objectMetadataId === objectMetadata.id &&
        !isDefined(group.parentRowLevelPermissionPredicateGroupId),
    )
    .map((group) =>
      renderGroupToFilter({
        group,
        roleId,
        flatFieldMetadataMaps,
        flatRowLevelPermissionPredicateMaps,
        flatRowLevelPermissionPredicateGroupMaps,
        workspaceMember,
      }),
    )
    .filter(isDefined);

  return combineFilters(
    [...ungroupedPredicateFilters, ...topLevelGroupFilters],
    'and',
  );
};

export const buildRowLevelPermissionRecordFilter = ({
  flatRowLevelPermissionPredicateMaps,
  flatRowLevelPermissionPredicateGroupMaps,
  flatFieldMetadataMaps,
  objectMetadata,
  roleIds,
  workspaceMember,
}: {
  flatRowLevelPermissionPredicateMaps: FlatRowLevelPermissionPredicateMaps;
  flatRowLevelPermissionPredicateGroupMaps: FlatRowLevelPermissionPredicateGroupMaps;
  flatFieldMetadataMaps: FlatEntityMaps<FlatFieldMetadata>;
  objectMetadata: FlatObjectMetadata;
  roleIds: string[];
  workspaceMember?: { id: string } | undefined;
}): RecordGqlOperationFilter | null => {
  const perRoleFilters = roleIds
    .map((roleId) =>
      buildFilterForRole({
        roleId,
        objectMetadata,
        flatFieldMetadataMaps,
        flatRowLevelPermissionPredicateMaps,
        flatRowLevelPermissionPredicateGroupMaps,
        workspaceMember,
      }),
    )
    .filter(isDefined);

  return combineFilters(perRoleFilters, 'and');
};
