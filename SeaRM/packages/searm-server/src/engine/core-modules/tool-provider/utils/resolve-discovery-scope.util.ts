import { PermissionFlagType } from 'searm-shared/constants';
import { type ObjectsPermissions } from 'searm-shared/types';

import { type ToolProviderContext } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider-context.type';
import { type PermissionsService } from 'src/engine/metadata-modules/permissions/permissions.service';
import { getObjectsPermissionsFromRolePermissionConfig } from 'src/engine/searm-orm/utils/get-objects-permissions-from-role-permission-config.util';
import { type WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

export type DiscoveryScope = {
  isUnscoped: boolean;
  objectPermissions: ObjectsPermissions;
};

// The metadata discovery scope for one caller, defined once so that
// get_object_metadata and get_field_metadata can never disagree about what
// exists. `isUnscoped` covers both a permission-bypassing context and a
// DATA_MODEL role: getObjectsPermissionsFromRolePermissionConfig returns {}
// for a bypass config, so without this short-circuit an unrestricted caller
// would discover nothing at all.
export const resolveDiscoveryScope = async ({
  context,
  permissionsService,
  workspaceCacheService,
}: {
  context: ToolProviderContext;
  permissionsService: PermissionsService;
  workspaceCacheService: WorkspaceCacheService;
}): Promise<DiscoveryScope> => {
  if ('shouldBypassPermissionChecks' in context.rolePermissionConfig) {
    return { isUnscoped: true, objectPermissions: {} };
  }

  const hasDataModelPermission =
    await permissionsService.checkRolesPermissions(
      context.rolePermissionConfig,
      context.workspaceId,
      PermissionFlagType.DATA_MODEL,
    );

  const { rolesPermissions } = await workspaceCacheService.getOrRecompute(
    context.workspaceId,
    ['rolesPermissions'],
  );

  return {
    isUnscoped: hasDataModelPermission,
    // Returns a Record keyed by objectMetadataId, never an array.
    objectPermissions: getObjectsPermissionsFromRolePermissionConfig({
      rolesPermissions,
      rolePermissionConfig: context.rolePermissionConfig,
    }),
  };
};
