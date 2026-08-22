// SeaRM — AGPL-3.0. Clean-room reimplementation of the usage ledger
// (no SeaRM Enterprise source consulted).

import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { UsageAnalyticsDTO } from 'src/engine/core-modules/usage/dtos/usage-analytics.dto';
import { UsageAnalyticsInput } from 'src/engine/core-modules/usage/dtos/inputs/usage-analytics.input';
import { UsageAnalyticsService } from 'src/engine/core-modules/usage/services/usage-analytics.service';
import { type WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';

@UseGuards(WorkspaceAuthGuard)
@Resolver()
export class UsageResolver {
  constructor(private readonly usageAnalyticsService: UsageAnalyticsService) {}

  @Query(() => UsageAnalyticsDTO)
  async getUsageAnalytics(
    @AuthWorkspace() workspace: WorkspaceEntity,
    @Args('input') input: UsageAnalyticsInput,
  ): Promise<UsageAnalyticsDTO> {
    return this.usageAnalyticsService.getUsageAnalytics({
      workspaceId: workspace.id,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      operationType: input.operationType,
    });
  }
}
