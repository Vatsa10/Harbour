import { Injectable, Logger } from '@nestjs/common';

import { type ObjectRecordCreateEvent } from 'searm-shared/database-events';

import { OnDatabaseBatchEvent } from 'src/engine/api/graphql/graphql-query-runner/decorators/on-database-batch-event.decorator';
import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';
import { type CalendarEventWorkspaceEntity } from 'src/modules/calendar/common/standard-objects/calendar-event.workspace-entity';
import {
  CalendarEventExtractionJob,
  type CalendarEventExtractionJobData,
} from 'src/modules/structured-extraction/jobs/calendar-event-extraction.job';
import { AiExtractionExclusionService } from 'src/modules/structured-extraction/services/ai-extraction-exclusion.service';

@Injectable()
export class CalendarEventExtractionListener {
  private readonly logger = new Logger(CalendarEventExtractionListener.name);

  constructor(
    private readonly aiExtractionExclusionService: AiExtractionExclusionService,
    @InjectMessageQueue(MessageQueue.aiQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {}

  @OnDatabaseBatchEvent('calendarEvent', DatabaseEventAction.CREATED)
  async handleCalendarEventCreated(
    payload: WorkspaceEventBatch<
      ObjectRecordCreateEvent<CalendarEventWorkspaceEntity>
    >,
  ): Promise<void> {
    const { workspaceId } = payload;

    for (const event of payload.events) {
      // Same enqueue-boundary rule as MessageExtractionListener: the owner's
      // exclusion decides whether the content is ever looked at, so it is
      // decided before anything reaches a queue.
      const isExcluded =
        await this.aiExtractionExclusionService.isCalendarEventExcluded({
          workspaceId,
          calendarEventId: event.recordId,
        });

      if (isExcluded) {
        this.logger.log(
          `Skipping AI extraction for calendar event ${event.recordId}: its connected account is excluded.`,
        );

        continue;
      }

      await this.messageQueueService.add<CalendarEventExtractionJobData>(
        CalendarEventExtractionJob.name,
        { workspaceId, calendarEventId: event.recordId },
      );
    }
  }
}
