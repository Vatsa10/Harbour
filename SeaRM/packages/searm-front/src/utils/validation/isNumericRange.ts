import { isDefined } from 'searm-shared/utils';

export const isNumericRange = (value: string): boolean => {
  return isDefined(value) && /^\d+(-\d+)?$/.test(value);
};
