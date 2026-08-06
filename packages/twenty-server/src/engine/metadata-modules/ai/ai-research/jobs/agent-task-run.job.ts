import { Scope } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { FieldActorSource, type ActorMetadata } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { Repository } from 'typeorm';

import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { UsageOperationType } from 'src/engine/core-modules/usage/enums/usage-operation-type.enum';
import { AgentAsyncExecutorService } from 'src/engine/metadata-modules/ai/ai-agent-execution/services/agent-async-executor.service';
import { AgentEntity } from 'src/engine/metadata-modules/ai/ai-agent/entities/agent.entity';
import {
  buildResearchAgentUserPrompt,
  RESEARCH_AGENT_BASE_SYSTEM_PROMPT,
} from 'src/engine/metadata-modules/ai/ai-research/constants/research-agent-prompts.const';
import { AgentRunEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/agent-run.entity';
import { AgentTaskEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/agent-task.entity';
import { AgentTaskService } from 'src/engine/metadata-modules/ai/ai-research/services/agent-task.service';
import { AgentRunStatus } from 'src/engine/metadata-modules/ai/ai-research/types/agent-run-status.type';
import { AgentTaskStatus } from 'src/engine/metadata-modules/ai/ai-research/types/agent-task-status.type';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';

export type AgentTaskRunJobData = {
  taskId: string;
  workspaceId: string;
};

@Processor({ queueName: MessageQueue.agentTaskQueue, scope: Scope.REQUEST })
export class AgentTaskRunJob {
  constructor(
    private readonly agentTaskService: AgentTaskService,
    private readonly agentAsyncExecutorService: AgentAsyncExecutorService,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    // AgentTask and AgentRun are core-schema platform tables, not per-workspace
    // entities. Every query below filters workspaceId as an ordinary column
    // predicate; the scoped wrapper has nothing to enforce here.
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(AgentTaskEntity)
    private readonly agentTaskRepository: Repository<AgentTaskEntity>,
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(AgentRunEntity)
    private readonly agentRunRepository: Repository<AgentRunEntity>,
    // AgentEntity is @Entity('agent') on the CORE schema (verified:
    // ai-agent/entities/agent.entity.ts:18), not a per-workspace-schema
    // entity, so a plain core repository is correct here. The workspaceId
    // filter below is an ordinary column predicate, not tenant scoping.
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(AgentEntity)
    private readonly agentRepository: Repository<AgentEntity>,
  ) {}

  @Process(AgentTaskRunJob.name)
  async handle(data: AgentTaskRunJobData): Promise<void> {
    const { taskId, workspaceId } = data;

    // Deviation from the brief's snippet: pass an explicit system auth
    // context (and `{ lite: true }`, mirroring MessagingMessagesImportJob)
    // rather than relying on executeInWorkspaceContext's ambient-storage
    // fallback. A queue worker has no request-scoped auth context sitting in
    // storage, so the brief's zero-arg call would resolve `authContext` to
    // undefined and throw reading `.workspace.id` inside loadWorkspaceContext.
    const authContext = buildSystemAuthContext(workspaceId);

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        // Re-fetch and re-validate: the task may have been cancelled between
        // the claim and this job running — the explicit status check is the
        // cancellation mechanism, no downstream 404s to interpret.
        const task = await this.agentTaskRepository.findOne({
          where: { id: taskId, workspaceId },
        });

        if (!isDefined(task) || task.status !== AgentTaskStatus.LEASED) {
          return;
        }

        const agent = await this.agentRepository.findOne({
          where: { id: task.agentId, workspaceId },
        });

        const run = await this.agentRunRepository.save({
          workspaceId,
          taskId: task.id,
          agentId: task.agentId,
          status: AgentRunStatus.RUNNING,
        });

        const actorContext: ActorMetadata = {
          source: FieldActorSource.AGENT,
          workspaceMemberId: null,
          name: agent?.label ?? 'Research agent',
          context: {},
        };

        try {
          const result = await this.agentAsyncExecutorService.executeAgent({
            agent: agent ?? null,
            userPrompt: buildResearchAgentUserPrompt({
              objectNameSingular: task.objectNameSingular,
              recordId: task.recordId,
              reason: task.reason,
            }),
            baseSystemPrompt: RESEARCH_AGENT_BASE_SYSTEM_PROMPT,
            actorContext,
            authContext,
            workspaceId,
            userWorkspaceId: null,
            operationType: UsageOperationType.AI_WORKFLOW_TOKEN,
            toolLoadingStrategy: 'lazy',
            threadId: run.id,
            // The charter's "budgeted". Task 6 Step 6b made this reach stopWhen.
            maxSteps: task.budget,
          });

          const resultText =
            typeof (result.result as { response?: string })?.response ===
            'string'
              ? (result.result as { response: string }).response
              : '';

          // AgentExecutionResult declares steps, modelId and creditsUsedMicro
          // OPTIONAL (agent-execution-result.type.ts:9-12). creditsUsedMicro
          // lands in a NOT NULL bigint column and modelId in a nullable
          // varchar, so every one of them is coalesced rather than passed
          // through.
          const stepCount = result.steps?.length ?? 0;
          const exhaustedBudget = stepCount >= task.budget;

          await this.agentRunRepository.save({
            ...run,
            status: AgentRunStatus.SUCCEEDED,
            modelId: result.modelId ?? null,
            finishedAt: new Date(),
            elapsedMs: Date.now() - run.startedAt.getTime(),
            inputTokens: result.usage.inputTokens ?? 0,
            outputTokens: result.usage.outputTokens ?? 0,
            creditsUsedMicro: result.creditsUsedMicro ?? 0,
            resultSummary: resultText.slice(0, 2000),
          });

          // A truncated run and a thorough run that found nothing look
          // identical in run history unless the outcome says which one
          // happened.
          const budgetNote = exhaustedBudget
            ? ` (stopped at the step budget of ${task.budget} — findings may be incomplete)`
            : '';

          await this.agentTaskService.completeTask({
            taskId: task.id,
            workspaceId,
            runId: run.id,
            outcome: `${resultText.slice(0, 400) || 'Research run completed.'}${budgetNote}`,
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Agent execution failed';

          await this.agentRunRepository.save({
            ...run,
            status: AgentRunStatus.FAILED,
            finishedAt: new Date(),
            elapsedMs: Date.now() - run.startedAt.getTime(),
            errorMessage,
          });

          await this.agentTaskService.failTask({
            taskId: task.id,
            workspaceId,
            runId: run.id,
            errorMessage,
          });
        }
      },
      authContext,
      { lite: true },
    );
  }
}
