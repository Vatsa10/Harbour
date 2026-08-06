import { defineView, ViewType } from 'twenty-sdk/define';

import {
  SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  TICKET_PRIORITY_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_STATUS_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_SUBJECT_FIELD_UNIVERSAL_IDENTIFIER,
  TICKETS_BY_STATUS_VIEW_PRIORITY_FIELD_UNIVERSAL_IDENTIFIER,
  TICKETS_BY_STATUS_VIEW_SUBJECT_FIELD_UNIVERSAL_IDENTIFIER,
  TICKETS_BY_STATUS_VIEW_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineView({
  universalIdentifier: TICKETS_BY_STATUS_VIEW_UNIVERSAL_IDENTIFIER,
  name: 'Tickets by status',
  objectUniversalIdentifier: SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  type: ViewType.KANBAN,
  icon: 'IconLayoutKanban',
  position: 1,
  mainGroupByFieldMetadataUniversalIdentifier:
    TICKET_STATUS_FIELD_UNIVERSAL_IDENTIFIER,
  fields: [
    {
      universalIdentifier:
        TICKETS_BY_STATUS_VIEW_SUBJECT_FIELD_UNIVERSAL_IDENTIFIER,
      fieldMetadataUniversalIdentifier:
        TICKET_SUBJECT_FIELD_UNIVERSAL_IDENTIFIER,
      position: 0,
      isVisible: true,
      size: 250,
    },
    {
      universalIdentifier:
        TICKETS_BY_STATUS_VIEW_PRIORITY_FIELD_UNIVERSAL_IDENTIFIER,
      fieldMetadataUniversalIdentifier:
        TICKET_PRIORITY_FIELD_UNIVERSAL_IDENTIFIER,
      position: 1,
      isVisible: true,
      size: 120,
    },
  ],
});
