import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { type ActorMetadata } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { In, Repository } from 'typeorm';

import {
  AGENT_TASK_CLAIM_BATCH_SIZE,
  AGENT_TASK_DEFAULT_BUDGET,
  AGENT_TASK_DEFAULT_MAX_ATTEMPTS,
  AGENT_TASK_LEASE_DURATION_MS,
  computeAgentTaskBackoffMs,
} from 'src/engine/metadata-modules/ai/ai-research/constants/agent-task.const';
import { AgentTaskEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/agent-task.entity';
import { AgentTaskStatus } from 'src/engine/metadata-modules/ai/ai-research/types/agent-task-status.type';
import { isPostgresUniqueViolation } from 'src/utils/is-postgres-unique-violation.util';

export type CreateAgentTaskParams = {
  workspaceId: string;
  objectNameSingular: string;
  recordId: string;
  agentId: string;
  reason: string;
  priority?: number;
  budget?: number;
  maxAttempts?: number;
  idempotencyKey?: string | null;
  dueAt?: Date;
  createdByActor?: ActorMetadata | null;
};

@Injectable()
export class AgentTaskService {
  constructor(
    // The lease claim needs a query builder for FOR UPDATE SKIP LOCKED and a
    // compare-and-set guard, which the scoped wrapper does not express. Every
    // query below therefore filters workspaceId explicitly — see the
    // `"workspaceId" = :workspaceId` clause on each builder.
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(AgentTaskEntity)
    private readonly agentTaskRepository: Repository<AgentTaskEntity>,
  ) {}

  // The read below and the insert are not one operation, so two concurrent
  // callers with the same key both miss the read and one of them hits
  // IDX_AGENT_TASK_IDEMPOTENCY_KEY. That is the index doing its job; the loser
  // must get the same "already scheduled" answer the read would have given a
  // moment later, not an unstructured 500 surfaced to an agent that will then
  // retry or invent a workaround.
  async createTask(params: CreateAgentTaskParams): Promise<AgentTaskEntity> {
    try {
      return await this.createTaskOnce(params);
    } catch (error) {
      if (!isPostgresUniqueViolation(error) || !isDefined(params.idempotencyKey)) {
        throw error;
      }

      const winner = await this.findOpenTaskByIdempotencyKey(params);

      // Lost the race but the winner is already gone (completed or cancelled
      // between the violation and this read) — nothing to return, so let the
      // ordinary path try again rather than inventing a task.
      if (!isDefined(winner)) {
        return this.createTaskOnce(params);
      }

      return winner;
    }
  }

  private findOpenTaskByIdempotencyKey(
    params: CreateAgentTaskParams,
  ): Promise<AgentTaskEntity | null> {
    return this.agentTaskRepository.findOne({
      where: {
        workspaceId: params.workspaceId,
        idempotencyKey: params.idempotencyKey as string,
        status: In([AgentTaskStatus.PENDING, AgentTaskStatus.LEASED]),
      },
    });
  }

  private async createTaskOnce(
    params: CreateAgentTaskParams,
  ): Promise<AgentTaskEntity> {
    if (isDefined(params.idempotencyKey)) {
      const existing = await this.findOpenTaskByIdempotencyKey(params);

      // Already scheduled — refresh timing/reason instead of duplicating the
      // work. Mirrors the crm repo's upsert-scheduling pattern.
      if (isDefined(existing)) {
        return this.agentTaskRepository.save({
          ...existing,
          reason: params.reason,
          dueAt: params.dueAt ?? existing.dueAt,
        });
      }
    }

    return this.agentTaskRepository.save({
      workspaceId: params.workspaceId,
      objectNameSingular: params.objectNameSingular,
      recordId: params.recordId,
      agentId: params.agentId,
      reason: params.reason,
      priority: params.priority ?? 0,
      budget: params.budget ?? AGENT_TASK_DEFAULT_BUDGET,
      maxAttempts: params.maxAttempts ?? AGENT_TASK_DEFAULT_MAX_ATTEMPTS,
      idempotencyKey: params.idempotencyKey ?? null,
      dueAt: params.dueAt ?? new Date(),
      createdByActor: params.createdByActor ?? null,
      status: AgentTaskStatus.PENDING,
      attempts: 0,
    });
  }

  // Select candidates, then a conditional bulk UPDATE keyed on the *same*
  // claimable predicate. Postgres serializes the UPDATE per row, so a second
  // concurrent dispatch tick claims nothing for a row the first tick already
  // took — the first tick moved it to LEASED with "leasedUntil" in the future,
  // which makes the predicate false. Same compare-and-swap shape the rest of
  // this codebase uses, no new locking primitive.
  //
  // The predicate deliberately covers TWO states, not one:
  //   - PENDING: never started, or rescheduled by failTask's backoff.
  //   - LEASED with an expired "leasedUntil": a worker crashed mid-run and
  //     never called completeTask/failTask. Nothing else in the system will
  //     ever reset that row's status, so a PENDING-only filter would strand it
  //     forever and the "survives restart" exit gate could not pass.
  // `attempts < maxAttempts` bounds the reclaim loop: a repeatedly-crashing
  // task stops being claimable after maxAttempts and is swept to FAILED by
  // reapAbandonedTasks below.
  async claimDueTasks(
    limit = AGENT_TASK_CLAIM_BATCH_SIZE,
  ): Promise<AgentTaskEntity[]> {
    const now = new Date();

    const claimablePredicate = `(
      task.status = :pending
      OR (task.status = :leased AND task."leasedUntil" < :now)
    )`;

    const candidates = await this.agentTaskRepository
      .createQueryBuilder('task')
      .where(claimablePredicate, {
        pending: AgentTaskStatus.PENDING,
        leased: AgentTaskStatus.LEASED,
        now,
      })
      .andWhere('task."dueAt" <= :now', { now })
      .andWhere('task.attempts < task."maxAttempts"')
      .orderBy('task.priority', 'DESC')
      .addOrderBy('task."dueAt"', 'ASC')
      .limit(limit)
      .getMany();

    if (candidates.length === 0) {
      return [];
    }

    const leasedUntil = new Date(now.getTime() + AGENT_TASK_LEASE_DURATION_MS);

    // update() takes no explicit target: the repository's own query builder
    // already carries the entity metadata, and passing the imported class
    // breaks whenever the class identity differs from the one the running
    // DataSource registered (which is exactly the case in the integration
    // suite, where the app is built in jest's globalSetup realm).
    const updateResult = await this.agentTaskRepository
      .createQueryBuilder()
      .update()
      .set({
        status: AgentTaskStatus.LEASED,
        leasedUntil,
        attempts: () => '"attempts" + 1',
      })
      .where('id IN (:...ids)', { ids: candidates.map((task) => task.id) })
      // Re-check the claimable predicate inside the UPDATE. This is the
      // compare-and-swap: without it two ticks that both selected the same row
      // would both "claim" it.
      .andWhere(
        `(
          status = :pending
          OR (status = :leased AND "leasedUntil" < :now)
        )`,
        {
          pending: AgentTaskStatus.PENDING,
          leased: AgentTaskStatus.LEASED,
          now,
        },
      )
      .returning('*')
      .execute();

    return updateResult.raw as AgentTaskEntity[];
  }

  // A row that burned through maxAttempts while LEASED is no longer claimable
  // but is also not terminal, so nothing would ever close it out. Sweep those
  // to FAILED. Modelled on WorkflowHandleStaledRunsWorkspaceService, which is
  // this codebase's existing answer to the same problem for workflow runs
  // (`get-staled-runs-find-options.util.ts`: status ENQUEUED + enqueuedAt older
  // than STALED_RUNS_THRESHOLD_MS, swept by the `cron:workflow:handle-staled-runs`
  // cron). Called from the same dispatch tick as claimDueTasks.
  async reapAbandonedTasks(): Promise<number> {
    const result = await this.agentTaskRepository
      .createQueryBuilder()
      .update()
      .set({
        status: AgentTaskStatus.FAILED,
        leasedUntil: null,
        outcome: () =>
          `'Abandoned after ' || "attempts" || ' attempts: lease expired with no worker result'`,
      })
      .where('status = :leased', { leased: AgentTaskStatus.LEASED })
      .andWhere('"leasedUntil" < now()')
      .andWhere('attempts >= "maxAttempts"')
      .execute();

    return result.affected ?? 0;
  }

  // Guarded on status = LEASED, so a stale or duplicate worker invocation
  // can never overwrite a result another attempt already wrote.
  async completeTask(params: {
    taskId: string;
    workspaceId: string;
    runId: string;
    outcome: string;
  }): Promise<void> {
    await this.agentTaskRepository
      .createQueryBuilder()
      .update()
      .set({
        status: AgentTaskStatus.SUCCEEDED,
        lastRunId: params.runId,
        outcome: params.outcome,
        leasedUntil: null,
      })
      .where('id = :id', { id: params.taskId })
      .andWhere('"workspaceId" = :workspaceId', {
        workspaceId: params.workspaceId,
      })
      .andWhere('status = :leased', { leased: AgentTaskStatus.LEASED })
      .execute();
  }

  // Exhaustion is a separate, explicit finalization from the claim path —
  // two small operations rather than one large state machine.
  async failTask(params: {
    taskId: string;
    workspaceId: string;
    runId: string;
    errorMessage: string;
  }): Promise<void> {
    const task = await this.agentTaskRepository.findOne({
      where: { id: params.taskId, workspaceId: params.workspaceId },
    });

    if (!isDefined(task) || task.status !== AgentTaskStatus.LEASED) {
      return;
    }

    const exhausted = task.attempts >= task.maxAttempts;

    await this.agentTaskRepository.save({
      ...task,
      status: exhausted ? AgentTaskStatus.FAILED : AgentTaskStatus.PENDING,
      lastRunId: params.runId,
      leasedUntil: null,
      outcome: exhausted
        ? `Gave up after ${task.attempts} attempts: ${params.errorMessage}`
        : null,
      dueAt: exhausted
        ? task.dueAt
        : new Date(Date.now() + computeAgentTaskBackoffMs(task.attempts)),
    });
  }

  async cancelTask(params: {
    taskId: string;
    workspaceId: string;
    reason: string;
  }): Promise<boolean> {
    const result = await this.agentTaskRepository
      .createQueryBuilder()
      .update()
      .set({
        status: AgentTaskStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelReason: params.reason,
      })
      .where('id = :id', { id: params.taskId })
      .andWhere('"workspaceId" = :workspaceId', {
        workspaceId: params.workspaceId,
      })
      .andWhere('status IN (:...openStatuses)', {
        openStatuses: [AgentTaskStatus.PENDING, AgentTaskStatus.LEASED],
      })
      .execute();

    return (result.affected ?? 0) > 0;
  }
}
