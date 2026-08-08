import { WorkflowActionType } from 'twenty-shared/workflow';

import { type WorkflowAiAgentAction } from 'src/modules/workflow/workflow-executor/workflow-actions/types/workflow-action.type';
import { type WorkflowTemplateDefinition } from 'src/modules/workflow/workflow-templates/types/workflow-template.type';
import { WorkflowTriggerType } from 'src/modules/workflow/workflow-trigger/types/workflow-trigger.type';

const errorHandlingOptions = {
  retryOnFailure: { value: false },
  continueOnFailure: { value: false },
};

// agentId is intentionally omitted so the step runs as an ad-hoc agent against
// the given prompt — AiAgentWorkflowAction only resolves an agent if (agentId).
const buildAiAgentStep = (params: {
  id: string;
  name: string;
  prompt: string;
}): WorkflowAiAgentAction => ({
  id: params.id,
  name: params.name,
  type: WorkflowActionType.AI_AGENT,
  valid: true,
  settings: {
    outputSchema: {},
    errorHandlingOptions,
    input: { prompt: params.prompt },
  },
});

export const WORKFLOW_TEMPLATES: WorkflowTemplateDefinition[] = [
  {
    key: 'RESEARCH_BRIEF',
    name: 'Research brief',
    description:
      'Run on demand from the command menu. Researches a company or person using existing CRM history and any connected enrichment tools, then proposes record updates for review.',
    trigger: {
      name: 'Manual trigger',
      type: WorkflowTriggerType.MANUAL,
      settings: { outputSchema: {} },
    },
    steps: [
      buildAiAgentStep({
        id: '11111111-1111-4111-8111-111111111101',
        name: 'Research and propose updates',
        prompt:
          'The user wants a research brief on a specific company or person. Use your find and group_by tools to gather existing CRM history (notes, tasks, past opportunities, related people). Summarize what you find, then propose any record updates or a new opportunity via your write tools. Every write you attempt becomes a proposal awaiting human approval — do not assume it applied, and do not retry a write that already returned a pending-approval result.',
      }),
    ],
  },
  {
    key: 'FOLLOW_UP_DIGEST',
    name: 'Daily follow-up digest',
    description:
      'Runs every morning. Finds opportunities with no recent activity and proposes a next action for each.',
    trigger: {
      name: 'Daily at 8am',
      type: WorkflowTriggerType.CRON,
      settings: {
        outputSchema: {},
        type: 'HOURS',
        schedule: { hour: 8, minute: 0 },
      },
    },
    steps: [
      buildAiAgentStep({
        id: '11111111-1111-4111-8111-111111111102',
        name: 'Find stale opportunities and propose follow-ups',
        prompt:
          'Find open opportunities with no activity (no note, task, or stage change) in the last 7 days. For each one, propose a task or a draft follow-up email with a concrete suggested next action, citing what you found. Keep the list short — do not process more than 20 opportunities in one run.',
      }),
    ],
  },
  {
    key: 'ACCOUNT_MONITORING',
    name: 'Weekly account monitoring',
    description:
      'Runs weekly. Reviews high-value accounts for material changes since the last review and proposes updates.',
    trigger: {
      name: 'Weekly',
      type: WorkflowTriggerType.CRON,
      settings: {
        outputSchema: {},
        type: 'DAYS',
        schedule: { day: 1, hour: 8, minute: 0 },
      },
    },
    steps: [
      buildAiAgentStep({
        id: '11111111-1111-4111-8111-111111111106',
        name: 'Check high-value accounts for changes',
        prompt:
          'Find companies flagged as high-value (or the top opportunities by amount, if no such flag exists). For each, check for material changes since your last note on the record — leadership changes, funding news, or CRM activity. Propose record updates for what changed and flag anything that looks risky. Skip accounts with no material change; do not write a no-op note.',
      }),
    ],
  },
];
