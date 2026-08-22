// SeaRM — AGPL-3.0. Clean-room reimplementation of the row-level-permission
// predicate create action handler (no SeaRM Enterprise source consulted;
// derived from the sibling create-view-filter-action-handler.service.ts).

import { Injectable } from '@nestjs/common';

import { v4 } from 'uuid';

import { WorkspaceMigrationRunnerActionHandler } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-runner/interfaces/workspace-migration-runner-action-handler-service.interface';

import { getUniversalFlatEntityEmptyForeignKeyAggregators } from 'src/engine/workspace-manager/workspace-migration/universal-flat-entity/utils/reset-universal-flat-entity-foreign-key-aggregators.util';
import { resolveUniversalRelationIdentifiersToIds } from 'src/engine/workspace-manager/workspace-migration/universal-flat-entity/utils/resolve-universal-relation-identifiers-to-ids.util';
import {
  FlatCreateRowLevelPermissionPredicateAction,
  UniversalCreateRowLevelPermissionPredicateAction,
} from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/builders/row-level-permission-predicate/types/workspace-migration-row-level-permission-predicate-action.type';
import {
  WorkspaceMigrationActionRunnerArgs,
  WorkspaceMigrationActionRunnerContext,
} from 'src/engine/workspace-manager/workspace-migration/workspace-migration-runner/types/workspace-migration-action-runner-args.type';

@Injectable()
export class CreateRowLevelPermissionPredicateActionHandlerService extends WorkspaceMigrationRunnerActionHandler(
  'create',
  'rowLevelPermissionPredicate',
) {
  override async transpileUniversalActionToFlatAction({
    action,
    allFlatEntityMaps,
    flatApplication,
    workspaceId,
  }: WorkspaceMigrationActionRunnerArgs<UniversalCreateRowLevelPermissionPredicateAction>): Promise<FlatCreateRowLevelPermissionPredicateAction> {
    const {
      fieldMetadataId,
      roleId,
      objectMetadataId,
      workspaceMemberFieldMetadataId,
      rowLevelPermissionPredicateGroupId,
    } = resolveUniversalRelationIdentifiersToIds({
      flatEntityMaps: allFlatEntityMaps,
      metadataName: action.metadataName,
      universalForeignKeyValues: action.flatEntity,
    });

    const emptyUniversalForeignKeyAggregators =
      getUniversalFlatEntityEmptyForeignKeyAggregators({
        metadataName: 'rowLevelPermissionPredicate',
      });

    return {
      ...action,
      flatEntity: {
        ...action.flatEntity,
        fieldMetadataId,
        roleId,
        objectMetadataId,
        workspaceMemberFieldMetadataId,
        rowLevelPermissionPredicateGroupId,
        id: action.id ?? v4(),
        applicationId: flatApplication.id,
        workspaceId,
        ...emptyUniversalForeignKeyAggregators,
      },
    };
  }

  async executeForMetadata(
    context: WorkspaceMigrationActionRunnerContext<FlatCreateRowLevelPermissionPredicateAction>,
  ): Promise<void> {
    const { flatAction, queryRunner } = context;
    const { flatEntity } = flatAction;

    // Row-level-permission predicates are metadata rows (like view filters),
    // not workspace-schema columns: creation is a plain insert. There is no
    // schema DDL step, so a create that reaches here and fails must throw
    // rather than degrade to a partially-applied predicate set — see
    // executeForWorkspaceSchema below and the RLP recon's deny-by-default
    // contract.
    await this.insertFlatEntitiesInRepository({
      queryRunner,
      flatEntities: [flatEntity],
    });
  }

  async executeForWorkspaceSchema(
    _context: WorkspaceMigrationActionRunnerContext<FlatCreateRowLevelPermissionPredicateAction>,
  ): Promise<void> {
    return;
  }
}
