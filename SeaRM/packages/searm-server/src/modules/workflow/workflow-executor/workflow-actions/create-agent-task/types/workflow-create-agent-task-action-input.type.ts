export type WorkflowCreateAgentTaskActionInput = {
  // The object the target record belongs to, e.g. 'company'. Static or a
  // resolved template — never inferred, same as every other record-crud step.
  objectNameSingular: string;
  // The record to research. Typically a template like
  // '{{trigger.properties.after.id}}' for a record-created trigger.
  recordId: string;
  // Shown to a human in the task list — why this research run exists.
  reason: string;
  // Higher runs first. Left unset unless the workflow author wants urgency.
  priority?: number;
  // Maximum agent steps the scheduled run may take. Mandatory ceiling: a step
  // that omits this still gets AgentTaskService's bounded default, never an
  // unbounded run — see AGENT_TASK_DEFAULT_BUDGET.
  budget?: number;
};
