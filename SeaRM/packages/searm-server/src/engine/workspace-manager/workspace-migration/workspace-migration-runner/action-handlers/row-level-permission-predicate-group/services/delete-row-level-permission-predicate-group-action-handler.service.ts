// SeaRM — AGPL-3.0. Clean-room reimplementation of the row-level-permission
// predicate group delete action handler (no upstream Enterprise source
// consulted; derived from the sibling
// delete-view-filter-group-action-handler.service.ts).

import { Injectable } from '@nestjs/common';

import { WorkspaceMigrationRunnerActionHandler } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-runner/interfaces/workspace-migration-runner-action-handler-service.interface';

import { RowLevelPermissionPredicateGroupEntity } from 'src/engine/metadata-modules/row-level-permission-predicate/entities/row-level-permission-predicate-group.entity';
import {
  type FlatDeleteRowLevelPermissionPredicateGroupAction,
  type UniversalDeleteRowLevelPermissionPredicateGroupAction,
} from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/builders/row-level-permission-predicate-group/types/workspace-migration-row-level-permission-predicate-group-action.type';
import {
  type WorkspaceMigrationActionRunnerArgs,
  type WorkspaceMigrationActionRunnerContext,
} from 'src/engine/workspace-manager/workspace-migration/workspace-migration-runner/types/workspace-migration-action-runner-args.type';

@Injectable()
export class DeleteRowLevelPermissionPredicateGroupActionHandlerService extends WorkspaceMigrationRunnerActionHandler(
  'delete',
  'rowLevelPermissionPredicateGroup',
) {
  constructor() {
    super();
  }

  override async transpileUniversalActionToFlatAction(
    context: WorkspaceMigrationActionRunnerArgs<UniversalDeleteRowLevelPermissionPredicateGroupAction>,
  ): Promise<FlatDeleteRowLevelPermissionPredicateGroupAction> {
    return this.transpileUniversalDeleteActionToFlatDeleteAction(context);
  }

  async executeForMetadata(
    context: WorkspaceMigrationActionRunnerContext<FlatDeleteRowLevelPermissionPredicateGroupAction>,
  ): Promise<void> {
    const { flatAction, queryRunner, workspaceId } = context;

    const rowLevelPermissionPredicateGroupRepository =
      queryRunner.manager.getRepository<RowLevelPermissionPredicateGroupEntity>(
        RowLevelPermissionPredicateGroupEntity,
      );

    await rowLevelPermissionPredicateGroupRepository.delete({
      id: flatAction.entityId,
      workspaceId,
    });
  }

  async executeForWorkspaceSchema(
    _context: WorkspaceMigrationActionRunnerContext<FlatDeleteRowLevelPermissionPredicateGroupAction>,
  ): Promise<void> {
    return;
  }
}
