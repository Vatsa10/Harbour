import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { WorkspaceActivationStatus } from 'searm-shared/workspace';
import { Repository } from 'typeorm';

import { SentryCronMonitor } from 'src/engine/core-modules/cron/sentry-cron-monitor.decorator';
import { ExceptionHandlerService } from 'src/engine/core-modules/exception-handler/exception-handler.service';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import {
  AiMonitoringSweepJob,
  type AiMonitoringSweepJobData,
} from 'src/engine/metadata-modules/ai/ai-write-approval/jobs/ai-monitoring-sweep.job';

// Hourly, at :17. Not every minute: selection reads aggregates over every fact
// in a workspace, and neither "these facts went stale" nor "this opportunity
// has not been researched" is a question whose answer changes in a minute. The
// per-minute tick belongs to AgentTaskDispatchCronJob, which drains what this
// enqueues — that separation is why this file adds no scheduler of its own.
export const AI_MONITORING_SWEEP_CRON_PATTERN = '17 * * * *';

@Injectable()
@Processor(MessageQueue.cronQueue)
export class AiMonitoringSweepCronJob {
  private readonly logger = new Logger(AiMonitoringSweepCronJob.name);

  constructor(
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    @InjectMessageQueue(MessageQueue.workspaceQueue)
    private readonly messageQueueService: MessageQueueService,
    private readonly exceptionHandlerService: ExceptionHandlerService,
  ) {}

  @Process(AiMonitoringSweepCronJob.name)
  @SentryCronMonitor(
    AiMonitoringSweepCronJob.name,
    AI_MONITORING_SWEEP_CRON_PATTERN,
  )
  async handle(): Promise<void> {
    const workspaces = await this.workspaceRepository.find({
      where: { activationStatus: WorkspaceActivationStatus.ACTIVE },
      select: ['id'],
      order: { id: 'ASC' },
    });

    if (workspaces.length === 0) {
      return;
    }

    // One workspace-queue job each, exactly like the event-log cleanup
    // fan-out. A workspace whose enqueue throws must not stop the rest: the
    // sweep is best-effort per tenant and the next tick retries it anyway.
    for (const workspace of workspaces) {
      try {
        await this.messageQueueService.add<AiMonitoringSweepJobData>(
          AiMonitoringSweepJob.name,
          { workspaceId: workspace.id },
        );
      } catch (error) {
        this.exceptionHandlerService.captureExceptions([error], {
          workspace: { id: workspace.id },
        });
      }
    }

    this.logger.log(
      `Enqueued AI monitoring sweep for ${workspaces.length} workspace(s)`,
    );
  }
}
