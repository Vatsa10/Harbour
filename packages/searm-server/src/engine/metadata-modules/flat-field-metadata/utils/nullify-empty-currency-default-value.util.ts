import { type FieldMetadataDefaultValueForAnyType } from 'searm-shared/types';
import { isDefined } from 'searm-shared/utils';

import { isNullEquivalentTextDefaultValue } from './is-null-equivalent-text-default-value.util';

export const nullifyEmptyCurrencyDefaultValue = (
  defaultValue: FieldMetadataDefaultValueForAnyType,
): FieldMetadataDefaultValueForAnyType => {
  if (!isDefined(defaultValue)) {
    return null;
  }

  const v = defaultValue as {
    amountMicros?: number | null;
    currencyCode?: string | null;
  };

  const amountMicros = v.amountMicros ?? null;
  const currencyCode = isNullEquivalentTextDefaultValue(v.currencyCode)
    ? null
    : (v.currencyCode ?? null);

  if (amountMicros === null && currencyCode === null) {
    return null;
  }

  return { amountMicros, currencyCode };
};
