import { isDefined } from 'searm-shared/utils';
import { type CommandMenuItemFieldsFragment } from '~/generated-metadata/graphql';

export const doesCommandMenuItemMatchObjectMetadataId =
  (objectMetadataItemId: unknown) => (item: CommandMenuItemFieldsFragment) =>
    !isDefined(item.availabilityObjectMetadataId) ||
    item.availabilityObjectMetadataId === objectMetadataItemId;
