import { type WorkflowCreateAgentTaskActionInput } from 'src/modules/workflow/workflow-executor/workflow-actions/create-agent-task/types/workflow-create-agent-task-action-input.type';
import { type BaseWorkflowActionSettings } from 'src/modules/workflow/workflow-executor/workflow-actions/types/workflow-action-settings.type';

export type WorkflowCreateAgentTaskActionSettings =
  BaseWorkflowActionSettings & {
    input: WorkflowCreateAgentTaskActionInput;
  };
