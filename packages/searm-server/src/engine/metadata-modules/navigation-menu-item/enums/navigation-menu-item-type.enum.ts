import { registerEnumType } from '@nestjs/graphql';

import { NavigationMenuItemType } from 'searm-shared/types';

registerEnumType(NavigationMenuItemType, {
  name: 'NavigationMenuItemType',
});

export { NavigationMenuItemType };
