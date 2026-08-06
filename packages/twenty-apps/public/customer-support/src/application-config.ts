import { defineApplication } from 'twenty-sdk/define';

import {
  APPLICATION_UNIVERSAL_IDENTIFIER,
  APP_DEFAULT_ROLE_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineApplication({
  universalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
  displayName: 'Customer Support',
  description:
    'Tickets, queues, SLAs, and AI triage for support teams — objects, views, roles, and workflows, installed without touching the CRM core.',
  author: 'Twenty',
  category: 'Support',
  defaultRoleUniversalIdentifier: APP_DEFAULT_ROLE_UNIVERSAL_IDENTIFIER,
});
