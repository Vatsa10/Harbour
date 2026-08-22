import { Injectable } from '@nestjs/common';

import { type ToolSet } from 'ai';
import { PermissionFlagType } from 'searm-shared/constants';

import { type GenerateDescriptorOptions } from 'src/engine/core-modules/tool-provider/interfaces/generate-descriptor-options.type';
import { type ToolProvider } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider.interface';
import { type ToolProviderContext } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider-context.type';

import { ToolCategory } from 'searm-shared/ai';
import { type ToolDescriptor } from 'src/engine/core-modules/tool-provider/types/tool-descriptor.type';
import { type ToolIndexEntry } from 'src/engine/core-modules/tool-provider/types/tool-index-entry.type';
import { executeToolFromToolSet } from 'src/engine/core-modules/tool-provider/utils/execute-tool-from-tool-set.util';
import { toolSetToDescriptors } from 'src/engine/core-modules/tool-provider/utils/tool-set-to-descriptors.util';
import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';
import { FieldMetadataToolsFactory } from 'src/engine/metadata-modules/field-metadata/tools/field-metadata-tools.factory';
import { ObjectMetadataToolsFactory } from 'src/engine/metadata-modules/object-metadata/tools/object-metadata-tools.factory';
import { PermissionsService } from 'src/engine/metadata-modules/permissions/permissions.service';
import { getObjectsPermissionsFromRolePermissionConfig } from 'src/engine/searm-orm/utils/get-objects-permissions-from-role-permission-config.util';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

// Everything else the two factories produce mutates the data model.
const READ_ONLY_METADATA_TOOL_NAMES = [
  'get_object_metadata',
  'get_field_metadata',
];

@Injectable()
export class MetadataToolProvider implements ToolProvider {
  readonly category = ToolCategory.METADATA;

  constructor(
    private readonly objectMetadataToolsFactory: ObjectMetadataToolsFactory,
    private readonly fieldMetadataToolsFactory: FieldMetadataToolsFactory,
    private readonly permissionsService: PermissionsService,
    private readonly workspaceCacheService: WorkspaceCacheService,
  ) {}

  private async hasDataModelPermission(
    context: ToolProviderContext,
  ): Promise<boolean> {
    // A bypass context needs no special case: checkRolesPermissions returns
    // true when role resolution yields null, so it short-circuits here.
    return this.permissionsService.checkRolesPermissions(
      context.rolePermissionConfig,
      context.workspaceId,
      PermissionFlagType.DATA_MODEL,
    );
  }

  async isAvailable(context: ToolProviderContext): Promise<boolean> {
    if (await this.hasDataModelPermission(context)) {
      return true;
    }

    // A record-scoped agent must be able to discover the schema of the objects
    // it can already read. Without DATA_MODEL the toolset is narrowed to the
    // two read tools by buildToolSet, so this widens discovery, not access.
    const { rolesPermissions } =
      await this.workspaceCacheService.getOrRecompute(context.workspaceId, [
        'rolesPermissions',
      ]);

    const objectPermissions = getObjectsPermissionsFromRolePermissionConfig({
      rolesPermissions,
      rolePermissionConfig: context.rolePermissionConfig,
    });

    // Object.values, not .some on the result — the util returns a Record keyed
    // by objectMetadataId, never an array.
    return Object.values(objectPermissions).some(
      (permission) => permission.canReadObjectRecords,
    );
  }

  async generateDescriptors(
    context: ToolProviderContext,
    options?: GenerateDescriptorOptions,
  ): Promise<(ToolIndexEntry | ToolDescriptor)[]> {
    const toolSet = await this.buildToolSet(context);

    return toolSetToDescriptors(toolSet, ToolCategory.METADATA, {
      includeSchemas: options?.includeSchemas ?? true,
      icon: 'IconSettings',
    });
  }

  async executeStaticTool(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolProviderContext,
  ): Promise<ToolOutput> {
    const toolSet = await this.buildToolSet(context);

    return executeToolFromToolSet(
      toolSet,
      toolName,
      args,
      ToolCategory.METADATA,
    );
  }

  // The schema-mutation tools call ObjectMetadataService / FieldMetadataService
  // with workspaceId alone; DATA_MODEL is enforced only at the GraphQL resolver
  // layer, which these tools bypass. So the permission has to be enforced here:
  // without DATA_MODEL a role sees the two read tools and nothing else, and
  // executeStaticTool throws for anything outside that set — including on the
  // approval path, which rebuilds the toolset as the approver.
  private async buildToolSet(context: ToolProviderContext): Promise<ToolSet> {
    const toolSet: ToolSet = {
      ...this.objectMetadataToolsFactory.generateTools(context),
      ...this.fieldMetadataToolsFactory.generateTools(context),
    };

    if (await this.hasDataModelPermission(context)) {
      return toolSet;
    }

    return Object.fromEntries(
      Object.entries(toolSet).filter(([toolName]) =>
        READ_ONLY_METADATA_TOOL_NAMES.includes(toolName),
      ),
    );
  }
}
