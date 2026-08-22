import { type FlatRole } from 'src/engine/metadata-modules/flat-role/types/flat-role.type';
import { type AllStandardRoleName } from 'src/engine/workspace-manager/searm-standard-application/types/all-standard-role-name.type';
import {
  type CreateStandardRoleArgs,
  createStandardRoleFlatMetadata,
} from 'src/engine/workspace-manager/searm-standard-application/utils/role-metadata/create-standard-role-flat-metadata.util';

export const STANDARD_FLAT_ROLE_METADATA_BUILDERS_BY_ROLE_NAME = {
  admin: (args: Omit<CreateStandardRoleArgs, 'context'>) =>
    createStandardRoleFlatMetadata({
      ...args,
      context: {
        roleName: 'admin',
        label: 'Admin',
        description: 'Admin role',
        icon: 'IconUserCog',
        isEditable: false,
        canUpdateAllSettings: true,
        canAccessAllTools: true,
        canReadAllObjectRecords: true,
        canUpdateAllObjectRecords: true,
        canSoftDeleteAllObjectRecords: true,
        canDestroyAllObjectRecords: true,
        canBeAssignedToUsers: true,
        canBeAssignedToAgents: false,
        canBeAssignedToApiKeys: true,
      },
    }),
  aiResearcher: (args: Omit<CreateStandardRoleArgs, 'context'>) =>
    createStandardRoleFlatMetadata({
      ...args,
      context: {
        roleName: 'aiResearcher',
        label: 'AI Researcher',
        description:
          'Read-broad role for the seeded research agent. Every record write it attempts is intercepted by the AI write gate and queued for human approval.',
        icon: 'IconRobot',
        // Editable so an admin can narrow it from Settings without a code
        // change. This is a product default, not a security boundary.
        isEditable: true,
        // No settings access and no destructive permissions. Update IS granted:
        // DatabaseToolProvider derives the whole write-tool descriptor block
        // from the role's object write permission, so a read-only role would
        // give the agent no write tool to trip the gate with and it could never
        // produce a proposal. ProposalGateService is what makes the write
        // non-direct, not the absence of the permission.
        canUpdateAllSettings: false,
        canAccessAllTools: true,
        canReadAllObjectRecords: true,
        canUpdateAllObjectRecords: true,
        canSoftDeleteAllObjectRecords: false,
        canDestroyAllObjectRecords: false,
        canBeAssignedToUsers: false,
        // The whole point. Every other shipped role sets this false, so
        // assignRoleToAgent would throw ROLE_CANNOT_BE_ASSIGNED_TO_AGENTS.
        canBeAssignedToAgents: true,
        canBeAssignedToApiKeys: false,
      },
    }),
} satisfies {
  [P in AllStandardRoleName]: (
    args: Omit<CreateStandardRoleArgs, 'context'>,
  ) => FlatRole;
};
