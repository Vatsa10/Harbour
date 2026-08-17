import { Injectable, Logger } from '@nestjs/common';

import { FieldActorSource } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

import { FindRecordsService } from 'src/engine/core-modules/record-crud/services/find-records.service';
import {
  OPEN_OPPORTUNITY_STAGES,
  OPPORTUNITY_OBJECT_NAME_SINGULAR,
  RECORD_SWEEP_COOLDOWN_DAYS,
  RECORD_SWEEP_HIGH_VALUE_PRIORITY,
  RECORD_SWEEP_LANE_CANDIDATE_LIMIT,
  RECORD_SWEEP_MAX_TASKS_PER_WORKSPACE,
  RECORD_SWEEP_RECENT_ACTIVITY_DAYS,
  RECORD_SWEEP_STALE_AFTER_DAYS,
  RECORD_SWEEP_STALE_PRIORITY,
} from 'src/engine/metadata-modules/ai/ai-research/constants/record-sweep.const';
import { AgentTaskService } from 'src/engine/metadata-modules/ai/ai-research/services/agent-task.service';
import { FactService } from 'src/engine/metadata-modules/ai/ai-research/services/fact.service';
import { ResearchAgentService } from 'src/engine/metadata-modules/ai/ai-research/services/research-agent.service';
import {
  type RecordSweepCandidate,
  type RecordSweepResult,
} from 'src/engine/metadata-modules/ai/ai-research/types/record-sweep.type';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';

const daysAgo = (days: number): Date =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000);

export type SweepWorkspaceParams = {
  workspaceId: string;
  // Whether the workspace's AiWritePolicy leaves this object writable at all.
  // Supplied by the caller rather than read here: AiWritePolicyService lives in
  // ai-write-approval, which already imports this module, and reaching back the
  // other way would close a module cycle. The caller (the monitoring sweep job)
  // sits above both and reads the policy once per workspace tick.
  //
  // Defaults to "sweep everything" only when no caller supplied one, which is
  // the direct-call and test path — the scheduled path always passes it.
  isObjectSweepable?: (objectNameSingular: string) => boolean;
  maxTasks?: number;
};

// Monitoring step 1: decide WHICH records deserve an agent's attention.
//
// Everything about *running* the work already exists — AgentTaskService owns
// leases, retries, backoff, budget and idempotency, and the dispatch cron owns
// the tick. This service adds only selection, and hands what it selects to
// createTask. There is deliberately no second scheduler, no second queue and
// no second retry policy here; if you find yourself adding one, the thing you
// actually want is a field on AgentTask.
//
// It writes no CRM record and can write none: its only outputs are AgentTask
// rows. The research those tasks trigger runs through the tool executor, so
// every write it eventually wants goes through ProposalGateService like any
// other agent write. The policy filter below is an efficiency measure on top
// of that gate, never a substitute for it — a FORBID object is one whose
// proposals could never be approved, so researching it burns budget to produce
// an inbox card nobody may act on.
@Injectable()
export class RecordSweepService {
  private readonly logger = new Logger(RecordSweepService.name);

  constructor(
    private readonly factService: FactService,
    private readonly agentTaskService: AgentTaskService,
    private readonly researchAgentService: ResearchAgentService,
    private readonly findRecordsService: FindRecordsService,
  ) {}

  async sweepWorkspace(
    params: SweepWorkspaceParams,
  ): Promise<RecordSweepResult> {
    const { workspaceId } = params;
    const maxTasks = params.maxTasks ?? RECORD_SWEEP_MAX_TASKS_PER_WORKSPACE;
    const isObjectSweepable = params.isObjectSweepable ?? (() => true);

    const [staleCandidates, highValueCandidates] = await Promise.all([
      this.selectStaleRecords(workspaceId),
      this.selectHighValueRecords(workspaceId),
    ]);

    const candidates = this.dedupe([
      ...highValueCandidates,
      ...staleCandidates,
    ]);

    const allowed = candidates.filter((candidate) =>
      isObjectSweepable(candidate.objectNameSingular),
    );

    const recentlyScheduled =
      await this.agentTaskService.findRecordIdsScheduledSince({
        workspaceId,
        recordIds: allowed.map((candidate) => candidate.recordId),
        since: daysAgo(RECORD_SWEEP_COOLDOWN_DAYS),
      });

    const schedulable = allowed.filter(
      (candidate) => !recentlyScheduled.has(candidate.recordId),
    );

    const result: RecordSweepResult = {
      workspaceId,
      candidateCount: candidates.length,
      enqueuedTaskIds: [],
      skippedForCooldownCount: allowed.length - schedulable.length,
      skippedForPolicyCount: candidates.length - allowed.length,
    };

    if (schedulable.length === 0) {
      return result;
    }

    // Resolved once, after we know there is work: a workspace with nothing to
    // sweep must not pay for (or fail on) agent resolution every tick.
    const agentId =
      await this.researchAgentService.resolveResearchAgentId(workspaceId);

    // Highest priority first, so the per-tick ceiling cuts the least valuable
    // tail rather than an arbitrary one.
    const ordered = [...schedulable].sort((a, b) => b.priority - a.priority);

    for (const candidate of ordered.slice(0, maxTasks)) {
      const task = await this.agentTaskService.createTask({
        workspaceId,
        objectNameSingular: candidate.objectNameSingular,
        recordId: candidate.recordId,
        agentId,
        reason: candidate.reason,
        priority: candidate.priority,
        // Stable across ticks. The unique index is partial on PENDING/LEASED,
        // so this collapses duplicates while a task is still open and lets a
        // later sweep re-schedule the record once the previous one finished —
        // the cooldown filter above is what governs how much later.
        idempotencyKey: `sweep:${candidate.lane}:${candidate.objectNameSingular}:${candidate.recordId}`,
        // Principal contract: the sweep is the system, not a user and not the
        // agent that will later run the task.
        createdByActor: {
          source: FieldActorSource.SYSTEM,
          name: 'Monitoring sweep',
          workspaceMemberId: null,
          context: {},
        },
      });

      result.enqueuedTaskIds.push(task.id);
    }

    if (result.enqueuedTaskIds.length > 0) {
      this.logger.log(
        `Monitoring sweep enqueued ${result.enqueuedTaskIds.length} research task(s) in workspace ${workspaceId} (${result.candidateCount} candidates, ${result.skippedForCooldownCount} in cooldown, ${result.skippedForPolicyCount} forbidden by policy)`,
      );
    }

    return result;
  }

