import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AiResearchModule } from 'src/engine/metadata-modules/ai/ai-research/ai-research.module';
import { AgentRunEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/agent-run.entity';
import { AiTrustDashboardResolver } from 'src/engine/metadata-modules/ai/ai-trust-dashboard/resolvers/ai-trust-dashboard.resolver';
import { AiTrustDashboardService } from 'src/engine/metadata-modules/ai/ai-trust-dashboard/services/ai-trust-dashboard.service';
import { ProposalItemEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal-item.entity';
import { ProposalEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal.entity';
import { PermissionsModule } from 'src/engine/metadata-modules/permissions/permissions.module';
import { provideWorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/provide-workspace-scoped-repository';

@Module({
  imports: [
    // For FactService only. AiResearchModule exports no Fact repository, and
    // this module must not acquire one: Fact is read through the service
    // boundary or not at all.
    AiResearchModule,
    // ProposalItemEntity is registered so the aggregate can join it, but no
    // repository is provided for it — it has no workspaceId, so a repository
    // here would be an unscoped read waiting to happen.
    TypeOrmModule.forFeature([
      AgentRunEntity,
      ProposalEntity,
      ProposalItemEntity,
    ]),
    // SettingsPermissionGuard resolves PermissionsService from the injector.
    PermissionsModule,
  ],
  providers: [
    AiTrustDashboardService,
    AiTrustDashboardResolver,
    provideWorkspaceScopedRepository(AgentRunEntity),
    provideWorkspaceScopedRepository(ProposalEntity),
  ],
  exports: [AiTrustDashboardService],
})
export class AiTrustDashboardModule {}
