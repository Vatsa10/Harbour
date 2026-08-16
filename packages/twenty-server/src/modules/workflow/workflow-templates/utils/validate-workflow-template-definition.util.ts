import { isDefined } from 'twenty-shared/utils';
import { WorkflowActionType } from 'twenty-shared/workflow';

import { type WorkflowDefinitionInput } from 'src/modules/workflow/workflow-templates/types/workflow-template.type';
import { WorkflowTriggerType } from 'src/modules/workflow/workflow-trigger/types/workflow-trigger.type';

// installWorkflowDefinition takes trigger and steps as GraphQL JSON, so the
// schema enforces nothing beyond "object" and "array". Everything the workflow
// builder guarantees by construction — a known trigger type, a known action
// type per step, a settings object — has to be checked here, before a
// permission-bypassed insert stamps the result `valid: true` and, with the
// input's default activate, turns it into a live automation.
const KNOWN_ACTION_TYPES = new Set<string>(Object.values(WorkflowActionType));
const KNOWN_TRIGGER_TYPES = new Set<string>(Object.values(WorkflowTriggerType));

export class InvalidWorkflowDefinitionError extends Error {}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  isDefined(value) && typeof value === 'object' && !Array.isArray(value);

export const validateWorkflowTemplateDefinition = (
  definition: WorkflowDefinitionInput,
): void => {
  if (
    typeof definition.name !== 'string' ||
    definition.name.trim().length === 0
  ) {
    throw new InvalidWorkflowDefinitionError(
      'Workflow definition requires a non-empty name.',
    );
  }

  const trigger = definition.trigger as unknown;

  if (!isPlainObject(trigger) || !KNOWN_TRIGGER_TYPES.has(`${trigger.type}`)) {
    throw new InvalidWorkflowDefinitionError(
      `Workflow definition has an unknown trigger type "${
        isPlainObject(trigger) ? trigger.type : trigger
      }".`,
    );
  }

  if (!Array.isArray(definition.steps) || definition.steps.length === 0) {
    throw new InvalidWorkflowDefinitionError(
      'Workflow definition requires at least one step.',
    );
  }

  definition.steps.forEach((step, index) => {
    if (!isPlainObject(step)) {
      throw new InvalidWorkflowDefinitionError(
        `Workflow step at index ${index} is not an object.`,
      );
    }

    if (!KNOWN_ACTION_TYPES.has(`${step.type}`)) {
      throw new InvalidWorkflowDefinitionError(
        `Workflow step at index ${index} has an unknown type "${step.type}".`,
      );
    }

    if (!isPlainObject(step.settings)) {
      throw new InvalidWorkflowDefinitionError(
        `Workflow step at index ${index} is missing a settings object.`,
      );
    }
  });
};
