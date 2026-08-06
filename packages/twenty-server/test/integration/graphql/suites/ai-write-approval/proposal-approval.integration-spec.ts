import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { ToolCategory } from 'twenty-shared/ai';

import { type ToolExecutorService } from 'src/engine/core-modules/tool-provider/services/tool-executor.service';
import { type ToolProviderContext } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider-context.type';
import { type ToolExecutionRef } from 'src/engine/core-modules/tool-provider/types/tool-execution-ref.type';
import { type UserRoleService } from 'src/engine/metadata-modules/user-role/user-role.service';
import { SEED_APPLE_WORKSPACE_ID } from 'src/engine/workspace-manager/dev-seeder/core/constants/seeder-workspaces.constant';

import { getAppProviderByClassName } from 'test/integration/utils/get-app-provider-by-class-name.util';

type CrudOperation = Extract<
  ToolExecutionRef,
  { kind: 'database_crud' }
>['operation'];

const client = request(`http://localhost:${APP_PORT}`);

const UPDATE_AI_WRITE_POLICY = `
  mutation UpdateAiWritePolicy($input: UpdateAiWritePolicyInput!) {
    updateAiWritePolicy(input: $input) { default overrides }
  }
`;

const PENDING_PROPOSALS = `
  query PendingProposals {
    pendingProposals {
      id
      status
      items { id actionType objectNameSingular recordId payload baseline status }
    }
  }
`;

