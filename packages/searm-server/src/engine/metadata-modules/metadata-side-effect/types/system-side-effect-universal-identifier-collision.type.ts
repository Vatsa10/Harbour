import { type AllMetadataName } from 'searm-shared/metadata';

import { type MetadataSideEffectOperation } from 'src/engine/metadata-modules/metadata-side-effect/types/metadata-side-effect-operation.type';

export type SystemSideEffectUniversalIdentifierCollision = {
  metadataName: AllMetadataName;
  operation: MetadataSideEffectOperation;
  universalIdentifier: string;
  name?: string;
};
