import { isDefined } from 'twenty-shared/utils';

import { type FlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/types/flat-entity-maps.type';
import { type FlatObjectPermission } from 'src/engine/metadata-modules/flat-object-permission/types/flat-object-permission.type';
import { type FlatRole } from 'src/engine/metadata-modules/flat-role/types/flat-role.type';

export type CatalogObjectGrant = {
  canReadObjectRecords: boolean;
  canUpdateObjectRecords: boolean;
  canSoftDeleteObjectRecords: boolean;
};

const NO_GRANT: CatalogObjectGrant = {
  canReadObjectRecords: false,
  canUpdateObjectRecords: false,
  canSoftDeleteObjectRecords: false,
};

// The composed `rolesPermissions` cache grants every role full CRUD on any
// object flagged `isSystem` (see WorkspaceRolesPermissionsCacheService's
// `isSystem ? true : defaultValue`). That fallback exists so the app's own
// plumbing (attachments, targets, timeline) keeps working; it is not a grant
// the workspace admin made. Advertising tools off it hands a role with zero
// object permissions a full write catalog, so the catalog is derived here from
// what the role was actually granted: an explicit objectPermission row, or the
// role-level all-records flag.
export const getCatalogObjectGrants = ({
  roleIds,
  combineWith,
  flatRoleMaps,
  flatObjectPermissionMaps,
}: {
  roleIds: string[];
  combineWith: 'union' | 'intersection';
  flatRoleMaps: FlatEntityMaps<FlatRole>;
  flatObjectPermissionMaps: FlatEntityMaps<FlatObjectPermission>;
}): ((objectMetadataId: string) => CatalogObjectGrant) => {
  if (roleIds.length === 0) {
    return () => NO_GRANT;
  }

  const rolesById = new Map<string, FlatRole>();

  for (const roleId of roleIds) {
    const universalIdentifier = flatRoleMaps.universalIdentifierById[roleId];
    const flatRole = isDefined(universalIdentifier)
      ? flatRoleMaps.byUniversalIdentifier[universalIdentifier]
      : undefined;

    if (isDefined(flatRole)) {
      rolesById.set(roleId, flatRole);
    }
  }

  // A requested role that is missing from the cache contributes no grant, and
  // must not be silently dropped from an intersection.
  if (rolesById.size !== roleIds.length) {
    return () => NO_GRANT;
  }

  const explicitRowsByObjectId = new Map<
    string,
    Map<string, FlatObjectPermission>
  >();

  for (const flatObjectPermission of Object.values(
    flatObjectPermissionMaps.byUniversalIdentifier,
  )) {
    if (
      !isDefined(flatObjectPermission) ||
      !rolesById.has(flatObjectPermission.roleId)
    ) {
      continue;
    }

    const byRoleId =
      explicitRowsByObjectId.get(flatObjectPermission.objectMetadataId) ??
      new Map<string, FlatObjectPermission>();

    byRoleId.set(flatObjectPermission.roleId, flatObjectPermission);
    explicitRowsByObjectId.set(flatObjectPermission.objectMetadataId, byRoleId);
  }

  return (objectMetadataId: string): CatalogObjectGrant => {
    const rowsByRoleId = explicitRowsByObjectId.get(objectMetadataId);

    const perRoleGrants = roleIds.map((roleId) => {
      const flatRole = rolesById.get(roleId);
      const row = rowsByRoleId?.get(roleId);

      return {
        canReadObjectRecords:
          row?.canReadObjectRecords ??
          flatRole?.canReadAllObjectRecords ??
          false,
        canUpdateObjectRecords:
          row?.canUpdateObjectRecords ??
          flatRole?.canUpdateAllObjectRecords ??
          false,
        canSoftDeleteObjectRecords:
          row?.canSoftDeleteObjectRecords ??
          flatRole?.canSoftDeleteAllObjectRecords ??
          false,
      };
    });

    const combine = (pick: (grant: CatalogObjectGrant) => boolean) =>
      combineWith === 'intersection'
        ? perRoleGrants.every(pick)
        : perRoleGrants.some(pick);

    return {
      canReadObjectRecords: combine((grant) => grant.canReadObjectRecords),
      canUpdateObjectRecords: combine((grant) => grant.canUpdateObjectRecords),
      canSoftDeleteObjectRecords: combine(
        (grant) => grant.canSoftDeleteObjectRecords,
      ),
    };
  };
};