const APPROVE_PROPOSAL = `
  mutation ApproveProposal($input: ApproveProposalInput!) {
    approveProposal(input: $input) {
      proposalId appliedItemIds conflictedItemIds failedItemIds aborted
    }
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

// Record CRUD lives on the core schema; the proposal and policy resolvers are
// @MetadataResolver()s and are served from /metadata.
const graphqlRequest = (query: string, variables: Record<string, unknown> = {}) =>
  post('/graphql', query, variables);

const metadataRequest = (
  query: string,
  variables: Record<string, unknown> = {},
) => post('/metadata', query, variables);

const setPolicy = async (input: {
  default: string;
  overrides: Record<string, string>;
}) => {
  const response = await metadataRequest(UPDATE_AI_WRITE_POLICY, { input });

  expect(response.body.errors).toBeUndefined();

  return response;
};

const findPersonJobTitle = async (personId: string): Promise<string> => {
  const response = await graphqlRequest(
    `
      query FindOnePerson($filter: PersonFilterInput!) {
        person(filter: $filter) { id jobTitle }
      }
    `,
    { filter: { id: { eq: personId } } },
  );

  expect(response.body.errors).toBeUndefined();

  return response.body.data.person.jobTitle;
};

const updatePersonDirectly = async (personId: string, jobTitle: string) => {
  const response = await graphqlRequest(
    `
      mutation UpdateOnePerson($idToUpdate: ID!, $input: PersonUpdateInput!) {
        updatePerson(id: $idToUpdate, data: $input) { id jobTitle }
      }
    `,
    { idToUpdate: personId, input: { jobTitle } },
  );

  expect(response.body.errors).toBeUndefined();

  return response.body.data.updatePerson;
};

const createPerson = async (jobTitle: string): Promise<string> => {
  const id = randomUUID();
  const response = await graphqlRequest(
    `
      mutation CreateOnePerson($input: PersonCreateInput!) {
        createPerson(data: $input) { id jobTitle }
      }
    `,
    { input: { id, jobTitle } },
  );

  expect(response.body.errors).toBeUndefined();

  return response.body.data.createPerson.id;
};

describe('proposal approval (e2e)', () => {
  let toolExecutorService: ToolExecutorService;
  let toolProviderContext: ToolProviderContext;
  let personId: string;

  beforeAll(async () => {
    toolExecutorService = getAppProviderByClassName<ToolExecutorService>(
      'ToolExecutorService',
    );

    const userRoleService = getAppProviderByClassName<UserRoleService>(
      'UserRoleService',
    );

    const [adminUserWorkspace] = await global.testDataSource.query(
      `SELECT uw.id AS "userWorkspaceId", u.id AS "userId"
       FROM core."userWorkspace" uw
       JOIN core."user" u ON u.id = uw."userId"
       WHERE uw."workspaceId" = $1 AND u.email = $2`,
      [SEED_APPLE_WORKSPACE_ID, 'jane.austen@apple.dev'],
    );

    const roleId = await userRoleService.getRoleIdForUserWorkspace({
      userWorkspaceId: adminUserWorkspace.userWorkspaceId,
      workspaceId: SEED_APPLE_WORKSPACE_ID,
    });

    toolProviderContext = {
      workspaceId: SEED_APPLE_WORKSPACE_ID,
      roleId,
      rolePermissionConfig: { shouldBypassPermissionChecks: true },
      userId: adminUserWorkspace.userId,
      userWorkspaceId: adminUserWorkspace.userWorkspaceId,
      threadId: randomUUID(),
    };
  });

  beforeEach(async () => {
    personId = await createPerson('Sales Rep');
    // Fresh thread per test so proposals don't merge across tests.
    toolProviderContext = { ...toolProviderContext, threadId: randomUUID() };
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
      toolProviderContext,
    );

  const dispatchUpdateJobTitle = (jobTitle: string) =>
    dispatchCrud('update_one', { id: personId, jobTitle });

  it('creates one PENDING proposal with one item and leaves the record unchanged under PROPOSE', async () => {
    await setPolicy({ default: 'PROPOSE', overrides: {} });

    const output = await dispatchUpdateJobTitle('Head of Sales');

    expect(output.success).toBe(true);

    const jobTitle = await findPersonJobTitle(personId);

    expect(jobTitle).toBe('Sales Rep');

    const pending = await metadataRequest(PENDING_PROPOSALS);

    expect(pending.body.errors).toBeUndefined();

    const proposals = pending.body.data.pendingProposals;
    const proposal = proposals.find((candidate: { id: string }) =>
      candidate.id ===
      (output.result as { proposalId: string }).proposalId,
    );

    expect(proposal).toBeDefined();
    expect(proposal.status).toBe('PENDING');
    expect(proposal.items).toHaveLength(1);
    expect(proposal.items[0].baseline).toEqual({ jobTitle: 'Sales Rep' });
    expect(proposal.items[0].payload).toEqual({ jobTitle: 'Head of Sales' });
  });

  it('approves a selected item, applies it, and leaves unselected items rejected', async () => {
    await setPolicy({ default: 'PROPOSE', overrides: {} });

    const output = await dispatchUpdateJobTitle('Head of Sales');
    const proposalId = (output.result as { proposalId: string }).proposalId;
    const proposalItemId = (output.result as { proposalItemId: string })
      .proposalItemId;

    const approveResponse = await metadataRequest(APPROVE_PROPOSAL, {
      input: { proposalId, selectedItemIds: [proposalItemId] },
    });

    expect(approveResponse.body.errors).toBeUndefined();

    const result = approveResponse.body.data.approveProposal;

    expect(result.aborted).toBe(false);
    expect(result.appliedItemIds).toEqual([proposalItemId]);

    const jobTitle = await findPersonJobTitle(personId);

    expect(jobTitle).toBe('Head of Sales');
  });

  it('aborts the whole batch as CONFLICTED when the baseline changed before approval', async () => {
    await setPolicy({ default: 'PROPOSE', overrides: {} });

    const output = await dispatchUpdateJobTitle('Head of Sales');
    const proposalId = (output.result as { proposalId: string }).proposalId;
    const proposalItemId = (output.result as { proposalItemId: string })
      .proposalItemId;

    await updatePersonDirectly(personId, 'VP of Sales');

    const approveResponse = await metadataRequest(APPROVE_PROPOSAL, {
      input: { proposalId, selectedItemIds: [proposalItemId] },
    });

    expect(approveResponse.body.errors).toBeUndefined();

    const result = approveResponse.body.data.approveProposal;

    expect(result.aborted).toBe(true);
    expect(result.conflictedItemIds).toEqual([proposalItemId]);

    const jobTitle = await findPersonJobTitle(personId);

    expect(jobTitle).toBe('VP of Sales');
  });

  it('rejects every item and writes nothing when approved with an empty selection', async () => {
    await setPolicy({ default: 'PROPOSE', overrides: {} });

    const output = await dispatchUpdateJobTitle('Head of Sales');
    const proposalId = (output.result as { proposalId: string }).proposalId;

    const approveResponse = await metadataRequest(APPROVE_PROPOSAL, {
      input: { proposalId, selectedItemIds: [] },
    });

    expect(approveResponse.body.errors).toBeUndefined();

    const result = approveResponse.body.data.approveProposal;

    expect(result.aborted).toBe(false);
    expect(result.appliedItemIds).toEqual([]);

    const jobTitle = await findPersonJobTitle(personId);

    expect(jobTitle).toBe('Sales Rep');

    const pending = await metadataRequest(PENDING_PROPOSALS);
    const stillPending = pending.body.data.pendingProposals.find(
      (candidate: { id: string }) => candidate.id === proposalId,
    );

    expect(stillPending).toBeUndefined();
  });

  it('applies the write directly and creates no proposal under AUTO', async () => {
    await setPolicy({ default: 'AUTO', overrides: {} });

    const output = await dispatchUpdateJobTitle('Head of Sales');

    expect(output.success).toBe(true);
    expect((output.result as { proposalId?: string }).proposalId).toBeUndefined();

    const jobTitle = await findPersonJobTitle(personId);

    expect(jobTitle).toBe('Head of Sales');
  });

  // C2 end to end: a field-level AUTO override was unreachable, because the
  // gate always injected the bare object key and the default outranked it.
  it('applies a write directly when a field-level AUTO override covers it', async () => {
    await setPolicy({
      default: 'PROPOSE',
      overrides: { 'person.jobTitle': 'AUTO' },
    });

    const output = await dispatchUpdateJobTitle('Head of Sales');

    expect(output.success).toBe(true);
    expect(
      (output.result as { proposalId?: string }).proposalId,
    ).toBeUndefined();
    expect(await findPersonJobTitle(personId)).toBe('Head of Sales');
  });

  it('still proposes a field the AUTO override does not cover', async () => {
    await setPolicy({
      default: 'PROPOSE',
      overrides: { 'person.linkedinLink': 'AUTO' },
    });

    const output = await dispatchUpdateJobTitle('Head of Sales');

    expect((output.result as { proposalId?: string }).proposalId).toBeDefined();
    expect(await findPersonJobTitle(personId)).toBe('Sales Rep');
  });

  // C3 end to end: create_many used to be stored as a single merged record and
  // applied through createRecordService, silently creating one wrong record.
  it('replays a create_many batch as several records on approval', async () => {
    await setPolicy({ default: 'PROPOSE', overrides: {} });

    const records = [
      { id: randomUUID(), jobTitle: 'Batch A' },
      { id: randomUUID(), jobTitle: 'Batch B' },
    ];

    const output = await dispatchCrud('create_many', { records });
    const { proposalId, proposalItemId } = output.result as {
      proposalId: string;
      proposalItemId: string;
    };

    const approveResponse = await metadataRequest(APPROVE_PROPOSAL, {
      input: { proposalId, selectedItemIds: [proposalItemId] },
    });

    expect(approveResponse.body.errors).toBeUndefined();
    expect(approveResponse.body.data.approveProposal.failedItemIds).toEqual([]);
    expect(approveResponse.body.data.approveProposal.appliedItemIds).toEqual([
      proposalItemId,
    ]);

    for (const record of records) {
      expect(await findPersonJobTitle(record.id)).toBe(record.jobTitle);
    }
  });

  // C3 end to end: update_many stored only `data`, dropping the filter, so the
  // item could never be applied and landed FAILED forever.
  it('replays an update_many filter on approval', async () => {
    await setPolicy({ default: 'PROPOSE', overrides: {} });

    const output = await dispatchCrud('update_many', {
      filter: { id: { eq: personId } },
      data: { jobTitle: 'Bulk updated' },
    });
    const { proposalId, proposalItemId } = output.result as {
      proposalId: string;
      proposalItemId: string;
    };

    const approveResponse = await metadataRequest(APPROVE_PROPOSAL, {
      input: { proposalId, selectedItemIds: [proposalItemId] },
    });

    expect(approveResponse.body.data.approveProposal.failedItemIds).toEqual([]);
    expect(await findPersonJobTitle(personId)).toBe('Bulk updated');
  });

  // I5: two approvals racing must not both apply.
  it('applies a proposal only once when two approvals race', async () => {
    await setPolicy({ default: 'PROPOSE', overrides: {} });

    const output = await dispatchUpdateJobTitle('Head of Sales');
    const { proposalId, proposalItemId } = output.result as {
      proposalId: string;
      proposalItemId: string;
    };

    const [first, second] = await Promise.all([
      metadataRequest(APPROVE_PROPOSAL, {
        input: { proposalId, selectedItemIds: [proposalItemId] },
      }),
      metadataRequest(APPROVE_PROPOSAL, {
        input: { proposalId, selectedItemIds: [proposalItemId] },
      }),
    ]);

    const results = [
      first.body.data.approveProposal,
      second.body.data.approveProposal,
    ];
    const appliedCount = results.filter(
      (result) => result.appliedItemIds.length === 1,
    ).length;

    expect(appliedCount).toBe(1);
    expect(await findPersonJobTitle(personId)).toBe('Head of Sales');
  });
});
