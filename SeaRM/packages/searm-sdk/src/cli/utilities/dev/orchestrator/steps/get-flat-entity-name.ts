import { type SyncAction } from 'searm-shared/metadata';

export const getFlatEntityName = (
  flatEntity: SyncAction['flatEntity'],
): string | null => {
  const universalIdentifier = flatEntity?.universalIdentifier;

  return (
    flatEntity?.name ??
    flatEntity?.nameSingular ??
    (typeof universalIdentifier === 'string' ? universalIdentifier : null)
  );
};
