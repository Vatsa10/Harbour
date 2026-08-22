import { CoreApiClient } from 'searm-client-sdk/core';
import { MetadataApiClient } from 'searm-client-sdk/metadata';
import { definePostInstallLogicFunction } from 'searm-sdk/define';
import { type InstallPayload } from 'searm-sdk/logic-function';

import { POST_INSTALL_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { seedNewTicketTriageWorkflow } from 'src/workflow-templates/new-ticket-triage.workflow-template';
import { seedSlaRiskSweepWorkflow } from 'src/workflow-templates/sla-risk-sweep.workflow-template';

const handler = async (payload: InstallPayload): Promise<void> => {
  // createSupportQueue and installWorkflowDefinition (called inside the two
  // seeders below) are both core-schema operations — one CoreApiClient serves
  // all three. installWorkflowDefinition is on the core schema because
  // WorkflowDefinitionInstallResolver is @CoreResolver()-decorated.
  const coreClient = new CoreApiClient();
  // Needed only by the seeders' agent lookup: AgentResolver is
  // @MetadataResolver()-scoped, so it is absent from the core endpoint.
  const metadataClient = new MetadataApiClient();

  // Fresh install only — an upgrade re-runs post-install, and creating a
  // second default queue on every upgrade would be a bug, not a feature.
  // The workflow seeds below need no such guard: installWorkflowDefinition is
  // idempotent by workflow name server-side.
  if (payload.previousVersion) {
    console.log(
      'Upgrade detected, skipping queue seed.',
      payload.previousVersion,
    );
  } else {
    const { createSupportQueue } = await coreClient.mutation({
      createSupportQueue: {
        __args: {
          data: {
            name: 'General Support',
            description: 'Default queue for new tickets.',
            slaFirstResponseMinutes: 60,
            slaResolutionMinutes: 1440,
            isDefault: true,
          },
        },
        id: true,
        name: true,
      },
    });

    if (!createSupportQueue?.id) {
      throw new Error('Failed to seed the default support queue.');
    }

    console.log(
      `Seeded default queue "${createSupportQueue.name}" (${createSupportQueue.id}).`,
    );
  }

  await seedNewTicketTriageWorkflow(metadataClient, coreClient);
  await seedSlaRiskSweepWorkflow(metadataClient, coreClient);
};

export default definePostInstallLogicFunction({
  universalIdentifier: POST_INSTALL_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'post-install',
  description: 'Seeds a default queue and the two workflow templates.',
  timeoutSeconds: 120,
  handler,
});
