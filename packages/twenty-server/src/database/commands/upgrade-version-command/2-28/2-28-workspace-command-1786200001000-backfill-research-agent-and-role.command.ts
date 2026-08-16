import { Command } from 'nest-commander';
import { isDefined } from 'twenty-shared/utils';

import { ProvisionedWorkspaceCommandRunner } from 'src/database/commands/command-runners/provisioned-workspace.command-runner';
import { WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { type RunOnWorkspaceArgs } from 'src/database/commands/command-runners/workspace.command-runner';
import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import { RegisteredWorkspaceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-workspace-command.decorator';
import {
  RESEARCH_AGENT_ROLE_UNIVERSAL_IDENTIFIER,
  RESEARCH_AGENT_UNIVERSAL_IDENTIFIER,
} from 'src/engine/metadata-modules/ai/ai-research/constants/research-agent.const';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { computeTwentyStandardApplicationAllFlatEntityMaps } from 'src/engine/workspace-manager/twenty-standard-application/utils/twenty-standard-application-all-flat-entity-maps.constant';
import { WorkspaceMigrationValidateBuildAndRunService } from 'src/engine/workspace-manager/workspace-migration/services/workspace-migration-validate-build-and-run-service';

// The `researcher` agent and the `AI Researcher` role ship only through the
// declarative standard-application seed, which runs when a workspace is
// created. Every workspace that existed before 2.28.0 therefore has neither,
// and on those workspaces ResearchAgentService.resolveResearchAgentId throws
// and the whole durable-research loop is dead — silently, because
// AgentTaskRunJob used to run a role-less agent (zero registry tools) to
// SUCCEEDED. This is the missing half of that fix: give existing workspaces
// the two rows the seed only gives new ones.
//
// Modelled on 2-27 backfill-standard-skills, which solves the same
// "declarative seed reaches new workspaces only" problem for skills.
@RegisteredWorkspaceCommand('2.28.0', 1786200001000)
@Command({
  name: 'upgrade:2-28:backfill-research-agent-and-role',
  description:
    'Backfill the researcher agent and the AI Researcher role on workspaces created before 2.28.0',
})
export class BackfillResearchAgentAndRoleCommand extends ProvisionedWorkspaceCommandRunner {
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

    const { twentyStandardFlatApplication } =
      await this.applicationService.findWorkspaceTwentyStandardAndCustomApplicationOrThrow(
        { workspaceId },
      );

    const { flatAgentMaps: existingFlatAgentMaps, flatRoleMaps: existingFlatRoleMaps } =
      await this.workspaceCacheService.getOrRecompute(workspaceId, [
        'flatAgentMaps',
        'flatRoleMaps',
      ]);

    const { allFlatEntityMaps: standardAllFlatEntityMaps } =
      computeTwentyStandardApplicationAllFlatEntityMaps({
        now: new Date().toISOString(),
        workspaceId,
        twentyStandardApplicationId: twentyStandardFlatApplication.id,
      });

    const standardAgent =
      standardAllFlatEntityMaps.flatAgentMaps.byUniversalIdentifier[
        RESEARCH_AGENT_UNIVERSAL_IDENTIFIER
      ];
    const standardRole =
      standardAllFlatEntityMaps.flatRoleMaps.byUniversalIdentifier[
        RESEARCH_AGENT_ROLE_UNIVERSAL_IDENTIFIER
      ];

    // The seed itself is gone or renamed — a code-level fault, not a
    // workspace-level one. Fail loudly rather than reporting a clean backfill.
    if (!isDefined(standardAgent) || !isDefined(standardRole)) {
      throw new Error(
        'The standard application no longer emits the researcher agent or the AI Researcher role; nothing to backfill from.',
      );
    }

    const agentsToCreate = isDefined(
      existingFlatAgentMaps.byUniversalIdentifier[
        RESEARCH_AGENT_UNIVERSAL_IDENTIFIER
      ],
    )
      ? []
      : [standardAgent];

    const rolesToCreate = isDefined(
      existingFlatRoleMaps.byUniversalIdentifier[
        RESEARCH_AGENT_ROLE_UNIVERSAL_IDENTIFIER
      ],
    )
      ? []
      : [standardRole];

    if (agentsToCreate.length === 0 && rolesToCreate.length === 0) {
      this.logger.log(
        `Research agent and role already present for workspace ${workspaceId}, skipping`,
      );

      return;
    }

    this.logger.log(
      `${isDryRun ? '[DRY RUN] ' : ''}Backfilling ${agentsToCreate.length} agent(s) and ${rolesToCreate.length} role(s) for workspace ${workspaceId}`,
    );

    if (isDryRun) {
      return;
    }

    // The roleTarget binding between the two is deliberately NOT made here:
    // roleTarget is not a standard-application metadata name, and
    // ResearchAgentService.ensureRoleBinding already creates it idempotently
    // on first use. This command's job is only to make that first use possible.
    const validateAndBuildResult =
      await this.workspaceMigrationValidateBuildAndRunService.validateBuildAndRunLegacyWorkspaceMigration(
        {
          allFlatEntityOperationByMetadataName: {
            role: {
              flatEntityToCreate: rolesToCreate,
              flatEntityToDelete: [],
              flatEntityToUpdate: [],
            },
            agent: {
              flatEntityToCreate: agentsToCreate,
              flatEntityToDelete: [],
              flatEntityToUpdate: [],
            },
          },
          workspaceId,
          applicationUniversalIdentifier:
            twentyStandardFlatApplication.universalIdentifier,
        },
      );

    if (validateAndBuildResult.status === 'fail') {
      this.logger.error(
        `Failed to backfill the research agent and role:\n${JSON.stringify(validateAndBuildResult, null, 2)}`,
      );

      throw new Error(
        `Failed to backfill the research agent and role for workspace ${workspaceId}`,
      );
    }

    this.logger.log(
      `Backfilled the research agent and role for workspace ${workspaceId}`,
    );
  }
}
