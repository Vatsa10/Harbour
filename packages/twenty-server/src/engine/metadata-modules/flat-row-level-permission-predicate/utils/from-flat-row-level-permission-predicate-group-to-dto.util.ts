import { type RowLevelPermissionPredicateGroupDTO } from 'src/engine/metadata-modules/row-level-permission-predicate/dtos/row-level-permission-predicate-group.dto';
import { type FlatRowLevelPermissionPredicateGroup } from 'src/engine/metadata-modules/row-level-permission-predicate/types/flat-row-level-permission-predicate-group.type';

export const fromFlatRowLevelPermissionPredicateGroupToDto = (
  flatRowLevelPermissionPredicateGroup: FlatRowLevelPermissionPredicateGroup,
): RowLevelPermissionPredicateGroupDTO => {
  const {
    id,
    roleId,
    objectMetadataId,
    logicalOperator,
    parentRowLevelPermissionPredicateGroupId,
    positionInRowLevelPermissionPredicateGroup,
  } = flatRowLevelPermissionPredicateGroup;

  return {
    id,
    roleId,
    objectMetadataId,
    logicalOperator,
    parentRowLevelPermissionPredicateGroupId,
    positionInRowLevelPermissionPredicateGroup,
  };
};
