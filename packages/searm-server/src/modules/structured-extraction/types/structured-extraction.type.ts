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

// The Inbox and meeting intelligence narrative (PRODUCT-CHARTER.md) names four
// categories of fact worth extracting from inbound content: "commitments,
// risks, job changes, and next actions". Job changes land on the Person
// `jobTitle` field (a FIELD claim, below). The other three have no single CRM
// field to update — a commitment or a risk is prose, not a value — so they
// become NOTE claims: freeform, interpretive, and proposed as a new Note
// record rather than a field update.
export const NOTE_EXTRACTION_CATEGORIES = [
  'COMMITMENT',
  'RISK',
  'NEXT_ACTION',
] as const;

export type NoteExtractionCategory = (typeof NOTE_EXTRACTION_CATEGORIES)[number];

// One thing the model claims it read. `snippet` is what makes the claim
// reviewable: a fact whose evidence has no quotable excerpt is unauditable,
// and "the model said so" is explicitly not evidence.
//
// FIELD claims update a specific allow-listed Person field and are checked
// against the record's current value. NOTE claims are freeform prose
// (commitments, risks, next actions) with nowhere to diff against a current
// value, so every one that survives verbatim-snippet verification is proposed
// — there is no "restates the current value" case for prose.
export type FieldExtractionClaim = {
  kind: 'FIELD';
  fieldName: ExtractablePersonField;
  value: string;
  snippet: string;
};

export type NoteExtractionClaim = {
  kind: 'NOTE';
  category: NoteExtractionCategory;
  value: string;
  snippet: string;
};

export type ExtractionClaim = FieldExtractionClaim | NoteExtractionClaim;

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
