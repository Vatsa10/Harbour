import { type ObjectRecord as SharedObjectRecord } from 'searm-shared/types';

export type BaseObjectRecord = SharedObjectRecord & {
  __typename: string;
};
