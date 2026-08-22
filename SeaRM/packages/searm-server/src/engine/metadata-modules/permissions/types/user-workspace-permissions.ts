import { type ObjectsPermissions } from 'searm-shared/types';
import { type PermissionFlagType } from 'searm-shared/constants';

export type UserWorkspacePermissions = {
  permissionFlags: Record<PermissionFlagType, boolean>;
  objectsPermissions: ObjectsPermissions;
};
