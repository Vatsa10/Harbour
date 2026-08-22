import { type ObjectRecord } from 'searm-shared/types';

import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';

export interface QueryResultGetterHandlerInterface {
  handle(
    objectRecord: ObjectRecord,
    workspaceId: string,
    flatFieldMetadata: FlatFieldMetadata[],
  ): Promise<ObjectRecord>;
}
