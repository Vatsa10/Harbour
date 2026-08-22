import { Injectable } from '@nestjs/common';

import { isDefined, isValidUuid, resolveInput } from 'searm-shared/utils';

import { type WorkflowAction } from 'src/modules/workflow/workflow-executor/interfaces/workflow-action.interface';

import { AgentTaskService } from 'src/engine/metadata-modules/ai/ai-research/services/agent-task.service';
import { ResearchAgentService } from 'src/engine/metadata-modules/ai/ai-research/services/research-agent.service';
import {
  WorkflowStepExecutorException,
  WorkflowStepExecutorExceptionCode,
} from 'src/modules/workflow/workflow-executor/exceptions/workflow-step-executor.exception';
import { type WorkflowActionInput } from 'src/modules/workflow/workflow-executor/types/workflow-action-input';
import { type WorkflowActionOutput } from 'src/modules/workflow/workflow-executor/types/workflow-action-output.type';
import { buildWorkflowActorMetadata } from 'src/modules/workflow/workflow-executor/utils/build-workflow-actor-metadata.util';
import { findStepOrThrow } from 'src/modules/workflow/workflow-executor/utils/find-step-or-throw.util';
import { isWorkflowCreateAgentTaskAction } from 'src/modules/workflow/workflow-executor/workflow-actions/create-agent-task/guards/is-workflow-create-agent-task-action.guard';
import { type WorkflowCreateAgentTaskActionInput } from 'src/modules/workflow/workflow-executor/workflow-actions/create-agent-task/types/workflow-create-agent-task-action-input.type';
import { WorkflowExecutionContextService } from 'src/modules/workflow/workflow-executor/services/workflow-execution-context.service';

// This step schedules durable AI research; it does not itself write CRM
// data. It therefore runs deterministically, un-gated, the same category as
// the four record-crud workflow actions: a human explicitly configured this
// step in the workflow builder. The research writes the scheduled run later
// makes still go through create_agent_task's tool path and, from there,
// ProposalGateService exactly as they do today — nothing here shortcuts that.
@Injectable()
export class CreateAgentTaskWorkflowAction implements WorkflowAction {
  constructor(
    private readonly agentTaskService: AgentTaskService,
    private readonly researchAgentService: ResearchAgentService,
    private readonly workflowExecutionContextService: WorkflowExecutionContextService,
  ) {}

  async execute({
    currentStepId,
    steps,
    context,
    runInfo,
  }: WorkflowActionInput): Promise<WorkflowActionOutput> {
    const step = findStepOrThrow({
      steps,
      stepId: currentStepId,
    });

    if (!isWorkflowCreateAgentTaskAction(step)) {
      throw new WorkflowStepExecutorException(
        'Step is not a create agent task action',
        WorkflowStepExecutorExceptionCode.INVALID_STEP_TYPE,
      );
    }

    const { workspaceId } = runInfo;

    const rawInput = step.settings.input;

    const workflowActionInput = resolveInput(
      rawInput,
      context,
    ) as WorkflowCreateAgentTaskActionInput;

    if (
      !isDefined(workflowActionInput.objectNameSingular) ||
      workflowActionInput.objectNameSingular.trim().length === 0 ||
      !isDefined(workflowActionInput.recordId) ||
      !isValidUuid(workflowActionInput.recordId) ||
      !isDefined(workflowActionInput.reason) ||
      workflowActionInput.reason.trim().length === 0
    ) {
      return {
        error:
          'Failed to schedule research: objectNameSingular, recordId, and reason are required',
      };
    }

    let agentId: string;

    try {
      // Owner Decision 4 (see create-agent-task-tool.ts): agent selection is
      // never arbitrary input. A workflow step is human-authored, not
      // AI-authored, so allowing it to opt into the workspace's seeded
      // research agent by default keeps this simple without letting a step
      // pick an arbitrary agentId.
      agentId = await this.researchAgentService.resolveResearchAgentId(
        workspaceId,
      );
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : 'No research agent is available in this workspace',
      };
    }

    const executionContext =
      await this.workflowExecutionContextService.getExecutionContext(runInfo);

    const createdByActor = buildWorkflowActorMetadata(executionContext);

    const task = await this.agentTaskService.createTask({
      workspaceId,
      objectNameSingular: workflowActionInput.objectNameSingular,
      recordId: workflowActionInput.recordId,
      agentId,
      reason: workflowActionInput.reason,
      priority: workflowActionInput.priority,
      // Budget is mandatory in spirit, not necessarily in the step's
      // settings: an omitted value falls through to
      // AgentTaskService's AGENT_TASK_DEFAULT_BUDGET, never to an
      // unbounded/undefined-passthrough run.
      budget: workflowActionInput.budget,
      // Deterministic per (run, step): a retried execution of this exact
      // step reuses the same open task instead of scheduling a duplicate,
      // satisfying the Execution contract's "a retry must never duplicate"
      // rule.
      idempotencyKey: `workflow-step:${runInfo.workflowRunId}:${currentStepId}`,
      createdByActor,
    });

    return {
      result: { taskId: task.id, status: task.status },
    };
  }
}
