import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { ToolCategory } from 'twenty-shared/ai';

import { type ToolExecutorService } from 'src/engine/core-modules/tool-provider/services/tool-executor.service';
import { type ToolRegistryService } from 'src/engine/core-modules/tool-provider/services/tool-registry.service';
import { type ToolProviderContext } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider-context.type';
import { type ToolExecutionRef } from 'src/engine/core-modules/tool-provider/types/tool-execution-ref.type';
import { type ToolContext } from 'src/engine/core-modules/tool-provider/types/tool-context.type';
import { type UserRoleService } from 'src/engine/metadata-modules/user-role/user-role.service';
import { getWorkspaceSchemaName } from 'src/engine/workspace-datasource/utils/get-workspace-schema-name.util';
import { SEED_APPLE_WORKSPACE_ID } from 'src/engine/workspace-manager/dev-seeder/core/constants/seeder-workspaces.constant';
import { type WorkflowTemplateService } from 'src/modules/workflow/workflow-templates/services/workflow-template.service';
import { WorkflowTriggerType } from 'src/modules/workflow/workflow-trigger/types/workflow-trigger.type';
import { WorkflowActionType } from 'twenty-shared/workflow';

import { createCustomRoleWithObjectPermissions } from 'test/integration/graphql/utils/create-custom-role-with-object-permissions.util';
import { deleteOneRole } from 'test/integration/metadata/suites/role/utils/delete-one-role.util';
import { getAppProviderByClassName } from 'test/integration/utils/get-app-provider-by-class-name.util';

type CrudOperation = Extract<
  ToolExecutionRef,
  { kind: 'database_crud' }
>['operation'];

const client = request(`http://localhost:${APP_PORT}`);

const WORKSPACE_SCHEMA = getWorkspaceSchemaName(SEED_APPLE_WORKSPACE_ID);

const UPDATE_AI_WRITE_POLICY = `
  mutation UpdateAiWritePolicy($input: UpdateAiWritePolicyInput!) {
    updateAiWritePolicy(input: $input) { default overrides }
  }
`;

const post = (
  path: '/graphql' | '/metadata',
  query: string,
  variables: Record<string, unknown> = {},
) =>
  client
    .post(path)
    .set('Authorization', `Bearer ${APPLE_JANE_ADMIN_ACCESS_TOKEN}`)
    .send({ query, variables });

const setPolicy = async (input: {
  default: string;
  overrides: Record<string, string>;
}) => {
  const response = await post('/metadata', UPDATE_AI_WRITE_POLICY, { input });

  expect(response.body.errors).toBeUndefined();
};

const createPerson = async (jobTitle: string): Promise<string> => {
  const id = randomUUID();
  const response = await post(
    '/graphql',
    `
      mutation CreateOnePerson($input: PersonCreateInput!) {
        createPerson(data: $input) { id }
      }
    `,
    { input: { id, jobTitle } },
  );

  expect(response.body.errors).toBeUndefined();

  return response.body.data.createPerson.id;
};

// Read straight from the workspace schema rather than through the GraphQL
// person query: the API filters soft-deleted rows out by default, which would
// make "still there" and "deleted" indistinguishable.
const readPersonDeletedAt = async (
  personId: string,
): Promise<string | null | undefined> => {
  const rows = await global.testDataSource.query(
    `SELECT "deletedAt" FROM ${WORKSPACE_SCHEMA}."person" WHERE id = $1`,
    [personId],
  );

  return rows[0]?.deletedAt;
};

const countProposalItemsForThread = async (
  threadId: string,
): Promise<number> => {
  const rows = await global.testDataSource.query(
    `SELECT count(*)::int AS count
     FROM core."proposalItem" pi
     JOIN core."proposal" p ON p.id = pi."proposalId"
     WHERE p."threadId" = $1 AND p."workspaceId" = $2`,
    [threadId, SEED_APPLE_WORKSPACE_ID],
  );

  return rows[0].count;
};

const findProposalItemsForThread = async (
  threadId: string,
): Promise<
  { id: string; toolId: string | null; toolCategory: string | null }[]
> =>
  global.testDataSource.query(
    `SELECT pi.id, pi."toolId", pi."toolCategory"
     FROM core."proposalItem" pi
     JOIN core."proposal" p ON p.id = pi."proposalId"
     WHERE p."threadId" = $1 AND p."workspaceId" = $2`,
    [threadId, SEED_APPLE_WORKSPACE_ID],
  );

