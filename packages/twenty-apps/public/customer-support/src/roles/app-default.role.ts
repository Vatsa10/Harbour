import {
  defineApplicationRole,
  SystemPermissionFlag,
} from 'twenty-sdk/define';

import {
  APP_DEFAULT_ROLE_UNIVERSAL_IDENTIFIER,
  SUPPORT_QUEUE_OBJECT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

// The application's own service role — the identity this app's install /
// upgrade / uninstall logic functions run as.
//
// Every grant below is backed by a call this app's own code makes, and
// nothing here is broader than that call needs. There are no
// canReadAllObjectRecords / canUpdateAllObjectRecords blanket grants: those
// were copied in from examples/hello-world once and removed, and the two
// logic functions still do not need them.
//
// What backs each grant (all added by Task 9, the commit that added the code):
//   - WORKFLOWS — installWorkflowDefinition, called by src/utils/
//     seed-workflow.util.ts from post-install, is guarded by
//     SettingsPermissionGuard(PermissionFlagType.WORKFLOWS)
//     (workflow-definition-install.resolver.ts).
//   - AI — findManyAgents, called by src/utils/find-agent-id-by-name.util.ts
//     to resolve the triage agent's row id, sits on AgentResolver, whose
//     class-level guard is SettingsPermissionGuard(PermissionFlagType.AI).
//     This is the read-side AI flag, not AI_SETTINGS: the app never creates or
//     edits an agent at runtime.
//   - supportQueue read + update — post-install's createSupportQueue seeds the
//     default "General Support" queue. Record creation is gated by the same
//     canUpdateObjectRecords bit as update; ObjectPermissionManifest exposes
//     no separate create flag. Scoped to this app's own object; no standard
//     CRM object is reachable by this role at all.
// Soft-delete and destroy stay false: nothing this app runs deletes a record.
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
  objectPermissions: [
    {
      objectUniversalIdentifier: SUPPORT_QUEUE_OBJECT_UNIVERSAL_IDENTIFIER,
      canReadObjectRecords: true,
      canUpdateObjectRecords: true,
      canSoftDeleteObjectRecords: false,
      canDestroyObjectRecords: false,
    },
  ],
  fieldPermissions: [],
  permissionFlagUniversalIdentifiers: [
    SystemPermissionFlag.WORKFLOWS,
    SystemPermissionFlag.AI,
  ],
});
