// Machine-readable failure shape every AI-facing tool call can surface, in
// addition to the legacy `error`/`message` strings on ToolOutput. An agent
// must be able to decide its next move — retry, ask a human, or give up —
// from `retryable` and `allowedActions` alone, without parsing English.
export type ToolFailureCode =
  | 'UNKNOWN_TOOL'
  | 'INVALID_ARGUMENTS'
  | 'NOT_FOUND'
  | 'FORBIDDEN_BY_POLICY'
  | 'PERMISSION_DENIED'
  | 'CONFIRMATION_REQUIRED'
  | 'DUPLICATE_PROPOSAL'
  | 'RATE_LIMITED'
  | 'UNSUPPORTED_OPERATION'
  | 'INTERNAL_ERROR';

// M2: `allowedActions` used to mix callable tool names with pseudo-actions,
// and an agent had no way to tell which entries it could actually invoke.
// The pseudo-actions are now an enumerated set: anything in allowedActions
// that is not one of these is a tool name the agent may call.
export const TOOL_FAILURE_PSEUDO_ACTIONS = [
  'retry',
  'retry_with_confirm_token',
  'ask_admin_to_change_policy',
] as const;

export type ToolFailurePseudoAction =
  (typeof TOOL_FAILURE_PSEUDO_ACTIONS)[number];

export const isToolFailurePseudoAction = (
  action: string,
): action is ToolFailurePseudoAction =>
  TOOL_FAILURE_PSEUDO_ACTIONS.some((candidate) => candidate === action);

// Either a pseudo-action from the set above or a callable tool name.
export type ToolFailureAction = ToolFailurePseudoAction | (string & {});

export type ToolFailure = {
  code: ToolFailureCode;
  message: string;
  // What the agent should do next, in plain language. Never empty: a failure an
  // agent cannot recover from is the defect this envelope exists to prevent.
  hint: string;
  // Whether re-issuing the identical call could succeed. A proposed or
  // forbidden write is never retryable — retrying duplicates work.
  retryable: boolean;
  // Concrete next moves: each entry is either a pseudo-action from
  // TOOL_FAILURE_PSEUDO_ACTIONS or the name of a tool the agent may call.
  // Use isToolFailurePseudoAction to tell them apart.
  allowedActions: ToolFailureAction[];
};
