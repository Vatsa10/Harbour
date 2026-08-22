import { type ObjectRecordGroupByDateGranularity } from 'searm-shared/types';

export type GroupByDefinition = {
  columnNameWithQuotes: string;
  expression: string;
  alias: string;
  dateGranularity?: ObjectRecordGroupByDateGranularity;
};
