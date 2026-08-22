import { type Nullable } from 'searm-shared/types';

export type RecordAggregateValueByRecordGroupValue = {
  recordGroupValue: Nullable<string>;
  recordAggregateValue: Nullable<string | number>;
};
