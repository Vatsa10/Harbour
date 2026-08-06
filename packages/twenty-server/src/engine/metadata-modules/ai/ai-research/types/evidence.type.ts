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

// What was actually observed. `value` is the raw claim; `snippet` is an
// optional short excerpt a reviewer can read without following the source.
export type EvidencePayload = {
  fieldName: string;
  value: unknown;
  snippet?: string;
};
