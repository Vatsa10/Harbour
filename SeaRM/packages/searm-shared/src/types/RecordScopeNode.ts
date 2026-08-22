import { type RecordScopeOperator } from './RecordScopeOperator';
import { type RecordScopePrincipalAttribute } from './RecordScopePrincipalAttribute';

export type RecordScopeLiteral = string | number | boolean | null;

export type RecordScopeValue =
  | { source: 'literal'; value: RecordScopeLiteral }
  | { source: 'literalList'; values: RecordScopeLiteral[] }
  | { source: 'principal'; attribute: RecordScopePrincipalAttribute };

export type RecordScopeComparisonNode = {
  type: 'comparison';
  // Always a field of the object the rule is attached to. Enforced at write
  // time by the validator and again at compile time by column resolution.
  fieldMetadataId: string;
  operator: RecordScopeOperator;
  // Absent for isNull / isNotNull.
  value?: RecordScopeValue;
};

export type RecordScopeGroupNode = {
  type: 'group';
  operator: 'and' | 'or';
  children: RecordScopeNode[];
};

export type RecordScopeNotNode = {
  type: 'not';
  child: RecordScopeNode;
};

export type RecordScopeNode =
  | RecordScopeComparisonNode
  | RecordScopeGroupNode
  | RecordScopeNotNode;
