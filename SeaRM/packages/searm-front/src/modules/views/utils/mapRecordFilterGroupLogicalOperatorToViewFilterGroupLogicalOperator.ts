import { ViewFilterGroupLogicalOperator } from '@/views/types/ViewFilterGroupLogicalOperator';
import { RecordFilterGroupLogicalOperator } from 'searm-shared/types';

export const mapRecordFilterGroupLogicalOperatorToViewFilterGroupLogicalOperator =
  ({
    recordFilterGroupLogicalOperator,
  }: {
    recordFilterGroupLogicalOperator: RecordFilterGroupLogicalOperator;
  }) => {
    return recordFilterGroupLogicalOperator ===
      RecordFilterGroupLogicalOperator.AND
      ? ViewFilterGroupLogicalOperator.AND
      : ViewFilterGroupLogicalOperator.OR;
  };
