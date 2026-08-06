export const AI_WRITE_APPROVAL_POLICY_KEY = 'AI_WRITE_APPROVAL_POLICY';

export const AI_WRITE_MODES = ['AUTO', 'PROPOSE', 'FORBID'] as const;

export type AiWriteMode = (typeof AI_WRITE_MODES)[number];

export const isAiWriteMode = (value: unknown): value is AiWriteMode =>
  typeof value === 'string' &&
  (AI_WRITE_MODES as readonly string[]).includes(value);

// What a single gated call targets. Record writes resolve per field so the
// most specific override wins; static tools resolve on their tool id.
export type AiWritePolicyTarget =
  | { kind: 'record'; objectNameSingular: string; fieldNames: string[] }
  | { kind: 'tool'; toolId: string };

// One blob per workspace. Override keys are `<objectNameSingular>.<fieldName>`,
// `<objectNameSingular>`, or a static tool id such as `send_email`.
export type AiWritePolicy = {
  default: AiWriteMode;
  overrides: Record<string, AiWriteMode>;
};

export type AiWritePolicyKeyValueTypeMap = {
  [AI_WRITE_APPROVAL_POLICY_KEY]: AiWritePolicy;
};

// Default deny: everything an agent writes is proposed until an admin opts out.
export const DEFAULT_AI_WRITE_POLICY: AiWritePolicy = {
  default: 'PROPOSE',
  overrides: {},
};
