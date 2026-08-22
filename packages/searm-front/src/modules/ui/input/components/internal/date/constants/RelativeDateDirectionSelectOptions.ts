import { type RelativeDateFilterDirection } from 'searm-shared/utils';

type RelativeDateDirectionOption = {
  value: RelativeDateFilterDirection;
  label: string;
};

export const RELATIVE_DATE_DIRECTION_SELECT_OPTIONS: RelativeDateDirectionOption[] =
  [
    { value: 'PAST', label: 'Past' },
    { value: 'THIS', label: 'This' },
    { value: 'NEXT', label: 'Next' },
  ];
