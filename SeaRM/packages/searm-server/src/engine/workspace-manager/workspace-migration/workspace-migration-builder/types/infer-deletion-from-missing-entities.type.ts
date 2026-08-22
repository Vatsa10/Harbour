import { type AllMetadataName } from 'searm-shared/metadata';

export type InferDeletionFromMissingEntities =
  | true
  | Partial<Record<AllMetadataName, boolean>>
  | undefined;
