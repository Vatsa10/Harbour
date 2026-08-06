import {
  defineRole,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

import {
  SUPPORT_AGENT_ROLE_UNIVERSAL_IDENTIFIER,
  SUPPORT_QUEUE_OBJECT_UNIVERSAL_IDENTIFIER,
  SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  TICKET_ASSIGNEE_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_CHANNEL_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_COMPANY_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_DESCRIPTION_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_FIRST_RESPONDED_AT_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_QUEUE_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_REQUESTER_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_RESOLVED_AT_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_SLA_FIRST_RESPONSE_DUE_AT_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_SLA_RESOLUTION_DUE_AT_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_SUBJECT_FIELD_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

// The role bound to the AI triage agent via defineAgent's
// roleUniversalIdentifier. Read-broad, write-narrow.
//
// Agent-only on purpose (canBeAssignedToUsers: false). Human support reps use
// Twenty's own Member/Admin roles, which already reach every object; if this
// role were shared with humans the field restrictions below — which exist to
// bound the *agent* — would also stop a human from closing a ticket.
//
// Two independent controls, in order:
//
// 1. No direct write, structurally. Every CRUD tool call an agent makes is
//    routed through ProposalGateService before the tool layer runs
//    (tool-executor.service.ts dispatch()), and that gate is a denylist: only
//    find_many / find_one / group_by are ungated. So "canUpdateObjectRecords"
//    below does not mean the agent mutates a ticket; it means the agent may
//    emit a proposal that a human approves. Setting it to false would remove
//    the update tool from the agent's registry entirely and it could not even
//    propose. This is the grant the proposal flow requires, and no more.
//
// 2. Field-level denylist on supportTicket. Field permissions are restrictions
//    layered over the object permission (workspace-roles-permissions-cache
//    .service.ts builds restrictedFields only from listed entries), so every
//    field the agent may write is simply absent from the list below. Writable:
//    status, priority, aiTriageSummary — exactly the three the agent's prompt
//    claims. Everything else on the ticket, including the SLA timestamps and
//    resolvedAt, is canUpdateFieldValue: false. The skill's "never close a
//    ticket yourself" rule is no longer prompt-level only.
//    canReadFieldValue is left unset on every entry: read stays broad.
export default defineRole({
  universalIdentifier: SUPPORT_AGENT_ROLE_UNIVERSAL_IDENTIFIER,
  label: 'Support agent',
  description:
    'Bound to the AI triage agent. Reads tickets, queues, and the CRM records a ticket is about; may write only status, priority, and aiTriageSummary on a ticket, and only via the human-approval proposal gate.',
  canReadAllObjectRecords: false,
  canUpdateAllObjectRecords: false,
  canSoftDeleteAllObjectRecords: false,
  canDestroyAllObjectRecords: false,
  canUpdateAllSettings: false,
  canBeAssignedToAgents: true,
  canBeAssignedToUsers: false,
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
  fieldPermissions: [
    // Ticket content owned by the requester / the intake channel.
    TICKET_SUBJECT_FIELD_UNIVERSAL_IDENTIFIER,
    TICKET_DESCRIPTION_FIELD_UNIVERSAL_IDENTIFIER,
    TICKET_CHANNEL_FIELD_UNIVERSAL_IDENTIFIER,
    // SLA integrity — computed on intake and on human action, never by the AI.
    TICKET_SLA_FIRST_RESPONSE_DUE_AT_FIELD_UNIVERSAL_IDENTIFIER,
    TICKET_SLA_RESOLUTION_DUE_AT_FIELD_UNIVERSAL_IDENTIFIER,
    TICKET_FIRST_RESPONDED_AT_FIELD_UNIVERSAL_IDENTIFIER,
    TICKET_RESOLVED_AT_FIELD_UNIVERSAL_IDENTIFIER,
    // Routing and ownership — a human decides who owns a ticket.
    TICKET_QUEUE_FIELD_UNIVERSAL_IDENTIFIER,
    TICKET_ASSIGNEE_FIELD_UNIVERSAL_IDENTIFIER,
    TICKET_COMPANY_FIELD_UNIVERSAL_IDENTIFIER,
    TICKET_REQUESTER_FIELD_UNIVERSAL_IDENTIFIER,
  ].map((fieldUniversalIdentifier) => ({
    objectUniversalIdentifier: SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
    fieldUniversalIdentifier,
    canUpdateFieldValue: false,
  })),
});
