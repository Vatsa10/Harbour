import { type ObjectPermissions } from 'searm-shared/types';
import { isDefined } from 'searm-shared/utils';

export const checkFieldPermissions = (
  fieldMetadataIds: string[],
  objectPermissions: ObjectPermissions,
): boolean => {
  const { restrictedFields } = objectPermissions;

  const hasInaccessibleField = fieldMetadataIds.some((fieldId) => {
    const fieldPermission = restrictedFields[fieldId];

    if (!isDefined(fieldPermission)) {
      return false;
    }

    return fieldPermission.canRead === false;
  });

  return !hasInaccessibleField;
};
