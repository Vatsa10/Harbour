import { createHash } from 'crypto';

// Stateless and deterministic: no confirmation record is written or expired,
// the server just recomputes the hash and compares. `basis` is the record id
// for delete_one, or a stable stringified filter for delete_many.
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
