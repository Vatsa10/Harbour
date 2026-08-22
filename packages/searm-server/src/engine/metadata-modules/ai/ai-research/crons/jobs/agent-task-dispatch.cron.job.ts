import { Logger } from '@nestjs/common';

import { SentryCronMonitor } from 'src/engine/core-modules/cron/sentry-cron-monitor.decorator';
import { ExceptionHandlerService } from 'src/engine/core-modules/exception-handler/exception-handler.service';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import {
  AgentTaskRunJob,
  type AgentTaskRunJobData,
} from 'src/engine/metadata-modules/ai/ai-research/jobs/agent-task-run.job';
import { AgentTaskService } from 'src/engine/metadata-modules/ai/ai-research/services/agent-task.service';

export const AGENT_TASK_DISPATCH_CRON_PATTERN = '* * * * *';

@Processor(MessageQueue.cronQueue)
export class AgentTaskDispatchCronJob {
  private readonly logger = new Logger(AgentTaskDispatchCronJob.name);

  constructor(
    private readonly agentTaskService: AgentTaskService,
    @InjectMessageQueue(MessageQueue.agentTaskQueue)
    private readonly messageQueueService: MessageQueueService,
    private readonly exceptionHandlerService: ExceptionHandlerService,
  ) {}

  @Process(AgentTaskDispatchCronJob.name)
  @SentryCronMonitor(
    AgentTaskDispatchCronJob.name,
    AGENT_TASK_DISPATCH_CRON_PATTERN,
  )
  async handle(): Promise<void> {
    try {
      // Reap first: a row that exhausted maxAttempts while leased is not
      // claimable, so leaving it for the next tick only delays the FAILED
      // transition an operator needs to see. Same tick, same transaction
      // boundary as the workflow staled-runs sweeper.
      await this.agentTaskService.reapAbandonedTasks();

      const claimedTasks = await this.agentTaskService.claimDueTasks();

      for (const task of claimedTasks) {
        await this.messageQueueService.add<AgentTaskRunJobData>(
          AgentTaskRunJob.name,
          { taskId: task.id, workspaceId: task.workspaceId },
        );
      }
    } catch (error) {
      this.exceptionHandlerService.captureExceptions([error]);
    }
  }
}
