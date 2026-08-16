import { Scope } from '@nestjs/common';

import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { StructuredExtractionService } from 'src/modules/structured-extraction/services/structured-extraction.service';

// Ids only, for the same reason as MessageExtractionJobData.
export type CalendarEventExtractionJobData = {
  workspaceId: string;
  calendarEventId: string;
};

@Processor({ queueName: MessageQueue.aiQueue, scope: Scope.REQUEST })
export class CalendarEventExtractionJob {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly structuredExtractionService: StructuredExtractionService,
  ) {}

  @Process(CalendarEventExtractionJob.name)
  async handle(data: CalendarEventExtractionJobData): Promise<void> {
    const { workspaceId, calendarEventId } = data;

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        await this.structuredExtractionService.extract({
          workspaceId,
          sourceKind: 'CALENDAR_EVENT',
          sourceId: calendarEventId,
        });
      },
      buildSystemAuthContext(workspaceId),
    );
  }
}
