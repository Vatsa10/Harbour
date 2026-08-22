import {
  defineLogicFunction,
  type ObjectRecordCreateEvent,
} from 'searm-sdk/define';
import { type DatabaseEventPayload } from 'searm-sdk/logic-function';
import { CoreApiClient } from 'searm-client-sdk/core';

import { COMPANY_CREATED_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { recomputeCompanyLastContact } from 'src/utils/recompute-company-last-contact';

type CompanyCreate = { id?: string | null };

const handler = async (
  event: DatabaseEventPayload<ObjectRecordCreateEvent<CompanyCreate>>,
): Promise<void> => {
  const companyId = event.properties.after.id ?? event.recordId;

  if (!companyId) {
    return;
  }

  const client = new CoreApiClient();

  await recomputeCompanyLastContact(client, companyId);
};

export default defineLogicFunction({
  universalIdentifier: COMPANY_CREATED_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'on-company-created',
  description:
    "Computes a company's last contact from its people when the company is created.",
  timeoutSeconds: 60,
  databaseEventTriggerSettings: {
    eventName: 'company.created',
  },
  handler,
});
