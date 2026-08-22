import { type RecordScopeNode } from 'searm-shared/types';

// The single case table shared by the in-memory evaluator spec and the real
// Postgres parity spec. The two evaluators must agree on every row: a
// divergence here is exactly how a user writes a record they cannot then read.
export const FIELD_REGION = 'field-region';
export const FIELD_OWNER = 'field-owner';

export const COLUMN_NAMES_BY_FIELD_METADATA_ID = new Map<string, string[]>([
  [FIELD_REGION, ['region']],
  [FIELD_OWNER, ['ownerId']],
  // A composite field resolves to several columns and therefore has no single
  // truth value; rules naming it must be refused, not guessed at.
  ['field-linkedin-link', ['linkedinLinkPrimaryLinkUrl', 'linkedinLinkLabel']],
]);

export const PRINCIPAL = { workspaceMemberId: 'wm-1' };

export const eqEmea: RecordScopeNode = {
  type: 'comparison',
  fieldMetadataId: FIELD_REGION,
  operator: 'eq',
  value: { source: 'literal', value: 'EMEA' },
};

export const neqEmea: RecordScopeNode = {
  type: 'comparison',
  fieldMetadataId: FIELD_REGION,
  operator: 'neq',
  value: { source: 'literal', value: 'EMEA' },
};

export const inEmpty: RecordScopeNode = {
  type: 'comparison',
  fieldMetadataId: FIELD_REGION,
  operator: 'in',
  value: { source: 'literalList', values: [] },
};

export const notInEmpty: RecordScopeNode = {
  type: 'comparison',
  fieldMetadataId: FIELD_REGION,
  operator: 'notIn',
  value: { source: 'literalList', values: [] },
};

export const notInAmer: RecordScopeNode = {
  type: 'comparison',
  fieldMetadataId: FIELD_REGION,
  operator: 'notIn',
  value: { source: 'literalList', values: ['AMER'] },
};

export const inEmeaAmer: RecordScopeNode = {
  type: 'comparison',
  fieldMetadataId: FIELD_REGION,
  operator: 'in',
  value: { source: 'literalList', values: ['EMEA', 'AMER'] },
};

export const notEqEmea: RecordScopeNode = { type: 'not', child: eqEmea };

export const isNullRegion: RecordScopeNode = {
  type: 'comparison',
  fieldMetadataId: FIELD_REGION,
  operator: 'isNull',
};

export const isNotNullRegion: RecordScopeNode = {
  type: 'comparison',
  fieldMetadataId: FIELD_REGION,
  operator: 'isNotNull',
};

export const ownedByMe: RecordScopeNode = {
  type: 'comparison',
  fieldMetadataId: FIELD_OWNER,
  operator: 'eq',
  value: { source: 'principal', attribute: 'workspaceMemberId' },
};

export const orNode: RecordScopeNode = {
  type: 'group',
  operator: 'or',
  children: [eqEmea, ownedByMe],
};

export const andNode: RecordScopeNode = {
  type: 'group',
  operator: 'and',
  children: [eqEmea, ownedByMe],
};

export type RecordScopeCase = {
  name: string;
  node: RecordScopeNode;
  row: { region: string | null; ownerId: string | null };
  expected: boolean;
};

export const RECORD_SCOPE_CASES: RecordScopeCase[] = [
  { name: 'eq match', node: eqEmea, row: { region: 'EMEA', ownerId: null }, expected: true },
  { name: 'eq miss', node: eqEmea, row: { region: 'AMER', ownerId: null }, expected: false },
  { name: 'eq vs null', node: eqEmea, row: { region: null, ownerId: null }, expected: false },
  { name: 'neq match', node: neqEmea, row: { region: 'AMER', ownerId: null }, expected: true },
  { name: 'neq vs null', node: neqEmea, row: { region: null, ownerId: null }, expected: true },
  { name: 'in match', node: inEmeaAmer, row: { region: 'AMER', ownerId: null }, expected: true },
  { name: 'in vs null', node: inEmeaAmer, row: { region: null, ownerId: null }, expected: false },
  { name: 'in empty list', node: inEmpty, row: { region: 'EMEA', ownerId: null }, expected: false },
  { name: 'notIn empty', node: notInEmpty, row: { region: 'EMEA', ownerId: null }, expected: true },
  { name: 'notIn vs null', node: notInAmer, row: { region: null, ownerId: null }, expected: true },
  { name: 'notIn match', node: notInAmer, row: { region: 'AMER', ownerId: null }, expected: false },
  { name: 'not(eq) vs null', node: notEqEmea, row: { region: null, ownerId: null }, expected: true },
  { name: 'isNull', node: isNullRegion, row: { region: null, ownerId: null }, expected: true },
  { name: 'isNotNull', node: isNotNullRegion, row: { region: null, ownerId: null }, expected: false },
  { name: 'principal eq match', node: ownedByMe, row: { region: null, ownerId: 'wm-1' }, expected: true },
  { name: 'principal eq miss', node: ownedByMe, row: { region: null, ownerId: 'wm-2' }, expected: false },
  { name: 'or short', node: orNode, row: { region: 'AMER', ownerId: 'wm-1' }, expected: true },
  { name: 'and both', node: andNode, row: { region: 'AMER', ownerId: 'wm-1' }, expected: false },
  { name: 'and satisfied', node: andNode, row: { region: 'EMEA', ownerId: 'wm-1' }, expected: true },
];
