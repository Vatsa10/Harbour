import { ViewFilterGroupLogicalOperator } from '@/views/types/ViewFilterGroupLogicalOperator';
import { RecordFilterGroupLogicalOperator } from 'searm-shared/types';

export const mapViewFilterGroupLogicalOperatorToRecordFilterGroupLogicalOperator =
  ({
    viewFilterGroupLogicalOperator,
  }: {
    viewFilterGroupLogicalOperator: ViewFilterGroupLogicalOperator;
  }) => {
    return viewFilterGroupLogicalOperator === ViewFilterGroupLogicalOperator.AND
      ? RecordFilterGroupLogicalOperator.AND
      : RecordFilterGroupLogicalOperator.OR;
  };
