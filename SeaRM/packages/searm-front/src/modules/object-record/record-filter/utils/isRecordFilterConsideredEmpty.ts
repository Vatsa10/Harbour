import { type RecordFilter } from '@/object-record/record-filter/types/RecordFilter';
import { isRecordFilterValueValid } from 'searm-shared/utils';

export const isRecordFilterConsideredEmpty = (
  recordFilter: RecordFilter,
): boolean => {
  return !isRecordFilterValueValid(recordFilter);
};