  // Lane 1: what we knew has gone old. Fact-driven, so it covers every object
  // research has ever touched without this service enumerating object types.
  private async selectStaleRecords(
    workspaceId: string,
  ): Promise<RecordSweepCandidate[]> {
    const targets = await this.factService.findStaleRecordTargets({
      workspaceId,
      staleBefore: daysAgo(RECORD_SWEEP_STALE_AFTER_DAYS),
      limit: RECORD_SWEEP_LANE_CANDIDATE_LIMIT,
    });

    return targets.map((target) => ({
      objectNameSingular: target.objectNameSingular,
      recordId: target.recordId,
      lane: 'STALE_FACTS',
      reason: `Every known fact about this ${target.objectNameSingular} was last observed on ${target.lastObservedAt.toISOString().slice(0, 10)}, more than ${RECORD_SWEEP_STALE_AFTER_DAYS} days ago. Re-check the record and record fresh evidence.`,
      priority: RECORD_SWEEP_STALE_PRIORITY,
    }));
  }

  // Lane 2: where being blind costs the most. An open opportunity that somebody
  // is actively working, which research has never covered, produces no stale
  // facts at all — lane 1 cannot see it, because there is nothing to go stale.
  private async selectHighValueRecords(
    workspaceId: string,
  ): Promise<RecordSweepCandidate[]> {
    const output = await this.findRecordsService.execute({
      objectName: OPPORTUNITY_OBJECT_NAME_SINGULAR,
      filter: {
        stage: { in: [...OPEN_OPPORTUNITY_STAGES] },
        updatedAt: { gte: daysAgo(RECORD_SWEEP_RECENT_ACTIVITY_DAYS).toISOString() },
      },
      limit: RECORD_SWEEP_LANE_CANDIDATE_LIMIT,
      select: ['id', 'name', 'stage', 'amount', 'updatedAt'],
      shouldBuildEffectiveSelectFields: true,
      // System context with checks bypassed. Safe here and only here: this
      // read decides what an agent will *look at*, never what anyone may
      // write. The research run itself, and the approval that follows it, are
      // both permission-checked on their own.
      authContext: buildSystemAuthContext(workspaceId),
      rolePermissionConfig: { shouldBypassPermissionChecks: true },
    });

    // record-crud never throws — it returns { success: false }. A workspace
    // with no opportunity object (or a transient read failure) must degrade to
    // "no high-value candidates", not take the whole sweep down.
    if (!output.success) {
      this.logger.warn(
        `High-value lane skipped in workspace ${workspaceId}: ${output.message}`,
      );

      return [];
    }

    const records =
      (output.result as { records?: Record<string, unknown>[] })?.records ?? [];

    return records.filter(hasId).map((record) => ({
      objectNameSingular: OPPORTUNITY_OBJECT_NAME_SINGULAR,
      recordId: record.id,
      lane: 'HIGH_VALUE' as const,
      reason: `Open opportunity at stage ${String(record.stage)} with activity in the last ${RECORD_SWEEP_RECENT_ACTIVITY_DAYS} days and no recent research. Gather current evidence on the account and its contacts.`,
      priority: RECORD_SWEEP_HIGH_VALUE_PRIORITY,
    }));
  }

  // One task per record per tick, whichever lane got there first. The array is
  // built high-value-first, so a record both lanes picked keeps the stronger
  // reason and the higher priority.
  private dedupe(
    candidates: RecordSweepCandidate[],
  ): RecordSweepCandidate[] {
    const seen = new Set<string>();

    return candidates.filter((candidate) => {
      const key = `${candidate.objectNameSingular}:${candidate.recordId}`;

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);

      return true;
    });
  }
}

const hasId = (record: Record<string, unknown>): record is { id: string } & Record<string, unknown> =>
  isDefined(record.id) && typeof record.id === 'string';
