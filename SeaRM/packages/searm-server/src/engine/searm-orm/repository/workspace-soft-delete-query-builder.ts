import { type ObjectsPermissions } from 'searm-shared/types';
import {
  type EntityTarget,
  type InsertQueryBuilder,
  type ObjectLiteral,
  type UpdateResult,
} from 'typeorm';
import { SoftDeleteQueryBuilder } from 'typeorm/query-builder/SoftDeleteQueryBuilder';
import { type WhereClause } from 'typeorm/query-builder/WhereClause';

import { type FeatureFlagMap } from 'src/engine/core-modules/feature-flag/interfaces/feature-flag-map.interface';
import { type WorkspaceInternalContext } from 'src/engine/searm-orm/interfaces/workspace-internal-context.interface';

import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { computeSearmORMException } from 'src/engine/searm-orm/error-handling/compute-searm-orm-exception';
import {
  SearmORMException,
  SearmORMExceptionCode,
} from 'src/engine/searm-orm/exceptions/searm-orm.exception';
import { validateQueryIsPermittedOrThrow } from 'src/engine/searm-orm/repository/permissions.utils';
import { type WorkspaceDeleteQueryBuilder } from 'src/engine/searm-orm/repository/workspace-delete-query-builder';
import { type WorkspaceSelectQueryBuilder } from 'src/engine/searm-orm/repository/workspace-select-query-builder';
import { type WorkspaceUpdateQueryBuilder } from 'src/engine/searm-orm/repository/workspace-update-query-builder';
import { applyRowLevelPermissionPredicates } from 'src/engine/searm-orm/utils/apply-row-level-permission-predicates.util';
import { applyTableAliasOnWhereCondition } from 'src/engine/searm-orm/utils/apply-table-alias-on-where-condition';
import { computeEventSelectQueryBuilder } from 'src/engine/searm-orm/utils/compute-event-select-query-builder.util';
import { formatResult } from 'src/engine/searm-orm/utils/format-result.util';
import { formatSearmOrmEventToDatabaseBatchEvent } from 'src/engine/searm-orm/utils/format-searm-orm-event-to-database-batch-event.util';
import { getObjectMetadataFromEntityTarget } from 'src/engine/searm-orm/utils/get-object-metadata-from-entity-target.util';
import { computeObjectTargetTable } from 'src/engine/utils/compute-object-target-table.util';

export class WorkspaceSoftDeleteQueryBuilder<
  T extends ObjectLiteral,
