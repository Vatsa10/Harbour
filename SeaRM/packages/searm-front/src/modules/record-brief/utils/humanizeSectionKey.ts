// Section keys come from the server's narratable-field table (`currentRole`,
// `previousRoles`, …). They are data, not UI copy, so they cannot go through
// Lingui; they are humanized instead of being shown raw.
export const humanizeSectionKey = (sectionKey: string): string => {
  const spaced = sectionKey
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();

  if (spaced.length === 0) {
    return sectionKey;
  }

  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};
