// SeaRM — AGPL-3.0. Clean-room reimplementation of the row-level-permission
// predicate update action handler (no SeaRM Enterprise source consulted;
// derived from the sibling update-view-filter-action-handler.service.ts).

import { Injectable } from '@nestjs/common';

import { WorkspaceMigrationRunnerActionHandler } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-runner/interfaces/workspace-migration-runner-action-handler-service.interface';

import { findFlatEntityByUniversalIdentifierOrThrow } from 'src/engine/metadata-modules/flat-entity/utils/find-flat-entity-by-universal-identifier-or-throw.util';
import { RowLevelPermissionPredicateEntity } from 'src/engine/metadata-modules/row-level-permission-predicate/entities/row-level-permission-predicate.entity';
import { resolveUniversalUpdateRelationIdentifiersToIds } from 'src/engine/workspace-manager/workspace-migration/universal-flat-entity/utils/resolve-universal-update-relation-identifiers-to-ids.util';
import {
  FlatUpdateRowLevelPermissionPredicateAction,
  UniversalUpdateRowLevelPermissionPredicateAction,
} from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/builders/row-level-permission-predicate/types/workspace-migration-row-level-permission-predicate-action.type';
import {
  WorkspaceMigrationActionRunnerArgs,
  WorkspaceMigrationActionRunnerContext,
} from 'src/engine/workspace-manager/workspace-migration/workspace-migration-runner/types/workspace-migration-action-runner-args.type';

@Injectable()
export class UpdateRowLevelPermissionPredicateActionHandlerService extends WorkspaceMigrationRunnerActionHandler(
  'update',
  'rowLevelPermissionPredicate',
) {
  constructor() {
    super();
  }

  override async transpileUniversalActionToFlatAction(
    context: WorkspaceMigrationActionRunnerArgs<UniversalUpdateRowLevelPermissionPredicateAction>,
  ): Promise<FlatUpdateRowLevelPermissionPredicateAction> {
    const { action, allFlatEntityMaps } = context;

    const flatRowLevelPermissionPredicate =
      findFlatEntityByUniversalIdentifierOrThrow({
        flatEntityMaps: allFlatEntityMaps.flatRowLevelPermissionPredicateMaps,
        universalIdentifier: action.universalIdentifier,
      });

    const update = resolveUniversalUpdateRelationIdentifiersToIds({
      metadataName: 'rowLevelPermissionPredicate',
      universalUpdate: action.update,
      allFlatEntityMaps,
    });

    return {
      type: 'update',
      metadataName: 'rowLevelPermissionPredicate',
      entityId: flatRowLevelPermissionPredicate.id,
      update,
    };
  }

  async executeForMetadata(
    context: WorkspaceMigrationActionRunnerContext<FlatUpdateRowLevelPermissionPredicateAction>,
  ): Promise<void> {
    const { flatAction, queryRunner, workspaceId } = context;
    const { entityId, update } = flatAction;

    const rowLevelPermissionPredicateRepository =
      queryRunner.manager.getRepository<RowLevelPermissionPredicateEntity>(
        RowLevelPermissionPredicateEntity,
      );

    await rowLevelPermissionPredicateRepository.update(
      { id: entityId, workspaceId },
      update,
    );
  }

  async executeForWorkspaceSchema(
    _context: WorkspaceMigrationActionRunnerContext<FlatUpdateRowLevelPermissionPredicateAction>,
  ): Promise<void> {
    return;
  }
}
