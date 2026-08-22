import {
  type CanActivate,
  type ExecutionContext,
  type Type,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  GraphQLSchemaBuilderModule,
  GraphQLSchemaFactory,
} from '@nestjs/graphql';

import { type GraphQLObjectType, type GraphQLSchema, printType } from 'graphql';
import { PermissionFlagType } from 'searm-shared/constants';
import { WorkspaceActivationStatus } from 'searm-shared/workspace';

import { RESOLVER_SCHEMA_SCOPE_KEY } from 'src/engine/api/graphql/graphql-config/constants/resolver-schema-scope-key.constant';
import { WorkflowDefinitionInstallResolver } from 'src/modules/workflow/workflow-templates/resolvers/workflow-definition-install.resolver';
import { WorkflowTemplateResolver } from 'src/modules/workflow/workflow-templates/resolvers/workflow-template.resolver';

// This spec is the Phase 5 contract check. Phase 5 calls
// installWorkflowDefinition through CoreApiClient against /graphql, and a
// metadata-scoped resolver is absent from that endpoint entirely — so the
// scope tag and the field signature are both load-bearing.
describe('installWorkflowDefinition contract', () => {
  let schema: GraphQLSchema;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [GraphQLSchemaBuilderModule],
    }).compile();

    const schemaFactory = module.get(GraphQLSchemaFactory);

    schema = await schemaFactory.create([
      WorkflowDefinitionInstallResolver,
      WorkflowTemplateResolver,
    ]);
  });

  it('should tag the install resolver with the core schema scope', () => {
    expect(
      Reflect.getMetadata(
        RESOLVER_SCHEMA_SCOPE_KEY,
        WorkflowDefinitionInstallResolver,
      ),
    ).toBe('core');
  });

  it('should keep the template resolver on the metadata schema scope', () => {
    expect(
      Reflect.getMetadata(RESOLVER_SCHEMA_SCOPE_KEY, WorkflowTemplateResolver),
    ).toBe('metadata');
  });

  it('should expose installWorkflowDefinition returning InstalledWorkflowTemplate', () => {
    const mutation = schema.getMutationType() as GraphQLObjectType;
    const field = mutation.getFields()['installWorkflowDefinition'];

    expect(field).toBeDefined();
    expect(String(field.type)).toBe('InstalledWorkflowTemplate!');
  });

  it('should accept the exact input shape Phase 5 sends', () => {
    const printed = printType(
      schema.getType('InstallWorkflowDefinitionInput') as GraphQLObjectType,
    );

    expect(printed).toContain('name: String!');
    expect(printed).toContain('description: String');
    expect(printed).toContain('trigger: JSON!');
    expect(printed).toContain('steps: JSON!');
    expect(printed).toContain('activate: Boolean! = true');
  });

  it('should return workflowId and workflowVersionId', () => {
    const printed = printType(
      schema.getType('InstalledWorkflowTemplate') as GraphQLObjectType,
    );

    expect(printed).toContain('workflowId: ID!');
    expect(printed).toContain('workflowVersionId: ID!');
  });

  // SettingsPermissionGuard is a mixin that closes over the flag, so the flag
  // is only observable by running the real guard and reading what it asks
  // PermissionsService for. C12: Phase 5's app role must declare WORKFLOWS.
  it('should guard the mutation on the WORKFLOWS permission flag', async () => {
    const guards: Type<CanActivate>[] =
      Reflect.getMetadata('__guards__', WorkflowDefinitionInstallResolver) ??
      [];

    const permissionsService = {
      userHasWorkspaceSettingPermission: jest.fn().mockResolvedValue(true),
    };

    const request = {
      workspace: {
        id: 'workspace-1',
        activationStatus: WorkspaceActivationStatus.ACTIVE,
      },
      userWorkspaceId: 'user-workspace-1',
    };
    const executionContext = {
      getType: () => 'graphql',
      getClass: () => WorkflowDefinitionInstallResolver,
      getHandler: () =>
        WorkflowDefinitionInstallResolver.prototype.installWorkflowDefinition,
      getArgs: () => [undefined, undefined, { req: request }, undefined],
      getArgByIndex: (index: number) =>
        index === 2 ? { req: request } : undefined,
    } as unknown as ExecutionContext;

    for (const Guard of guards) {
      const guard = new Guard(
        permissionsService as never,
      ) as unknown as CanActivate;

      try {
        await guard.canActivate(executionContext);
      } catch {
        // WorkspaceAuthGuard is also on the class and needs more context than
        // this harness gives it; only the settings guard is under test.
      }
    }

    expect(
      permissionsService.userHasWorkspaceSettingPermission,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ setting: PermissionFlagType.WORKFLOWS }),
    );
  });
});
