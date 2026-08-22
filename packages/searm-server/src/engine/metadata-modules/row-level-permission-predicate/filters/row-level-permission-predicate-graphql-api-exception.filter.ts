// SeaRM — AGPL-3.0. Clean-room reimplementation, mirroring the structure of
// the already-AGPL sibling ViewGroupGraphqlApiExceptionFilter (no Enterprise
// source consulted).

import {
  Catch,
  type ExceptionFilter,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';

import { RowLevelPermissionPredicateException } from 'src/engine/metadata-modules/row-level-permission-predicate/exceptions/row-level-permission-predicate.exception';
import { RowLevelPermissionPredicateGroupException } from 'src/engine/metadata-modules/row-level-permission-predicate/exceptions/row-level-permission-predicate-group.exception';
import { rowLevelPermissionPredicateGraphqlApiExceptionHandler } from 'src/engine/metadata-modules/row-level-permission-predicate/utils/row-level-permission-predicate-graphql-api-exception-handler.util';
import { WorkspaceMigrationBuilderException } from 'src/engine/workspace-manager/workspace-migration/exceptions/workspace-migration-builder-exception';

@Catch(
  RowLevelPermissionPredicateException,
  RowLevelPermissionPredicateGroupException,
  WorkspaceMigrationBuilderException,
)
@Injectable()
export class RowLevelPermissionPredicateGraphqlApiExceptionFilter
  implements ExceptionFilter
{
  catch(
    exception:
      | RowLevelPermissionPredicateException
      | RowLevelPermissionPredicateGroupException
      | WorkspaceMigrationBuilderException,
    _host: ExecutionContext,
  ) {
    return rowLevelPermissionPredicateGraphqlApiExceptionHandler(exception);
  }
}
