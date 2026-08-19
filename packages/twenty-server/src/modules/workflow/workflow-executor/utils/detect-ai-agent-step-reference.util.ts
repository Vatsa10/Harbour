import { TRIGGER_STEP_ID, WorkflowActionType } from 'twenty-shared/workflow';

import { type WorkflowAction } from 'src/modules/workflow/workflow-executor/workflow-actions/types/workflow-action.type';

// Matches the leading identifier of a `{{stepId...}}` / `{{stepId.field}}`
// variable token, the same `{{...}}` syntax `resolveInput` (twenty-shared)
// consumes. Deliberately independent of that resolver: this walks the RAW,
// unresolved template — after resolveInput() an AI-agent step's raw text
// output is byte-identical to a human-typed string, and the {{stepId...}}
// token is the only provenance signal left by the time it would reach here.
const VARIABLE_STEP_ID_PATTERN = /\{\{\s*([a-zA-Z0-9_-]+)/g;

const collectReferencedStepIds = (value: unknown, stepIds: Set<string>) => {
  if (typeof value === 'string') {
    for (const match of value.matchAll(VARIABLE_STEP_ID_PATTERN)) {
      stepIds.add(match[1]);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectReferencedStepIds(item, stepIds));
    return;
  }

  if (typeof value === 'object' && value !== null) {
    Object.entries(value).forEach(([key, val]) => {
      collectReferencedStepIds(key, stepIds);
      collectReferencedStepIds(val, stepIds);
    });
  }
};

// B2 (contract-audit.md): a workflow update-record step whose input resolves
// from an AI-agent step's raw `{{stepId.result}}` output is an AI-originated
// write and must go through ProposalGateService, exactly like any other AI
// write path. A step whose input is entirely human-authored static text is
// not, and must keep writing directly — re-gating every workflow write would
// silently break ordinary automations the charter never asked to touch.
//
// This is the provenance test that draws that line: true unless every
// `{{...}}` token in the raw (pre-resolveInput) input can be traced to a
// step that is definitely NOT an AI_AGENT step. Two cases both resolve to
// "gate it" (fail closed), deliberately:
//   1. the token names a step whose type is AI_AGENT.
//   2. the token names a step id that isn't in `steps` at all — this
//      function cannot prove it is safe, so it is not treated as safe.
export const isAiAgentOriginatedWorkflowInput = (
  rawInput: unknown,
  steps: WorkflowAction[],
): boolean => {
  const referencedStepIds = new Set<string>();

  collectReferencedStepIds(rawInput, referencedStepIds);

  if (referencedStepIds.size === 0) {
    return false;
  }

  const stepsById = new Map(steps.map((step) => [step.id, step]));

  for (const stepId of referencedStepIds) {
    // The trigger is not a WorkflowAction (it never appears in `steps`) but
    // it is a known, non-AI source — its payload is the event that started
    // the run, not model output. Excluding it here is what keeps ordinary
    // trigger-payload-driven automations ungated.
    if (stepId === TRIGGER_STEP_ID) {
      continue;
    }

    const referencedStep = stepsById.get(stepId);

    // Unknown step id: cannot rule out an AI_AGENT source. Fail closed.
    if (!referencedStep) {
      return true;
    }

    if (referencedStep.type === WorkflowActionType.AI_AGENT) {
      return true;
    }
  }

  return false;
};
