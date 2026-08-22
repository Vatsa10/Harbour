import { type RecordScopeRule } from './RecordScopeRule';
import { type RestrictedFieldsPermissions } from './RestrictedFieldsPermissions';
import { type RowLevelPermissionPredicate } from './RowLevelPermissionPredicate';
import { type RowLevelPermissionPredicateGroup } from './RowLevelPermissionPredicateGroup';

export type ObjectPermissions = {
  canReadObjectRecords: boolean;
  canUpdateObjectRecords: boolean;
  canSoftDeleteObjectRecords: boolean;
  canDestroyObjectRecords: boolean;
  restrictedFields: RestrictedFieldsPermissions;
  // Record scope: the SeaRM replacement for the two predicate arrays below.
  // Optional while both models coexist — absent and empty both mean
  // "unrestricted", which is exactly the behaviour of a role with no rules,
  // so a producer that has not been migrated yet cannot accidentally widen
  // or narrow access. Becomes required when the predicate arrays are deleted.
  recordScopeRules?: RecordScopeRule[];
  /** @deprecated superseded by recordScopeRules */
  rowLevelPermissionPredicates: RowLevelPermissionPredicate[];
  /** @deprecated superseded by recordScopeRules */
  rowLevelPermissionPredicateGroups: RowLevelPermissionPredicateGroup[];
};
