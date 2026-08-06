import { CreateAgentTaskTool } from 'src/engine/core-modules/tool/tools/create-agent-task-tool/create-agent-task-tool';

describe('CreateAgentTaskTool', () => {
  const agentTaskService = { createTask: jest.fn() };
  const researchAgentService = { resolveResearchAgentId: jest.fn() };

  const buildTool = () =>
    new CreateAgentTaskTool(
      agentTaskService as never,
      researchAgentService as never,
    );

  const args = {
    objectNameSingular: 'company',
    recordId: '11111111-1111-4111-8111-111111111111',
    reason: 'New lead created',
  };

  const context = { workspaceId: 'workspace-1' };

  beforeEach(() => {
    jest.clearAllMocks();
    researchAgentService.resolveResearchAgentId.mockResolvedValue(
      'agent-seeded',
    );
    agentTaskService.createTask.mockResolvedValue({
      id: 'task-1',
      status: 'PENDING',
      dueAt: new Date('2026-08-01T00:00:00.000Z'),
    });
  });

  it('should schedule the task against the workspace research agent with a literal agent actor', async () => {
    const tool = buildTool();

    const result = await tool.execute(args as never, context as never);

    expect(agentTaskService.createTask).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      objectNameSingular: 'company',
      recordId: '11111111-1111-4111-8111-111111111111',
      agentId: 'agent-seeded',
      reason: 'New lead created',
      priority: undefined,
      budget: undefined,
      idempotencyKey:
        'tool:company:11111111-1111-4111-8111-111111111111:New lead created',
      createdByActor: {
        source: 'AGENT',
        workspaceMemberId: null,
        name: 'AI agent',
        context: {},
      },
    });
    expect(result.success).toBe(true);
    expect(result.result).toEqual({ taskId: 'task-1', status: 'PENDING' });
  });

  it('should pass the budget through as the run step cap', async () => {
    const tool = buildTool();

    await tool.execute({ ...args, budget: 3 } as never, context as never);

    expect(agentTaskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ budget: 3 }),
    );
  });

  // The idempotency key is what makes a re-fired workflow trigger safe.
  it('should derive the same idempotency key when called twice with the same inputs', async () => {
    const tool = buildTool();

    const first = await tool.execute(args as never, context as never);
    const second = await tool.execute(args as never, context as never);

    const [firstCall, secondCall] = agentTaskService.createTask.mock.calls;

    expect(firstCall[0].idempotencyKey).toBe(secondCall[0].idempotencyKey);
    expect(first.result).toEqual(second.result);
  });

  it('should fail without scheduling anything when the workspace has no seeded research agent', async () => {
    researchAgentService.resolveResearchAgentId.mockRejectedValue(
      new Error("This workspace's research agent is not seeded."),
    );

    const tool = buildTool();

    const result = await tool.execute(args as never, context as never);

    expect(result.success).toBe(false);
    expect(agentTaskService.createTask).not.toHaveBeenCalled();
  });
});
