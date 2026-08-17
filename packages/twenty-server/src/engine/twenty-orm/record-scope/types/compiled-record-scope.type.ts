import { type RecordScopeNode } from 'twenty-shared/types';

// A tagged result rather than `RecordScopeNode | null`, because "no rules" and
// "rules that can never match" are opposite answers and a nullable return
// makes them one keystroke apart at every call site.
export type CompiledRecordScope =
  | { kind: 'unrestricted' }
  | { kind: 'denyAll' }
  | { kind: 'expression'; node: RecordScopeNode };

export const RECORD_SCOPE_UNRESTRICTED: CompiledRecordScope = {
  kind: 'unrestricted',
};

export const RECORD_SCOPE_DENY_ALL: CompiledRecordScope = { kind: 'denyAll' };
