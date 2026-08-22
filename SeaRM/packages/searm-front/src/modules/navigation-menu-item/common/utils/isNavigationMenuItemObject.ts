import { NavigationMenuItemType } from 'searm-shared/types';
import { type NavigationMenuItem } from '~/generated-metadata/graphql';

export const isNavigationMenuItemObject = (
  item: Pick<NavigationMenuItem, 'type'>,
) => item.type === NavigationMenuItemType.OBJECT;
