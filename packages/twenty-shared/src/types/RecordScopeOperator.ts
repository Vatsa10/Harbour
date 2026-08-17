export const RECORD_SCOPE_OPERATORS = [
  'eq',
  'neq',
  'in',
  'notIn',
  'isNull',
  'isNotNull',
] as const;

export type RecordScopeOperator = (typeof RECORD_SCOPE_OPERATORS)[number];
