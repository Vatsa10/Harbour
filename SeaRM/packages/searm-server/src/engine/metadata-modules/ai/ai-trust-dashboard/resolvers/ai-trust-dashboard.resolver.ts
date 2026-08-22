import { UseGuards } from '@nestjs/common';
import { Args, Int, Query } from '@nestjs/graphql';

import { PermissionFlagType } from 'searm-shared/constants';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { type WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { SettingsPermissionGuard } from 'src/engine/guards/settings-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { AiTrustDashboardDTO } from 'src/engine/metadata-modules/ai/ai-trust-dashboard/dtos/ai-trust-dashboard.dto';
import { AiTrustDashboardService } from 'src/engine/metadata-modules/ai/ai-trust-dashboard/services/ai-trust-dashboard.service';
import {
  AI_SPEND_DEFAULT_BUCKET_COUNT,
  AiSpendPeriod,
} from 'src/engine/metadata-modules/ai/ai-trust-dashboard/types/ai-spend-period.type';

// AI_SETTINGS, not AI. This surface reports workspace-wide AI spend and every
// reviewer's approve/reject record; that is administrator information, and the
// same flag already guards the approvals surface and the write policy.
@UseGuards(
  WorkspaceAuthGuard,
  SettingsPermissionGuard(PermissionFlagType.AI_SETTINGS),
)
@MetadataResolver()
export class AiTrustDashboardResolver {
  constructor(
    private readonly aiTrustDashboardService: AiTrustDashboardService,
  ) {}

  @Query(() => AiTrustDashboardDTO)
  async findAiTrustDashboard(
    @AuthWorkspace() { id: workspaceId }: WorkspaceEntity,
    @Args('period', { type: () => AiSpendPeriod, nullable: true })
    period?: AiSpendPeriod,
    @Args('bucketCount', { type: () => Int, nullable: true })
    bucketCount?: number,
  ): Promise<AiTrustDashboardDTO> {
    return this.aiTrustDashboardService.computeDashboard({
      workspaceId,
      period: period ?? AiSpendPeriod.DAY,
      bucketCount: bucketCount ?? AI_SPEND_DEFAULT_BUCKET_COUNT,
    });
  }
}
