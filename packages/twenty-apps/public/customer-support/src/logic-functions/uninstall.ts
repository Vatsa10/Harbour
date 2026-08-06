import { defineUninstallLogicFunction } from 'twenty-sdk/define';
import { type UninstallPayload } from 'twenty-sdk/logic-function';

import { UNINSTALL_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

const handler = async (payload: UninstallPayload): Promise<void> => {
  // The framework tears down every object, field, view, role, agent, and
  // page layout this app owns after this hook returns — including the
  // supportTicket and supportQueue tables and all their records. This hook
  // exists to make that destructive step observable, not to perform it.
  console.log(
    'Uninstalling Customer Support — all tickets, queues, and their records will be removed. Company, Person, and WorkspaceMember records are untouched; only this app\'s relation fields on them are removed.',
    payload,
  );
};

export default defineUninstallLogicFunction({
  universalIdentifier: UNINSTALL_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'uninstall',
  description: 'Logs the scope of teardown before Customer Support is removed.',
  timeoutSeconds: 60,
  handler,
});
