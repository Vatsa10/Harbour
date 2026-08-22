import { isNonEmptyArray } from '@sniptt/guards';
import { isDefined } from 'searm-shared/utils';
import { type InputSchemaProperty } from 'searm-shared/workflow';
import { type SelectOption } from 'searm-ui/input';

export const getWorkflowCodeFieldsEnumSelectOptions = (
  property: InputSchemaProperty | undefined,
): SelectOption[] => {
  if (!isDefined(property) || !isNonEmptyArray(property.enum)) {
    return [];
  }

  return property.enum.map((value) => ({
    value,
    label: value,
  }));
};
