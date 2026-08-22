import { type ObjectPermissions } from 'searm-shared/types';

type GetNonReadableFieldMetadataIdsFromObjectPermissionsArgs = {
  objectPermissions: ObjectPermissions;
};

export const getNonReadableFieldMetadataIdsFromObjectPermissions = ({
  objectPermissions,
}: GetNonReadableFieldMetadataIdsFromObjectPermissionsArgs) => {
  const restrictedFields = objectPermissions.restrictedFields;

  return Object.entries(restrictedFields)
    .filter(([_, restrictedField]) => restrictedField.canRead === false)
    .map(([fieldMetadataId]) => fieldMetadataId);
};
