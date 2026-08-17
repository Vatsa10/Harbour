import { Command, CommandRunner } from 'nest-commander';

import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import {
  AI_MONITORING_SWEEP_CRON_PATTERN,
  AiMonitoringSweepCronJob,
} from 'src/engine/metadata-modules/ai/ai-write-approval/crons/jobs/ai-monitoring-sweep.cron.job';

@Command({
  name: 'cron:ai:monitoring-sweep',
  description:
    'Starts a cron job that retires stale proposals and selects records worth researching',
})
export class AiMonitoringSweepCronCommand extends CommandRunner {
  constructor(
    @InjectMessageQueue(MessageQueue.cronQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {
    super();
  }

  async run(): Promise<void> {
    await this.messageQueueService.addCron<undefined>({
      jobName: AiMonitoringSweepCronJob.name,
      data: undefined,
      options: {
        repeat: { pattern: AI_MONITORING_SWEEP_CRON_PATTERN },
      },
    });
  }
}
