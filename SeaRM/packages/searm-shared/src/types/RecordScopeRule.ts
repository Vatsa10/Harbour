import { type RecordScopeNode } from './RecordScopeNode';

// The cache-facing projection of one recordScopeRule row. The entity carries
// more (timestamps, universalIdentifier); the hot path needs only this.
export type RecordScopeRule = {
  id: string;
  roleId: string;
  objectMetadataId: string;
  expression: RecordScopeNode;
};
