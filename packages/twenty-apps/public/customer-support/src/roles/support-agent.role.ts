import {
  defineRole,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

import {
  SUPPORT_AGENT_ROLE_UNIVERSAL_IDENTIFIER,
  SUPPORT_QUEUE_OBJECT_UNIVERSAL_IDENTIFIER,
  SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

// Scoped role assigned to human support reps and (Task 7) the AI triage
// agent. canBeAssignedToAgents:true is what makes it legal to bind to
// defineAgent's roleUniversalIdentifier — read-broad on the CRM records a
// ticket references, write access limited to tickets themselves. All actual
// writes by the AI still pass through the trust-layer proposal gate on top
// of what this role permits.
export default defineRole({
  universalIdentifier: SUPPORT_AGENT_ROLE_UNIVERSAL_IDENTIFIER,
  label: 'Support agent',
  description:
    'Assignable to human support reps and to the AI triage agent. Scoped to tickets and queues, read-only on the CRM records a ticket is about.',
  canReadAllObjectRecords: false,
  canUpdateAllObjectRecords: false,
  canSoftDeleteAllObjectRecords: false,
  canDestroyAllObjectRecords: false,
  canUpdateAllSettings: false,
  canBeAssignedToAgents: true,
  canBeAssignedToUsers: true,
  canBeAssignedToApiKeys: false,
  objectPermissions: [
    {
      objectUniversalIdentifier: SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
      canReadObjectRecords: true,
      canUpdateObjectRecords: true,
      canSoftDeleteObjectRecords: false,
      canDestroyObjectRecords: false,
    },
    {
      objectUniversalIdentifier: SUPPORT_QUEUE_OBJECT_UNIVERSAL_IDENTIFIER,
      canReadObjectRecords: true,
      canUpdateObjectRecords: false,
      canSoftDeleteObjectRecords: false,
      canDestroyObjectRecords: false,
    },
    {
      objectUniversalIdentifier:
        STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.company.universalIdentifier,
      canReadObjectRecords: true,
      canUpdateObjectRecords: false,
      canSoftDeleteObjectRecords: false,
      canDestroyObjectRecords: false,
    },
    {
      objectUniversalIdentifier:
        STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
      canReadObjectRecords: true,
      canUpdateObjectRecords: false,
      canSoftDeleteObjectRecords: false,
      canDestroyObjectRecords: false,
    },
  ],
});
