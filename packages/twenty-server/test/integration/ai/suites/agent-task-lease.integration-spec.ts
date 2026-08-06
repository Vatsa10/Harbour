import { getRepositoryToken } from '@nestjs/typeorm';

import { type Repository } from 'typeorm';

import { AgentTaskEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/agent-task.entity';
import { AgentTaskService } from 'src/engine/metadata-modules/ai/ai-research/services/agent-task.service';
import { AgentTaskStatus } from 'src/engine/metadata-modules/ai/ai-research/types/agent-task-status.type';
import { SEED_APPLE_WORKSPACE_ID } from 'src/engine/workspace-manager/dev-seeder/core/constants/seeder-workspaces.constant';

// Real seam. The unit spec doubles the repository, so the compare-and-swap the
// claim depends on is never actually executed by Postgres there. This suite
// runs the real SQL against the real table and, crucially, kills a worker
// mid-lease and restarts it: with a strict-PENDING claim predicate the crashed
// row would be stranded forever and this suite fails.
describe('AgentTask lease claim (integration)', () => {
  const RECORD_ID = '3d2f7a10-6c11-4c8e-9f1e-1a2b3c4d5e6f';

  let service: AgentTaskService;
  let repository: Repository<AgentTaskEntity>;

  const findTask = async (taskId: string): Promise<AgentTaskEntity> => {
    const task = await repository.findOne({ where: { id: taskId } });

    if (task === null) {
      throw new Error(`Task ${taskId} disappeared`);
    }

    return task;
  };

  // Simulates the crash: the worker is gone, so nothing ever called
  // completeTask/failTask and the lease simply runs out.
  const expireLease = async (taskId: string): Promise<void> => {
    await repository.update(taskId, {
      leasedUntil: new Date(Date.now() - 60_000),
    });
  };

  const createTask = () =>
    service.createTask({
      workspaceId: SEED_APPLE_WORKSPACE_ID,
      objectNameSingular: 'company',
      recordId: RECORD_ID,
      agentId: '4b1f0c2a-9d3e-4a55-8b7c-0e1d2c3b4a59',
      reason: 'lease integration test',
    });

  beforeAll(() => {
    service = global.app.get<AgentTaskService>(AgentTaskService);
    repository = global.app.get<Repository<AgentTaskEntity>>(
      getRepositoryToken(AgentTaskEntity),
    );
  });

  afterEach(async () => {
    await repository.delete({ recordId: RECORD_ID });
  });

  it('should claim a PENDING task exactly once while the lease is held', async () => {
    const created = await createTask();

    expect(created.status).toBe(AgentTaskStatus.PENDING);

    const firstTick = await service.claimDueTasks(50);

    expect(firstTick.map((task) => task.id)).toContain(created.id);

    const claimed = await findTask(created.id);

    expect(claimed.status).toBe(AgentTaskStatus.LEASED);
    expect(claimed.attempts).toBe(1);
    expect(claimed.leasedUntil?.getTime()).toBeGreaterThan(Date.now());

    // Second tick, lease still live: the row must not be handed out twice.
    const secondTick = await service.claimDueTasks(50);

    expect(secondTick.map((task) => task.id)).not.toContain(created.id);
  });

  it('should re-claim a task whose worker crashed mid-lease', async () => {
    const created = await createTask();

    await service.claimDueTasks(50);
    await expireLease(created.id);

    const afterRestart = await service.claimDueTasks(50);

    expect(afterRestart.map((task) => task.id)).toContain(created.id);

    const reclaimed = await findTask(created.id);

    expect(reclaimed.status).toBe(AgentTaskStatus.LEASED);
    expect(reclaimed.attempts).toBe(2);
    expect(reclaimed.leasedUntil?.getTime()).toBeGreaterThan(Date.now());
  });

  it('should stop re-claiming and sweep to FAILED once attempts are exhausted', async () => {
    const created = await createTask();

    await repository.update(created.id, { maxAttempts: 1 });
    await service.claimDueTasks(50);
    await expireLease(created.id);

    const afterExhaustion = await service.claimDueTasks(50);

    expect(afterExhaustion.map((task) => task.id)).not.toContain(created.id);
    expect((await findTask(created.id)).status).toBe(AgentTaskStatus.LEASED);

    const reaped = await service.reapAbandonedTasks();

    expect(reaped).toBeGreaterThanOrEqual(1);

    const swept = await findTask(created.id);

    expect(swept.status).toBe(AgentTaskStatus.FAILED);
    expect(swept.leasedUntil).toBeNull();
    expect(swept.outcome).toContain('Abandoned after');
  });

  it('should reschedule a failed attempt with backoff and finalize a terminal one', async () => {
    const created = await createTask();

    await service.claimDueTasks(50);
    await service.failTask({
      taskId: created.id,
      workspaceId: SEED_APPLE_WORKSPACE_ID,
      runId: '7c9e4a20-1b33-4d6f-8a21-5e6f7a8b9c01',
      errorMessage: 'Model timed out',
    });

    const rescheduled = await findTask(created.id);

    expect(rescheduled.status).toBe(AgentTaskStatus.PENDING);
    expect(rescheduled.outcome).toBeNull();
    expect(rescheduled.dueAt.getTime()).toBeGreaterThan(Date.now());

    // Backoff pushed dueAt into the future, so it is not due yet.
    const tooEarly = await service.claimDueTasks(50);

    expect(tooEarly.map((task) => task.id)).not.toContain(created.id);
  });

  it('should cancel an open task once and refuse a terminal one', async () => {
    const created = await createTask();

    await expect(
      service.cancelTask({
        taskId: created.id,
        workspaceId: SEED_APPLE_WORKSPACE_ID,
        reason: 'Record deleted',
      }),
    ).resolves.toBe(true);

    expect((await findTask(created.id)).status).toBe(AgentTaskStatus.CANCELLED);

    await expect(
      service.cancelTask({
        taskId: created.id,
        workspaceId: SEED_APPLE_WORKSPACE_ID,
        reason: 'Record deleted again',
      }),
    ).resolves.toBe(false);

    // A cancelled row must never come back out of the claim.
    const afterCancel = await service.claimDueTasks(50);

    expect(afterCancel.map((task) => task.id)).not.toContain(created.id);
  });
});
