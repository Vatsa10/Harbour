import { type ObjectRecordGroupByDateGranularity } from 'searm-shared/types';

export type SupportedDateGranularityForGapFilling =
  | ObjectRecordGroupByDateGranularity.DAY
  | ObjectRecordGroupByDateGranularity.MONTH
  | ObjectRecordGroupByDateGranularity.QUARTER
  | ObjectRecordGroupByDateGranularity.YEAR
  | ObjectRecordGroupByDateGranularity.WEEK;
