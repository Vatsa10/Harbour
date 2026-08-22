import { createHash } from 'crypto';

// Stateless and deterministic: no confirmation record is written or expired,
// the server just recomputes the hash and compares. `basis` is the record id
// for delete_one, or a stable stringified filter for delete_many.
// A plain JSON.stringify is key-order sensitive, so a model that reorders
// filter keys on the retry would loop forever against its own token. Sort
// object keys at every depth so the basis depends on the filter's meaning.
const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
};

// Returns null when the filter identifies nothing — absent, not an object, or
// empty. The gate refuses those rather than letting them skip confirmation.
export const buildDeleteFilterBasis = (filter: unknown): string | null => {
  if (
    filter === null ||
    typeof filter !== 'object' ||
    Object.keys(filter).length === 0
  ) {
    return null;
  }

  return JSON.stringify(canonicalize(filter));
};

export const buildDeleteConfirmationToken = (params: {
  workspaceId: string;
  objectNameSingular: string;
  basis: string;
}): string => {
  const { workspaceId, objectNameSingular, basis } = params;

  return createHash('sha256')
    .update(`ai-delete:${workspaceId}:${objectNameSingular}:${basis}`)
    .digest('hex')
    .slice(0, 10);
};
