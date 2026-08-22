import { isDefined } from 'searm-shared/utils';

export const getIsMetadataItemCustom = (
  metadataItem: { applicationId?: string | null },
  workspaceCustomApplicationId?: string | null,
) =>
  isDefined(metadataItem.applicationId) &&
  metadataItem.applicationId === workspaceCustomApplicationId;
