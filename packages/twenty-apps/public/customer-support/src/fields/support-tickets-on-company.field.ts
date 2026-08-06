// A relation pointer onto a standard object, not a business-data field —
// the same pattern last-contact ships today. No industry data lands on Company.
import {
  defineField,
  FieldType,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

import {
  SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  TICKET_COMPANY_FIELD_UNIVERSAL_IDENTIFIER,
  COMPANY_SUPPORT_TICKETS_FIELD_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: COMPANY_SUPPORT_TICKETS_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.company.universalIdentifier,
  type: FieldType.RELATION,
  name: 'supportTickets',
  label: 'Support tickets',
  icon: 'IconTicket',
  isNullable: true,
  isUIEditable: false,
  relationTargetObjectMetadataUniversalIdentifier:
    SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  relationTargetFieldMetadataUniversalIdentifier:
    TICKET_COMPANY_FIELD_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
