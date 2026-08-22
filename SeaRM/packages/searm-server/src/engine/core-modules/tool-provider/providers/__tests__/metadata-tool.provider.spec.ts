import { type ToolSet } from 'ai';

import { MetadataToolProvider } from 'src/engine/core-modules/tool-provider/providers/metadata-tool.provider';
import { type ToolProviderContext } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider-context.type';
import { type FieldMetadataToolsFactory } from 'src/engine/metadata-modules/field-metadata/tools/field-metadata-tools.factory';
import { type ObjectMetadataToolsFactory } from 'src/engine/metadata-modules/object-metadata/tools/object-metadata-tools.factory';
import { type PermissionsService } from 'src/engine/metadata-modules/permissions/permissions.service';
import { type WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

const workspaceId = 'workspace-id';
const objectMetadataId = 'object-metadata-id';

const makeTool = (name: string) =>
  ({
    description: name,
    execute: jest.fn().mockResolvedValue({ success: true, result: name }),
  }) as unknown as ToolSet[string];

const OBJECT_TOOL_NAMES = [
  'get_object_metadata',
  'create_object_metadata',
  'update_object_metadata',
  'delete_object_metadata',
  'create_many_object_metadata',
  'update_many_object_metadata',
];

const FIELD_TOOL_NAMES = [
  'get_field_metadata',
  'create_field_metadata',
  'update_field_metadata',
  'delete_field_metadata',
  'create_many_field_metadata',
  'update_many_field_metadata',
  'create_many_relation_fields',
];

const buildToolSet = (names: string[]): ToolSet =>
  Object.fromEntries(names.map((name) => [name, makeTool(name)]));

const buildProvider = ({ hasDataModel }: { hasDataModel: boolean }) => {
  const permissionsService = {
    checkRolesPermissions: jest.fn().mockResolvedValue(hasDataModel),
  } as unknown as PermissionsService;

  const workspaceCacheService = {
    getOrRecompute: jest.fn().mockResolvedValue({
      rolesPermissions: {
        'reader-role': {
          [objectMetadataId]: {
            canReadObjectRecords: true,
            canUpdateObjectRecords: false,
            canSoftDeleteObjectRecords: false,
            canDestroyObjectRecords: false,
            restrictedFields: {},
            rowLevelPermissionPredicates: [],
            rowLevelPermissionPredicateGroups: [],
          },
        },
      },
    }),
  } as unknown as WorkspaceCacheService;

  const provider = new MetadataToolProvider(
    {
      generateTools: () => buildToolSet(OBJECT_TOOL_NAMES),
    } as unknown as ObjectMetadataToolsFactory,
    {
      generateTools: () => buildToolSet(FIELD_TOOL_NAMES),
    } as unknown as FieldMetadataToolsFactory,
    permissionsService,
    workspaceCacheService,
  );

  const context = {
    workspaceId,
    rolePermissionConfig: { unionOf: ['reader-role'] },
  } as unknown as ToolProviderContext;

  return { provider, context };
};

describe('MetadataToolProvider data-model scoping', () => {
  it('exposes only the read tools to a record-scoped role without DATA_MODEL', async () => {
    const { provider, context } = buildProvider({ hasDataModel: false });

    const descriptors = await provider.generateDescriptors(context);

    expect(descriptors.map((descriptor) => descriptor.name).sort()).toEqual([
      'get_field_metadata',
      'get_object_metadata',
    ]);
  });

  it('refuses to execute a schema-mutation tool without DATA_MODEL', async () => {
    const { provider, context } = buildProvider({ hasDataModel: false });

    await expect(
      provider.executeStaticTool('delete_object_metadata', {}, context),
    ).rejects.toThrow('"delete_object_metadata" not found');
  });

  it('still exposes and executes the full toolset with DATA_MODEL', async () => {
    const { provider, context } = buildProvider({ hasDataModel: true });

    const descriptors = await provider.generateDescriptors(context);

    expect(descriptors).toHaveLength(
      OBJECT_TOOL_NAMES.length + FIELD_TOOL_NAMES.length,
    );

    await expect(
      provider.executeStaticTool('delete_object_metadata', {}, context),
    ).resolves.toEqual({ success: true, result: 'delete_object_metadata' });
  });

  it('keeps the provider available to a record-scoped role for discovery', async () => {
    const { provider, context } = buildProvider({ hasDataModel: false });

    await expect(provider.isAvailable(context)).resolves.toBe(true);
  });
});
