import { type CoreApiClient } from 'searm-client-sdk/core';
import { type MetadataApiClient } from 'searm-client-sdk/metadata';

import { SUPPORT_TRIAGE_AGENT_NAME } from 'src/constants/agent-names';
import { SLA_RISK_SWEEP_STEP_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { findAgentIdByName } from 'src/utils/find-agent-id-by-name.util';
import {
  DEFAULT_STEP_ERROR_HANDLING_OPTIONS,
  seedWorkflow,
  WORKFLOW_ACTION_TYPE,
} from 'src/utils/seed-workflow.util';

// A periodic sweep for tickets about to breach their SLA. Deliberately the
// same single AI_AGENT step as the triage workflow rather than a
// FIND_RECORDS / ITERATOR / UPDATE_RECORD chain: that chain's step settings
// were never verified against a resolver, and a deterministic bulk-escalation
// workflow is explicitly out of scope for this phase.
export const seedSlaRiskSweepWorkflow = async (
  metadataClient: MetadataApiClient,
  coreClient: CoreApiClient,
): Promise<void> => {
  const agentId = await findAgentIdByName(
    metadataClient,
    SUPPORT_TRIAGE_AGENT_NAME,
  );

  if (!agentId) {
    throw new Error(
      `Support triage agent ("${SUPPORT_TRIAGE_AGENT_NAME}") not found — cannot seed the SLA-risk-sweep workflow.`,
    );
  }

  await seedWorkflow(coreClient, {
    name: 'SLA risk sweep',
    description:
      'Runs every 15 minutes. The triage agent finds tickets at or past their SLA deadline and proposes an urgent escalation for each.',
    trigger: {
      type: 'CRON',
      settings: { outputSchema: {}, type: 'MINUTES', schedule: { minute: 15 } },
    },
    steps: [
      {
        id: SLA_RISK_SWEEP_STEP_UNIVERSAL_IDENTIFIER,
        type: WORKFLOW_ACTION_TYPE.AI_AGENT,
        name: 'Assess SLA risk',
        settings: {
          outputSchema: {},
          errorHandlingOptions: DEFAULT_STEP_ERROR_HANDLING_OPTIONS,
          input: {
            agentId,
            prompt:
              'Find open support tickets (status not RESOLVED or CLOSED) whose slaResolutionDueAt has passed or is within 30 minutes. For each one, propose raising its priority to URGENT and add a note to aiTriageSummary explaining the SLA risk.',
          },
        },
      },
    ],
  });
};
