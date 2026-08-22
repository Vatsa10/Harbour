import { WorkflowActionType } from 'searm-shared/workflow';

import { AgentTaskService } from 'src/engine/metadata-modules/ai/ai-research/services/agent-task.service';
import { ResearchAgentService } from 'src/engine/metadata-modules/ai/ai-research/services/research-agent.service';
import { WorkflowExecutionContextService } from 'src/modules/workflow/workflow-executor/services/workflow-execution-context.service';
import { type WorkflowAction } from 'src/modules/workflow/workflow-executor/workflow-actions/types/workflow-action.type';
import { CreateAgentTaskWorkflowAction } from 'src/modules/workflow/workflow-executor/workflow-actions/create-agent-task/create-agent-task.workflow-action';

const RECORD_ID = '20202020-1111-4111-8111-111111111111';

const buildCreateAgentTaskStep = (
  input: Record<string, unknown>,
): WorkflowAction =>
  ({
    id: 'schedule-research-step',
    type: WorkflowActionType.CREATE_AGENT_TASK,
    name: 'Schedule research',
    valid: true,
    settings: {
      outputSchema: {},
      errorHandlingOptions: {
        retryOnFailure: { value: false },
        continueOnFailure: { value: false },
      },
      input,
    },
  }) as WorkflowAction;

describe('CreateAgentTaskWorkflowAction', () => {
  let action: CreateAgentTaskWorkflowAction;
  let agentTaskService: { createTask: jest.Mock };
  let researchAgentService: { resolveResearchAgentId: jest.Mock };
  let workflowExecutionContextService: { getExecutionContext: jest.Mock };

  const runInfo = { workflowRunId: 'run-1', workspaceId: 'workspace-1' };

  beforeEach(() => {
    jest.clearAllMocks();

    agentTaskService = {
      createTask: jest.fn().mockResolvedValue({
        id: 'task-1',
        status: 'PENDING',
      }),
    };
    researchAgentService = {
      resolveResearchAgentId: jest.fn().mockResolvedValue('agent-1'),
    };
    workflowExecutionContextService = {
      getExecutionContext: jest.fn().mockResolvedValue({
        isActingOnBehalfOfUser: false,
        initiator: { source: 'WORKFLOW', name: 'Workflow', context: {} },
        rolePermissionConfig: { unionOf: ['role-1'] },
        authContext: { type: 'system' },
      }),
    };

    action = new CreateAgentTaskWorkflowAction(
      agentTaskService as unknown as AgentTaskService,
      researchAgentService as unknown as ResearchAgentService,
      workflowExecutionContextService as unknown as WorkflowExecutionContextService,
    );
  });

  it('should schedule a research task deterministically, without an LLM in the loop', async () => {
    const step = buildCreateAgentTaskStep({
      objectNameSingular: 'company',
      recordId: RECORD_ID,
      reason: 'New company just entered the pipeline',
    });

    const output = await action.execute({
      currentStepId: 'schedule-research-step',
      steps: [step],
      context: {},
      runInfo,
    });

    expect(researchAgentService.resolveResearchAgentId).toHaveBeenCalledWith(
      'workspace-1',
    );
    expect(agentTaskService.createTask).toHaveBeenCalledTimes(1);
    expect(agentTaskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        objectNameSingular: 'company',
        recordId: RECORD_ID,
        agentId: 'agent-1',
        reason: 'New company just entered the pipeline',
        idempotencyKey: 'workflow-step:run-1:schedule-research-step',
      }),
    );
    expect(output.error).toBeUndefined();
    expect(output.result).toMatchObject({ taskId: 'task-1', status: 'PENDING' });
  });

  it('should resolve templated recordId from the trigger context', async () => {
    const step = buildCreateAgentTaskStep({
      objectNameSingular: 'company',
      recordId: '{{trigger.properties.after.id}}',
      reason: 'New company created',
    });

    await action.execute({
      currentStepId: 'schedule-research-step',
      steps: [step],
      context: { trigger: { properties: { after: { id: RECORD_ID } } } },
      runInfo,
    });

    expect(agentTaskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ recordId: RECORD_ID }),
    );
  });

  it('should never write CRM data directly and should pass budget through uncapped-by-this-step (AgentTaskService applies the bounded default)', async () => {
    const step = buildCreateAgentTaskStep({
      objectNameSingular: 'company',
      recordId: RECORD_ID,
      reason: 'Check this lead',
    });

    await action.execute({
      currentStepId: 'schedule-research-step',
      steps: [step],
      context: {},
      runInfo,
    });

    const call = agentTaskService.createTask.mock.calls[0][0];

    expect(call.budget).toBeUndefined();
    expect(Object.keys(call)).not.toContain('objectRecord');
  });

  it('should fail without scheduling when recordId is missing or invalid', async () => {
    const step = buildCreateAgentTaskStep({
      objectNameSingular: 'company',
      recordId: 'not-a-uuid',
      reason: 'Check this lead',
    });

    const output = await action.execute({
      currentStepId: 'schedule-research-step',
      steps: [step],
      context: {},
      runInfo,
    });

    expect(agentTaskService.createTask).not.toHaveBeenCalled();
    expect(output.error).toBeDefined();
  });

  it('should fail gracefully when no research agent is seeded for the workspace', async () => {
    researchAgentService.resolveResearchAgentId.mockRejectedValue(
      new Error("This workspace's research agent is not seeded."),
    );

    const step = buildCreateAgentTaskStep({
      objectNameSingular: 'company',
      recordId: RECORD_ID,
      reason: 'Check this lead',
    });

    const output = await action.execute({
      currentStepId: 'schedule-research-step',
      steps: [step],
      context: {},
      runInfo,
    });

    expect(agentTaskService.createTask).not.toHaveBeenCalled();
    expect(output.error).toContain('research agent is not seeded');
  });
});
