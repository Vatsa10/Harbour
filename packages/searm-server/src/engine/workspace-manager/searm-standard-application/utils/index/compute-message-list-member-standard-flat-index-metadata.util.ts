import { type FlatIndexMetadata } from 'src/engine/metadata-modules/flat-index-metadata/types/flat-index-metadata.type';
import { type AllStandardObjectIndexName } from 'src/engine/workspace-manager/searm-standard-application/types/all-standard-object-index-name.type';
import {
  type CreateStandardIndexArgs,
  createStandardIndexFlatMetadata,
} from 'src/engine/workspace-manager/searm-standard-application/utils/index/create-standard-index-flat-metadata.util';

export const buildMessageListMemberStandardFlatIndexMetadatas = ({
  now,
  objectName,
  workspaceId,
  standardObjectMetadataRelatedEntityIds,
  dependencyFlatEntityMaps,
  searmStandardApplicationId,
}: Omit<CreateStandardIndexArgs<'messageListMember'>, 'context'>): Record<
  AllStandardObjectIndexName<'messageListMember'>,
  FlatIndexMetadata
> => ({
  listIdIndex: createStandardIndexFlatMetadata({
    objectName,
    workspaceId,
    context: {
      indexName: 'listIdIndex',
      relatedFieldNames: ['list'],
    },
    standardObjectMetadataRelatedEntityIds,
    dependencyFlatEntityMaps,
    searmStandardApplicationId,
    now,
  }),
  personListUniqueIndex: createStandardIndexFlatMetadata({
    objectName,
    workspaceId,
    context: {
      indexName: 'personListUniqueIndex',
      relatedFieldNames: ['person', 'list'],
      isUnique: true,
      indexWhereClause: '"deletedAt" IS NULL',
    },
    standardObjectMetadataRelatedEntityIds,
    dependencyFlatEntityMaps,
    searmStandardApplicationId,
    now,
  }),
});
