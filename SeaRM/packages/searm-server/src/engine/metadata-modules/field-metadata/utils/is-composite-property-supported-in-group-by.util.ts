import { type CompositeProperty, FieldMetadataType } from 'searm-shared/types';

export const isCompositePropertySupportedInGroupBy = (
  property: CompositeProperty,
): boolean => {
  return (
    property.hidden !== true && property.type !== FieldMetadataType.RAW_JSON
  );
};
