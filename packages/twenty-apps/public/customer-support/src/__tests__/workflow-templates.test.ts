import { describe, expect, it, vi } from 'vitest';

import type { CoreApiClient } from 'twenty-client-sdk/core';
import type { MetadataApiClient } from 'twenty-client-sdk/metadata';

import supportTriageAgent from 'src/agents/support-triage-agent';
import { SUPPORT_TRIAGE_AGENT_NAME } from 'src/constants/agent-names';
import {
  NEW_TICKET_TRIAGE_STEP_UNIVERSAL_IDENTIFIER,
  SLA_RISK_SWEEP_STEP_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';
import { seedWorkflow } from 'src/utils/seed-workflow.util';
import { seedNewTicketTriageWorkflow } from 'src/workflow-templates/new-ticket-triage.workflow-template';
import { seedSlaRiskSweepWorkflow } from 'src/workflow-templates/sla-risk-sweep.workflow-template';

// These tests pin the wire shape this app sends to installWorkflowDefinition
// against the contract in
// packages/twenty-server/src/modules/workflow/workflow-templates/dtos/
// install-workflow-definition.input.ts. They do not touch a server; what they
// prove is that the payload matches the input DTO and that the agent's row id
// — not its universalIdentifier — is what lands in the step.

const AGENT_ROW_ID = 'c0ffee00-0000-4000-8000-000000000001';

const buildClients = (agents = [{ id: AGENT_ROW_ID, name: SUPPORT_TRIAGE_AGENT_NAME }]) => {
  const mutation = vi.fn().mockResolvedValue({
    installWorkflowDefinition: {
      workflowId: 'workflow-1',
      workflowVersionId: 'workflow-version-1',
    },
  });
  const query = vi.fn().mockResolvedValue({ findManyAgents: agents });

  return {
    mutation,
    query,
    coreClient: { mutation } as unknown as CoreApiClient,
    metadataClient: { query } as unknown as MetadataApiClient,
  };
};

const inputOf = (mutation: ReturnType<typeof vi.fn>) =>
  mutation.mock.calls[0][0].installWorkflowDefinition.__args.input;

describe('seedWorkflow', () => {
  it('sends exactly the fields InstallWorkflowDefinitionInput declares', async () => {
    const { mutation, coreClient } = buildClients();

    const result = await seedWorkflow(coreClient, {
      name: 'Some workflow',
      description: 'A description.',
      trigger: { type: 'MANUAL', settings: { outputSchema: {} } },
      steps: [{ type: 'AI_AGENT', name: 'Step', settings: {} }],
    });

    const input = inputOf(mutation);

    expect(Object.keys(input).sort()).toEqual([
      'activate',
      'description',
      'name',
      'steps',
      'trigger',
    ]);
    expect(input.activate).toBe(true);
    // BaseTrigger.name is required server-side and derived here.
    expect(input.trigger.name).toBe('Some workflow trigger');
    expect(result).toEqual({
      workflowId: 'workflow-1',
      workflowVersionId: 'workflow-version-1',
    });
  });

  it('selects workflowId and workflowVersionId off InstalledWorkflowTemplate', async () => {
    const { mutation, coreClient } = buildClients();

    await seedWorkflow(coreClient, {
      name: 'Some workflow',
      trigger: { type: 'MANUAL', settings: { outputSchema: {} } },
      steps: [],
    });

    const selection = mutation.mock.calls[0][0].installWorkflowDefinition;

    expect(selection.workflowId).toBe(true);
    expect(selection.workflowVersionId).toBe(true);
  });

  it('throws rather than returning a half-installed result', async () => {
    const mutation = vi.fn().mockResolvedValue({});
    const coreClient = { mutation } as unknown as CoreApiClient;

    await expect(
      seedWorkflow(coreClient, {
        name: 'Broken workflow',
        trigger: { type: 'MANUAL', settings: { outputSchema: {} } },
        steps: [],
      }),
    ).rejects.toThrow('Failed to install workflow "Broken workflow".');
  });
});

describe('new ticket triage template', () => {
  it('uses the agent row id from the lookup, not the manifest identifier', async () => {
    const { mutation, coreClient, metadataClient } = buildClients();

    await seedNewTicketTriageWorkflow(metadataClient, coreClient);

    const input = inputOf(mutation);

    expect(input.name).toBe('New ticket triage');
    expect(input.trigger.type).toBe('DATABASE_EVENT');
    expect(input.trigger.settings.eventName).toBe('supportTicket.created');
    expect(input.steps).toHaveLength(1);
    expect(input.steps[0].id).toBe(NEW_TICKET_TRIAGE_STEP_UNIVERSAL_IDENTIFIER);
    expect(input.steps[0].type).toBe('AI_AGENT');
    expect(input.steps[0].settings.input.agentId).toBe(AGENT_ROW_ID);
    expect(input.steps[0].settings.input.agentId).not.toBe(
      supportTriageAgent.config.universalIdentifier,
    );
  });

  it('fails loudly when the agent is missing instead of seeding an agentless step', async () => {
    const { coreClient, metadataClient, mutation } = buildClients([]);

    await expect(
      seedNewTicketTriageWorkflow(metadataClient, coreClient),
    ).rejects.toThrow(SUPPORT_TRIAGE_AGENT_NAME);
    expect(mutation).not.toHaveBeenCalled();
  });
});

describe('SLA risk sweep template', () => {
  it('installs a CRON-triggered single-step workflow', async () => {
    const { mutation, coreClient, metadataClient } = buildClients();

    await seedSlaRiskSweepWorkflow(metadataClient, coreClient);

    const input = inputOf(mutation);

    expect(input.name).toBe('SLA risk sweep');
    expect(input.trigger.type).toBe('CRON');
    expect(input.trigger.settings).toEqual({
      outputSchema: {},
      type: 'MINUTES',
      schedule: { minute: 15 },
    });
    expect(input.steps[0].id).toBe(SLA_RISK_SWEEP_STEP_UNIVERSAL_IDENTIFIER);
    expect(input.steps[0].settings.input.agentId).toBe(AGENT_ROW_ID);
  });

  it('looks the agent up by the same name the manifest declares', async () => {
    const { coreClient, metadataClient } = buildClients();

    await seedSlaRiskSweepWorkflow(metadataClient, coreClient);

    expect(supportTriageAgent.config.name).toBe(SUPPORT_TRIAGE_AGENT_NAME);
  });
});
