import { AgentTaskRunJob } from 'src/engine/metadata-modules/ai/ai-research/jobs/agent-task-run.job';
import { AgentRunStatus } from 'src/engine/metadata-modules/ai/ai-research/types/agent-run-status.type';

describe('AgentTaskRunJob', () => {
  const agentTaskRepository = { findOne: jest.fn() };
  const agentRunRepository = { save: jest.fn() };
  const agentRepository = { findOne: jest.fn() };
  const agentTaskService = { completeTask: jest.fn(), failTask: jest.fn() };
  const agentAsyncExecutorService = { executeAgent: jest.fn() };
  const globalWorkspaceOrmManager = {
    executeInWorkspaceContext: jest.fn((fn: () => Promise<void>) => fn()),
  };

  const buildJob = () =>
    new AgentTaskRunJob(
      agentTaskService as never,
      agentAsyncExecutorService as never,
      globalWorkspaceOrmManager as never,
      agentTaskRepository as never,
      agentRunRepository as never,
      agentRepository as never,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    agentRunRepository.save.mockImplementation(async (entity) => ({
      id: 'run-1',
      startedAt: new Date(),
      ...entity,
    }));
  });

  it('should do nothing when the task is no longer LEASED (cancelled between claim and pickup)', async () => {
    agentTaskRepository.findOne.mockResolvedValue({
      id: 'task-1',
      status: 'CANCELLED',
    });

    const job = buildJob();

    await job.handle({ taskId: 'task-1', workspaceId: 'workspace-1' });

    expect(agentAsyncExecutorService.executeAgent).not.toHaveBeenCalled();
  });

  it('should run the agent with threadId set to the new run id and complete the task on success', async () => {
    agentTaskRepository.findOne.mockResolvedValue({
      id: 'task-1',
      workspaceId: 'workspace-1',
      status: 'LEASED',
      agentId: 'agent-1',
      objectNameSingular: 'company',
      recordId: 'record-1',
      reason: 'New lead created',
      budget: 8,
    });
    agentRepository.findOne.mockResolvedValue({
      id: 'agent-1',
      label: 'Researcher',
    });
    agentAsyncExecutorService.executeAgent.mockResolvedValue({
      result: { response: 'Found nothing new.' },
      usage: { inputTokens: 100, outputTokens: 50 },
      steps: [],
      modelId: 'openai/gpt-4.1',
      creditsUsedMicro: 42,
    });

    const job = buildJob();

    await job.handle({ taskId: 'task-1', workspaceId: 'workspace-1' });

    expect(agentAsyncExecutorService.executeAgent).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'run-1' }),
    );
    expect(agentRunRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: AgentRunStatus.SUCCEEDED }),
    );
    expect(agentTaskService.completeTask).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1', runId: 'run-1' }),
    );
    expect(agentTaskService.failTask).not.toHaveBeenCalled();
  });

  it('should cap the agent at the task budget', async () => {
    agentTaskRepository.findOne.mockResolvedValue({
      id: 'task-1',
      workspaceId: 'workspace-1',
      status: 'LEASED',
      agentId: 'agent-1',
      objectNameSingular: 'company',
      recordId: 'record-1',
      reason: 'New lead created',
      budget: 3,
    });
    agentRepository.findOne.mockResolvedValue({
      id: 'agent-1',
      label: 'Researcher',
    });
    agentAsyncExecutorService.executeAgent.mockResolvedValue({
      result: { response: 'Partial.' },
      usage: { inputTokens: 1, outputTokens: 1 },
      steps: [{}, {}],
      modelId: 'openai/gpt-4.1',
      creditsUsedMicro: 1,
    });

    const job = buildJob();

    await job.handle({ taskId: 'task-1', workspaceId: 'workspace-1' });

    expect(agentAsyncExecutorService.executeAgent).toHaveBeenCalledWith(
      expect.objectContaining({ maxSteps: 3 }),
    );
  });

  // An exhausted budget must not read like a thorough run that found nothing.
  it('should name the budget in the outcome when the step cap was reached', async () => {
    agentTaskRepository.findOne.mockResolvedValue({
      id: 'task-1',
      workspaceId: 'workspace-1',
      status: 'LEASED',
      agentId: 'agent-1',
      objectNameSingular: 'company',
      recordId: 'record-1',
      reason: 'New lead created',
      budget: 3,
    });
    agentRepository.findOne.mockResolvedValue({
      id: 'agent-1',
      label: 'Researcher',
    });
    agentAsyncExecutorService.executeAgent.mockResolvedValue({
      result: { response: 'Partial findings.' },
      usage: { inputTokens: 1, outputTokens: 1 },
      steps: [{}, {}, {}],
      modelId: 'openai/gpt-4.1',
      creditsUsedMicro: 1,
    });

    const job = buildJob();

    await job.handle({ taskId: 'task-1', workspaceId: 'workspace-1' });

    // Still SUCCEEDED: the run did real work, it just ran out of room.
    expect(agentTaskService.completeTask).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: expect.stringContaining('step budget of 3'),
      }),
    );
  });

  // I1: AgentExecutionResult declares steps/modelId/creditsUsedMicro optional.
  // creditsUsedMicro lands in a NOT NULL bigint column and modelId in a
  // nullable varchar, so both need explicit coalescing, not a pass-through.
  it('should tolerate an execution result that omits its optional fields', async () => {
    agentTaskRepository.findOne.mockResolvedValue({
      id: 'task-1',
      workspaceId: 'workspace-1',
      status: 'LEASED',
      agentId: 'agent-1',
      objectNameSingular: 'company',
      recordId: 'record-1',
      reason: 'New lead created',
      budget: 8,
    });
    agentRepository.findOne.mockResolvedValue({
      id: 'agent-1',
      label: 'Researcher',
    });
    agentAsyncExecutorService.executeAgent.mockResolvedValue({
      result: { response: 'Done.' },
      usage: {},
    });

    const job = buildJob();

    await job.handle({ taskId: 'task-1', workspaceId: 'workspace-1' });

    expect(agentRunRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: AgentRunStatus.SUCCEEDED,
        modelId: null,
        creditsUsedMicro: 0,
        inputTokens: 0,
        outputTokens: 0,
      }),
    );
  });

  it('should record the run as FAILED and call failTask when the agent throws', async () => {
    agentTaskRepository.findOne.mockResolvedValue({
      id: 'task-1',
      workspaceId: 'workspace-1',
      status: 'LEASED',
      agentId: 'agent-1',
      objectNameSingular: 'company',
      recordId: 'record-1',
      reason: 'New lead created',
      budget: 8,
    });
    agentRepository.findOne.mockResolvedValue({
      id: 'agent-1',
      label: 'Researcher',
    });
    agentAsyncExecutorService.executeAgent.mockRejectedValue(
      new Error('model unavailable'),
    );

    const job = buildJob();

    await job.handle({ taskId: 'task-1', workspaceId: 'workspace-1' });

    expect(agentRunRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: AgentRunStatus.FAILED,
        errorMessage: 'model unavailable',
      }),
    );
    expect(agentTaskService.failTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-1',
        errorMessage: 'model unavailable',
      }),
    );
    expect(agentTaskService.completeTask).not.toHaveBeenCalled();
  });
});
