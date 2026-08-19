// SeaRM: clean-room AGPL-3.0 rewrite. See
// .superpowers/sdd/enterprise-rewrite/rlp-recon.md for design notes.
// Shape reverse-derived from the (AGPL, already clean-room) mapper utils in
// flat-row-level-permission-predicate/utils/from-{create,update}-*, which
// construct and consume this exact field set.
import {
  type RowLevelPermissionPredicateOperand,
  type RowLevelPermissionPredicateValue,
} from 'twenty-shared/types';

export type FlatRowLevelPermissionPredicate = {
  id: string;
  universalIdentifier: string;
  workspaceId: string;
  applicationId: string;
  applicationUniversalIdentifier: string;
  roleId: string;
  roleUniversalIdentifier: string;
  objectMetadataId: string;
  objectMetadataUniversalIdentifier: string;
  fieldMetadataId: string;
  fieldMetadataUniversalIdentifier: string;
  operand: RowLevelPermissionPredicateOperand;
  value: RowLevelPermissionPredicateValue | null;
  subFieldName: string | null;
  workspaceMemberFieldMetadataId: string | null;
  workspaceMemberFieldMetadataUniversalIdentifier: string | null;
  workspaceMemberSubFieldName: string | null;
  rowLevelPermissionPredicateGroupId: string | null;
  rowLevelPermissionPredicateGroupUniversalIdentifier: string | null;
  positionInRowLevelPermissionPredicateGroup: number | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};
