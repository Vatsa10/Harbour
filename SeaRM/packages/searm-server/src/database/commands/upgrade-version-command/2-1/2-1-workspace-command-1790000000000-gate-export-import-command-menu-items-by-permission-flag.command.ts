import { Command } from 'nest-commander';
import { isDefined } from 'searm-shared/utils';

import { ProvisionedWorkspaceCommandRunner } from 'src/database/commands/command-runners/provisioned-workspace.command-runner';
import { WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { type RunOnWorkspaceArgs } from 'src/database/commands/command-runners/workspace.command-runner';
import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import { RegisteredWorkspaceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-workspace-command.decorator';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { STANDARD_COMMAND_MENU_ITEMS } from 'src/engine/workspace-manager/searm-standard-application/constants/standard-command-menu-item.constant';
import { computeSearmStandardApplicationAllFlatEntityMaps } from 'src/engine/workspace-manager/searm-standard-application/utils/searm-standard-application-all-flat-entity-maps.constant';
import { WorkspaceMigrationValidateBuildAndRunService } from 'src/engine/workspace-manager/workspace-migration/services/workspace-migration-validate-build-and-run-service';

const UNIVERSAL_IDENTIFIERS_TO_FIX = new Set<string>([
  STANDARD_COMMAND_MENU_ITEMS.exportRecords.universalIdentifier,
  STANDARD_COMMAND_MENU_ITEMS.exportView.universalIdentifier,
  STANDARD_COMMAND_MENU_ITEMS.importRecords.universalIdentifier,
]);

@RegisteredWorkspaceCommand('2.1.0', 1790000000000)
@Command({
  name: 'upgrade:2-1:gate-export-import-by-permission-flag',
  description:
    'Gate export/import command menu items (exportRecords, exportView, importRecords) behind EXPORT_CSV / IMPORT_CSV permission flags',
})
export class GateExportImportCommandMenuItemsByPermissionFlagCommand extends ProvisionedWorkspaceCommandRunner {
  constructor(
    protected readonly workspaceIteratorService: WorkspaceIteratorService,
    private readonly applicationService: ApplicationService,
    private readonly workspaceMigrationValidateBuildAndRunService: WorkspaceMigrationValidateBuildAndRunService,
    private readonly workspaceCacheService: WorkspaceCacheService,
  ) {
    super(workspaceIteratorService);
  }

  override async runOnWorkspace({
    workspaceId,
    options,
  }: RunOnWorkspaceArgs): Promise<void> {
    const isDryRun = options.dryRun ?? false;

    this.logger.log(
      `${isDryRun ? '[DRY RUN] ' : ''}Gating export/import command menu items by permission flag for workspace ${workspaceId}`,
    );

    const { searmStandardFlatApplication } =
      await this.applicationService.findWorkspaceSearmStandardAndCustomApplicationOrThrow(
        { workspaceId },
      );

    const { flatCommandMenuItemMaps: existingFlatCommandMenuItemMaps } =
      await this.workspaceCacheService.getOrRecompute(workspaceId, [
        'flatCommandMenuItemMaps',
      ]);

    const { allFlatEntityMaps: standardAllFlatEntityMaps } =
      computeSearmStandardApplicationAllFlatEntityMaps({
        now: new Date().toISOString(),
        workspaceId,
        searmStandardApplicationId: searmStandardFlatApplication.id,
      });

    const itemsToUpdate = [...UNIVERSAL_IDENTIFIERS_TO_FIX]
      .map((universalIdentifier) => {
        const standardItem =
          standardAllFlatEntityMaps.flatCommandMenuItemMaps
            .byUniversalIdentifier[universalIdentifier];
        const existingItem =
          existingFlatCommandMenuItemMaps.byUniversalIdentifier[
            universalIdentifier
          ];

        if (
          !isDefined(standardItem) ||
          !isDefined(existingItem) ||
          existingItem.conditionalAvailabilityExpression ===
            standardItem.conditionalAvailabilityExpression
        ) {
          return undefined;
        }

        return {
          ...existingItem,
          conditionalAvailabilityExpression:
            standardItem.conditionalAvailabilityExpression,
          updatedAt: new Date().toISOString(),
        };
      })
      .filter(isDefined);

    if (itemsToUpdate.length === 0) {
      this.logger.log(
        `Export/import command menu item expressions already up to date for workspace ${workspaceId}`,
      );

      return;
    }

    this.logger.log(
      `Found ${itemsToUpdate.length} command menu item(s) to update for workspace ${workspaceId}`,
    );

    if (isDryRun) {
      this.logger.log(
        `[DRY RUN] Would update ${itemsToUpdate.length} command menu item availability expression(s) for workspace ${workspaceId}`,
      );

      return;
    }

    const validateAndBuildResult =
      await this.workspaceMigrationValidateBuildAndRunService.validateBuildAndRunLegacyWorkspaceMigration(
        {
          allFlatEntityOperationByMetadataName: {
            commandMenuItem: {
              flatEntityToCreate: [],
              flatEntityToDelete: [],
              flatEntityToUpdate: itemsToUpdate,
            },
          },
          workspaceId,
          applicationUniversalIdentifier:
            searmStandardFlatApplication.universalIdentifier,
        },
      );

    if (validateAndBuildResult.status === 'fail') {
      this.logger.error(
        `Failed to update command menu item availability expressions:\n${JSON.stringify(validateAndBuildResult, null, 2)}`,
      );

      throw new Error(
        `Failed to gate export/import command menu items by permission flag for workspace ${workspaceId}`,
      );
    }

    this.logger.log(
      `Successfully updated ${itemsToUpdate.length} command menu item availability expression(s) for workspace ${workspaceId}`,
    );
  }
}
