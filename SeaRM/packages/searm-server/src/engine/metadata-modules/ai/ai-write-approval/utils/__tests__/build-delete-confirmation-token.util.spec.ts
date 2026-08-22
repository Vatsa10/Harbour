import { buildDeleteConfirmationToken } from 'src/engine/metadata-modules/ai/ai-write-approval/utils/build-delete-confirmation-token.util';

describe('buildDeleteConfirmationToken', () => {
  it('should be deterministic for the same inputs', () => {
    const params = {
      workspaceId: 'workspace-1',
      objectNameSingular: 'person',
      basis: 'record-1',
    };

    expect(buildDeleteConfirmationToken(params)).toBe(
      buildDeleteConfirmationToken(params),
    );
  });

  it('should differ when the record id differs', () => {
    const tokenA = buildDeleteConfirmationToken({
      workspaceId: 'workspace-1',
      objectNameSingular: 'person',
      basis: 'record-1',
    });
    const tokenB = buildDeleteConfirmationToken({
      workspaceId: 'workspace-1',
      objectNameSingular: 'person',
      basis: 'record-2',
    });

    expect(tokenA).not.toBe(tokenB);
  });

  it('should differ across workspaces for the same record id', () => {
    const tokenA = buildDeleteConfirmationToken({
      workspaceId: 'workspace-1',
      objectNameSingular: 'person',
      basis: 'record-1',
    });
    const tokenB = buildDeleteConfirmationToken({
      workspaceId: 'workspace-2',
      objectNameSingular: 'person',
      basis: 'record-1',
    });

    expect(tokenA).not.toBe(tokenB);
  });

  // A token minted for one object must not authorise a delete on another:
  // record ids collide across objects far more easily than across workspaces.
  it('should differ across objects for the same record id', () => {
    const tokenA = buildDeleteConfirmationToken({
      workspaceId: 'workspace-1',
      objectNameSingular: 'person',
      basis: 'record-1',
    });
    const tokenB = buildDeleteConfirmationToken({
      workspaceId: 'workspace-1',
      objectNameSingular: 'company',
      basis: 'record-1',
    });

    expect(tokenA).not.toBe(tokenB);
  });
});
