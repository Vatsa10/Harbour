import { type CoreApiClient } from 'searm-client-sdk/core';
import { type MetadataApiClient } from 'searm-client-sdk/metadata';

import { SUPPORT_TRIAGE_AGENT_NAME } from 'src/constants/agent-names';
import { NEW_TICKET_TRIAGE_STEP_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { findAgentIdByName } from 'src/utils/find-agent-id-by-name.util';
import {
  DEFAULT_STEP_ERROR_HANDLING_OPTIONS,
  seedWorkflow,
  WORKFLOW_ACTION_TYPE,
} from 'src/utils/seed-workflow.util';

// Fires on every newly created support ticket and hands it to the triage
// agent, which proposes a priority, a status and a summary. Every write the
// agent attempts is held by the proposal gate for human approval, so this
// workflow never silently changes a ticket.
export const seedNewTicketTriageWorkflow = async (
  metadataClient: MetadataApiClient,
  coreClient: CoreApiClient,
): Promise<void> => {
  const agentId = await findAgentIdByName(
    metadataClient,
    SUPPORT_TRIAGE_AGENT_NAME,
  );

  if (!agentId) {
    throw new Error(
      `Support triage agent ("${SUPPORT_TRIAGE_AGENT_NAME}") not found — cannot seed the new-ticket-triage workflow.`,
    );
  }

  await seedWorkflow(coreClient, {
    name: 'New ticket triage',
    description:
      'Runs when a support ticket is created. The triage agent proposes a priority, a status of TRIAGED, and a summary, all awaiting human approval.',
    trigger: {
      type: 'DATABASE_EVENT',
      // objectNameSingular of src/objects/support-ticket.object.ts.
      settings: { eventName: 'supportTicket.created', outputSchema: {} },
    },
    steps: [
      {
        id: NEW_TICKET_TRIAGE_STEP_UNIVERSAL_IDENTIFIER,
        type: WORKFLOW_ACTION_TYPE.AI_AGENT,
        name: 'Triage the ticket',
        settings: {
          outputSchema: {},
          errorHandlingOptions: DEFAULT_STEP_ERROR_HANDLING_OPTIONS,
          input: {
            agentId,
            prompt:
              'A new support ticket was just created: {{trigger.subject}} — {{trigger.description}}. Read it, its linked company and person, and propose a priority, a status of TRIAGED, and an aiTriageSummary.',
          },
        },
      },
    ],
  });
};
