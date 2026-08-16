import { definePageLayout, PageLayoutTabLayoutMode } from 'twenty-sdk/define';

import {
  SUPPORT_OVERVIEW_KANBAN_WIDGET_UNIVERSAL_IDENTIFIER,
  SUPPORT_OVERVIEW_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
  SUPPORT_OVERVIEW_QUEUE_WIDGET_UNIVERSAL_IDENTIFIER,
  SUPPORT_OVERVIEW_TAB_UNIVERSAL_IDENTIFIER,
  SUPPORT_QUEUE_OBJECT_UNIVERSAL_IDENTIFIER,
  SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

// Dashboard-type layout: two RECORD_TABLE widgets render each object's records
// so support agents see tickets and queue breakdowns on one screen.
//
// Not `VIEW`. Task 10's brief specified `type: 'VIEW'`, and the manifest type
// accepts it (`type: string`), but a live install rejects it outright:
//   INVALID_PAGE_LAYOUT_WIDGET_DATA: Widget type VIEW is not supported yet.
// `VIEW` is hard-rejected for both creation and update by
// flat-page-layout-widget-type-validator.service.ts (`rejectWidgetType`).
// `RECORD_TABLE` is the supported widget for "show this object's records", and
// its configuration takes an optional `viewId` — a *view row id*, not a
// universalIdentifier, so an app manifest cannot supply it and the widget
// falls back to the object's default view. See the Task 11 report.
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
          type: 'RECORD_TABLE',
          objectUniversalIdentifier: SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
          configuration: { configurationType: 'RECORD_TABLE' },
          gridPosition: { row: 0, column: 0, rowSpan: 4, columnSpan: 8 },
        },
        {
          universalIdentifier:
            SUPPORT_OVERVIEW_QUEUE_WIDGET_UNIVERSAL_IDENTIFIER,
          title: 'Queues',
          type: 'RECORD_TABLE',
          objectUniversalIdentifier: SUPPORT_QUEUE_OBJECT_UNIVERSAL_IDENTIFIER,
          configuration: { configurationType: 'RECORD_TABLE' },
          gridPosition: { row: 4, column: 0, rowSpan: 3, columnSpan: 8 },
        },
      ],
    },
  ],
});
