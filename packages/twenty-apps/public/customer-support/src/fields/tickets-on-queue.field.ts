import { defineField, FieldType, RelationType } from 'twenty-sdk/define';

import {
  SUPPORT_QUEUE_OBJECT_UNIVERSAL_IDENTIFIER,
  SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  TICKET_QUEUE_FIELD_UNIVERSAL_IDENTIFIER,
  QUEUE_TICKETS_FIELD_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: QUEUE_TICKETS_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: SUPPORT_QUEUE_OBJECT_UNIVERSAL_IDENTIFIER,
  type: FieldType.RELATION,
  name: 'tickets',
  label: 'Tickets',
  icon: 'IconTicket',
  relationTargetObjectMetadataUniversalIdentifier:
    SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  relationTargetFieldMetadataUniversalIdentifier:
    TICKET_QUEUE_FIELD_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
