import { type ObjectRecord } from 'searm-shared/types';
import { fastDeepEqual } from 'searm-shared/utils';

import { type BaseWorkspaceEntity } from 'src/engine/searm-orm/base.workspace-entity';

export const objectRecordChangedProperties = <
  PRecord extends Partial<ObjectRecord | BaseWorkspaceEntity> =
    Partial<ObjectRecord>,
>(
  oldRecord: PRecord,
  newRecord: PRecord,
) => {
  const changedProperties = Object.keys(newRecord).filter(
    // @ts-expect-error legacy noImplicitAny
    (key) => !fastDeepEqual(oldRecord[key], newRecord[key]),
  );

  return changedProperties;
};
