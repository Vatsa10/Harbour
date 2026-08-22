// SeaRM: clean-room AGPL-3.0 rewrite. See
// .superpowers/sdd/enterprise-rewrite/rlp-recon.md for design notes.
// Post-write guard: after a mutation returns the affected records, confirm
// each one still satisfies the row level permission predicate for the
// acting role. This catches writes that a SQL WHERE clause could not have
// blocked (e.g. an UPDATE that moves a record out of its own visible set).
// A record that fails the predicate is deny-by-default: it is reported as a
// violation, never silently dropped or silently allowed through.
import { isDefined } from 'searm-shared/utils';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type WorkspaceInternalContext } from 'src/engine/searm-orm/interfaces/workspace-internal-context.interface';
import { buildRowLevelPermissionRecordFilter } from 'src/engine/searm-orm/utils/build-row-level-permission-record-filter.util';
import { isRecordMatchingRLSRowLevelPermissionPredicate } from 'src/engine/searm-orm/utils/is-record-matching-rls-row-level-permission-predicate.util';
import { resolveRoleIdsFromAuthContext } from 'src/engine/searm-orm/utils/resolve-role-ids-from-auth-context.util';

export class RowLevelPermissionValidationError extends Error {}

export const validateRLSPredicatesForRecords = <T extends object>({
  records,
  objectMetadata,
  internalContext,
  authContext,
  shouldBypassPermissionChecks,
  errorMessage,
}: {
  records: T[];
  objectMetadata: FlatObjectMetadata;
  internalContext: WorkspaceInternalContext;
  authContext: WorkspaceAuthContext;
  shouldBypassPermissionChecks?: boolean;
  errorMessage?: string;
}): void => {
  if (shouldBypassPermissionChecks === true) {
    return;
  }

  const roleIds = resolveRoleIdsFromAuthContext({
    authContext,
    userWorkspaceRoleMap: internalContext.userWorkspaceRoleMap,
    apiKeyRoleMap: internalContext.apiKeyRoleMap,
  });

  const recordFilter = buildRowLevelPermissionRecordFilter({
    flatRowLevelPermissionPredicateMaps:
      internalContext.flatRowLevelPermissionPredicateMaps,
    flatRowLevelPermissionPredicateGroupMaps:
      internalContext.flatRowLevelPermissionPredicateGroupMaps,
    flatFieldMetadataMaps: internalContext.flatFieldMetadataMaps,
    objectMetadata,
    roleIds,
  });

  if (!isDefined(recordFilter)) {
    return;
  }

  const violatingRecord = records.find(
    (record) =>
      !isRecordMatchingRLSRowLevelPermissionPredicate({
        record,
        filter: recordFilter as unknown as Record<string, unknown>,
        flatObjectMetadata: objectMetadata,
        flatFieldMetadataMaps: internalContext.flatFieldMetadataMaps,
      }),
  );

  if (isDefined(violatingRecord)) {
    const violatingRecordId = (violatingRecord as { id?: string }).id;

    throw new RowLevelPermissionValidationError(
      errorMessage ??
        `Record "${violatingRecordId}" no longer satisfies the row level permission predicate for object "${objectMetadata.nameSingular}"`,
    );
  }
};
