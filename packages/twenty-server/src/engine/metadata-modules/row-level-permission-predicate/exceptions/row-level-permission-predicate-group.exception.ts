// SeaRM — AGPL-3.0. Clean-room reimplementation of the row-level-permission
// predicate group exception (no Twenty Enterprise source consulted;
// derived from the sibling ViewFilterException and mirroring the code
// naming convention fixed by
// exceptions/row-level-permission-predicate.exception.ts).
//
// Kept as its own code enum for the same reason the predicate exception is
// — no unification with the workspace-migration builders' local
// WorkspaceMigrationRowLevelPermissionPredicateGroupExceptionCode was made.

import { type MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { assertUnreachable } from 'twenty-shared/utils';

import { CustomException } from 'src/utils/custom-exception';

export enum RowLevelPermissionPredicateGroupExceptionCode {
  ROW_LEVEL_PERMISSION_FEATURE_DISABLED = 'ROW_LEVEL_PERMISSION_FEATURE_DISABLED',
  ROW_LEVEL_PERMISSION_PREDICATE_GROUP_NOT_FOUND = 'ROW_LEVEL_PERMISSION_PREDICATE_GROUP_NOT_FOUND',
  ROW_LEVEL_PERMISSION_PREDICATE_GROUP_ALREADY_EXISTS = 'ROW_LEVEL_PERMISSION_PREDICATE_GROUP_ALREADY_EXISTS',
  INVALID_ROW_LEVEL_PERMISSION_PREDICATE_GROUP_DATA = 'INVALID_ROW_LEVEL_PERMISSION_PREDICATE_GROUP_DATA',
  CIRCULAR_DEPENDENCY = 'CIRCULAR_DEPENDENCY',
  MAX_DEPTH_EXCEEDED = 'MAX_DEPTH_EXCEEDED',
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
}

export class RowLevelPermissionPredicateGroupException extends CustomException<RowLevelPermissionPredicateGroupExceptionCode> {
  constructor(
    message: string,
    code: RowLevelPermissionPredicateGroupExceptionCode,
    { userFriendlyMessage }: { userFriendlyMessage?: MessageDescriptor } = {},
  ) {
    super(message, code, {
      userFriendlyMessage:
        userFriendlyMessage ??
        msg`A row level permission predicate group error occurred.`,
    });
  }
}

export enum RowLevelPermissionPredicateGroupExceptionMessageKey {
  WORKSPACE_ID_REQUIRED = 'WORKSPACE_ID_REQUIRED',
  ROLE_ID_REQUIRED = 'ROLE_ID_REQUIRED',
  ROW_LEVEL_PERMISSION_PREDICATE_GROUP_NOT_FOUND = 'ROW_LEVEL_PERMISSION_PREDICATE_GROUP_NOT_FOUND',
  INVALID_ROW_LEVEL_PERMISSION_PREDICATE_GROUP_DATA = 'INVALID_ROW_LEVEL_PERMISSION_PREDICATE_GROUP_DATA',
  OBJECT_METADATA_ID_REQUIRED = 'OBJECT_METADATA_ID_REQUIRED',
}

export const generateRowLevelPermissionPredicateGroupExceptionMessage = (
  key: RowLevelPermissionPredicateGroupExceptionMessageKey,
  id?: string,
) => {
  switch (key) {
    case RowLevelPermissionPredicateGroupExceptionMessageKey.WORKSPACE_ID_REQUIRED:
      return 'WorkspaceId is required';
    case RowLevelPermissionPredicateGroupExceptionMessageKey.ROLE_ID_REQUIRED:
      return 'RoleId is required';
    case RowLevelPermissionPredicateGroupExceptionMessageKey.ROW_LEVEL_PERMISSION_PREDICATE_GROUP_NOT_FOUND:
      return `Row level permission predicate group${id ? ` (id: ${id})` : ''} not found`;
    case RowLevelPermissionPredicateGroupExceptionMessageKey.INVALID_ROW_LEVEL_PERMISSION_PREDICATE_GROUP_DATA:
      return `Invalid row level permission predicate group data${id ? ` for id: ${id}` : ''}`;
    case RowLevelPermissionPredicateGroupExceptionMessageKey.OBJECT_METADATA_ID_REQUIRED:
      return 'ObjectMetadataId is required';
    default:
      assertUnreachable(key);
  }
};

export const generateRowLevelPermissionPredicateGroupUserFriendlyExceptionMessage =
  (
    key: RowLevelPermissionPredicateGroupExceptionMessageKey,
  ): MessageDescriptor | undefined => {
    switch (key) {
      case RowLevelPermissionPredicateGroupExceptionMessageKey.WORKSPACE_ID_REQUIRED:
        return msg`WorkspaceId is required to create a row level permission predicate group.`;
      case RowLevelPermissionPredicateGroupExceptionMessageKey.ROLE_ID_REQUIRED:
        return msg`RoleId is required to create a row level permission predicate group.`;
      case RowLevelPermissionPredicateGroupExceptionMessageKey.OBJECT_METADATA_ID_REQUIRED:
        return msg`ObjectMetadataId is required to create a row level permission predicate group.`;
    }
  };
