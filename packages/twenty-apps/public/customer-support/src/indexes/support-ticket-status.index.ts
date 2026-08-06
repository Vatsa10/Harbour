import { defineIndex } from 'twenty-sdk/define';

import {
  SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  TICKET_STATUS_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_STATUS_INDEX_FIELD_UNIVERSAL_IDENTIFIER,
  TICKET_STATUS_INDEX_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineIndex({
  universalIdentifier: TICKET_STATUS_INDEX_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: SUPPORT_TICKET_OBJECT_UNIVERSAL_IDENTIFIER,
  fields: [
    {
      universalIdentifier: TICKET_STATUS_INDEX_FIELD_UNIVERSAL_IDENTIFIER,
      fieldUniversalIdentifier: TICKET_STATUS_FIELD_UNIVERSAL_IDENTIFIER,
    },
  ],
});
