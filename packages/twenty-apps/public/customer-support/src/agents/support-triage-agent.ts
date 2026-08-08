import { defineAgent } from 'twenty-sdk/define';

import { SUPPORT_TRIAGE_AGENT_NAME } from 'src/constants/agent-names';
import {
  SUPPORT_AGENT_ROLE_UNIVERSAL_IDENTIFIER,
  SUPPORT_TRIAGE_AGENT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineAgent({
  universalIdentifier: SUPPORT_TRIAGE_AGENT_UNIVERSAL_IDENTIFIER,
  // Without this the manifest converter skips the role-target row and the
  // agent gets no registry tools at all (agent-async-executor.service.ts:
  // "No role means no registry tools"). See src/roles/support-agent.role.ts
  // for what it grants.
  roleUniversalIdentifier: SUPPORT_AGENT_ROLE_UNIVERSAL_IDENTIFIER,
  // Shared with the workflow seeders, which resolve this agent's row id by
  // name — see src/constants/agent-names.ts.
  name: SUPPORT_TRIAGE_AGENT_NAME,
  label: 'Support triage agent',
  description:
    'Reads a new support ticket and the CRM records it relates to, then proposes a priority, a status, and a triage summary. Never applies a change directly — every proposed change waits for human approval.',
  icon: 'IconRobot',
  responseFormat: { type: 'text' },
  prompt: `You triage customer support tickets. You can read the ticket, its
linked company and person, and existing queues. You can propose an update
to the ticket's status, priority, and aiTriageSummary fields. You cannot
read or write anything outside support tickets, queues, companies, and
people — if a task needs more than that, say so instead of guessing.
Every write you make is held for human approval before it changes anything;
do not describe a change as already applied.`,
});
