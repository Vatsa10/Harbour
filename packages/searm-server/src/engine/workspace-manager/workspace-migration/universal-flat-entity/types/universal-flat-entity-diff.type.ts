import { type AllMetadataName } from 'searm-shared/metadata';

import { type MetadataUniversalFlatEntity } from 'src/engine/metadata-modules/flat-entity/types/metadata-universal-flat-entity.type';
import { type MetadataUniversalFlatEntityPropertiesToCompare } from 'src/engine/workspace-manager/workspace-migration/universal-flat-entity/types/metadata-universal-flat-entity-properties-to-compare.type';

export type UniversalFlatEntityDiff<T extends AllMetadataName> = {
  [K in MetadataUniversalFlatEntityPropertiesToCompare<T>]?: {
    before: MetadataUniversalFlatEntity<T>[K];
    after: MetadataUniversalFlatEntity<T>[K];
  };
};
