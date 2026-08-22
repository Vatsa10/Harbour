import { createRequire as __createRequire } from 'module';
const require = __createRequire(import.meta.url);

// src/logic-functions/post-install.ts
import { CoreApiClient } from "twenty-client-sdk/core";
import { MetadataApiClient } from "twenty-client-sdk/metadata";

// twenty-sdk-define-stub:__twenty-sdk-define-stub__
var __defineFactoryStub = (config) => ({
  success: true,
  config,
  errors: []
});
var __anyHandler = {
  get(_target, prop) {
    if (prop === "__esModule") return true;
    if (prop === Symbol.toPrimitive) return () => "";
    if (typeof prop === "symbol") return void 0;
    return new Proxy(() => void 0, __anyHandler);
  },
  apply() {
    return new Proxy(() => void 0, __anyHandler);
  }
};
var __anyStub = new Proxy(() => void 0, __anyHandler);
var definePostInstallLogicFunction = __defineFactoryStub;

// src/constants/universal-identifiers.ts
var POST_INSTALL_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER = "28557ec1-4c0b-43a8-9157-f7e7016c80d3";
var NEW_TICKET_TRIAGE_STEP_UNIVERSAL_IDENTIFIER = "4a6a0a29-6e8a-4b9a-9a9d-7d6a6b6e0a01";
var SLA_RISK_SWEEP_STEP_UNIVERSAL_IDENTIFIER = "4a6a0a29-6e8a-4b9a-9a9d-7d6a6b6e0a02";

// src/constants/agent-names.ts
var SUPPORT_TRIAGE_AGENT_NAME = "support-triage-agent";

// src/utils/find-agent-id-by-name.util.ts
var findAgentIdByName = async (metadataClient, agentName) => {
  const { findManyAgents } = await metadataClient.query({
    findManyAgents: {
      id: true,
      name: true
    }
  });
  return findManyAgents.find((agent) => agent.name === agentName)?.id;
};

// src/utils/seed-workflow.util.ts
var WORKFLOW_ACTION_TYPE = {
  AI_AGENT: "AI_AGENT"
};
var DEFAULT_STEP_ERROR_HANDLING_OPTIONS = {
  retryOnFailure: { value: false },
  continueOnFailure: { value: false }
};
var seedWorkflow = async (client, template) => {
  const result = await client.mutation({
    installWorkflowDefinition: {
      __args: {
        input: {
          name: template.name,
          description: template.description ?? null,
          trigger: {
            // BaseTrigger.name is required server-side and is not part of the
            // app-facing template shape — derive it.
            name: `${template.name} trigger`,
            type: template.trigger.type,
            settings: template.trigger.settings
          },
          steps: template.steps,
          activate: true
        }
      },
      workflowId: true,
      workflowVersionId: true
    }
  });
  const installed = result.installWorkflowDefinition;
  if (!installed?.workflowId || !installed?.workflowVersionId) {
    throw new Error(`Failed to install workflow "${template.name}".`);
  }
  return installed;
};

// src/workflow-templates/new-ticket-triage.workflow-template.ts
var seedNewTicketTriageWorkflow = async (metadataClient, coreClient) => {
  const agentId = await findAgentIdByName(
    metadataClient,
    SUPPORT_TRIAGE_AGENT_NAME
  );
  if (!agentId) {
    throw new Error(
      `Support triage agent ("${SUPPORT_TRIAGE_AGENT_NAME}") not found \u2014 cannot seed the new-ticket-triage workflow.`
    );
  }
  await seedWorkflow(coreClient, {
    name: "New ticket triage",
    description: "Runs when a support ticket is created. The triage agent proposes a priority, a status of TRIAGED, and a summary, all awaiting human approval.",
    trigger: {
      type: "DATABASE_EVENT",
      // objectNameSingular of src/objects/support-ticket.object.ts.
      settings: { eventName: "supportTicket.created", outputSchema: {} }
    },
    steps: [
      {
        id: NEW_TICKET_TRIAGE_STEP_UNIVERSAL_IDENTIFIER,
        type: WORKFLOW_ACTION_TYPE.AI_AGENT,
        name: "Triage the ticket",
        settings: {
          outputSchema: {},
          errorHandlingOptions: DEFAULT_STEP_ERROR_HANDLING_OPTIONS,
          input: {
            agentId,
            prompt: "A new support ticket was just created: {{trigger.subject}} \u2014 {{trigger.description}}. Read it, its linked company and person, and propose a priority, a status of TRIAGED, and an aiTriageSummary."
          }
        }
      }
    ]
  });
};

// src/workflow-templates/sla-risk-sweep.workflow-template.ts
var seedSlaRiskSweepWorkflow = async (metadataClient, coreClient) => {
  const agentId = await findAgentIdByName(
    metadataClient,
    SUPPORT_TRIAGE_AGENT_NAME
  );
  if (!agentId) {
    throw new Error(
      `Support triage agent ("${SUPPORT_TRIAGE_AGENT_NAME}") not found \u2014 cannot seed the SLA-risk-sweep workflow.`
    );
  }
  await seedWorkflow(coreClient, {
    name: "SLA risk sweep",
    description: "Runs every 15 minutes. The triage agent finds tickets at or past their SLA deadline and proposes an urgent escalation for each.",
    trigger: {
      type: "CRON",
      settings: { outputSchema: {}, type: "MINUTES", schedule: { minute: 15 } }
    },
    steps: [
      {
        id: SLA_RISK_SWEEP_STEP_UNIVERSAL_IDENTIFIER,
        type: WORKFLOW_ACTION_TYPE.AI_AGENT,
        name: "Assess SLA risk",
        settings: {
          outputSchema: {},
          errorHandlingOptions: DEFAULT_STEP_ERROR_HANDLING_OPTIONS,
          input: {
            agentId,
            prompt: "Find open support tickets (status not RESOLVED or CLOSED) whose slaResolutionDueAt has passed or is within 30 minutes. For each one, propose raising its priority to URGENT and add a note to aiTriageSummary explaining the SLA risk."
          }
        }
      }
    ]
  });
};

// src/logic-functions/post-install.ts
var handler = async (payload) => {
  const coreClient = new CoreApiClient();
  const metadataClient = new MetadataApiClient();
  if (payload.previousVersion) {
    console.log(
      "Upgrade detected, skipping queue seed.",
      payload.previousVersion
    );
  } else {
    const { createSupportQueue } = await coreClient.mutation({
      createSupportQueue: {
        __args: {
          data: {
            name: "General Support",
            description: "Default queue for new tickets.",
            slaFirstResponseMinutes: 60,
            slaResolutionMinutes: 1440,
            isDefault: true
          }
        },
        id: true,
        name: true
      }
    });
    if (!createSupportQueue?.id) {
      throw new Error("Failed to seed the default support queue.");
    }
    console.log(
      `Seeded default queue "${createSupportQueue.name}" (${createSupportQueue.id}).`
    );
  }
  await seedNewTicketTriageWorkflow(metadataClient, coreClient);
  await seedSlaRiskSweepWorkflow(metadataClient, coreClient);
};
var post_install_default = definePostInstallLogicFunction({
  universalIdentifier: POST_INSTALL_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: "post-install",
  description: "Seeds a default queue and the two workflow templates.",
  timeoutSeconds: 120,
  handler
});
export {
  post_install_default as default
};
//# sourceMappingURL=post-install.mjs.map
