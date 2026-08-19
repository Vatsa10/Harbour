import { type RowLevelPermissionPredicateDTO } from 'src/engine/metadata-modules/row-level-permission-predicate/dtos/row-level-permission-predicate.dto';
import { type FlatRowLevelPermissionPredicate } from 'src/engine/metadata-modules/row-level-permission-predicate/types/flat-row-level-permission-predicate.type';

export const fromFlatRowLevelPermissionPredicateToDto = (
  flatRowLevelPermissionPredicate: FlatRowLevelPermissionPredicate,
): RowLevelPermissionPredicateDTO => {
  const {
    id,
    roleId,
    objectMetadataId,
    fieldMetadataId,
    operand,
    value,
    subFieldName,
    workspaceMemberFieldMetadataId,
    workspaceMemberSubFieldName,
    rowLevelPermissionPredicateGroupId,
    positionInRowLevelPermissionPredicateGroup,
  } = flatRowLevelPermissionPredicate;

  return {
    id,
    roleId,
    objectMetadataId,
    fieldMetadataId,
    operand,
    value,
    subFieldName,
    workspaceMemberFieldMetadataId,
    workspaceMemberSubFieldName,
    rowLevelPermissionPredicateGroupId,
    positionInRowLevelPermissionPredicateGroup,
  };
};
