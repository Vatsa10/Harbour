// SeaRM — AGPL-3.0. Clean-room reimplementation of the row-level-permission
// predicate exception (no SeaRM Enterprise source consulted; derived from
// the sibling ViewFilterException and from the AGPL exception-handler spec
// at utils/__tests__/row-level-permission-predicate-graphql-api-exception-handler.util.spec.ts,
// which fixes the ROW_LEVEL_PERMISSION_FEATURE_DISABLED,
// ROW_LEVEL_PERMISSION_PREDICATE_NOT_FOUND,
// INVALID_ROW_LEVEL_PERMISSION_PREDICATE_DATA and INTERNAL_SERVER_ERROR code
// names as the exact contract consumed by the untouched
// row-level-permission-predicate-graphql-api-exception-handler.util.ts).
//
// This module intentionally keeps its own code enum rather than importing
// one from workspace-migration — the workspace-migration builders/validators
// already define their own local
// WorkspaceMigrationRowLevelPermissionPredicateExceptionCode for the same
// reason (FlatEntityValidationError.code is generic over string), so no
// unification was made in either direction.

import { type MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { assertUnreachable } from 'searm-shared/utils';

import { CustomException } from 'src/utils/custom-exception';

export enum RowLevelPermissionPredicateExceptionCode {
  ROW_LEVEL_PERMISSION_FEATURE_DISABLED = 'ROW_LEVEL_PERMISSION_FEATURE_DISABLED',
  ROW_LEVEL_PERMISSION_PREDICATE_NOT_FOUND = 'ROW_LEVEL_PERMISSION_PREDICATE_NOT_FOUND',
  ROW_LEVEL_PERMISSION_PREDICATE_ALREADY_EXISTS = 'ROW_LEVEL_PERMISSION_PREDICATE_ALREADY_EXISTS',
  INVALID_ROW_LEVEL_PERMISSION_PREDICATE_DATA = 'INVALID_ROW_LEVEL_PERMISSION_PREDICATE_DATA',
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
}

export class RowLevelPermissionPredicateException extends CustomException<RowLevelPermissionPredicateExceptionCode> {
  constructor(
    message: string,
    code: RowLevelPermissionPredicateExceptionCode,
    { userFriendlyMessage }: { userFriendlyMessage?: MessageDescriptor } = {},
  ) {
    super(message, code, {
      userFriendlyMessage:
        userFriendlyMessage ?? msg`A row level permission predicate error occurred.`,
    });
  }
}

export enum RowLevelPermissionPredicateExceptionMessageKey {
  WORKSPACE_ID_REQUIRED = 'WORKSPACE_ID_REQUIRED',
  ROLE_ID_REQUIRED = 'ROLE_ID_REQUIRED',
  ROW_LEVEL_PERMISSION_PREDICATE_NOT_FOUND = 'ROW_LEVEL_PERMISSION_PREDICATE_NOT_FOUND',
  INVALID_ROW_LEVEL_PERMISSION_PREDICATE_DATA = 'INVALID_ROW_LEVEL_PERMISSION_PREDICATE_DATA',
  FIELD_METADATA_ID_REQUIRED = 'FIELD_METADATA_ID_REQUIRED',
}

export const generateRowLevelPermissionPredicateExceptionMessage = (
  key: RowLevelPermissionPredicateExceptionMessageKey,
  id?: string,
) => {
  switch (key) {
    case RowLevelPermissionPredicateExceptionMessageKey.WORKSPACE_ID_REQUIRED:
      return 'WorkspaceId is required';
    case RowLevelPermissionPredicateExceptionMessageKey.ROLE_ID_REQUIRED:
      return 'RoleId is required';
    case RowLevelPermissionPredicateExceptionMessageKey.ROW_LEVEL_PERMISSION_PREDICATE_NOT_FOUND:
      return `Row level permission predicate${id ? ` (id: ${id})` : ''} not found`;
    case RowLevelPermissionPredicateExceptionMessageKey.INVALID_ROW_LEVEL_PERMISSION_PREDICATE_DATA:
      return `Invalid row level permission predicate data${id ? ` for id: ${id}` : ''}`;
    case RowLevelPermissionPredicateExceptionMessageKey.FIELD_METADATA_ID_REQUIRED:
      return 'FieldMetadataId is required';
    default:
      assertUnreachable(key);
  }
};

export const generateRowLevelPermissionPredicateUserFriendlyExceptionMessage = (
  key: RowLevelPermissionPredicateExceptionMessageKey,
): MessageDescriptor | undefined => {
  switch (key) {
    case RowLevelPermissionPredicateExceptionMessageKey.WORKSPACE_ID_REQUIRED:
      return msg`WorkspaceId is required to create a row level permission predicate.`;
    case RowLevelPermissionPredicateExceptionMessageKey.ROLE_ID_REQUIRED:
      return msg`RoleId is required to create a row level permission predicate.`;
    case RowLevelPermissionPredicateExceptionMessageKey.FIELD_METADATA_ID_REQUIRED:
      return msg`FieldMetadataId is required to create a row level permission predicate.`;
  }
};
