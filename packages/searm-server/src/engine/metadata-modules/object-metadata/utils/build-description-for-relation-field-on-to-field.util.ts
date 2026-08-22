import { capitalize } from 'searm-shared/utils';
export const buildDescriptionForRelationFieldMetadataOnToField = ({
  relationObjectMetadataNamePlural,
  targetObjectLabelSingular,
}: {
  relationObjectMetadataNamePlural: string;
  targetObjectLabelSingular: string;
}) => {
  const description = `${capitalize(relationObjectMetadataNamePlural)} ${targetObjectLabelSingular}`;

  return { description };
};
