import {
  FieldMetadataType,
  type FilterableAndTSVectorFieldType,
  type ViewFilterOperand,
} from 'searm-shared/types';
import {
  FILTER_OPERANDS_MAP,
  getFilterOperandsForFilterableFieldType,
  isDefined,
} from 'searm-shared/utils';

export const getDefaultViewFilterOperand = ({
  fieldType,
  subFieldName,
  relationTargetFieldType,
}: {
  fieldType: FieldMetadataType;
  subFieldName?: string | null;
  relationTargetFieldType?: FieldMetadataType;
}): ViewFilterOperand | undefined => {
  const effectiveFieldType =
    fieldType === FieldMetadataType.RELATION &&
    isDefined(relationTargetFieldType)
      ? relationTargetFieldType
      : fieldType;

  if (!(effectiveFieldType in FILTER_OPERANDS_MAP)) {
    return undefined;
  }

  return getFilterOperandsForFilterableFieldType({
    filterType: effectiveFieldType as FilterableAndTSVectorFieldType,
    subFieldName,
  })[0];
};
