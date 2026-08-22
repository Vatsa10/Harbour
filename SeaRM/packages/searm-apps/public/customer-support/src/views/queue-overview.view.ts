import { defineView, ViewType } from 'searm-sdk/define';

import {
  QUEUE_NAME_FIELD_UNIVERSAL_IDENTIFIER,
  QUEUE_OVERVIEW_VIEW_NAME_FIELD_UNIVERSAL_IDENTIFIER,
  QUEUE_OVERVIEW_VIEW_SLA_FIELD_UNIVERSAL_IDENTIFIER,
  QUEUE_OVERVIEW_VIEW_UNIVERSAL_IDENTIFIER,
  QUEUE_SLA_FIRST_RESPONSE_MINUTES_FIELD_UNIVERSAL_IDENTIFIER,
  SUPPORT_QUEUE_OBJECT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineView({
  universalIdentifier: QUEUE_OVERVIEW_VIEW_UNIVERSAL_IDENTIFIER,
  name: 'Queues',
  objectUniversalIdentifier: SUPPORT_QUEUE_OBJECT_UNIVERSAL_IDENTIFIER,
  type: ViewType.TABLE,
  icon: 'IconInbox',
  position: 0,
  fields: [
    {
      universalIdentifier: QUEUE_OVERVIEW_VIEW_NAME_FIELD_UNIVERSAL_IDENTIFIER,
      fieldMetadataUniversalIdentifier: QUEUE_NAME_FIELD_UNIVERSAL_IDENTIFIER,
      position: 0,
      isVisible: true,
      size: 200,
    },
    {
      universalIdentifier: QUEUE_OVERVIEW_VIEW_SLA_FIELD_UNIVERSAL_IDENTIFIER,
      fieldMetadataUniversalIdentifier:
        QUEUE_SLA_FIRST_RESPONSE_MINUTES_FIELD_UNIVERSAL_IDENTIFIER,
      position: 1,
      isVisible: true,
      size: 140,
    },
  ],
});
