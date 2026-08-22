import { Scope } from '@nestjs/common';

import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { GlobalWorkspaceOrmManager } from 'src/engine/searm-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/searm-orm/utils/build-system-auth-context.util';
import { StructuredExtractionService } from 'src/modules/structured-extraction/services/structured-extraction.service';

// Ids only. The message body is deliberately NOT in the payload: an excluded
// account's content must never be serialised into a queue, and a job payload
// outlives the check that produced it.
export type MessageExtractionJobData = {
  workspaceId: string;
  messageId: string;
};

@Processor({ queueName: MessageQueue.aiQueue, scope: Scope.REQUEST })
export class MessageExtractionJob {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly structuredExtractionService: StructuredExtractionService,
  ) {}

  @Process(MessageExtractionJob.name)
  async handle(data: MessageExtractionJobData): Promise<void> {
    const { workspaceId, messageId } = data;

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        // Nothing is written to a record here — the outcome is a proposal.
        await this.structuredExtractionService.extract({
          workspaceId,
          sourceKind: 'MESSAGE',
          sourceId: messageId,
        });
      },
      buildSystemAuthContext(workspaceId),
    );
  }
}
