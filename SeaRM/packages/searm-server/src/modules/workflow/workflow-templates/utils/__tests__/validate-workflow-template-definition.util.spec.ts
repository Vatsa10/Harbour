import { WorkflowActionType } from 'searm-shared/workflow';

import { WorkflowTriggerType } from 'src/modules/workflow/workflow-trigger/types/workflow-trigger.type';
import {
  InvalidWorkflowDefinitionError,
  validateWorkflowTemplateDefinition,
} from 'src/modules/workflow/workflow-templates/utils/validate-workflow-template-definition.util';

const buildBaseDefinition = (steps: Record<string, unknown>[]) => ({
  name: 'Test workflow',
  trigger: {
    name: 'Manual trigger',
    type: WorkflowTriggerType.MANUAL,
    settings: { outputSchema: {} },
  },
  steps,
});

describe('validateWorkflowTemplateDefinition - CREATE_AGENT_TASK step', () => {
  it('should throw when a CREATE_AGENT_TASK step has no objectNameSingular or recordId', () => {
    const definition = buildBaseDefinition([
      {
        id: 'step-1',
        name: 'Schedule research',
        type: WorkflowActionType.CREATE_AGENT_TASK,
        valid: true,
        settings: {
          outputSchema: {},
          errorHandlingOptions: {
            retryOnFailure: { value: false },
            continueOnFailure: { value: false },
          },
          input: { reason: 'new lead' },
        },
      },
    ]);

    expect(() =>
      validateWorkflowTemplateDefinition(
        definition as unknown as Parameters<
          typeof validateWorkflowTemplateDefinition
        >[0],
      ),
    ).toThrow(InvalidWorkflowDefinitionError);
  });

  it('should not throw when a CREATE_AGENT_TASK step has objectNameSingular and recordId', () => {
    const definition = buildBaseDefinition([
      {
        id: 'step-1',
        name: 'Schedule research',
        type: WorkflowActionType.CREATE_AGENT_TASK,
        valid: true,
        settings: {
          outputSchema: {},
          errorHandlingOptions: {
            retryOnFailure: { value: false },
            continueOnFailure: { value: false },
          },
          input: {
            objectNameSingular: 'company',
            recordId: '{{trigger.properties.after.id}}',
            reason: 'new lead',
          },
        },
      },
    ]);

    expect(() =>
      validateWorkflowTemplateDefinition(
        definition as unknown as Parameters<
          typeof validateWorkflowTemplateDefinition
        >[0],
      ),
    ).not.toThrow();
  });
});
