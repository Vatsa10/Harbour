import { WorkflowActionType } from 'searm-shared/workflow';

import { type WorkflowStepInput } from 'src/modules/workflow/workflow-templates/types/workflow-template.type';
import { normalizeWorkflowTemplateSteps } from 'src/modules/workflow/workflow-templates/utils/normalize-workflow-template-steps.util';

// Exactly Phase 5's WorkflowStepTemplate shape: {type, name, settings} only.
const appStep = (name: string): WorkflowStepInput => ({
  type: WorkflowActionType.AI_AGENT,
  name,
  settings: {
    outputSchema: {},
    errorHandlingOptions: {
      retryOnFailure: { value: false },
      continueOnFailure: { value: false },
    },
    input: { prompt: 'do the thing' },
  },
});

describe('normalizeWorkflowTemplateSteps', () => {
  it('should assign an id to an app-supplied step that omits one', () => {
    const [step] = normalizeWorkflowTemplateSteps([appStep('Triage')]);

    expect(step.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('should mark an app-supplied step valid', () => {
    const [step] = normalizeWorkflowTemplateSteps([appStep('Triage')]);

    expect(step.valid).toBe(true);
  });

  it('should chain nextStepIds in array order and terminate the last step', () => {
    const [first, second] = normalizeWorkflowTemplateSteps([
      appStep('Triage'),
      appStep('Notify'),
    ]);

    expect(first.nextStepIds).toEqual([second.id]);
    expect(second.nextStepIds).toEqual([]);
  });

  it('should preserve an id the caller already assigned', () => {
    const id = '11111111-1111-4111-8111-111111111101';

    const [step] = normalizeWorkflowTemplateSteps([
      { ...appStep('Triage'), id, valid: true },
    ]);

    expect(step.id).toBe(id);
  });

  it('should preserve an explicit nextStepIds instead of overwriting it with the array order', () => {
    const [first, second] = normalizeWorkflowTemplateSteps([
      { ...appStep('Triage'), id: 'step-1', nextStepIds: [] },
      { ...appStep('Notify'), id: 'step-2' },
    ]);

    expect(first.nextStepIds).toEqual([]);
    expect(second.nextStepIds).toEqual([]);
  });

  it('should preserve an explicit valid false rather than forcing it true', () => {
    const [step] = normalizeWorkflowTemplateSteps([
      { ...appStep('Triage'), valid: false },
    ]);

    expect(step.valid).toBe(false);
  });
});
