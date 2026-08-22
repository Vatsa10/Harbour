// SeaRM: clean-room AGPL-3.0 rewrite. See
// .superpowers/sdd/enterprise-rewrite/event-logs-spec.md for design notes.
import { Injectable } from '@nestjs/common';

import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { EventLogCleanupService } from 'src/engine/core-modules/event-logs/cleanup/services/event-log-cleanup.service';

@Injectable()
@Processor(MessageQueue.cronQueue)
export class EventLogCleanupJob {
  constructor(
    private readonly eventLogCleanupService: EventLogCleanupService,
  ) {}

  @Process(EventLogCleanupJob.name)
  async handle(): Promise<void> {
    await this.eventLogCleanupService.cleanup();
  }
}
