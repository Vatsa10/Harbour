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

export type ToolFailure = {
  code: ToolFailureCode;
  message: string;
  // What the agent should do next, in plain language. Never empty: a failure an
  // agent cannot recover from is the defect this envelope exists to prevent.
  hint: string;
  // Whether re-issuing the identical call could succeed. A proposed or
  // forbidden write is never retryable — retrying duplicates work.
  retryable: boolean;
  // Concrete next moves, e.g. other tool names the agent may call instead.
  allowedActions: string[];
};
