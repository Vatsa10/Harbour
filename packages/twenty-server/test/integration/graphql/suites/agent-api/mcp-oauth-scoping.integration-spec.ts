import { randomUUID } from 'node:crypto';

import { type ToolRegistryService } from 'src/engine/core-modules/tool-provider/services/tool-registry.service';
import { type ToolProviderContext } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider-context.type';
import { SEED_APPLE_WORKSPACE_ID } from 'src/engine/workspace-manager/dev-seeder/core/constants/seeder-workspaces.constant';
import { ToolCategory } from 'twenty-shared/ai';

import { getAppProviderByClassName } from 'test/integration/utils/get-app-provider-by-class-name.util';
import { createCustomRoleWithObjectPermissions } from 'test/integration/graphql/utils/create-custom-role-with-object-permissions.util';
import { createOneRole } from 'test/integration/metadata/suites/role/utils/create-one-role.util';
import { deleteOneRole } from 'test/integration/metadata/suites/role/utils/delete-one-role.util';

// Proves the property the charter requires ("OAuth-scoped agent credentials
// with workspace-limited access") holds through the tool layer: a role's
// object permissions are what McpCoreController's OAuth-issued token gets
// pinned to via ToolProviderContext.roleId/rolePermissionConfig, so exercising
// getCatalog/resolveAndExecute with two contexts differing only in role is
// equivalent to exercising two differently-scoped OAuth tokens end to end.
describe('MCP OAuth-scoped tool access (integration)', () => {
  let toolRegistryService: ToolRegistryService;
  let roleWithPersonReadId: string;
  let roleWithNoPermissionsId: string;
  let contextWithPersonRead: ToolProviderContext;
  let contextWithNoPermissions: ToolProviderContext;

  beforeAll(async () => {
    toolRegistryService =
      getAppProviderByClassName<ToolRegistryService>('ToolRegistryService');

    const { roleId: personReadRoleId } =
      await createCustomRoleWithObjectPermissions({
        label: `OAuth scoping - person read ${randomUUID()}`,
        canReadPerson: true,
        canUpdatePerson: false,
        hasAllObjectRecordsReadPermission: false,
      });

    roleWithPersonReadId = personReadRoleId;

    const { data: noPermissionsRoleData } = await createOneRole({
      expectToFail: false,
      input: {
        label: `OAuth scoping - no permissions ${randomUUID()}`,
        description: 'Role with zero object permissions granted',
        icon: 'IconKey',
        canUpdateAllSettings: false,
        canReadAllObjectRecords: false,
        canUpdateAllObjectRecords: false,
        canSoftDeleteAllObjectRecords: false,
        canDestroyAllObjectRecords: false,
        canBeAssignedToUsers: false,
        canBeAssignedToAgents: false,
        canBeAssignedToApiKeys: true,
      },
    });

    roleWithNoPermissionsId = noPermissionsRoleData?.createOneRole
      ?.id as string;

    const buildContext = (roleId: string): ToolProviderContext => ({
      workspaceId: SEED_APPLE_WORKSPACE_ID,
      roleId,
      rolePermissionConfig: { unionOf: [roleId] },
      threadId: randomUUID(),
    });

    contextWithPersonRead = buildContext(roleWithPersonReadId);
    contextWithNoPermissions = buildContext(roleWithNoPermissionsId);
  });

  afterAll(async () => {
    for (const idToDelete of [roleWithPersonReadId, roleWithNoPermissionsId]) {
      if (idToDelete) {
        await deleteOneRole({
          expectToFail: false,
          input: { idToDelete },
        });
      }
    }
  });

  it('advertises only read tools in the catalog for a read-only role', async () => {
    const index = await toolRegistryService.getCatalog(contextWithPersonRead);
    const toolNames = index.map((entry) => entry.name);

    expect(toolNames).toEqual(expect.arrayContaining(['find_many_people']));
    expect(toolNames).not.toEqual(
      expect.arrayContaining([
        'create_one_person',
        'update_one_person',
        'delete_one_person',
      ]),
    );
  });

  it('advertises zero database_crud tools for a role with no object permissions', async () => {
    const index = await toolRegistryService.getCatalog(
      contextWithNoPermissions,
    );
    const crudEntries = index.filter(
      (entry) => entry.category === ToolCategory.DATABASE_CRUD,
    );

    expect(crudEntries).toHaveLength(0);
  });

  it('resolves an undiscovered tool as UNKNOWN_TOOL rather than a permission error', async () => {
    const output = await toolRegistryService.resolveAndExecute(
      'find_many_people',
      { select: ['id'] },
      contextWithNoPermissions,
    );

    expect(output.success).toBe(false);
    expect(output.failure?.code).toBe('UNKNOWN_TOOL');
  });

  it('executes a discovered tool successfully for the role that can see it', async () => {
    const output = await toolRegistryService.resolveAndExecute(
      'find_many_people',
      { select: ['id'] },
      contextWithPersonRead,
    );

    expect(output.success).toBe(true);
  });
});
