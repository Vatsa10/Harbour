// SeaRM — AGPL-3.0. Clean-room reimplementation of the row-level-permission
// predicate group update action handler (no upstream Enterprise source
// consulted; derived from the sibling
// update-view-filter-group-action-handler.service.ts).

import { Injectable } from '@nestjs/common';

import { WorkspaceMigrationRunnerActionHandler } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-runner/interfaces/workspace-migration-runner-action-handler-service.interface';

import { findFlatEntityByUniversalIdentifierOrThrow } from 'src/engine/metadata-modules/flat-entity/utils/find-flat-entity-by-universal-identifier-or-throw.util';
import { RowLevelPermissionPredicateGroupEntity } from 'src/engine/metadata-modules/row-level-permission-predicate/entities/row-level-permission-predicate-group.entity';
import { resolveUniversalUpdateRelationIdentifiersToIds } from 'src/engine/workspace-manager/workspace-migration/universal-flat-entity/utils/resolve-universal-update-relation-identifiers-to-ids.util';
import {
  type FlatUpdateRowLevelPermissionPredicateGroupAction,
  type UniversalUpdateRowLevelPermissionPredicateGroupAction,
} from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/builders/row-level-permission-predicate-group/types/workspace-migration-row-level-permission-predicate-group-action.type';
import {
  type WorkspaceMigrationActionRunnerArgs,
  type WorkspaceMigrationActionRunnerContext,
} from 'src/engine/workspace-manager/workspace-migration/workspace-migration-runner/types/workspace-migration-action-runner-args.type';

@Injectable()
export class UpdateRowLevelPermissionPredicateGroupActionHandlerService extends WorkspaceMigrationRunnerActionHandler(
  'update',
  'rowLevelPermissionPredicateGroup',
) {
  constructor() {
    super();
  }

  override async transpileUniversalActionToFlatAction(
    context: WorkspaceMigrationActionRunnerArgs<UniversalUpdateRowLevelPermissionPredicateGroupAction>,
  ): Promise<FlatUpdateRowLevelPermissionPredicateGroupAction> {
    const { action, allFlatEntityMaps } = context;

    const flatRowLevelPermissionPredicateGroup =
      findFlatEntityByUniversalIdentifierOrThrow({
        flatEntityMaps:
          allFlatEntityMaps.flatRowLevelPermissionPredicateGroupMaps,
        universalIdentifier: action.universalIdentifier,
      });

    const update = resolveUniversalUpdateRelationIdentifiersToIds({
      metadataName: 'rowLevelPermissionPredicateGroup',
      universalUpdate: action.update,
      allFlatEntityMaps,
    });

    return {
      type: 'update',
      metadataName: 'rowLevelPermissionPredicateGroup',
      entityId: flatRowLevelPermissionPredicateGroup.id,
      update,
    };
  }

  async executeForMetadata(
    context: WorkspaceMigrationActionRunnerContext<FlatUpdateRowLevelPermissionPredicateGroupAction>,
  ): Promise<void> {
    const { flatAction, queryRunner, workspaceId } = context;
    const { entityId, update } = flatAction;

    const rowLevelPermissionPredicateGroupRepository =
      queryRunner.manager.getRepository<RowLevelPermissionPredicateGroupEntity>(
        RowLevelPermissionPredicateGroupEntity,
      );

    await rowLevelPermissionPredicateGroupRepository.update(
      { id: entityId, workspaceId },
      update,
    );
  }

  async executeForWorkspaceSchema(
    _context: WorkspaceMigrationActionRunnerContext<FlatUpdateRowLevelPermissionPredicateGroupAction>,
  ): Promise<void> {
    return;
  }
}
