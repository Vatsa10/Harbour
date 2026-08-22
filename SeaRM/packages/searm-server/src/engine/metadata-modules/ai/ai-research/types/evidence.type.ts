export type EvidenceSourceType =
  | 'CRM_RECORD'
  | 'CRM_ACTIVITY'
  | 'WEB_SEARCH'
  | 'MANUAL'
  // Phase 3 ingestion/import sources. Declared here, in the one owning table,
  // so Phase 3 never invents a parallel provenance vocabulary.
  | 'EMAIL_MESSAGE'
  | 'CALL_RECORDING'
  | 'IMPORT_FILE';

export type EvidenceStrength = 'STRONG' | 'WEAK';

// WHO asserted the source type, which is a different question from what the
// source type is. `MODEL` means a language model typed the sourceType into a
// tool call; `SERVER` means our own code chose it from something it observed
// itself (an ingested message, a mapped import row, a record it read).
export type EvidenceAssertedBy = 'MODEL' | 'SERVER';

// Deterministic, server-assigned strength per source type — never reported by
// the model. Our own CRM data and human input are STRONG; anything fetched
// from outside the CRM, or inferred by a model from unstructured text, is WEAK
// until proven otherwise by a second source.
export const EVIDENCE_SOURCE_STRENGTH: Record<
  EvidenceSourceType,
  EvidenceStrength
> = {
  CRM_RECORD: 'STRONG',
  CRM_ACTIVITY: 'STRONG',
  MANUAL: 'STRONG',
  // A file a human uploaded and mapped is a direct human assertion.
  IMPORT_FILE: 'STRONG',
  WEB_SEARCH: 'WEAK',
  // The message/recording itself is first-party, but the *claim* is model-
  // inferred from prose, so it must never silently supersede a STRONG fact.
  EMAIL_MESSAGE: 'WEAK',
  CALL_RECORDING: 'WEAK',
};

// The strength table above answers "how good is this KIND of source". It is
// not, on its own, an answer to "how good is this observation", because the
// source type on a record_evidence tool call is a string the MODEL chose.
// Nothing verified that a CRM_RECORD observation came from a CRM record, so a
// model wanting a STRONG citation only had to type eight characters - and the
// approval UI then showed a human `STRONG - CRM_RECORD - <url>` beside the
// diff it justified. That is a confidence score with better typography, which
// is the exact thing the evidence contract exists to refuse.
//
// So strength is a function of the source type AND of who asserted it.
// Anything the model asserts is WEAK; STRONG is reserved for source types the
// server picked from something it observed itself. A model can still end up
// with a STRONG fact - by a second, server-observed corroboration - it just
// cannot declare one.
export const resolveEvidenceStrength = (params: {
  sourceType: EvidenceSourceType;
  assertedBy: EvidenceAssertedBy;
}): EvidenceStrength =>
  params.assertedBy === 'MODEL'
    ? 'WEAK'
    : EVIDENCE_SOURCE_STRENGTH[params.sourceType];

// What was actually observed. `value` is the raw claim; `snippet` is an
// optional short excerpt a reviewer can read without following the source.
export type EvidencePayload = {
  fieldName: string;
  value: unknown;
  snippet?: string;
};
