import { type RecordGqlOperationFilter } from 'searm-shared/types';
import { isDefined } from 'searm-shared/utils';

export const makeOrFilterVariables = (
  filters: (RecordGqlOperationFilter | undefined)[],
): RecordGqlOperationFilter | undefined => {
  const definedFilters = filters.filter(isDefined);

  if (!definedFilters.length) return undefined;

  return definedFilters.length === 1
    ? definedFilters[0]
    : { or: definedFilters };
};
