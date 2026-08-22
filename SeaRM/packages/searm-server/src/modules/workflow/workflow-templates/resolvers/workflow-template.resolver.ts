import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query } from '@nestjs/graphql';

import { PermissionFlagType } from 'searm-shared/constants';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { type FlatWorkspace } from 'src/engine/core-modules/workspace/types/flat-workspace.type';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { SettingsPermissionGuard } from 'src/engine/guards/settings-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { InstallWorkflowTemplateInput } from 'src/modules/workflow/workflow-templates/dtos/install-workflow-template.input';
import {
  InstalledWorkflowTemplateDTO,
  WorkflowTemplateDTO,
} from 'src/modules/workflow/workflow-templates/dtos/workflow-template.dto';
import { WorkflowTemplateService } from 'src/modules/workflow/workflow-templates/services/workflow-template.service';

// Metadata schema: this pair backs the settings UI. The core-schema
// installWorkflowDefinition mutation is a separate class in its own file so
// each schema scope is obvious at a glance.
@UseGuards(
  WorkspaceAuthGuard,
  SettingsPermissionGuard(PermissionFlagType.WORKFLOWS),
)
@MetadataResolver()
export class WorkflowTemplateResolver {
  constructor(
    private readonly workflowTemplateService: WorkflowTemplateService,
  ) {}

  @Query(() => [WorkflowTemplateDTO])
  workflowTemplates(): WorkflowTemplateDTO[] {
    return this.workflowTemplateService.list();
  }

  @Mutation(() => InstalledWorkflowTemplateDTO)
  async installWorkflowTemplate(
    @Args('input') input: InstallWorkflowTemplateInput,
    @AuthWorkspace() workspace: FlatWorkspace,
  ): Promise<InstalledWorkflowTemplateDTO> {
    return this.workflowTemplateService.install({
      key: input.key,
      workspaceId: workspace.id,
      activate: input.activate ?? false,
    });
  }
}
