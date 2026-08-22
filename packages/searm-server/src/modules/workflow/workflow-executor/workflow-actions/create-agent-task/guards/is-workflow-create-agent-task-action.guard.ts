import { WorkflowActionType } from 'searm-shared/workflow';
import {
  type WorkflowAction,
  type WorkflowCreateAgentTaskAction,
} from 'src/modules/workflow/workflow-executor/workflow-actions/types/workflow-action.type';

export const isWorkflowCreateAgentTaskAction = (
  action: WorkflowAction,
): action is WorkflowCreateAgentTaskAction => {
  return action.type === WorkflowActionType.CREATE_AGENT_TASK;
};
