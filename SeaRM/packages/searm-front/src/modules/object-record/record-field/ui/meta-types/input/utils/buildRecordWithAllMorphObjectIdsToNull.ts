import { type FieldMetadataItemRelation } from '@/object-metadata/types/FieldMetadataItemRelation';
import { type RelationType } from 'searm-shared/types';
import { computeMorphRelationGqlFieldName } from 'searm-shared/utils';

export const buildRecordWithAllMorphObjectIdsToNull = ({
  morphRelations,
  fieldName,
  relationType,
}: {
  morphRelations: FieldMetadataItemRelation[];
  fieldName: string;
  relationType: RelationType;
}): Record<string, null> => {
  return morphRelations.reduce(
    (acc, morphRelation) => {
      const computedFieldName = computeMorphRelationGqlFieldName({
        fieldName,
        relationType,
        targetObjectMetadataNameSingular:
          morphRelation.targetObjectMetadata.nameSingular,
        targetObjectMetadataNamePlural:
          morphRelation.targetObjectMetadata.namePlural,
      });
      acc[`${computedFieldName}Id`] = null;
      return acc;
    },
    {} as Record<string, null>,
  );
};
