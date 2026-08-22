import { type ObjectsPermissions } from 'searm-shared/types';
import { type ObjectLiteral } from 'typeorm';
import { type QueryExpressionMap } from 'typeorm/query-builder/QueryExpressionMap';

import { type FeatureFlagMap } from 'src/engine/core-modules/feature-flag/interfaces/feature-flag-map.interface';
import { type WorkspaceInternalContext } from 'src/engine/searm-orm/interfaces/workspace-internal-context.interface';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type WorkspaceDeleteQueryBuilder } from 'src/engine/searm-orm/repository/workspace-delete-query-builder';
import { type WorkspaceInsertQueryBuilder } from 'src/engine/searm-orm/repository/workspace-insert-query-builder';
import { WorkspaceSelectQueryBuilder } from 'src/engine/searm-orm/repository/workspace-select-query-builder';
import { type WorkspaceSoftDeleteQueryBuilder } from 'src/engine/searm-orm/repository/workspace-soft-delete-query-builder';
import { type WorkspaceUpdateQueryBuilder } from 'src/engine/searm-orm/repository/workspace-update-query-builder';

type EventSelectQueryBuilderFactoryArgs<T extends ObjectLiteral> = {
  queryBuilder:
    | WorkspaceUpdateQueryBuilder<T>
    | WorkspaceSoftDeleteQueryBuilder<T>
    | WorkspaceDeleteQueryBuilder<T>
    | WorkspaceInsertQueryBuilder<T>;
  authContext: WorkspaceAuthContext;
  internalContext: WorkspaceInternalContext;
  featureFlagMap: FeatureFlagMap;
  expressionMap: QueryExpressionMap;
  objectRecordsPermissions: ObjectsPermissions;
};

export const computeEventSelectQueryBuilder = <T extends ObjectLiteral>({
  queryBuilder,
  authContext,
  featureFlagMap,
  internalContext,
  expressionMap,
  objectRecordsPermissions,
}: EventSelectQueryBuilderFactoryArgs<T>): WorkspaceSelectQueryBuilder<T> => {
  const eventSelectQueryBuilder = new WorkspaceSelectQueryBuilder(
    queryBuilder as unknown as WorkspaceSelectQueryBuilder<T>,
    objectRecordsPermissions,
    internalContext,
    true,
    authContext,
    featureFlagMap,
  );

  eventSelectQueryBuilder.expressionMap.wheres = expressionMap.wheres;
  eventSelectQueryBuilder.expressionMap.aliases = expressionMap.aliases;
  eventSelectQueryBuilder.setParameters(expressionMap.parameters);

  if (
    eventSelectQueryBuilder.expressionMap.selects.length === 0 &&
    eventSelectQueryBuilder.expressionMap.mainAlias
  ) {
    eventSelectQueryBuilder.expressionMap.selects = [
      { selection: eventSelectQueryBuilder.expressionMap.mainAlias.name },
    ];
  }

  return eventSelectQueryBuilder;
};
