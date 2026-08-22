// SeaRM — AGPL-3.0. Clean-room reimplementation of the row-level-permission
// predicate group create action handler (no upstream Enterprise source
// consulted; derived from the sibling
// create-view-filter-group-action-handler.service.ts).

import { Injectable } from '@nestjs/common';

import { v4 } from 'uuid';

import { WorkspaceMigrationRunnerActionHandler } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-runner/interfaces/workspace-migration-runner-action-handler-service.interface';

import { getUniversalFlatEntityEmptyForeignKeyAggregators } from 'src/engine/workspace-manager/workspace-migration/universal-flat-entity/utils/reset-universal-flat-entity-foreign-key-aggregators.util';
import { resolveUniversalRelationIdentifiersToIds } from 'src/engine/workspace-manager/workspace-migration/universal-flat-entity/utils/resolve-universal-relation-identifiers-to-ids.util';
import {
  type FlatCreateRowLevelPermissionPredicateGroupAction,
  type UniversalCreateRowLevelPermissionPredicateGroupAction,
} from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/builders/row-level-permission-predicate-group/types/workspace-migration-row-level-permission-predicate-group-action.type';
import {
  type WorkspaceMigrationActionRunnerArgs,
  type WorkspaceMigrationActionRunnerContext,
} from 'src/engine/workspace-manager/workspace-migration/workspace-migration-runner/types/workspace-migration-action-runner-args.type';

@Injectable()
export class CreateRowLevelPermissionPredicateGroupActionHandlerService extends WorkspaceMigrationRunnerActionHandler(
  'create',
  'rowLevelPermissionPredicateGroup',
) {
  override async transpileUniversalActionToFlatAction({
    action,
    allFlatEntityMaps,
    flatApplication,
    workspaceId,
  }: WorkspaceMigrationActionRunnerArgs<UniversalCreateRowLevelPermissionPredicateGroupAction>): Promise<FlatCreateRowLevelPermissionPredicateGroupAction> {
    const { roleId, objectMetadataId, parentRowLevelPermissionPredicateGroupId } =
      resolveUniversalRelationIdentifiersToIds({
        flatEntityMaps: allFlatEntityMaps,
        metadataName: action.metadataName,
        universalForeignKeyValues: action.flatEntity,
      });

    const emptyUniversalForeignKeyAggregators =
      getUniversalFlatEntityEmptyForeignKeyAggregators({
        metadataName: 'rowLevelPermissionPredicateGroup',
      });

    return {
      ...action,
      flatEntity: {
        ...action.flatEntity,
        roleId,
        objectMetadataId,
        parentRowLevelPermissionPredicateGroupId,
        id: action.id ?? v4(),
        applicationId: flatApplication.id,
        workspaceId,
        childRowLevelPermissionPredicateGroupIds: [],
        rowLevelPermissionPredicateIds: [],
        ...emptyUniversalForeignKeyAggregators,
      },
    };
  }

  async executeForMetadata(
    context: WorkspaceMigrationActionRunnerContext<FlatCreateRowLevelPermissionPredicateGroupAction>,
  ): Promise<void> {
    const { flatAction, queryRunner } = context;
    const { flatEntity } = flatAction;

    await this.insertFlatEntitiesInRepository({
      queryRunner,
      flatEntities: [flatEntity],
    });
  }

  async executeForWorkspaceSchema(
    _context: WorkspaceMigrationActionRunnerContext<FlatCreateRowLevelPermissionPredicateGroupAction>,
  ): Promise<void> {
    return;
  }
}
