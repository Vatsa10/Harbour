import { isDefined } from 'searm-shared/utils';

export type RelationFieldChangeValue = {
  id: string | null;
};

export const isRelationFieldChangeValue = (
  value: unknown,
): value is RelationFieldChangeValue => {
  return (
    isDefined(value) &&
    typeof value === 'object' &&
    value !== null &&
    'id' in value
  );
};
