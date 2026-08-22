import { Module } from '@nestjs/common';

import { AiResearchModule } from 'src/engine/metadata-modules/ai/ai-research/ai-research.module';
import { WorkflowCommonModule } from 'src/modules/workflow/common/workflow-common.module';
import { WorkflowExecutionContextService } from 'src/modules/workflow/workflow-executor/services/workflow-execution-context.service';
import { CreateAgentTaskWorkflowAction } from 'src/modules/workflow/workflow-executor/workflow-actions/create-agent-task/create-agent-task.workflow-action';
import { UserWorkspaceModule } from 'src/engine/core-modules/user-workspace/user-workspace.module';
import { UserRoleModule } from 'src/engine/metadata-modules/user-role/user-role.module';
import { RoleModule } from 'src/engine/metadata-modules/role/role.module';
import { ApplicationModule } from 'src/engine/core-modules/application/application.module';
import { WorkflowRunModule } from 'src/modules/workflow/workflow-runner/workflow-run/workflow-run.module';

@Module({
  imports: [
    AiResearchModule,
    ApplicationModule,
    WorkflowRunModule,
    UserWorkspaceModule,
    UserRoleModule,
    RoleModule,
    WorkflowCommonModule,
  ],
  providers: [WorkflowExecutionContextService, CreateAgentTaskWorkflowAction],
  exports: [CreateAgentTaskWorkflowAction],
})
export class CreateAgentTaskActionModule {}
