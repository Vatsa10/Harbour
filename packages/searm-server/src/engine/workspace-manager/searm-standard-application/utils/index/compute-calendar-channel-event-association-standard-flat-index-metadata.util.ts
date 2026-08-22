import { type FlatIndexMetadata } from 'src/engine/metadata-modules/flat-index-metadata/types/flat-index-metadata.type';
import { type AllStandardObjectIndexName } from 'src/engine/workspace-manager/searm-standard-application/types/all-standard-object-index-name.type';
import {
  type CreateStandardIndexArgs,
  createStandardIndexFlatMetadata,
} from 'src/engine/workspace-manager/searm-standard-application/utils/index/create-standard-index-flat-metadata.util';

export const buildCalendarChannelEventAssociationStandardFlatIndexMetadatas = ({
  now,
  objectName,
  workspaceId,
  standardObjectMetadataRelatedEntityIds,
  dependencyFlatEntityMaps,
  searmStandardApplicationId,
}: Omit<
  CreateStandardIndexArgs<'calendarChannelEventAssociation'>,
  'context'
>): Record<
  AllStandardObjectIndexName<'calendarChannelEventAssociation'>,
  FlatIndexMetadata
> => ({
  calendarChannelIdIndex: createStandardIndexFlatMetadata({
    objectName,
    workspaceId,
    context: {
      indexName: 'calendarChannelIdIndex',
      relatedFieldNames: ['calendarChannelId'],
    },
    standardObjectMetadataRelatedEntityIds,
    dependencyFlatEntityMaps,
    searmStandardApplicationId,
    now,
  }),
  calendarEventIdIndex: createStandardIndexFlatMetadata({
    objectName,
    workspaceId,
    context: {
      indexName: 'calendarEventIdIndex',
      relatedFieldNames: ['calendarEvent'],
    },
    standardObjectMetadataRelatedEntityIds,
    dependencyFlatEntityMaps,
    searmStandardApplicationId,
    now,
  }),
});