describe('agent API semantics (e2e)', () => {
  let toolExecutorService: ToolExecutorService;
  let toolRegistryService: ToolRegistryService;
  let workflowTemplateService: WorkflowTemplateService;
  let adminRoleId: string;
  let adminUserId: string;
  let adminUserWorkspaceId: string;
  let context: ToolProviderContext;

  beforeAll(async () => {
    toolExecutorService = getAppProviderByClassName<ToolExecutorService>(
      'ToolExecutorService',
    );
    toolRegistryService = getAppProviderByClassName<ToolRegistryService>(
      'ToolRegistryService',
    );
    workflowTemplateService =
      getAppProviderByClassName<WorkflowTemplateService>(
        'WorkflowTemplateService',
      );

    const userRoleService =
      getAppProviderByClassName<UserRoleService>('UserRoleService');

    const [adminUserWorkspace] = await global.testDataSource.query(
      `SELECT uw.id AS "userWorkspaceId", u.id AS "userId"
       FROM core."userWorkspace" uw
       JOIN core."user" u ON u.id = uw."userId"
       WHERE uw."workspaceId" = $1 AND u.email = $2`,
      [SEED_APPLE_WORKSPACE_ID, 'jane.austen@apple.dev'],
    );

    adminUserId = adminUserWorkspace.userId;
    adminUserWorkspaceId = adminUserWorkspace.userWorkspaceId;

    adminRoleId = await userRoleService.getRoleIdForUserWorkspace({
      userWorkspaceId: adminUserWorkspaceId,
      workspaceId: SEED_APPLE_WORKSPACE_ID,
    });
  });

  beforeEach(() => {
    context = {
      workspaceId: SEED_APPLE_WORKSPACE_ID,
      roleId: adminRoleId,
      rolePermissionConfig: { shouldBypassPermissionChecks: true },
      userId: adminUserId,
      userWorkspaceId: adminUserWorkspaceId,
      // Fresh thread per test so proposals never merge across tests.
      threadId: randomUUID(),
    };
  });

  const dispatchCrud = (
    operation: CrudOperation,
    args: Record<string, unknown>,
    objectNameSingular = 'person',
  ) =>
    toolExecutorService.dispatch(
      {
        name: `${operation}_${objectNameSingular}`,
        label: operation,
        description: '',
        category: ToolCategory.DATABASE_CRUD,
        executionRef: {
          kind: 'database_crud',
          objectNameSingular,
          operation,
        },
      },
      args,
      context,
    );

  describe('idempotency of retried writes', () => {
    it('returns the same proposalItemId and writes one row for an identical retried update', async () => {
      await setPolicy({ default: 'PROPOSE', overrides: {} });

      const personId = await createPerson('Sales Rep');
      const args = { id: personId, jobTitle: 'Head of Sales' };

      const first = await dispatchCrud('update_one', args);
      const second = await dispatchCrud('update_one', args);

      const firstResult = first.result as { proposalItemId: string };
      const secondResult = second.result as { proposalItemId: string };

      expect(firstResult.proposalItemId).toBeDefined();
      expect(secondResult.proposalItemId).toBe(firstResult.proposalItemId);
      expect(
        await countProposalItemsForThread(context.threadId as string),
      ).toBe(1);
    });
  });

  describe('confirmation tokens for AUTO-policy deletes', () => {
    it('refuses an unconfirmed delete, then applies the identical call with the token', async () => {
      await setPolicy({ default: 'AUTO', overrides: {} });

      const personId = await createPerson('To be deleted');

      const refused = await dispatchCrud('delete_one', { id: personId });

      expect(refused.success).toBe(false);
      expect(refused.failure?.code).toBe('CONFIRMATION_REQUIRED');
      expect(refused.failure?.retryable).toBe(true);
      // The record must survive the refusal — this is the assertion that fails
      // if the executor forgets to short-circuit on CONFIRMATION_REQUIRED.
      expect(await readPersonDeletedAt(personId)).toBeNull();

      const token = /confirm: "([^"]+)"/.exec(refused.failure?.hint ?? '')?.[1];

      expect(token).toBeDefined();

      const confirmed = await dispatchCrud('delete_one', {
        id: personId,
        confirm: token,
      });

      expect(confirmed.success).toBe(true);
      expect(await readPersonDeletedAt(personId)).not.toBeNull();
    });

    it('refuses a token minted for a different record', async () => {
      await setPolicy({ default: 'AUTO', overrides: {} });

      const [firstPersonId, secondPersonId] = await Promise.all([
        createPerson('Keep me A'),
        createPerson('Keep me B'),
      ]);

      const refused = await dispatchCrud('delete_one', { id: firstPersonId });
      const token = /confirm: "([^"]+)"/.exec(refused.failure?.hint ?? '')?.[1];

      const replayed = await dispatchCrud('delete_one', {
        id: secondPersonId,
        confirm: token,
      });

      expect(replayed.success).toBe(false);
      expect(replayed.failure?.code).toBe('CONFIRMATION_REQUIRED');
      expect(await readPersonDeletedAt(secondPersonId)).toBeNull();
    });
  });

  describe('pagination signal', () => {
    it('reports hasMore true on a truncated page and false on a complete one', async () => {
      await setPolicy({ default: 'PROPOSE', overrides: {} });

      // Scoped to a marker job title: the seeded workspace holds ~1200 people,
      // so an unfiltered limit:100 page would report hasMore true for a reason
      // that has nothing to do with the assertion.
      const marker = `Paging probe ${randomUUID()}`;

      await Promise.all([
        createPerson(marker),
        createPerson(marker),
        createPerson(marker),
      ]);

      const filter = { jobTitle: { eq: marker } };

      const truncated = await dispatchCrud('find_many', {
        limit: 1,
        select: ['id'],
        ...filter,
      });

      expect(truncated.success).toBe(true);
      expect(
        (truncated.result as { hasMore: boolean; records: unknown[] }).records,
      ).toHaveLength(1);
      expect((truncated.result as { hasMore: boolean }).hasMore).toBe(true);

      const complete = await dispatchCrud('find_many', {
        limit: 100,
        select: ['id'],
        ...filter,
      });
      const completeResult = complete.result as {
        hasMore: boolean;
        records: unknown[];
      };

      // Guard: hasMore false only means "complete" when the page really did
      // hold every matching row.
      expect(completeResult.records).toHaveLength(3);
      expect(completeResult.hasMore).toBe(false);
    });
  });

  describe('permission-scoped metadata discovery', () => {
    let personReadRoleId: string;
    let companyOnlyRoleId: string;

    beforeAll(async () => {
      personReadRoleId = (
        await createCustomRoleWithObjectPermissions({
          label: `Agent semantics - person read ${randomUUID()}`,
          canReadPerson: true,
          hasAllObjectRecordsReadPermission: false,
        })
      ).roleId;

      companyOnlyRoleId = (
        await createCustomRoleWithObjectPermissions({
          label: `Agent semantics - company only ${randomUUID()}`,
          canReadPerson: false,
          canReadCompany: true,
          hasAllObjectRecordsReadPermission: false,
        })
      ).roleId;
    });

    afterAll(async () => {
      for (const idToDelete of [personReadRoleId, companyOnlyRoleId]) {
        if (idToDelete) {
          await deleteOneRole({ expectToFail: false, input: { idToDelete } });
        }
      }
    });

    const getObjectMetadata = async (roleId: string) => {
      const toolContext: ToolContext = {
        workspaceId: SEED_APPLE_WORKSPACE_ID,
        roleId,
        threadId: randomUUID(),
      };

      const output = await toolRegistryService.resolveAndExecute(
        'get_object_metadata',
        { objectName: 'person' },
        toolContext,
      );

      // The metadata factory returns the entry array directly rather than a
      // {success, result} envelope, so assert the shape rather than success.
      expect(Array.isArray(output)).toBe(true);

      return output as unknown as {
        nameSingular: string;
        permittedOperations?: {
          read: boolean;
          write: boolean;
          delete: boolean;
        };
      }[];
    };

    it('scopes get_object_metadata and its permittedOperations to the caller role', async () => {
      const withPersonRead = await getObjectMetadata(personReadRoleId);
      const withCompanyOnly = await getObjectMetadata(companyOnlyRoleId);

      const readablePerson = withPersonRead.find(
        (entry) => entry.nameSingular === 'person',
      );

      expect(readablePerson?.permittedOperations?.read).toBe(true);
      // Read granted, update never was — permittedOperations is per-operation,
      // not a single "can touch this object" bit.
      expect(readablePerson?.permittedOperations?.write).toBe(false);

      // The factory drops objects the role cannot read entirely, so the
      // company-only role's `read` for person is expressed as absence. That is
      // strictly stronger than reporting read:false, and it is what the
      // implementation actually does.
      expect(
        withCompanyOnly.find((entry) => entry.nameSingular === 'person'),
      ).toBeUndefined();
    });
  });

  describe('actionable failures', () => {
    it('returns a non-retryable UNKNOWN_TOOL failure for a tool that does not exist', async () => {
      const output = await toolRegistryService.resolveAndExecute(
        'delete_all_the_things',
        {},
        {
          workspaceId: SEED_APPLE_WORKSPACE_ID,
          roleId: adminRoleId,
          threadId: randomUUID(),
        },
      );

      expect(output.success).toBe(false);
      expect(output.failure?.code).toBe('UNKNOWN_TOOL');
      expect(output.failure?.retryable).toBe(false);
      expect(output.failure?.hint).toBeDefined();
    });
  });

  // C9: the gate is a denylist. A static tool nobody classified must still be
  // gated. If either of these passes through, the gate has been inverted to an
  // allowlist and the phase must not ship.
  describe('C9 regression - unclassified writes stay gated', () => {
    it('proposes an unclassified static tool instead of executing it', async () => {
      await setPolicy({ default: 'PROPOSE', overrides: {} });

      const threadId = randomUUID();
      const objectNameSingular = `gatedProbe${Date.now()}`;

      const output = await toolRegistryService.resolveAndExecute(
        'create_object_metadata',
        {
          nameSingular: objectNameSingular,
          namePlural: `${objectNameSingular}s`,
          labelSingular: 'Gated probe',
          labelPlural: 'Gated probes',
        },
        {
          workspaceId: SEED_APPLE_WORKSPACE_ID,
          roleId: adminRoleId,
          threadId,
        },
      );

      const result = output.result as { proposalItemId?: string };

      expect(output.success).toBe(true);
      expect(result.proposalItemId).toBeDefined();

      const items = await findProposalItemsForThread(threadId);

      expect(items).toHaveLength(1);
      expect(items[0].toolId).toBe('create_object_metadata');
      expect(items[0].toolCategory).not.toBeNull();

      // And nothing was actually created in the data model.
      const created = await global.testDataSource.query(
        `SELECT id FROM core."objectMetadata"
         WHERE "workspaceId" = $1 AND "nameSingular" = $2`,
        [SEED_APPLE_WORKSPACE_ID, objectNameSingular],
      );

      expect(created).toHaveLength(0);
    });

    it('proposes a create_one instead of writing the record', async () => {
      await setPolicy({ default: 'PROPOSE', overrides: {} });

      const personId = randomUUID();

      const output = await dispatchCrud('create_one', {
        id: personId,
        jobTitle: 'Never written',
      });

      expect(
        (output.result as { proposalItemId?: string }).proposalItemId,
      ).toBeDefined();
      expect(
        await countProposalItemsForThread(context.threadId as string),
      ).toBe(1);

      const rows = await global.testDataSource.query(
        `SELECT id FROM ${WORKSPACE_SCHEMA}."person" WHERE id = $1`,
        [personId],
      );

      expect(rows).toHaveLength(0);
    });
  });

  // C13/C11: the exact call Phase 5's post-install hook makes.
  describe('installDefinition for app-supplied workflows', () => {
    const definitionName = `Integration test workflow ${randomUUID()}`;

    const definition = {
      name: definitionName,
      trigger: {
        name: 'Manual trigger',
        type: WorkflowTriggerType.MANUAL,
        settings: { outputSchema: {} },
      },
      steps: [
        {
          type: WorkflowActionType.AI_AGENT,
          name: 'Step one',
          settings: {
            outputSchema: {},
            errorHandlingOptions: {
              retryOnFailure: { value: false },
              continueOnFailure: { value: false },
            },
            input: { prompt: 'Do the thing.' },
          },
        },
      ],
    };

    it('normalizes app-supplied steps, activates, and is idempotent by name', async () => {
      const installed = await workflowTemplateService.installDefinition({
        // The cast mirrors what a Phase 5 post-install hook supplies: a step
        // with no id / valid / nextStepIds.
        definition: definition as Parameters<
          WorkflowTemplateService['installDefinition']
        >[0]['definition'],
        workspaceId: SEED_APPLE_WORKSPACE_ID,
        activate: true,
      });

      const [version] = await global.testDataSource.query(
        `SELECT steps, status FROM ${WORKSPACE_SCHEMA}."workflowVersion" WHERE id = $1`,
        [installed.workflowVersionId],
      );

      const [step] = version.steps as {
        id: string;
        valid: boolean;
        nextStepIds: string[];
      }[];

      expect(step.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(step.valid).toBe(true);
      expect(step.nextStepIds).toEqual([]);

      const [workflow] = await global.testDataSource.query(
        `SELECT statuses FROM ${WORKSPACE_SCHEMA}."workflow" WHERE id = $1`,
        [installed.workflowId],
      );

      // `statuses` is a multi-select column; the raw driver hands it back as
      // the Postgres array literal rather than a JS array.
      expect(String(workflow.statuses)).toContain('ACTIVE');

      const reinstalled = await workflowTemplateService.installDefinition({
        definition: definition as Parameters<
          WorkflowTemplateService['installDefinition']
        >[0]['definition'],
        workspaceId: SEED_APPLE_WORKSPACE_ID,
        activate: true,
      });

      expect(reinstalled).toEqual(installed);

      const duplicates = await global.testDataSource.query(
        `SELECT id FROM ${WORKSPACE_SCHEMA}."workflow" WHERE name = $1`,
        [definitionName],
      );

      expect(duplicates).toHaveLength(1);
    });

    // An ACTIVE workflow left behind keeps reacting to record events in later
    // runs, which stalls the between-test job drain. Clean it up.
    afterAll(async () => {
      await global.testDataSource.query(
        `DELETE FROM ${WORKSPACE_SCHEMA}."workflow" WHERE name = $1`,
        [definitionName],
      );
    });
  });
});
