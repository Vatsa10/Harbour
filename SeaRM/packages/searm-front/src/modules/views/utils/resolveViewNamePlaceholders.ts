import { type FlatObjectMetadataItem } from '@/metadata-store/types/FlatObjectMetadataItem';
import { isDefined } from 'searm-shared/utils';

export const resolveViewNamePlaceholders = (
  viewName: string | undefined,
  objectMetadataItem: FlatObjectMetadataItem | undefined,
): string => {
  if (!isDefined(viewName) || !isDefined(objectMetadataItem)) {
    return viewName ?? '';
  }

  return viewName
    .replace('{objectLabelPlural}', objectMetadataItem.labelPlural)
    .replace('{objectLabelSingular}', objectMetadataItem.labelSingular);
};
