import { NavigationMenuItemType } from 'searm-shared/types';

export const hasNavigationMenuItemOwnColor = (item: { type?: string | null }) =>
  item.type === NavigationMenuItemType.FOLDER;
