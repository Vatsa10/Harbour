import { Injectable, Logger } from '@nestjs/common';

import { type ObjectRecordCreateEvent } from 'searm-shared/database-events';

import { OnDatabaseBatchEvent } from 'src/engine/api/graphql/graphql-query-runner/decorators/on-database-batch-event.decorator';
import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';
import { type MessageWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message.workspace-entity';
import {
  MessageExtractionJob,
  type MessageExtractionJobData,
} from 'src/modules/structured-extraction/jobs/message-extraction.job';
import { AiExtractionExclusionService } from 'src/modules/structured-extraction/services/ai-extraction-exclusion.service';

@Injectable()
export class MessageExtractionListener {
  private readonly logger = new Logger(MessageExtractionListener.name);

  constructor(
    private readonly aiExtractionExclusionService: AiExtractionExclusionService,
    @InjectMessageQueue(MessageQueue.aiQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {}

  @OnDatabaseBatchEvent('message', DatabaseEventAction.CREATED)
  async handleMessageCreated(
    payload: WorkspaceEventBatch<
      ObjectRecordCreateEvent<MessageWorkspaceEntity>
    >,
  ): Promise<void> {
    const { workspaceId } = payload;

    for (const event of payload.events) {
      // The owner's privacy decision is enforced HERE, at the enqueue
      // boundary — before the body is read and before anything is serialised
      // into a job payload. Checking inside the job would mean an excluded
      // mailbox's message id sits in Redis, and any later change to the job
      // (logging the subject, prefetching the body) would leak content the
      // owner said must not leave the instance.
      const isExcluded =
        await this.aiExtractionExclusionService.isMessageExcluded({
          workspaceId,
          messageId: event.recordId,
        });

      if (isExcluded) {
        this.logger.log(
          `Skipping AI extraction for message ${event.recordId}: its connected account is excluded.`,
        );

        continue;
      }

      await this.messageQueueService.add<MessageExtractionJobData>(
        MessageExtractionJob.name,
        { workspaceId, messageId: event.recordId },
      );
    }
  }
}
