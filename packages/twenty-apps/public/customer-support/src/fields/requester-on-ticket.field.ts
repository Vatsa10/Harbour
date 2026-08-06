import {
  defineField,
  FieldType,
  OnDeleteAction,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

import {
  SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  TICKET_REQUESTER_FIELD_UNIVERSAL_IDENTIFIER,
  PERSON_SUPPORT_TICKETS_FIELD_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: TICKET_REQUESTER_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  type: FieldType.RELATION,
  name: 'requester',
  label: 'Requested by',
  icon: 'IconUser',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  relationTargetFieldMetadataUniversalIdentifier:
    PERSON_SUPPORT_TICKETS_FIELD_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.SET_NULL,
    joinColumnName: 'requesterId',
  },
});
