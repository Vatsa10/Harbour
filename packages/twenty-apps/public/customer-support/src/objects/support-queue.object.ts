import { defineObject, FieldType } from 'twenty-sdk/define';

import {
  QUEUE_DESCRIPTION_FIELD_UNIVERSAL_IDENTIFIER,
  QUEUE_IS_DEFAULT_FIELD_UNIVERSAL_IDENTIFIER,
  QUEUE_NAME_FIELD_UNIVERSAL_IDENTIFIER,
  QUEUE_SLA_FIRST_RESPONSE_MINUTES_FIELD_UNIVERSAL_IDENTIFIER,
  QUEUE_SLA_RESOLUTION_MINUTES_FIELD_UNIVERSAL_IDENTIFIER,
  SUPPORT_QUEUE_OBJECT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineObject({
  universalIdentifier: SUPPORT_QUEUE_OBJECT_UNIVERSAL_IDENTIFIER,
  nameSingular: 'supportQueue',
  namePlural: 'supportQueues',
  labelSingular: 'Support queue',
  labelPlural: 'Support queues',
  description: 'A routing bucket for support tickets with its own SLA targets.',
  icon: 'IconInbox',
  labelIdentifierFieldMetadataUniversalIdentifier:
    QUEUE_NAME_FIELD_UNIVERSAL_IDENTIFIER,
  fields: [
    {
      universalIdentifier: QUEUE_NAME_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.TEXT,
      name: 'name',
      label: 'Name',
      description: 'Queue name, e.g. "Tier 1" or "Billing"',
      icon: 'IconAbc',
    },
    {
      universalIdentifier: QUEUE_DESCRIPTION_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.TEXT,
      name: 'description',
      label: 'Description',
      icon: 'IconFileDescription',
      isNullable: true,
      defaultValue: null,
    },
    {
      universalIdentifier:
        QUEUE_SLA_FIRST_RESPONSE_MINUTES_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.NUMBER,
      name: 'slaFirstResponseMinutes',
      label: 'SLA: first response (minutes)',
      description: 'Minutes from ticket creation to a required first response.',
      icon: 'IconClockHour3',
      defaultValue: 60,
    },
    {
      universalIdentifier:
        QUEUE_SLA_RESOLUTION_MINUTES_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.NUMBER,
      name: 'slaResolutionMinutes',
      label: 'SLA: resolution (minutes)',
      description: 'Minutes from ticket creation to a required resolution.',
      icon: 'IconClockHour9',
      defaultValue: 1440,
    },
    {
      universalIdentifier: QUEUE_IS_DEFAULT_FIELD_UNIVERSAL_IDENTIFIER,
      type: FieldType.BOOLEAN,
      name: 'isDefault',
      label: 'Default queue',
      description: 'New tickets with no queue specified route here.',
      icon: 'IconStar',
      defaultValue: false,
    },
  ],
});
