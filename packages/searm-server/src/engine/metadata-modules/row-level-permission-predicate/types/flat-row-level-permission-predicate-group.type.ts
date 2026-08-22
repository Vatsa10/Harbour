// SeaRM: clean-room AGPL-3.0 rewrite. See
// .superpowers/sdd/enterprise-rewrite/rlp-recon.md for design notes.
// Shape reverse-derived from the (AGPL, already clean-room) mapper utils in
// flat-row-level-permission-predicate/utils/from-{create,update}-*-group-*,
// which construct and consume this exact field set.
import { type RowLevelPermissionPredicateGroupLogicalOperator } from 'searm-shared/types';

export type FlatRowLevelPermissionPredicateGroup = {
  id: string;
  universalIdentifier: string;
  workspaceId: string;
  applicationId: string;
  applicationUniversalIdentifier: string;
  roleId: string;
  roleUniversalIdentifier: string;
  objectMetadataId: string;
  objectMetadataUniversalIdentifier: string;
  logicalOperator: RowLevelPermissionPredicateGroupLogicalOperator;
  parentRowLevelPermissionPredicateGroupId: string | null;
  parentRowLevelPermissionPredicateGroupUniversalIdentifier: string | null;
  positionInRowLevelPermissionPredicateGroup: number | null;
  childRowLevelPermissionPredicateGroupIds: string[];
  childRowLevelPermissionPredicateGroupUniversalIdentifiers: string[];
  rowLevelPermissionPredicateIds: string[];
  rowLevelPermissionPredicateUniversalIdentifiers: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};
