import { defineApplicationRole } from 'twenty-sdk/define';

import { APP_DEFAULT_ROLE_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

// The application's own service role — the identity this app's install /
// upgrade / uninstall logic functions run as. It is deliberately empty.
//
// The app ships exactly one logic function (uninstall), and that handler only
// logs; it performs no record reads or writes and calls no settings-gated
// mutation. A role grants what its own code calls and nothing more, so there
// is nothing here to grant.
//
// Previously this role carried canReadAllObjectRecords / canUpdateAll /
// canSoftDeleteAll and SystemPermissionFlag.WORKFLOWS, copied from
// examples/hello-world. All of it backed code that does not exist.
//
// Task 9 (workflow templates + seed data, blocked on Phase 4 Task 10's
// installWorkflowDefinition) will need, in the same commit that lands it:
//   - SystemPermissionFlag.WORKFLOWS  — installWorkflowDefinition is guarded
//     by SettingsPermissionGuard(PermissionFlagType.WORKFLOWS)
//   - an objectPermissions entry on supportQueue with create/read, to seed
//     the default "General Support" queue from post-install
// Granting either before that code exists is an unbacked standing grant on
// every workspace that installs this app, so they are added with Task 9, not
// reserved here.
export default defineApplicationRole({
  universalIdentifier: APP_DEFAULT_ROLE_UNIVERSAL_IDENTIFIER,
  label: 'Customer support app service role',
  description:
    "Used by this application's own install/upgrade/uninstall logic functions. Never assign to a human user.",
  canReadAllObjectRecords: false,
  canUpdateAllObjectRecords: false,
  canSoftDeleteAllObjectRecords: false,
  canDestroyAllObjectRecords: false,
  canUpdateAllSettings: false,
  canBeAssignedToUsers: false,
  canBeAssignedToAgents: false,
  canBeAssignedToApiKeys: false,
  objectPermissions: [],
  fieldPermissions: [],
  permissionFlagUniversalIdentifiers: [],
});
