import { type RowLevelPermissionPredicateDTO } from 'src/engine/metadata-modules/row-level-permission-predicate/dtos/row-level-permission-predicate.dto';
import { type FlatRowLevelPermissionPredicate } from 'src/engine/metadata-modules/row-level-permission-predicate/types/flat-row-level-permission-predicate.type';

export const fromFlatRowLevelPermissionPredicateToDto = (
  flatRowLevelPermissionPredicate: FlatRowLevelPermissionPredicate,
): RowLevelPermissionPredicateDTO => {
  const {
    id,
    workspaceId,
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
    createdAt,
    updatedAt,
    deletedAt,
  } = flatRowLevelPermissionPredicate;

  return {
    id,
    workspaceId,
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
    createdAt: new Date(createdAt),
    updatedAt: new Date(updatedAt),
    deletedAt: deletedAt ? new Date(deletedAt) : null,
  };
};
