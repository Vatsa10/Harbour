import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { resolveRecordScopePrincipal } from 'src/engine/twenty-orm/record-scope/resolve-record-scope-principal.util';

const workspace = { id: 'ws-1' } as WorkspaceAuthContext['workspace'];

describe('resolveRecordScopePrincipal', () => {
  it('should resolve all three attributes for a user context', () => {
    expect(
      resolveRecordScopePrincipal({
        type: 'user',
        workspace,
        userWorkspaceId: 'uw-1',
        user: { id: 'u-1' },
        workspaceMemberId: 'wm-1',
        workspaceMember: { id: 'wm-1' },
      } as WorkspaceAuthContext),
    ).toEqual({
      workspaceMemberId: 'wm-1',
      userWorkspaceId: 'uw-1',
      userId: 'u-1',
    });
  });

  it('should omit workspaceMemberId for a pending activation user', () => {
    const principal = resolveRecordScopePrincipal({
      type: 'pendingActivationUser',
      workspace,
      userWorkspaceId: 'uw-2',
      user: { id: 'u-2' },
    } as WorkspaceAuthContext);

    expect(principal.workspaceMemberId).toBeUndefined();
    expect(principal.userWorkspaceId).toBe('uw-2');
    expect(principal.userId).toBe('u-2');
  });

  it('should return an empty principal for an api key context', () => {
    expect(
      resolveRecordScopePrincipal({
        type: 'apiKey',
        workspace,
        apiKey: { id: 'ak-1' },
      } as WorkspaceAuthContext),
    ).toEqual({});
  });

  it('should return an empty principal for an application context', () => {
    expect(
      resolveRecordScopePrincipal({
        type: 'application',
        workspace,
        application: { id: 'app-1' },
      } as WorkspaceAuthContext),
    ).toEqual({});
  });

  it('should return an empty principal for a system context', () => {
    expect(
      resolveRecordScopePrincipal({
        type: 'system',
        workspace,
      } as WorkspaceAuthContext),
    ).toEqual({});
  });

  it('should return an empty principal when there is no auth context at all', () => {
    expect(resolveRecordScopePrincipal(undefined)).toEqual({});
  });
});
