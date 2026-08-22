import { v4 as uuidv4 } from 'uuid';

import { type WorkflowAction } from 'src/modules/workflow/workflow-executor/workflow-actions/types/workflow-action.type';
import { type WorkflowStepInput } from 'src/modules/workflow/workflow-templates/types/workflow-template.type';

// App-supplied steps carry {type, name, settings} and nothing else. A stored
// WorkflowVersion step without an id or `valid` is structurally invalid and
// fails at execution time, not at insert time — normalise here, once.
export const normalizeWorkflowTemplateSteps = (
  steps: WorkflowStepInput[],
): WorkflowAction[] => {
  const withIds = steps.map((step) => ({
    ...step,
    id: step.id ?? uuidv4(),
    // The default is only sound because installDefinition runs
    // validateWorkflowTemplateDefinition first: without it this flag asserted
    // a validity nothing had checked. An explicit `false` is still honoured.
    valid: step.valid ?? true,
  }));

  // Linear chain in array order — the only ordering an app-supplied list
  // expresses. An explicit nextStepIds on a step is respected as authored.
  return withIds.map((step, index) => ({
    ...step,
    nextStepIds:
      step.nextStepIds ??
      (index < withIds.length - 1 ? [withIds[index + 1].id] : []),
  })) as WorkflowAction[];
};
