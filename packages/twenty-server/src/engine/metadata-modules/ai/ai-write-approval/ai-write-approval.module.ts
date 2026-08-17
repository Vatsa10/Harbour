import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { NotificationModule } from 'src/engine/core-modules/notification/notification.module';
import { KeyValuePairModule } from 'src/engine/core-modules/key-value-pair/key-value-pair.module';
import { RecordCrudModule } from 'src/engine/core-modules/record-crud/record-crud.module';
import { ToolModule } from 'src/engine/core-modules/tool/tool.module';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { PermissionsModule } from 'src/engine/metadata-modules/permissions/permissions.module';
import { GlobalWorkspaceDataSourceModule } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-datasource.module';
import { WorkspaceCacheModule } from 'src/engine/workspace-cache/workspace-cache.module';
import { AiResearchModule } from 'src/engine/metadata-modules/ai/ai-research/ai-research.module';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AiMonitoringSweepCronCommand } from 'src/engine/metadata-modules/ai/ai-write-approval/crons/commands/ai-monitoring-sweep.cron.command';
import { AiMonitoringSweepCronJob } from 'src/engine/metadata-modules/ai/ai-write-approval/crons/jobs/ai-monitoring-sweep.cron.job';
import { AiMonitoringSweepJob } from 'src/engine/metadata-modules/ai/ai-write-approval/jobs/ai-monitoring-sweep.job';
import { ProposalItemEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal-item.entity';
import { ProposalEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal.entity';
import { AiWritePolicyResolver } from 'src/engine/metadata-modules/ai/ai-write-approval/resolvers/ai-write-policy.resolver';
import { ProposalItemFieldsResolver } from 'src/engine/metadata-modules/ai/ai-write-approval/resolvers/proposal-item-fields.resolver';
import { ProposalResolver } from 'src/engine/metadata-modules/ai/ai-write-approval/resolvers/proposal.resolver';
import { AiWritePolicyService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/ai-write-policy.service';
import { ProposalCreationService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-creation.service';
import { ProposalExecutionService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-execution.service';
import { ProposalGateService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-gate.service';
import { ProposalSupersessionService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-supersession.service';
import { UserRoleModule } from 'src/engine/metadata-modules/user-role/user-role.module';

@Module({
  imports: [
    // FactService only — the module exports no Fact repository.
    AiResearchModule,
    TypeOrmModule.forFeature([
      ProposalEntity,
      ProposalItemEntity,
      UserEntity,
      UserWorkspaceEntity,
      // The monitoring sweep cron fans out over active workspaces.
      WorkspaceEntity,
    ]),
    KeyValuePairModule,
    NotificationModule,
    RecordCrudModule,
    UserRoleModule,
    PermissionsModule,
    WorkspaceCacheModule,
    ToolModule,
    GlobalWorkspaceDataSourceModule,
  ],
  providers: [
    AiWritePolicyService,
    ProposalGateService,
    ProposalCreationService,
    ProposalExecutionService,
    ProposalSupersessionService,
    ProposalResolver,
    AiWritePolicyResolver,
    ProposalItemFieldsResolver,
    AiMonitoringSweepCronJob,
    AiMonitoringSweepCronCommand,
    AiMonitoringSweepJob,
  ],
  exports: [
    AiWritePolicyService,
    ProposalGateService,
    ProposalCreationService,
    ProposalExecutionService,
    // Exported for the monitoring sweep, which owns the per-workspace tick
    // this service's pull-based half runs on.
    ProposalSupersessionService,
    // cron-register-all injects this to register the monitoring sweep at
    // bootstrap — the only reason it needs to leave this module.
    AiMonitoringSweepCronCommand,
  ],
})
export class AiWriteApprovalModule {}
