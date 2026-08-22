import { capitalize } from 'searm-shared/utils';

export const getMergeManyRecordsMutationResponseField = (
  objectNamePlural: string,
): string => {
  return `merge${capitalize(objectNamePlural)}`;
};
