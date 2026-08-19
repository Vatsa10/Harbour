// SeaRM: clean-room AGPL-3.0 rewrite. See
// .superpowers/sdd/enterprise-rewrite/rlp-recon.md for design notes.
// No entitlement/license gating: row level permission predicates are
// unconditionally live for every workspace. A missing, empty, or
// unresolvable predicate set applies NO where clause, which is safe — it
// simply means "no additional restriction for this role", not "bypass
// checks". Access control itself (shouldBypassPermissionChecks) is
// enforced by the caller before this is ever invoked.
import { isDefined } from 'twenty-shared/utils';
import { Brackets, type ObjectLiteral } from 'typeorm';

import { type FeatureFlagMap } from 'src/engine/core-modules/feature-flag/interfaces/feature-flag-map.interface';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type WorkspaceInternalContext } from 'src/engine/twenty-orm/interfaces/workspace-internal-context.interface';
import { type WorkspaceSelectQueryBuilder } from 'src/engine/twenty-orm/repository/workspace-select-query-builder';
import { buildRowLevelPermissionRecordFilter } from 'src/engine/twenty-orm/utils/build-row-level-permission-record-filter.util';
import { renderRowLevelPermissionFilterToSql } from 'src/engine/twenty-orm/utils/render-row-level-permission-filter-to-sql.util';
import { resolveRoleIdsFromAuthContext } from 'src/engine/twenty-orm/utils/resolve-role-ids-from-auth-context.util';

const QUERY_TYPES_USING_MAIN_TABLE_ALIAS = new Set(['select']);

export const applyRowLevelPermissionPredicates = <T extends ObjectLiteral>({
  queryBuilder,
  objectMetadata,
  internalContext,
  authContext,
  featureFlagMap: _featureFlagMap,
}: {
  queryBuilder: WorkspaceSelectQueryBuilder<T>;
  objectMetadata: FlatObjectMetadata;
  internalContext: WorkspaceInternalContext;
  authContext: WorkspaceAuthContext;
  featureFlagMap: FeatureFlagMap;
}): void => {
  const roleIds = resolveRoleIdsFromAuthContext({
    authContext,
    userWorkspaceRoleMap: internalContext.userWorkspaceRoleMap,
    apiKeyRoleMap: internalContext.apiKeyRoleMap,
  });

  const recordFilter = buildRowLevelPermissionRecordFilter({
    flatRowLevelPermissionPredicateMaps:
      internalContext.flatRowLevelPermissionPredicateMaps,
    flatRowLevelPermissionPredicateGroupMaps:
      internalContext.flatRowLevelPermissionPredicateGroupMaps,
    flatFieldMetadataMaps: internalContext.flatFieldMetadataMaps,
    objectMetadata,
    roleIds,
  });

  if (!isDefined(recordFilter) || Object.keys(recordFilter).length === 0) {
    return;
  }

  const queryType = queryBuilder.expressionMap.queryType;
  const tableAlias = QUERY_TYPES_USING_MAIN_TABLE_ALIAS.has(queryType)
    ? objectMetadata.nameSingular
    : undefined;

  const renderedCondition = renderRowLevelPermissionFilterToSql({
    tableAlias,
    objectMetadata,
    flatFieldMetadataMaps: internalContext.flatFieldMetadataMaps,
    recordFilter,
  });

  if (!isDefined(renderedCondition)) {
    return;
  }

  const applyMethod =
    queryBuilder.expressionMap.wheres.length > 0 ? 'andWhere' : 'where';

  queryBuilder[applyMethod](
    new Brackets((qb) => {
      qb.where(renderedCondition.sql, renderedCondition.parameters);
    }),
  );
};
