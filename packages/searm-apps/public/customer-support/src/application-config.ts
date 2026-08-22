import { defineApplication } from 'searm-sdk/define';

import { APPLICATION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

// The default role is declared with defineApplicationRole() in
// src/roles/app-default.role.ts. defaultRoleUniversalIdentifier here is
// deprecated by the SDK and intentionally omitted.
export default defineApplication({
  universalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
  displayName: 'Customer Support',
  description:
    'Tickets, queues, SLAs, and AI triage for support teams — objects, views, roles, and workflows, installed without touching the CRM core.',
  author: 'SeaRM',
  // 'Support' is not in ApplicationCategory (see searm-shared
  // applicationCategoryType.ts). Adding it there is a core change and out of
  // bounds for this app, so we use the closest supported value; an arbitrary
  // string would build but match no UI category filter.
  category: 'Other',
});
