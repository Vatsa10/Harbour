import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AgentTaskEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/agent-task.entity';
import { AgentTaskService } from 'src/engine/metadata-modules/ai/ai-research/services/agent-task.service';
import { AgentTaskStatus } from 'src/engine/metadata-modules/ai/ai-research/types/agent-task-status.type';

const buildQueryBuilder = (overrides: Record<string, unknown> = {}) => {
  const builder: Record<string, jest.Mock> = {
    where: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    limit: jest.fn(),
    update: jest.fn(),
    set: jest.fn(),
    returning: jest.fn(),
    execute: jest.fn().mockResolvedValue({ raw: [], affected: 0 }),
    getMany: jest.fn().mockResolvedValue([]),
    ...overrides,
  };

  for (const key of Object.keys(builder)) {
    if (key !== 'execute' && key !== 'getMany') {
      builder[key].mockReturnValue(builder);
    }
  }

  return builder;
};

describe('AgentTaskService', () => {
  let service: AgentTaskService;

  const agentTaskRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    agentTaskRepository.save.mockImplementation(async (entity) => ({
      id: 'task-1',
      ...entity,
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentTaskService,
        {
          provide: getRepositoryToken(AgentTaskEntity),
          useValue: agentTaskRepository,
        },
      ],
    }).compile();

    service = module.get<AgentTaskService>(AgentTaskService);
  });

  describe('createTask', () => {
    it('should create a new PENDING task with default budget and attempts', async () => {
      const task = await service.createTask({
        workspaceId: 'workspace-1',
        objectNameSingular: 'company',
        recordId: 'record-1',
        agentId: 'agent-1',
        reason: 'New lead created',
      });

      expect(agentTaskRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: AgentTaskStatus.PENDING,
          budget: 8,
          maxAttempts: 3,
          attempts: 0,
        }),
      );
      expect(task.status).toBe(AgentTaskStatus.PENDING);
    });

    it('should reuse an open task with the same idempotency key instead of duplicating it', async () => {
      agentTaskRepository.findOne.mockResolvedValue({
        id: 'task-existing',
        status: AgentTaskStatus.PENDING,
        dueAt: new Date('2026-01-01'),
      });

      await service.createTask({
        workspaceId: 'workspace-1',
        objectNameSingular: 'company',
        recordId: 'record-1',
        agentId: 'agent-1',
        reason: 'Recheck after 30 days',
        idempotencyKey: 'recheck:company:record-1',
      });

      expect(agentTaskRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'task-existing',
          reason: 'Recheck after 30 days',
        }),
      );
    });
  });

  describe('claimDueTasks', () => {
    it('should return an empty array when no candidates are due', async () => {
      agentTaskRepository.createQueryBuilder.mockReturnValue(
        buildQueryBuilder(),
      );

      const result = await service.claimDueTasks();

      expect(result).toEqual([]);
    });

    it('should claim candidates via a conditional bulk update and return the updated rows', async () => {
      const claimedRows = [{ id: 'task-1', status: AgentTaskStatus.LEASED }];

      agentTaskRepository.createQueryBuilder
        .mockReturnValueOnce(
          buildQueryBuilder({
            getMany: jest.fn().mockResolvedValue([{ id: 'task-1' }]),
          }),
        )
        .mockReturnValueOnce(
          buildQueryBuilder({
            execute: jest.fn().mockResolvedValue({ raw: claimedRows }),
          }),
        );

      const result = await service.claimDueTasks(5);

      expect(result).toEqual(claimedRows);
    });

    // Guards the "survives restart" exit gate at the unit level. A crashed
    // worker leaves status = LEASED, so the claimable predicate must name
    // LEASED explicitly; a PENDING-only filter strands the row forever.
    it('should include expired LEASED rows in the claimable predicate, not just PENDING', async () => {
      const candidateBuilder = buildQueryBuilder({
        getMany: jest.fn().mockResolvedValue([]),
      });

      agentTaskRepository.createQueryBuilder.mockReturnValue(candidateBuilder);

      await service.claimDueTasks();

      const [predicate, parameters] = candidateBuilder.where.mock.calls[0];

      expect(predicate).toContain('task.status = :pending');
      expect(predicate).toContain('task."leasedUntil" < :now');
      expect(parameters).toEqual(
        expect.objectContaining({
          pending: AgentTaskStatus.PENDING,
          leased: AgentTaskStatus.LEASED,
        }),
      );
    });

    // The compare-and-swap. If the UPDATE's guard is weaker than the SELECT's
    // predicate, two concurrent dispatch ticks both claim the same row.
    it('should re-check the claimable predicate inside the conditional update', async () => {
      const updateBuilder = buildQueryBuilder({
        execute: jest.fn().mockResolvedValue({ raw: [] }),
      });

      agentTaskRepository.createQueryBuilder
        .mockReturnValueOnce(
          buildQueryBuilder({
            getMany: jest.fn().mockResolvedValue([{ id: 'task-1' }]),
          }),
        )
        .mockReturnValueOnce(updateBuilder);

      const claimed = await service.claimDueTasks();

      const guard = updateBuilder.andWhere.mock.calls
        .map(([clause]) => clause)
        .join(' ');

      expect(guard).toContain('status = :pending');
      expect(guard).toContain('"leasedUntil" < :now');
      // Losing the CAS must yield nothing. Returning the *candidate* list here
      // instead of the UPDATE's RETURNING rows would hand a row to two ticks.
      expect(claimed).toEqual([]);
    });
  });

  describe('reapAbandonedTasks', () => {
    it('should mark LEASED rows whose lease expired and whose attempts are exhausted as FAILED', async () => {
      const reapBuilder = buildQueryBuilder({
        execute: jest.fn().mockResolvedValue({ affected: 2 }),
      });

      agentTaskRepository.createQueryBuilder.mockReturnValue(reapBuilder);

      const reaped = await service.reapAbandonedTasks();

      expect(reaped).toBe(2);
      expect(reapBuilder.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: AgentTaskStatus.FAILED }),
      );

      const guard = reapBuilder.andWhere.mock.calls
        .map(([clause]) => clause)
        .join(' ');

      expect(guard).toContain('"leasedUntil" < now()');
      expect(guard).toContain('attempts >= "maxAttempts"');
    });
  });

  describe('failTask', () => {
    it('should reschedule with backoff when attempts remain', async () => {
      agentTaskRepository.findOne.mockResolvedValue({
        id: 'task-1',
        workspaceId: 'workspace-1',
        status: AgentTaskStatus.LEASED,
        attempts: 1,
        maxAttempts: 3,
        dueAt: new Date('2026-01-01'),
      });

      await service.failTask({
        taskId: 'task-1',
        workspaceId: 'workspace-1',
        runId: 'run-1',
        errorMessage: 'Model timed out',
      });

      expect(agentTaskRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: AgentTaskStatus.PENDING,
          outcome: null,
        }),
      );
    });

    it('should mark FAILED with a human-readable outcome once attempts are exhausted', async () => {
      agentTaskRepository.findOne.mockResolvedValue({
        id: 'task-1',
        workspaceId: 'workspace-1',
        status: AgentTaskStatus.LEASED,
        attempts: 3,
        maxAttempts: 3,
        dueAt: new Date('2026-01-01'),
      });

      await service.failTask({
        taskId: 'task-1',
        workspaceId: 'workspace-1',
        runId: 'run-1',
        errorMessage: 'Model timed out',
      });

      expect(agentTaskRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: AgentTaskStatus.FAILED,
          outcome: 'Gave up after 3 attempts: Model timed out',
        }),
      );
    });

    it('should do nothing when the task is no longer LEASED', async () => {
      agentTaskRepository.findOne.mockResolvedValue({
        id: 'task-1',
        workspaceId: 'workspace-1',
        status: AgentTaskStatus.CANCELLED,
      });

      await service.failTask({
        taskId: 'task-1',
        workspaceId: 'workspace-1',
        runId: 'run-1',
        errorMessage: 'Model timed out',
      });

      expect(agentTaskRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('cancelTask', () => {
    it('should return true when an open task was cancelled', async () => {
      agentTaskRepository.createQueryBuilder.mockReturnValue(
        buildQueryBuilder({
          execute: jest.fn().mockResolvedValue({ affected: 1 }),
        }),
      );

      const cancelled = await service.cancelTask({
        taskId: 'task-1',
        workspaceId: 'workspace-1',
        reason: 'Record deleted',
      });

      expect(cancelled).toBe(true);
    });

    it('should return false when the task was already terminal', async () => {
      agentTaskRepository.createQueryBuilder.mockReturnValue(
        buildQueryBuilder({
          execute: jest.fn().mockResolvedValue({ affected: 0 }),
        }),
      );

      const cancelled = await service.cancelTask({
        taskId: 'task-1',
        workspaceId: 'workspace-1',
        reason: 'Record deleted',
      });

      expect(cancelled).toBe(false);
    });
  });
  // Important 5. The find-then-save dedupe is not atomic and the migration
  // puts a partial unique index on exactly the predicate it reads. Two
  // concurrent calls with the same key both miss the read; the loser used to
  // get an unstructured Postgres error where the code path promised an
  // idempotent "already scheduled".
  describe('idempotency-key race', () => {
    const params = {
      workspaceId: 'workspace-1',
      objectNameSingular: 'company',
      recordId: 'record-1',
      agentId: 'agent-1',
      reason: 'New lead created',
      idempotencyKey: 'tool:company:record-1:New lead created',
    };

    it('should return the winning task instead of throwing when the unique index rejects the insert', async () => {
      const winner = {
        id: 'task-winner',
        status: AgentTaskStatus.PENDING,
        idempotencyKey: params.idempotencyKey,
      };

      // First read: nothing scheduled. Insert loses to the concurrent caller.
      // Second read: the winner is now visible.
      agentTaskRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(winner);
      agentTaskRepository.save.mockRejectedValueOnce(
        Object.assign(
          new Error(
            'duplicate key value violates unique constraint "IDX_AGENT_TASK_IDEMPOTENCY_KEY"',
          ),
          { code: '23505' },
        ),
      );

      await expect(service.createTask(params)).resolves.toEqual(winner);
    });

    it('should rethrow a failure that is not a unique violation', async () => {
      agentTaskRepository.findOne.mockResolvedValue(null);
      agentTaskRepository.save.mockRejectedValueOnce(
        Object.assign(new Error('connection terminated'), { code: '08006' }),
      );

      await expect(service.createTask(params)).rejects.toThrow(
        'connection terminated',
      );
    });
  });
});
