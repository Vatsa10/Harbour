import { capitalize } from 'searm-shared/utils';

export const getGroupByAggregateQueryName = ({
  objectMetadataNamePlural,
}: {
  objectMetadataNamePlural: string;
}) => {
  return `${capitalize(objectMetadataNamePlural)}GroupByAggregates`;
};
