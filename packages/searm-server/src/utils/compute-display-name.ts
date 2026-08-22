import { isDefined } from 'searm-shared/utils';
import { type FullNameMetadata } from 'searm-shared/types';

export const computeDisplayName = (
  name: FullNameMetadata | null | undefined,
) => {
  if (!name) {
    return '';
  }

  return Object.values(name).filter(isDefined).join(' ');
};
