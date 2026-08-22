import { type ObjectPermissions } from 'searm-shared/types';

type GetObjectPermissionsFromMapByObjectIdArgs = {
  objectPermissionsByObjectMetadataId: Record<
    string,
    ObjectPermissions & { objectMetadataId: string }
  >;
  objectMetadataId: string;
};

export const getObjectPermissionsFromMapByObjectMetadataId = ({
  objectPermissionsByObjectMetadataId,
  objectMetadataId,
}: GetObjectPermissionsFromMapByObjectIdArgs) => {
  return (
    objectPermissionsByObjectMetadataId[objectMetadataId] ?? {
      canReadObjectRecords: true,
      canUpdateObjectRecords: true,
      canCreateObjectRecords: true,
      canDeleteObjectRecords: true,
      restrictedFields: {},
      rowLevelPermissionPredicates: [],
      rowLevelPermissionPredicateGroups: [],
    }
  );
};
