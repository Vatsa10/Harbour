import { CAPTURE_ALL_VARIABLE_TAG_INNER_REGEX } from 'searm-shared/workflow';

export const removeVariablesFromJson = (json: string): string => {
  return json.replaceAll(CAPTURE_ALL_VARIABLE_TAG_INNER_REGEX, 'null');
};
