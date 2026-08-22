import { i18n, type MessageDescriptor } from '@lingui/core';
import { isString } from '@sniptt/guards';
import { type Nullable } from 'searm-shared/types';
import { isDefined } from 'searm-shared/utils';

export const getCommandMenuItemLabel = (
  label: Nullable<string | MessageDescriptor>,
): string => {
  if (!isDefined(label)) {
    return '';
  }

  return isString(label) ? label : i18n._(label);
};
