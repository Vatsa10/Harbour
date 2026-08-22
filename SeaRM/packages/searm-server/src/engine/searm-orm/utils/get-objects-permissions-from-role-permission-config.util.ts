import {
  type ObjectsPermissions,
  type ObjectsPermissionsByRoleId,
} from 'searm-shared/types';
import { isDefined, isNonEmptyArray } from 'searm-shared/utils';

import { type RolePermissionConfig } from 'src/engine/searm-orm/types/role-permission-config';
import { computePermissionIntersection } from 'src/engine/searm-orm/utils/compute-permission-intersection.util';

export const getObjectsPermissionsFromRolePermissionConfig = ({
  rolesPermissions,
  rolePermissionConfig,
}: {
  rolesPermissions: ObjectsPermissionsByRoleId;
  rolePermissionConfig: RolePermissionConfig;
}): ObjectsPermissions => {
  if ('shouldBypassPermissionChecks' in rolePermissionConfig) {
    return {};
  }

  if ('intersectionOf' in rolePermissionConfig) {
    const permissionsPerRole = rolePermissionConfig.intersectionOf
      .map((roleId) => rolesPermissions[roleId])
      .filter(isDefined);

    if (
      !isNonEmptyArray(permissionsPerRole) ||
      permissionsPerRole.length !== rolePermissionConfig.intersectionOf.length
    ) {
      return {};
    }

    return computePermissionIntersection(permissionsPerRole);
  }

  // Multi-role union is unimplemented and every producer emits one role, so
  // taking the first is exact rather than lossy.
  if ('unionOf' in rolePermissionConfig) {
    const roleId = rolePermissionConfig.unionOf[0];

    return isDefined(roleId) ? (rolesPermissions[roleId] ?? {}) : {};
  }

  return {};
};
