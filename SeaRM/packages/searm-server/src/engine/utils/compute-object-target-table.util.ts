import { SEARM_STANDARD_APPLICATION } from 'src/engine/workspace-manager/searm-standard-application/constants/searm-standard-applications';
import { type UniversalFlatObjectMetadata } from 'src/engine/workspace-manager/workspace-migration/universal-flat-entity/types/universal-flat-object-metadata.type';

import { computeTableName } from './compute-table-name.util';

export const computeObjectTargetTable = (
  objectMetadata: Pick<
    UniversalFlatObjectMetadata,
    'nameSingular' | 'applicationUniversalIdentifier'
  >,
) => {
  return computeTableName(
    objectMetadata.nameSingular,
    objectMetadata.applicationUniversalIdentifier !==
      SEARM_STANDARD_APPLICATION.universalIdentifier,
  );
};
