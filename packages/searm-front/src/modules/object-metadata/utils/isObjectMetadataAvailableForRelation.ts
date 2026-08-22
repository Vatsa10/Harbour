import { CoreObjectNameSingular } from 'searm-shared/types';
import { type EnrichedObjectMetadataItem } from '@/object-metadata/types/EnrichedObjectMetadataItem';

export const isObjectMetadataAvailableForRelation = (
  objectMetadataItem: Pick<
    EnrichedObjectMetadataItem,
    'isSystem' | 'nameSingular' | 'isRemote'
  >,
) => {
  return (
    (!objectMetadataItem.isSystem ||
      objectMetadataItem.nameSingular ===
        CoreObjectNameSingular.WorkspaceMember) &&
    !objectMetadataItem.isRemote
  );
};
