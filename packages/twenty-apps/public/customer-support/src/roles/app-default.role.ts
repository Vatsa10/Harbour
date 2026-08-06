import { defineRole, SystemPermissionFlag } from 'twenty-sdk/define';

import { APP_DEFAULT_ROLE_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

export default defineRole({
  universalIdentifier: APP_DEFAULT_ROLE_UNIVERSAL_IDENTIFIER,
  label: 'Customer support app service role',
  description:
    "Used by this application's own install/upgrade/uninstall logic functions. Never assign to a human user.",
  canReadAllObjectRecords: true,
  canUpdateAllObjectRecords: true,
  canSoftDeleteAllObjectRecords: true,
  canDestroyAllObjectRecords: false,
  // Required to call installWorkflowDefinition from post-install (Task 9) —
  // that mutation is guarded by SettingsPermissionGuard(PermissionFlagType.WORKFLOWS).
  permissionFlagUniversalIdentifiers: [SystemPermissionFlag.WORKFLOWS],
});
