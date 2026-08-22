import { capitalize } from 'searm-shared/utils';
export const buildDescriptionForRelationFieldMetadataOnFromField = ({
  relationObjectMetadataNamePlural,
  targetObjectLabelSingular,
}: {
  relationObjectMetadataNamePlural: string;
  targetObjectLabelSingular: string;
}) => {
  const description = `${capitalize(relationObjectMetadataNamePlural)} tied to the ${targetObjectLabelSingular}`;

  return { description };
};
