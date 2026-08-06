import { defineNavigationMenuItem } from 'twenty-sdk/define';
import { NavigationMenuItemType } from 'twenty-shared/types';

import {
  ALL_TICKETS_VIEW_UNIVERSAL_IDENTIFIER,
  SUPPORT_TICKETS_NAV_ITEM_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineNavigationMenuItem({
  universalIdentifier: SUPPORT_TICKETS_NAV_ITEM_UNIVERSAL_IDENTIFIER,
  name: 'support-tickets',
  icon: 'IconTicket',
  color: 'blue',
  position: 0,
  type: NavigationMenuItemType.VIEW,
  viewUniversalIdentifier: ALL_TICKETS_VIEW_UNIVERSAL_IDENTIFIER,
});
