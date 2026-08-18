import { type FlatWorkspace } from 'src/engine/core-modules/workspace/types/flat-workspace.type';
import { AgentRunResolver } from 'src/engine/metadata-modules/ai/ai-research/resolvers/agent-run.resolver';

describe('AgentRunResolver agentRuns', () => {
  const workspace = { id: 'workspace-id' } as FlatWorkspace;

  const buildResolver = (runs: unknown[]) => {
    const agentRunRepository = {
      find: jest.fn().mockResolvedValue(runs),
    };

    const resolver = new AgentRunResolver(agentRunRepository as never);

    return { resolver, agentRunRepository };
  };

  const buildRun = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'run-id',
    workspaceId: 'workspace-id',
    taskId: 'task-id',
    modelId: 'gpt-5',
    elapsedMs: 1200,
    inputTokens: 10,
    outputTokens: 20,
    creditsUsedMicro: 500,
    resultSummary: 'done',
    errorMessage: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  });

  it('scopes the query to the requesting workspace so runs from other workspaces are not returned', async () => {
    const run = buildRun();
    const { resolver, agentRunRepository } = buildResolver([run]);

    await resolver.agentRuns(workspace);

    expect(agentRunRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: 'workspace-id' }),
      }),
    );
  });

  it('filters by agentTaskId when provided', async () => {
    const run = buildRun();
    const { resolver, agentRunRepository } = buildResolver([run]);

    await resolver.agentRuns(workspace, 'task-id');

    expect(agentRunRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: 'workspace-id',
          taskId: 'task-id',
        }),
      }),
    );
  });

  it('does not include a taskId filter when agentTaskId is not provided', async () => {
    const run = buildRun();
    const { resolver, agentRunRepository } = buildResolver([run]);

    await resolver.agentRuns(workspace);

    const [{ where }] = agentRunRepository.find.mock.calls[0];

    expect(where).not.toHaveProperty('taskId');
  });

  it('maps entity fields to the AgentRunDTO shape', async () => {
    const run = buildRun();
    const { resolver } = buildResolver([run]);

    const result = await resolver.agentRuns(workspace);

    expect(result).toEqual([
      {
        id: 'run-id',
        agentTaskId: 'task-id',
        modelId: 'gpt-5',
        elapsedMs: 1200,
        inputTokens: 10,
        outputTokens: 20,
        creditsUsedMicro: 500,
        resultSummary: 'done',
        errorMessage: null,
        createdAt: run.createdAt,
      },
    ]);
  });
});
