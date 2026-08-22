import { Command, CommandRunner } from 'nest-commander';

import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import {
  AGENT_TASK_DISPATCH_CRON_PATTERN,
  AgentTaskDispatchCronJob,
} from 'src/engine/metadata-modules/ai/ai-research/crons/jobs/agent-task-dispatch.cron.job';

@Command({
  name: 'cron:ai-research:agent-task-dispatch',
  description: 'Starts a cron job to claim and dispatch due AgentTask rows',
})
export class AgentTaskDispatchCronCommand extends CommandRunner {
  constructor(
    @InjectMessageQueue(MessageQueue.cronQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {
    super();
  }

  async run(): Promise<void> {
    await this.messageQueueService.addCron<undefined>({
      jobName: AgentTaskDispatchCronJob.name,
      data: undefined,
      options: {
        repeat: { pattern: AGENT_TASK_DISPATCH_CRON_PATTERN },
      },
    });
  }
}