> extends SoftDeleteQueryBuilder<T> {
  private objectRecordsPermissions: ObjectsPermissions;
  private shouldBypassPermissionChecks: boolean;
  private internalContext: WorkspaceInternalContext;
  private authContext: WorkspaceAuthContext;
  private featureFlagMap: FeatureFlagMap;

  constructor(
    queryBuilder: SoftDeleteQueryBuilder<T>,
    objectRecordsPermissions: ObjectsPermissions,
    internalContext: WorkspaceInternalContext,
    shouldBypassPermissionChecks: boolean,
    authContext: WorkspaceAuthContext,
    featureFlagMap: FeatureFlagMap,
  ) {
    super(queryBuilder);
    this.objectRecordsPermissions = objectRecordsPermissions;
    this.internalContext = internalContext;
    this.shouldBypassPermissionChecks = shouldBypassPermissionChecks;
    this.authContext = authContext;
    this.featureFlagMap = featureFlagMap;
  }

  override clone(): this {
    const clonedQueryBuilder = super.clone();

    const workspaceSoftDeleteQueryBuilder = new WorkspaceSoftDeleteQueryBuilder(
      clonedQueryBuilder,
      this.objectRecordsPermissions,
      this.internalContext,
      this.shouldBypassPermissionChecks,
      this.authContext,
      this.featureFlagMap,
    ) as this;

    return workspaceSoftDeleteQueryBuilder;
  }

  override async execute(): Promise<UpdateResult> {
    try {
      this.applyRowLevelPermissionPredicates();
      validateQueryIsPermittedOrThrow({
        expressionMap: this.expressionMap,
        objectsPermissions: this.objectRecordsPermissions,
        flatObjectMetadataMaps: this.internalContext.flatObjectMetadataMaps,
        flatFieldMetadataMaps: this.internalContext.flatFieldMetadataMaps,
        objectIdByNameSingular: this.internalContext.objectIdByNameSingular,
        shouldBypassPermissionChecks: this.shouldBypassPermissionChecks,
      });

      const mainAliasTarget = this.getMainAliasTarget();

      const objectMetadata = getObjectMetadataFromEntityTarget(
        mainAliasTarget,
        this.internalContext,
      );

      const beforeEventSelectQueryBuilder = computeEventSelectQueryBuilder<T>({
        queryBuilder: this,
        authContext: this.authContext,
        internalContext: this.internalContext,
        featureFlagMap: this.featureFlagMap,
        expressionMap: this.expressionMap,
        objectRecordsPermissions: this.objectRecordsPermissions,
      });

      const tableName = computeObjectTargetTable(objectMetadata);

      const before = await beforeEventSelectQueryBuilder.getMany({
        noFormatting: true,
      });

      this.expressionMap.wheres = applyTableAliasOnWhereCondition({
        condition: this.expressionMap.wheres,
        tableName,
        aliasName: objectMetadata.nameSingular,
      }) as WhereClause[];

      const typeORMSoftRemoveResultWithOnlyIdColumn = await super.execute();

      const afterWithAllFields = await beforeEventSelectQueryBuilder.getMany({
        noFormatting: true,
      });

      const formattedAfter = formatResult<T[]>(
        afterWithAllFields,
        objectMetadata,
        this.internalContext.flatObjectMetadataMaps,
        this.internalContext.flatFieldMetadataMaps,
      );

      const formattedBefore = formatResult<T[]>(
        before,
        objectMetadata,
        this.internalContext.flatObjectMetadataMaps,
        this.internalContext.flatFieldMetadataMaps,
      );

      this.internalContext.eventEmitterService.emitDatabaseBatchEvent(
        formatSearmOrmEventToDatabaseBatchEvent({
          action:
            this.expressionMap.queryType === 'restore'
              ? DatabaseEventAction.RESTORED
              : DatabaseEventAction.DELETED,
          objectMetadataItem: objectMetadata,
          flatFieldMetadataMaps: this.internalContext.flatFieldMetadataMaps,
          workspaceId: this.internalContext.workspaceId,
          recordsBefore: formattedBefore,
          recordsAfter: formattedAfter,
          authContext: this.authContext,
        }),
      );

      return {
        raw: typeORMSoftRemoveResultWithOnlyIdColumn.raw,
        generatedMaps: formattedAfter,
        affected: typeORMSoftRemoveResultWithOnlyIdColumn.affected,
      };
    } catch (error) {
      throw await computeSearmORMException(error);
    }
  }

  override select(): WorkspaceSelectQueryBuilder<T> {
    throw new SearmORMException(
      'This builder cannot morph into a select builder',
      SearmORMExceptionCode.METHOD_NOT_ALLOWED,
    );
  }

  override update(): WorkspaceUpdateQueryBuilder<T> {
    throw new SearmORMException(
      'This builder cannot morph into an update builder',
      SearmORMExceptionCode.METHOD_NOT_ALLOWED,
    );
  }

  override insert(): InsertQueryBuilder<T> {
    throw new SearmORMException(
      'This builder cannot morph into an insert builder',
      SearmORMExceptionCode.METHOD_NOT_ALLOWED,
    );
  }

  override delete(): WorkspaceDeleteQueryBuilder<T> {
    throw new SearmORMException(
      'This builder cannot morph into a delete builder',
      SearmORMExceptionCode.METHOD_NOT_ALLOWED,
    );
  }

  private getMainAliasTarget(): EntityTarget<T> {
    const mainAliasTarget = this.expressionMap.mainAlias?.target;

    if (!mainAliasTarget) {
      throw new SearmORMException(
        'Main alias target is missing',
        SearmORMExceptionCode.MISSING_MAIN_ALIAS_TARGET,
      );
    }

    return mainAliasTarget;
  }

  private applyRowLevelPermissionPredicates(): void {
    if (this.shouldBypassPermissionChecks) {
      return;
    }

    const mainAliasTarget = this.getMainAliasTarget();

    const objectMetadata = getObjectMetadataFromEntityTarget(
      mainAliasTarget,
      this.internalContext,
    );

    applyRowLevelPermissionPredicates({
      queryBuilder: this as unknown as WorkspaceSelectQueryBuilder<T>,
      objectMetadata,
      internalContext: this.internalContext,
      authContext: this.authContext,
      featureFlagMap: this.featureFlagMap,
    });
  }
}
