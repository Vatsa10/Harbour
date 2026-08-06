import { defineView, ViewType } from 'twenty-sdk/define';

import {
  ALL_TICKETS_VIEW_PRIORITY_FIELD_UNIVERSAL_IDENTIFIER,
  ALL_TICKETS_VIEW_SLA_FIELD_UNIVERSAL_IDENTIFIER,
  ALL_TICKETS_VIEW_SUBJECT_FIELD_UNIVERSAL_IDENTIFIER,
  ALL_TICKETS_VIEW_UNIVERSAL_IDENTIFIER,
  SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  TICKET_PRIORITY_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_SLA_RESOLUTION_DUE_AT_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_SUBJECT_FIELD_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineView({
  universalIdentifier: ALL_TICKETS_VIEW_UNIVERSAL_IDENTIFIER,
  name: 'All tickets',
  objectUniversalIdentifier: SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  type: ViewType.TABLE,
  icon: 'IconTicket',
  position: 0,
  fields: [
    {
      universalIdentifier: ALL_TICKETS_VIEW_SUBJECT_FIELD_UNIVERSAL_IDENTIFIER,
      fieldMetadataUniversalIdentifier:
        TICKET_SUBJECT_FIELD_UNIVERSAL_IDENTIFIER,
      position: 0,
      isVisible: true,
      size: 250,
    },
    {
      universalIdentifier: ALL_TICKETS_VIEW_PRIORITY_FIELD_UNIVERSAL_IDENTIFIER,
      fieldMetadataUniversalIdentifier:
        TICKET_PRIORITY_FIELD_UNIVERSAL_IDENTIFIER,
      position: 1,
      isVisible: true,
      size: 120,
    },
    {
      universalIdentifier: ALL_TICKETS_VIEW_SLA_FIELD_UNIVERSAL_IDENTIFIER,
      fieldMetadataUniversalIdentifier:
        TICKET_SLA_RESOLUTION_DUE_AT_FIELD_UNIVERSAL_IDENTIFIER,
      position: 2,
      isVisible: true,
      size: 180,
    },
  ],
});
