import {
  defineField,
  FieldType,
  OnDeleteAction,
  RelationType,
} from 'searm-sdk/define';

import {
  SUPPORT_QUEUE_OBJECT_UNIVERSAL_IDENTIFIER,
  SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  TICKET_QUEUE_FIELD_UNIVERSAL_IDENTIFIER,
  QUEUE_TICKETS_FIELD_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: TICKET_QUEUE_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  type: FieldType.RELATION,
  name: 'queue',
  label: 'Queue',
  icon: 'IconInbox',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier:
    SUPPORT_QUEUE_OBJECT_UNIVERSAL_IDENTIFIER,
  relationTargetFieldMetadataUniversalIdentifier:
    QUEUE_TICKETS_FIELD_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.SET_NULL,
    joinColumnName: 'queueId',
  },
});
