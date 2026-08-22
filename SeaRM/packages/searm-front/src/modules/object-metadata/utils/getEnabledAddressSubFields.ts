import { DEFAULT_VISIBLE_ADDRESS_SUBFIELDS } from 'searm-shared/constants';
import {
  type AllowedAddressSubField,
  type FieldMetadataSettingsMapping,
  type FieldMetadataType,
} from 'searm-shared/types';
import { isNonEmptyArray } from 'searm-shared/utils';

export const getEnabledAddressSubFields = (
  settings:
    | FieldMetadataSettingsMapping[FieldMetadataType.ADDRESS]
    | null
    | undefined,
): readonly AllowedAddressSubField[] => {
  if (isNonEmptyArray(settings?.subFields)) {
    return settings.subFields;
  }
  return DEFAULT_VISIBLE_ADDRESS_SUBFIELDS;
};
