import { capitalize } from 'searm-shared/utils';

export const getActivityTargetObjectFieldIdName = ({
  nameSingular,
}: {
  nameSingular: string;
}) => {
  return `target${capitalize(nameSingular)}Id`;
};
