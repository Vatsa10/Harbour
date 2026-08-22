// The closed set of request-time values a rule may compare against. Closed on
// purpose: anything open-ended here becomes an injection surface, and anything
// derived from client input becomes a privilege-escalation surface.
export const RECORD_SCOPE_PRINCIPAL_ATTRIBUTES = [
  'workspaceMemberId',
  'userWorkspaceId',
  'userId',
] as const;

export type RecordScopePrincipalAttribute =
  (typeof RECORD_SCOPE_PRINCIPAL_ATTRIBUTES)[number];
