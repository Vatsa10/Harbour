import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query } from '@nestjs/graphql';
import { InjectRepository } from '@nestjs/typeorm';

import { FieldActorSource } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { PermissionFlagType } from 'twenty-shared/constants';
import { Repository } from 'typeorm';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { type FlatWorkspace } from 'src/engine/core-modules/workspace/types/flat-workspace.type';
import { AuthUser } from 'src/engine/decorators/auth/auth-user.decorator';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { AuthWorkspaceMemberId } from 'src/engine/decorators/auth/auth-workspace-member-id.decorator';
import { SettingsPermissionGuard } from 'src/engine/guards/settings-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { AgentTaskDTO } from 'src/engine/metadata-modules/ai/ai-research/dtos/agent-task.dto';
import { CreateAgentTaskInput } from 'src/engine/metadata-modules/ai/ai-research/dtos/create-agent-task.input';
import { AgentTaskEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/agent-task.entity';
import { AgentTaskService } from 'src/engine/metadata-modules/ai/ai-research/services/agent-task.service';
import { ResearchAgentService } from 'src/engine/metadata-modules/ai/ai-research/services/research-agent.service';
import { type UserEntity } from 'src/engine/core-modules/user/user.entity';

@UseGuards(WorkspaceAuthGuard, SettingsPermissionGuard(PermissionFlagType.AI))
@MetadataResolver()
export class AgentTaskResolver {
  constructor(
    private readonly agentTaskService: AgentTaskService,
    private readonly researchAgentService: ResearchAgentService,
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
    @AuthWorkspaceMemberId() workspaceMemberId: string,
    @AuthUser() user: UserEntity,
  ): Promise<AgentTaskDTO> {
    // A supplied agentId is caller input and was never checked: a bogus or
    // role-less id produced a tool-less run that still reported SUCCEEDED.
    // Omitting it resolves the workspace's research agent, which also binds
    // it to its role — the same path the tool takes.
    if (isDefined(input.agentId)) {
      await this.researchAgentService.assertAgentIsUsable({
        workspaceId: workspace.id,
        agentId: input.agentId,
      });
    }

    const agentId =
      input.agentId ??
      (await this.researchAgentService.resolveResearchAgentId(workspace.id));

    const task = await this.agentTaskService.createTask({
      workspaceId: workspace.id,
      objectNameSingular: input.objectNameSingular,
      recordId: input.recordId,
      agentId,
      reason: input.reason,
      priority: input.priority,
      budget: input.budget,
      maxAttempts: input.maxAttempts,
      idempotencyKey: input.idempotencyKey ?? null,
      // Contract 5 requires the audit entry to distinguish principals, and
      // this one threw away the authenticated human for the string 'GraphQL
      // API' with @AuthWorkspace already in the signature. A human scheduling
      // research from the app is a MANUAL act through the API; the member id
      // is what makes it attributable.
      createdByActor: {
        source: FieldActorSource.API,
        workspaceMemberId: workspaceMemberId ?? null,
        name:
          [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() ||
          user?.email ||
          'GraphQL API',
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
