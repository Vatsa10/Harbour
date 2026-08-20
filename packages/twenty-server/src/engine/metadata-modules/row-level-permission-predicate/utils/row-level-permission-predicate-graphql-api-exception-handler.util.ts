// SeaRM — AGPL-3.0. Clean-room reimplementation (no Twenty Enterprise
// source consulted). Contract fixed by the AGPL spec at
// __tests__/row-level-permission-predicate-graphql-api-exception-handler.util.spec.ts
// (ROW_LEVEL_PERMISSION_FEATURE_DISABLED -> ForbiddenError,
// ROW_LEVEL_PERMISSION_PREDICATE_NOT_FOUND -> NotFoundError,
// INVALID_ROW_LEVEL_PERMISSION_PREDICATE_DATA -> UserInputError,
// INTERNAL_SERVER_ERROR -> InternalServerError), shaped like the sibling
// pageLayoutGraphqlApiExceptionHandler / viewGroupGraphqlApiExceptionHandler
// utils in this same package family.

import { assertUnreachable } from 'twenty-shared/utils';

import {
  ForbiddenError,
  InternalServerError,
  NotFoundError,
  UserInputError,
} from 'src/engine/core-modules/graphql/utils/graphql-errors.util';
import {
  RowLevelPermissionPredicateException,
  RowLevelPermissionPredicateExceptionCode,
} from 'src/engine/metadata-modules/row-level-permission-predicate/exceptions/row-level-permission-predicate.exception';
import {
  RowLevelPermissionPredicateGroupException,
  RowLevelPermissionPredicateGroupExceptionCode,
} from 'src/engine/metadata-modules/row-level-permission-predicate/exceptions/row-level-permission-predicate-group.exception';
import { WorkspaceMigrationBuilderException } from 'src/engine/workspace-manager/workspace-migration/exceptions/workspace-migration-builder-exception';
import { workspaceMigrationBuilderGraphqlApiExceptionHandler } from 'src/engine/workspace-manager/workspace-migration/interceptors/utils/workspace-migration-builder-graphql-api-exception-handler.util';

export const rowLevelPermissionPredicateGraphqlApiExceptionHandler = (
  error: Error,
) => {
  if (error instanceof WorkspaceMigrationBuilderException) {
    return workspaceMigrationBuilderGraphqlApiExceptionHandler(error);
  }

  if (error instanceof RowLevelPermissionPredicateException) {
    switch (error.code) {
      case RowLevelPermissionPredicateExceptionCode.ROW_LEVEL_PERMISSION_FEATURE_DISABLED:
        throw new ForbiddenError(error.message, {
          userFriendlyMessage: error.userFriendlyMessage,
        });
      case RowLevelPermissionPredicateExceptionCode.ROW_LEVEL_PERMISSION_PREDICATE_NOT_FOUND:
        throw new NotFoundError(error.message);
      case RowLevelPermissionPredicateExceptionCode.ROW_LEVEL_PERMISSION_PREDICATE_ALREADY_EXISTS:
      case RowLevelPermissionPredicateExceptionCode.INVALID_ROW_LEVEL_PERMISSION_PREDICATE_DATA:
        throw new UserInputError(error.message, {
          userFriendlyMessage: error.userFriendlyMessage,
        });
      case RowLevelPermissionPredicateExceptionCode.INTERNAL_SERVER_ERROR:
        throw new InternalServerError(error.message);
      default: {
        return assertUnreachable(error.code);
      }
    }
  }

  if (error instanceof RowLevelPermissionPredicateGroupException) {
    switch (error.code) {
      case RowLevelPermissionPredicateGroupExceptionCode.ROW_LEVEL_PERMISSION_FEATURE_DISABLED:
        throw new ForbiddenError(error.message, {
          userFriendlyMessage: error.userFriendlyMessage,
        });
      case RowLevelPermissionPredicateGroupExceptionCode.ROW_LEVEL_PERMISSION_PREDICATE_GROUP_NOT_FOUND:
        throw new NotFoundError(error.message);
      case RowLevelPermissionPredicateGroupExceptionCode.ROW_LEVEL_PERMISSION_PREDICATE_GROUP_ALREADY_EXISTS:
      case RowLevelPermissionPredicateGroupExceptionCode.INVALID_ROW_LEVEL_PERMISSION_PREDICATE_GROUP_DATA:
      case RowLevelPermissionPredicateGroupExceptionCode.CIRCULAR_DEPENDENCY:
      case RowLevelPermissionPredicateGroupExceptionCode.MAX_DEPTH_EXCEEDED:
        throw new UserInputError(error.message, {
          userFriendlyMessage: error.userFriendlyMessage,
        });
      case RowLevelPermissionPredicateGroupExceptionCode.INTERNAL_SERVER_ERROR:
        throw new InternalServerError(error.message);
      default: {
        return assertUnreachable(error.code);
      }
    }
  }

  throw error;
};
