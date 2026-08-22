import { isDefined } from 'searm-shared/utils';

export const isStepValue = (value: string): boolean => {
  return isDefined(value) && value.includes('/');
};
