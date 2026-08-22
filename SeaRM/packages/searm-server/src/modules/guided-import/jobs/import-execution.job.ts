import { Scope } from '@nestjs/common';

import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { GlobalWorkspaceOrmManager } from 'src/engine/searm-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/searm-orm/utils/build-system-auth-context.util';
import { ImportExecutionService } from 'src/modules/guided-import/services/import-execution.service';

export type ImportExecutionJobData = {
  workspaceId: string;
  importBatchId: string;
};

// The job only opens the workspace ORM context; every record write inside
// executeBatch runs under the importing user's own auth context and role.
@Processor({ queueName: MessageQueue.importQueue, scope: Scope.REQUEST })
export class ImportExecutionJob {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly importExecutionService: ImportExecutionService,
  ) {}

  @Process(ImportExecutionJob.name)
  async handle(data: ImportExecutionJobData): Promise<void> {
    const { workspaceId, importBatchId } = data;

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        await this.importExecutionService.executeBatch({
          workspaceId,
          importBatchId,
        });
      },
      buildSystemAuthContext(workspaceId),
    );
  }
}
