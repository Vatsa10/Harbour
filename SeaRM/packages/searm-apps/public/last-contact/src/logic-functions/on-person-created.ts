import {
  defineLogicFunction,
  type ObjectRecordCreateEvent,
} from 'searm-sdk/define';
import { type DatabaseEventPayload } from 'searm-sdk/logic-function';
import { CoreApiClient } from 'searm-client-sdk/core';

import { PERSON_CREATED_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { recomputeCompanyLastContact } from 'src/utils/recompute-company-last-contact';

type PersonCreate = { companyId?: string | null };

const handler = async (
  event: DatabaseEventPayload<ObjectRecordCreateEvent<PersonCreate>>,
): Promise<void> => {
  const companyId = event.properties.after.companyId;

  if (!companyId) {
    return;
  }

  const client = new CoreApiClient();

  await recomputeCompanyLastContact(client, companyId);
};

export default defineLogicFunction({
  universalIdentifier: PERSON_CREATED_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'on-person-created',
  description:
    "Recomputes the company's last contact when a person is created with a company.",
  timeoutSeconds: 60,
  databaseEventTriggerSettings: {
    eventName: 'person.created',
  },
  handler,
});
