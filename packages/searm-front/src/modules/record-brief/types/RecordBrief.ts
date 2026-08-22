// Hand-written rather than generated. `codegen-metadata.cjs` reads the schema
// from a running server and rewrites `src/generated-metadata/graphql.ts`
// wholesale; neither is available here, and regenerating that shared file
// while another workstream edits the same branch would be the larger risk.
// The shapes below mirror `RecordBriefDTO` / `RecordBriefGenerationResultDTO`
// field for field.

// Sparse by design on the server: an unknown value is omitted, never guessed.
export type BriefSections = Record<string, string>;

export type RecordBrief = {
  __typename?: 'RecordBrief';
  id: string;
  objectNameSingular: string;
  recordId: string;
  narrative: string;
  sections: BriefSections;
  factIds: string[];
  oldestObservedAt: string;
  refreshedAt: string;
};

// Mirrors the server union: `NO_QUALIFYING_EVIDENCE` when nothing cleared the
// evidence gate, `NARRATIVE_BELOW_FLOOR` when what cleared it was too thin to
// be worth a sentence. Both are success states, not errors.
export type BriefRefusalReason =
  | 'NO_QUALIFYING_EVIDENCE'
  | 'NARRATIVE_BELOW_FLOOR';

export type RecordBriefQueryResult = {
  recordBrief: RecordBrief | null;
};

export type RecordBriefQueryVariables = {
  objectNameSingular: string;
  recordId: string;
};

export type GenerateRecordBriefMutationResult = {
  generateRecordBrief: {
    __typename?: 'RecordBriefGenerationResult';
    brief: RecordBrief | null;
    refusalReason: BriefRefusalReason | null;
  };
};
