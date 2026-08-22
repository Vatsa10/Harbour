import { type AllMetadataName } from 'searm-shared/metadata';

export const ALL_METADATA_SIDE_EFFECT_COMPANION_METADATA_NAMES = {
  fieldMetadata: ['index', 'searchFieldMetadata', 'view', 'viewField'],
  objectMetadata: [
    'fieldMetadata',
    'index',
    'searchFieldMetadata',
    'view',
    'viewField',
  ],
} as const satisfies Partial<
  Record<AllMetadataName, readonly AllMetadataName[]>
>;
