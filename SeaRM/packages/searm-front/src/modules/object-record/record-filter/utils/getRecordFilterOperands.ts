import {
  type FilterableAndTSVectorFieldType,
  type ViewFilterOperand as RecordFilterOperand,
} from 'searm-shared/types';
import { getFilterOperandsForFilterableFieldType } from 'searm-shared/utils';

export const getRecordFilterOperands = ({
  filterType,
  subFieldName,
}: {
  filterType: FilterableAndTSVectorFieldType;
  subFieldName?: string | null | undefined;
}): readonly RecordFilterOperand[] => {
  return getFilterOperandsForFilterableFieldType({
    filterType,
    subFieldName,
  });
};
