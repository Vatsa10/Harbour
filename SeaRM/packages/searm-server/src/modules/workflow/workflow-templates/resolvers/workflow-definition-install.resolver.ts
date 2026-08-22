import { UseGuards } from '@nestjs/common';
import { Args, Mutation } from '@nestjs/graphql';

import { PermissionFlagType } from 'searm-shared/constants';

import { CoreResolver } from 'src/engine/api/graphql/graphql-config/decorators/core-resolver.decorator';
import { type FlatWorkspace } from 'src/engine/core-modules/workspace/types/flat-workspace.type';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { SettingsPermissionGuard } from 'src/engine/guards/settings-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { InstallWorkflowDefinitionInput } from 'src/modules/workflow/workflow-templates/dtos/install-workflow-definition.input';
import { InstalledWorkflowTemplateDTO } from 'src/modules/workflow/workflow-templates/dtos/workflow-template.dto';
import { WorkflowTemplateService } from 'src/modules/workflow/workflow-templates/services/workflow-template.service';
import { type WorkflowStepInput } from 'src/modules/workflow/workflow-templates/types/workflow-template.type';
import { type WorkflowTrigger } from 'src/modules/workflow/workflow-trigger/types/workflow-trigger.type';

// Core schema, not metadata: an installed application seeds its workflows
// through CoreApiClient, and a metadata-scoped mutation is absent from the
// core endpoint entirely.
@UseGuards(
  WorkspaceAuthGuard,
  SettingsPermissionGuard(PermissionFlagType.WORKFLOWS),
)
@CoreResolver()
export class WorkflowDefinitionInstallResolver {
  constructor(
    private readonly workflowTemplateService: WorkflowTemplateService,
  ) {}

  @Mutation(() => InstalledWorkflowTemplateDTO)
  async installWorkflowDefinition(
    @Args('input') input: InstallWorkflowDefinitionInput,
    @AuthWorkspace() workspace: FlatWorkspace,
  ): Promise<InstalledWorkflowTemplateDTO> {
    return this.workflowTemplateService.installDefinition({
      definition: {
        name: input.name,
        description: input.description,
        // The wire type is JSON: the trigger/step unions are server-internal
        // and validated by the workflow executor, not by GraphQL.
        trigger: input.trigger as unknown as WorkflowTrigger,
        steps: input.steps as unknown as WorkflowStepInput[],
      },
      workspaceId: workspace.id,
      activate: input.activate,
    });
  }
}
