import { UseGuards } from '@nestjs/common';
import { Args, ID, Query } from '@nestjs/graphql';
import { InjectRepository } from '@nestjs/typeorm';

import { PermissionFlagType } from 'twenty-shared/constants';
import { Repository } from 'typeorm';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { type FlatWorkspace } from 'src/engine/core-modules/workspace/types/flat-workspace.type';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { SettingsPermissionGuard } from 'src/engine/guards/settings-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { AgentRunDTO } from 'src/engine/metadata-modules/ai/ai-research/dtos/agent-run.dto';
import { AgentRunEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/agent-run.entity';

@UseGuards(WorkspaceAuthGuard, SettingsPermissionGuard(PermissionFlagType.AI))
@MetadataResolver()
export class AgentRunResolver {
  constructor(
    @InjectRepository(AgentRunEntity)
    private readonly agentRunRepository: Repository<AgentRunEntity>,
  ) {}

  @Query(() => [AgentRunDTO])
  async agentRuns(
    @AuthWorkspace() workspace: FlatWorkspace,
    @Args('agentTaskId', { type: () => ID, nullable: true })
    agentTaskId?: string,
  ): Promise<AgentRunDTO[]> {
    const runs = await this.agentRunRepository.find({
      where: {
        workspaceId: workspace.id,
        ...(agentTaskId ? { taskId: agentTaskId } : {}),
      },
      order: { createdAt: 'DESC' },
    });

    return runs.map((run) => ({
      id: run.id,
      agentTaskId: run.taskId,
      modelId: run.modelId,
      elapsedMs: run.elapsedMs,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      creditsUsedMicro: run.creditsUsedMicro,
      resultSummary: run.resultSummary,
      errorMessage: run.errorMessage,
      createdAt: run.createdAt,
    }));
  }
}
