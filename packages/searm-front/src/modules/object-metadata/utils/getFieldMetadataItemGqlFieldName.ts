import { type FieldMetadataItem } from '@/object-metadata/types/FieldMetadataItem';
import { isManyToOneRelationField } from '@/object-metadata/utils/isManyToOneRelationField';
import { computeRelationGqlFieldJoinColumnName } from 'searm-shared/utils';

export const getFieldMetadataItemGqlFieldName = (
  fieldMetadataItem: Pick<FieldMetadataItem, 'name' | 'type' | 'relation'>,
): string => {
  if (isManyToOneRelationField(fieldMetadataItem)) {
    return computeRelationGqlFieldJoinColumnName({
      name: fieldMetadataItem.name,
    });
  }

  return fieldMetadataItem.name;
};
