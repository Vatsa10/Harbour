// SeaRM: clean-room AGPL-3.0 rewrite. See
// .superpowers/sdd/enterprise-rewrite/rlp-recon.md for design notes.
// Thin composition of role resolution + record filter building, used by the
// joined-relation predicate loop in workspace-select-query-builder.ts. A
// caller that gets `null` back must treat it as "no additional restriction",
// never as "skip the predicate step entirely" — that distinction is handled
// by the caller checking shouldBypassPermissionChecks before ever getting
// here.
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type RecordGqlOperationFilter } from 'twenty-shared/types';
import { type WorkspaceInternalContext } from 'src/engine/twenty-orm/interfaces/workspace-internal-context.interface';
import { buildRowLevelPermissionRecordFilter } from 'src/engine/twenty-orm/utils/build-row-level-permission-record-filter.util';
import { resolveRoleIdsFromAuthContext } from 'src/engine/twenty-orm/utils/resolve-role-ids-from-auth-context.util';

export const resolveRowLevelPermissionRecordFilter = ({
  internalContext,
  authContext,
  objectMetadata,
}: {
  internalContext: WorkspaceInternalContext;
  authContext: WorkspaceAuthContext;
  objectMetadata: FlatObjectMetadata;
}): RecordGqlOperationFilter | null => {
  const roleIds = resolveRoleIdsFromAuthContext({
    authContext,
    userWorkspaceRoleMap: internalContext.userWorkspaceRoleMap,
    apiKeyRoleMap: internalContext.apiKeyRoleMap,
  });

  return buildRowLevelPermissionRecordFilter({
    flatRowLevelPermissionPredicateMaps:
      internalContext.flatRowLevelPermissionPredicateMaps,
    flatRowLevelPermissionPredicateGroupMaps:
      internalContext.flatRowLevelPermissionPredicateGroupMaps,
    flatFieldMetadataMaps: internalContext.flatFieldMetadataMaps,
    objectMetadata,
    roleIds,
  });
};
