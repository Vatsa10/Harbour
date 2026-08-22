import { NavigationMenuItemType } from 'searm-shared/types';
import { type NavigationMenuItem } from '~/generated-metadata/graphql';

export const isNavigationMenuItemFolder = (
  item: Pick<NavigationMenuItem, 'type'>,
) => item.type === NavigationMenuItemType.FOLDER;
