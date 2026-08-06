import { AUTO_SELECT_SMART_MODEL_ID } from 'twenty-shared/constants';
import { type FlatAgent } from 'src/engine/metadata-modules/flat-agent/types/flat-agent.type';
import { type AllStandardAgentName } from 'src/engine/workspace-manager/twenty-standard-application/types/all-standard-agent-name.type';
import {
  type CreateStandardAgentArgs,
  createStandardAgentFlatMetadata,
} from 'src/engine/workspace-manager/twenty-standard-application/utils/agent-metadata/create-standard-agent-flat-metadata.util';

export const STANDARD_FLAT_AGENT_METADATA_BUILDERS_BY_AGENT_NAME = {
  helper: (args: Omit<CreateStandardAgentArgs, 'context'>) =>
    createStandardAgentFlatMetadata({
      ...args,
      context: {
        agentName: 'helper',
        name: 'helper',
        label: 'Helper',
        description:
          'AI agent specialized in helping users learn how to use Twenty CRM',
        icon: 'IconHelp',
        prompt: `You are a Helper Agent for Twenty. You answer questions about features, setup, and usage by searching the official documentation.

Core workflow:
1. Use search_help_center tool to find relevant documentation
2. If the first search doesn't yield complete results, try different search terms
3. Synthesize information from multiple articles when needed
4. Provide clear, step-by-step answers based on the documentation
5. Be honest if the docs don't cover the topic

When to search:
- "How to" questions
- Feature explanations
- Setup and configuration help
- Troubleshooting issues
- Best practices

Response format:
- Summarize key information from the documentation
- Break down complex topics into clear steps
- Include important notes or prerequisites
- Use markdown for readability

Always base answers on official Twenty documentation. Be patient and helpful.`,
        modelId: AUTO_SELECT_SMART_MODEL_ID,
        responseFormat: { type: 'text' },
        isCustom: false,
        modelConfiguration: {},
        evaluationInputs: [],
      },
    }),
  researcher: (args: Omit<CreateStandardAgentArgs, 'context'>) =>
    createStandardAgentFlatMetadata({
      ...args,
      context: {
        agentName: 'researcher',
        name: 'researcher',
        label: 'Researcher',
        description:
          'AI agent that researches CRM records and records what it observed as evidence before proposing any change',
        icon: 'IconSearch',
        prompt: `You research company and person records for this CRM.

For every field you intend to change, call record_evidence FIRST with the source and the value you observed. Only after recording evidence should you call the update tool for that record. Updates are never applied directly — they are queued for a human to approve, and the evidence you recorded is what that human reads to decide.

Never guess a value to fill a gap. If you find nothing verifiable, say so and stop.`,
        modelId: AUTO_SELECT_SMART_MODEL_ID,
        responseFormat: { type: 'text' },
        isCustom: false,
        modelConfiguration: {},
        evaluationInputs: [],
      },
    }),
} satisfies {
  [P in AllStandardAgentName]: (
    args: Omit<CreateStandardAgentArgs, 'context'>,
  ) => FlatAgent;
};
