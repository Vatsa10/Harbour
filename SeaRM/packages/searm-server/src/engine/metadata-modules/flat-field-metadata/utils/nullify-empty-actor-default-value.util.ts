import { type FieldMetadataDefaultValueForAnyType } from 'searm-shared/types';
import { isDefined } from 'searm-shared/utils';

import { isNullEquivalentTextDefaultValue } from './is-null-equivalent-text-default-value.util';

export const nullifyEmptyActorDefaultValue = (
  defaultValue: FieldMetadataDefaultValueForAnyType,
): FieldMetadataDefaultValueForAnyType => {
  if (!isDefined(defaultValue)) {
    return null;
  }

  const v = defaultValue as {
    source?: string | null;
    workspaceMemberId?: string | null;
    name?: string | null;
    context?: object | null;
  };

  const source = v.source ?? null;
  const workspaceMemberId = v.workspaceMemberId ?? null;
  const name = isNullEquivalentTextDefaultValue(v.name)
    ? null
    : (v.name ?? null);
  const context = v.context ?? null;

  if (
    source === null &&
    workspaceMemberId === null &&
    name === null &&
    context === null
  ) {
    return null;
  }

  return { source, workspaceMemberId, name, context };
};
