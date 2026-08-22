// Name comparison must be explainable in one sentence ("same name, same company
// domain"), so normalization stays deterministic: case and whitespace only. No
// fuzzy distance, no nickname tables — a user looking at a merge prompt has to
// be able to see why two names were judged equal.
export const normalizePersonDisplayName = (
  displayName: string | null | undefined,
): string => {
  if (!displayName) {
    return '';
  }

  return displayName.trim().toLowerCase().replace(/\s+/g, ' ');
};
