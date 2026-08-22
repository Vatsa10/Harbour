// SeaRM: clean-room AGPL-3.0 rewrite. See
// .superpowers/sdd/enterprise-rewrite/event-logs-spec.md for design notes.
import { Injectable } from '@nestjs/common';

import { SentryCronMonitor } from 'src/engine/core-modules/cron/sentry-cron-monitor.decorator';
import { EVENT_LOG_CLEANUP_CRON_PATTERN } from 'src/engine/core-modules/event-logs/cleanup/constants/event-log-cleanup-cron-pattern.constant';
import { EventLogCleanupJob } from 'src/engine/core-modules/event-logs/cleanup/jobs/event-log-cleanup.job';
import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';

@Injectable()
@Processor(MessageQueue.cronQueue)
export class EventLogCleanupCronJob {
  constructor(private readonly eventLogCleanupJob: EventLogCleanupJob) {}

  @Process(EventLogCleanupCronJob.name)
  @SentryCronMonitor(
    EventLogCleanupCronJob.name,
    EVENT_LOG_CLEANUP_CRON_PATTERN,
  )
  async handle(): Promise<void> {
    await this.eventLogCleanupJob.handle();
  }
}
