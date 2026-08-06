import { definePageLayout, PageLayoutTabLayoutMode } from 'twenty-sdk/define';

import {
  SUPPORT_OVERVIEW_KANBAN_WIDGET_UNIVERSAL_IDENTIFIER,
  SUPPORT_OVERVIEW_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
  SUPPORT_OVERVIEW_QUEUE_WIDGET_UNIVERSAL_IDENTIFIER,
  SUPPORT_OVERVIEW_TAB_UNIVERSAL_IDENTIFIER,
  SUPPORT_QUEUE_OBJECT_UNIVERSAL_IDENTIFIER,
  SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

// Dashboard-type layout: two VIEW widgets render each object's default view
// so support agents see ticket-by-status and queue breakdowns on one screen.
export default definePageLayout({
  universalIdentifier: SUPPORT_OVERVIEW_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
  name: 'Support overview',
  type: 'DASHBOARD',
  tabs: [
    {
      universalIdentifier: SUPPORT_OVERVIEW_TAB_UNIVERSAL_IDENTIFIER,
      title: 'Overview',
      position: 0,
      icon: 'IconTicket',
      layoutMode: PageLayoutTabLayoutMode.CANVAS,
      widgets: [
        {
          universalIdentifier:
            SUPPORT_OVERVIEW_KANBAN_WIDGET_UNIVERSAL_IDENTIFIER,
          title: 'Tickets by status',
          type: 'VIEW',
          objectUniversalIdentifier: SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
          configuration: { configurationType: 'VIEW' },
          gridPosition: { row: 0, column: 0, rowSpan: 4, columnSpan: 8 },
        },
        {
          universalIdentifier:
            SUPPORT_OVERVIEW_QUEUE_WIDGET_UNIVERSAL_IDENTIFIER,
          title: 'Queues',
          type: 'VIEW',
          objectUniversalIdentifier: SUPPORT_QUEUE_OBJECT_UNIVERSAL_IDENTIFIER,
          configuration: { configurationType: 'VIEW' },
          gridPosition: { row: 4, column: 0, rowSpan: 3, columnSpan: 8 },
        },
      ],
    },
  ],
});
