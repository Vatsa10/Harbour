// Which kind of ingested content an extraction run is reading. Kept as a
// two-member union rather than reusing EvidenceSourceType: that type is the
// provenance vocabulary for the whole evidence table and carries members
// (WEB_SEARCH, CRM_RECORD) this module can never produce.
export type ExtractionSourceKind = 'MESSAGE' | 'CALENDAR_EVENT';

// The fields structured extraction is allowed to propose. An allowlist, not a
// denylist: a model that invents "salary" or "ssn" must produce a claim this
// module silently drops, and a new extractable field must be a deliberate
// edit here rather than an emergent behaviour of a prompt change.
export const EXTRACTABLE_PERSON_FIELDS = ['jobTitle'] as const;

export type ExtractablePersonField = (typeof EXTRACTABLE_PERSON_FIELDS)[number];

// One thing the model claims it read. `snippet` is what makes the claim
// reviewable: a fact whose evidence has no quotable excerpt is unauditable,
// and "the model said so" is explicitly not evidence.
export type ExtractionClaim = {
  fieldName: ExtractablePersonField;
  value: string;
  snippet: string;
};

export type ExtractionRequest = {
  workspaceId: string;
  sourceKind: ExtractionSourceKind;
  sourceId: string;
};

// Why a run produced nothing, when it produced nothing. A bare null would
// make "the owner opted out" indistinguishable from "the model found
// nothing", and those need different answers from support.
export type ExtractionStatus =
  | 'PROPOSED'
  | 'EXCLUDED'
  | 'NO_CONTENT'
  | 'NO_SUBJECT'
  | 'NO_CLAIMS'
  | 'NO_MODEL';

export type ExtractionResult = {
  status: ExtractionStatus;
  proposalId: string | null;
  claimCount: number;
};
