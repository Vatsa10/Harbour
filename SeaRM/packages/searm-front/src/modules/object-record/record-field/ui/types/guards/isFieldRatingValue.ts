import { RATING_VALUES } from 'searm-shared/constants';
import { type FieldRatingValue } from 'searm-shared/types';

export const isFieldRatingValue = (
  fieldValue: unknown,
): fieldValue is FieldRatingValue =>
  RATING_VALUES.includes(fieldValue as NonNullable<FieldRatingValue>);
