import { type AllMetadataName } from 'searm-shared/metadata';
import { type RemoveSuffix } from 'searm-shared/types';

import { type MetadataManyToOneJoinColumn } from 'src/engine/metadata-modules/flat-entity/types/metadata-many-to-one-join-column.type';

export type AddSuffixToEntityManyToOneProperties<
  TEntity,
  TMetadataName extends AllMetadataName,
  TSuffix extends string,
> = {
  [P in Extract<MetadataManyToOneJoinColumn<TMetadataName>, keyof TEntity> &
    string as `${RemoveSuffix<P, 'Id'>}${Capitalize<TSuffix>}`]: TEntity[P];
};
