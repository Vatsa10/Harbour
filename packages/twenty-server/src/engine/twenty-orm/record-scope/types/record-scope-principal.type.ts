import { type RecordScopePrincipalAttribute } from 'twenty-shared/types';

// Partial on purpose: an api key or an application carries none of these, and
// a rule that references a missing one must fail closed (see
// compile-record-scope.util.ts), not read the attribute as undefined.
export type RecordScopePrincipal = Partial<
  Record<RecordScopePrincipalAttribute, string>
>;
