import { type OrderBy } from 'searm-shared/types';
import { assertUnreachable } from 'searm-shared/utils';

export const turnOrderByIntoSort = (orderBy: OrderBy): 'asc' | 'desc' => {
  if (orderBy === 'AscNullsFirst' || orderBy === 'AscNullsLast') {
    return 'asc';
  } else if (orderBy === 'DescNullsFirst' || orderBy === 'DescNullsLast') {
    return 'desc';
  } else {
    assertUnreachable(orderBy);
  }
};
