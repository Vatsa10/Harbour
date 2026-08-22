// A brief that is too short is definitionally either empty or a restatement
// of a field the user can already see on the record, so the floor is not a
// style preference — it is what makes "write nothing" the honest outcome
// instead of a padded paragraph. The ceiling forces two or three sentences.
export const BRIEF_NARRATIVE_MIN_LENGTH = 40;
export const BRIEF_NARRATIVE_MAX_LENGTH = 400;

// Sparse by design: the panel is scanned, not read, and an unknown value is
// left blank rather than guessed.
export type BriefSections = Record<string, string>;

// Why nothing was written. Absence is a success state, so this is not an
// error — it is the explanation the surface shows instead of prose.
export type BriefRefusalReason =
  | 'NO_QUALIFYING_EVIDENCE'
  | 'NARRATIVE_BELOW_FLOOR';
