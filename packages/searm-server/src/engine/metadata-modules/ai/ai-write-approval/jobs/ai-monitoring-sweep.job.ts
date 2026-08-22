import { Injectable, Logger } from '@nestjs/common';

import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { RecordSweepService } from 'src/engine/metadata-modules/ai/ai-research/services/record-sweep.service';
import { AiWritePolicyService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/ai-write-policy.service';
import { ProposalSupersessionService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-supersession.service';

export type AiMonitoringSweepJobData = {
  workspaceId: string;
};

// One workspace's monitoring tick. Two halves that both need the same
// per-workspace iteration and neither of which deserves its own scheduler:
//
//   1. retire proposals whose situation moved on (pull-based supersession),
//   2. select records worth researching and enqueue AgentTasks for them.
//
// Supersession runs first. A record the sweep is about to re-research may well
// be the record that just invalidated a pending draft, and retiring the draft
// before the new research lands keeps the inbox honest in between.
//
// This job lives in ai-write-approval rather than ai-research for one concrete
// reason: it needs AiWritePolicyService, and ai-write-approval already imports
// ai-research. Placing it the other way round would close a module cycle.
@Injectable()
@Processor(MessageQueue.workspaceQueue)
export class AiMonitoringSweepJob {
  private readonly logger = new Logger(AiMonitoringSweepJob.name);

  constructor(
    private readonly proposalSupersessionService: ProposalSupersessionService,
    private readonly recordSweepService: RecordSweepService,
    private readonly aiWritePolicyService: AiWritePolicyService,
  ) {}

  @Process(AiMonitoringSweepJob.name)
  async handle(data: AiMonitoringSweepJobData): Promise<void> {
    const { workspaceId } = data;

    try {
      await this.proposalSupersessionService.sweepWorkspace(workspaceId);

      await this.recordSweepService.sweepWorkspace({
        workspaceId,
        isObjectSweepable: await this.buildPolicyFilter(workspaceId),
      });
    } catch (error) {
      this.logger.error(
        `AI monitoring sweep failed for workspace ${workspaceId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  // The policy read, resolved per object name the sweep actually picked. Built
  // as a predicate rather than a deny list because the deny list cannot express
  // a workspace whose default is FORBID with per-object escapes, and because
  // the stale lane can surface any object research has ever touched — the set
  // is not enumerable up front.
  //
  // The policy is read once per workspace tick, not once per candidate.
  // Field-level overrides are deliberately not consulted: an object with one
  // untouchable field is still worth researching for its other fields, and the
  // gate refuses that single field at write time regardless.
  private async buildPolicyFilter(
    workspaceId: string,
  ): Promise<(objectNameSingular: string) => boolean> {
    const policy = await this.aiWritePolicyService.getPolicy(workspaceId);

    return (objectNameSingular: string) =>
      this.aiWritePolicyService.resolveMode(policy, {
        kind: 'record',
        objectNameSingular,
        fieldNames: [],
      }) !== 'FORBID';
  }
}
