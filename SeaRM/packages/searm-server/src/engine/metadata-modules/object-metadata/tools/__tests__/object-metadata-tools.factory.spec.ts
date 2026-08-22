import { Test, type TestingModule } from '@nestjs/testing';

import { WorkspaceManyOrAllFlatEntityMapsCacheService } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service';
import { ObjectMetadataService } from 'src/engine/metadata-modules/object-metadata/object-metadata.service';
import { ObjectMetadataToolsFactory } from 'src/engine/metadata-modules/object-metadata/tools/object-metadata-tools.factory';
import { PermissionsService } from 'src/engine/metadata-modules/permissions/permissions.service';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

// Real seam: getObjectsPermissionsFromRolePermissionConfig is NOT mocked in
// this spec. The factory calls the real util with the real cache payload
// shape, so a wrong argument shape or a wrong return-shape assumption fails
// here instead of type-checking against a stub.
const context = {
  workspaceId: 'workspace-1',
  roleId: 'role-1',
  rolePermissionConfig: { unionOf: ['role-1'] },
} as never;

const bypassContext = {
  workspaceId: 'workspace-1',
  roleId: 'role-1',
  rolePermissionConfig: { shouldBypassPermissionChecks: true },
} as never;

const scopedRolesPermissions = {
  rolesPermissions: {
    'role-1': {
      'object-person': {
        canReadObjectRecords: true,
        canUpdateObjectRecords: false,
        canSoftDeleteObjectRecords: false,
      },
    },
  },
};

describe('ObjectMetadataToolsFactory permittedOperations', () => {
  let factory: ObjectMetadataToolsFactory;

  const objectMetadataService = {
    findManyWithinWorkspace: jest.fn(),
  };
  const permissionsService = {
    checkRolesPermissions: jest.fn(),
  };
  const flatEntityMapsCacheService = {
    getOrRecomputeManyOrAllFlatEntityMaps: jest.fn(),
  };
  const workspaceCacheService = {
    getOrRecompute: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    objectMetadataService.findManyWithinWorkspace.mockResolvedValue([
      {
        id: 'object-person',
        nameSingular: 'person',
        namePlural: 'people',
        isSystem: false,
      },
      {
        id: 'object-secret',
        nameSingular: 'secret',
        namePlural: 'secrets',
        isSystem: false,
      },
    ]);
    flatEntityMapsCacheService.getOrRecomputeManyOrAllFlatEntityMaps.mockResolvedValue(
      { flatFieldMetadataMaps: { byUniversalIdentifier: {} } },
    );
    permissionsService.checkRolesPermissions.mockResolvedValue(false);
    workspaceCacheService.getOrRecompute.mockResolvedValue(
      scopedRolesPermissions,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ObjectMetadataToolsFactory,
        { provide: ObjectMetadataService, useValue: objectMetadataService },
        {
          provide: WorkspaceManyOrAllFlatEntityMapsCacheService,
          useValue: flatEntityMapsCacheService,
        },
        { provide: WorkspaceCacheService, useValue: workspaceCacheService },
        { provide: PermissionsService, useValue: permissionsService },
      ],
    }).compile();

    factory = module.get<ObjectMetadataToolsFactory>(
      ObjectMetadataToolsFactory,
    );
  });

  type DiscoveredObject = {
    nameSingular: string;
    permittedOperations?: { read: boolean; write: boolean; delete: boolean };
  };

  const discover = async (callerContext: never) =>
    (await factory
      .generateTools(callerContext)
      .get_object_metadata.execute?.(
        {},
        { toolCallId: 'test', messages: [] },
      )) as DiscoveredObject[];

  it('should annotate a returned object with the caller role permitted operations', async () => {
    const result = await discover(context);

    expect(result[0].permittedOperations).toEqual({
      read: true,
      write: false,
      delete: false,
    });
  });

  it('should omit an object the role cannot read', async () => {
    const result = await discover(context);

    expect(result.map((entry) => entry.nameSingular)).toEqual(['person']);
  });

  it('should return every object to a DATA_MODEL role even when it holds no object permissions', async () => {
    permissionsService.checkRolesPermissions.mockResolvedValue(true);
    workspaceCacheService.getOrRecompute.mockResolvedValue({
      rolesPermissions: { 'role-1': {} },
    });

    const result = await discover(context);

    expect(result.map((entry) => entry.nameSingular)).toEqual([
      'person',
      'secret',
    ]);
  });

  // The util returns {} for a bypass config, so without the short-circuit an
  // unrestricted caller would discover nothing.
  it('should return every object to a permission-bypassing caller', async () => {
    workspaceCacheService.getOrRecompute.mockResolvedValue({
      rolesPermissions: {},
    });

    const result = await discover(bypassContext);

    expect(result.map((entry) => entry.nameSingular)).toEqual([
      'person',
      'secret',
    ]);
    expect(result[0].permittedOperations).toEqual({
      read: true,
      write: true,
      delete: true,
    });
  });
});
