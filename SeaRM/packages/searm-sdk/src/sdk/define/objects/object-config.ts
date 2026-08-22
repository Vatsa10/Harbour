import { type ObjectManifest } from 'searm-shared/application';

export type ObjectConfig = Omit<
  ObjectManifest,
  'labelIdentifierFieldMetadataUniversalIdentifier'
> & {
  labelIdentifierFieldMetadataUniversalIdentifier?: string;
};
