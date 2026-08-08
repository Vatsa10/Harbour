import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query } from '@nestjs/graphql';
import { InjectRepository } from '@nestjs/typeorm';

import { FieldActorSource } from 'twenty-shared/types';
import { PermissionFlagType } from 'twenty-shared/constants';
import { Repository } from 'typeorm';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { type FlatWorkspace } from 'src/engine/core-modules/workspace/types/flat-workspace.type';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { SettingsPermissionGuard } from 'src/engine/guards/settings-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { AgentTaskDTO } from 'src/engine/metadata-modules/ai/ai-research/dtos/agent-task.dto';
import { CreateAgentTaskInput } from 'src/engine/metadata-modules/ai/ai-research/dtos/create-agent-task.input';
import { AgentTaskEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/agent-task.entity';
import { AgentTaskService } from 'src/engine/metadata-modules/ai/ai-research/services/agent-task.service';

@UseGuards(WorkspaceAuthGuard, SettingsPermissionGuard(PermissionFlagType.AI))
@MetadataResolver()
export class AgentTaskResolver {
  constructor(
    private readonly agentTaskService: AgentTaskService,
    @InjectRepository(AgentTaskEntity)
    private readonly agentTaskRepository: Repository<AgentTaskEntity>,
  ) {}

  @Query(() => [AgentTaskDTO])
  async agentTasks(
    @AuthWorkspace() workspace: FlatWorkspace,
    @Args('objectNameSingular', { type: () => String, nullable: true })
    objectNameSingular?: string,
    @Args('recordId', { type: () => ID, nullable: true }) recordId?: string,
  ): Promise<AgentTaskDTO[]> {
    const tasks = await this.agentTaskRepository.find({
      where: {
        workspaceId: workspace.id,
        ...(objectNameSingular ? { objectNameSingular } : {}),
        ...(recordId ? { recordId } : {}),
      },
      order: { createdAt: 'DESC' },
    });

    return tasks as unknown as AgentTaskDTO[];
  }

  @Mutation(() => AgentTaskDTO)
  async createAgentTask(
    @Args('input') input: CreateAgentTaskInput,
    @AuthWorkspace() workspace: FlatWorkspace,
  ): Promise<AgentTaskDTO> {
    const task = await this.agentTaskService.createTask({
      workspaceId: workspace.id,
      objectNameSingular: input.objectNameSingular,
      recordId: input.recordId,
      agentId: input.agentId,
      reason: input.reason,
      priority: input.priority,
      idempotencyKey: input.idempotencyKey ?? null,
      createdByActor: {
        source: FieldActorSource.API,
        workspaceMemberId: null,
        name: 'GraphQL API',
        context: {},
      },
    });

    return task as unknown as AgentTaskDTO;
  }

  @Mutation(() => Boolean)
  async cancelAgentTask(
    @Args('taskId', { type: () => ID }) taskId: string,
    @Args('reason', { type: () => String }) reason: string,
    @AuthWorkspace() workspace: FlatWorkspace,
  ): Promise<boolean> {
    return this.agentTaskService.cancelTask({
      taskId,
      workspaceId: workspace.id,
      reason,
    });
  }
}
