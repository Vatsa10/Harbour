import { type AllFlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/types/all-flat-entity-maps.type';
import { type MetadataToFlatEntityMapsKey } from 'src/engine/metadata-modules/flat-entity/types/metadata-to-flat-entity-maps-key';
import { type SEARM_STANDARD_ALL_METADATA_NAME } from 'src/engine/workspace-manager/searm-standard-application/constants/searm-standard-all-metadata-name.constant';

export type SearmStandardAllFlatEntityMaps = Pick<
  AllFlatEntityMaps,
  MetadataToFlatEntityMapsKey<
    (typeof SEARM_STANDARD_ALL_METADATA_NAME)[number]
  >
>;
