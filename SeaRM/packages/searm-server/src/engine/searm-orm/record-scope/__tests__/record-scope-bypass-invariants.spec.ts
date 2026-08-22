import { type ObjectPermissions } from 'searm-shared/types';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { composeRecordScopes } from 'src/engine/searm-orm/record-scope/compose-record-scopes.util';
import { resolveRolePermissionConfig } from 'src/engine/searm-orm/utils/resolve-role-permission-config.util';

import { ownedByMe } from './record-scope-cases';

// This spec adds no production code. It pins the one property the whole
// feature rests on: bypass is reachable only from a context with no principal
// at all. A later refactor that widens it must go red here.
const workspace = { id: 'ws-1' } as WorkspaceAuthContext['workspace'];

const userWorkspaceRoleMap = { 'uw-1': 'role-1' };
const apiKeyRoleMap = { 'ak-1': 'role-1' };

const permissions = (
  recordScopeRules: ObjectPermissions['recordScopeRules'],
): ObjectPermissions => ({
  canReadObjectRecords: true,
  canUpdateObjectRecords: true,
  canSoftDeleteObjectRecords: true,
  canDestroyObjectRecords: true,
  restrictedFields: {},
  recordScopeRules,
  rowLevelPermissionPredicates: [],
  rowLevelPermissionPredicateGroups: [],
});

describe('record scope bypass invariants', () => {
  it.each([
    [
      'user',
      {
        type: 'user',
        workspace,
        userWorkspaceId: 'uw-1',
        user: { id: 'u-1' },
        workspaceMemberId: 'wm-1',
        workspaceMember: { id: 'wm-1' },
      },
    ],
    ['apiKey', { type: 'apiKey', workspace, apiKey: { id: 'ak-1' } }],
    [
      'application',
      { type: 'application', workspace, application: { id: 'app-1' } },
    ],
    [
      'pendingActivationUser',
      {
        type: 'pendingActivationUser',
        workspace,
        userWorkspaceId: 'uw-1',
        user: { id: 'u-1' },
      },
    ],
  ])(
    'should never produce a bypass config for a %s auth context',
    (_type, authContext) => {
      const config = resolveRolePermissionConfig({
        authContext: authContext as WorkspaceAuthContext,
        userWorkspaceRoleMap,
        apiKeyRoleMap,
      });

      expect(
        config === null || !('shouldBypassPermissionChecks' in config),
      ).toBe(true);
    },
  );

  it('should produce a bypass config only for a system auth context', () => {
    expect(
      resolveRolePermissionConfig({
        authContext: { type: 'system', workspace } as WorkspaceAuthContext,
        userWorkspaceRoleMap,
        apiKeyRoleMap,
      }),
    ).toEqual({ shouldBypassPermissionChecks: true });
  });

  it('should not bypass for a role that can read every object record', () => {
    // canReadObjectRecords is an object-level grant. It says nothing about
    // which rows, and must not be mistaken for a scope exemption: an admin
    // with a scoped role is still scoped.
    expect(
      composeRecordScopes({
        rolePermissionConfig: { unionOf: ['role-admin'] },
        rolesPermissions: {
          'role-admin': {
            'object-1': permissions([
              {
                id: 'r1',
                roleId: 'role-admin',
                objectMetadataId: 'object-1',
                expression: ownedByMe,
              },
            ]),
          },
        },
        objectMetadataId: 'object-1',
        principal: { workspaceMemberId: 'wm-1' },
      }),
    ).toEqual({ kind: 'expression', node: ownedByMe });
  });

  it('should give an api key nothing on an object whose role rules name a person', () => {
    // Documented consequence, not an accident: a workspace wanting broad api
    // key access gives the key a role with no scope rules.
    expect(
      composeRecordScopes({
        rolePermissionConfig: { unionOf: ['role-1'] },
        rolesPermissions: {
          'role-1': {
            'object-1': permissions([
              {
                id: 'r1',
                roleId: 'role-1',
                objectMetadataId: 'object-1',
                expression: ownedByMe,
              },
            ]),
          },
        },
        objectMetadataId: 'object-1',
        // An api key resolves to an empty principal.
        principal: {},
      }),
    ).toEqual({ kind: 'denyAll' });
  });
});
