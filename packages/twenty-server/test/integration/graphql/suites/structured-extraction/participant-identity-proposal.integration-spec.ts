import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { MessageParticipantRole } from 'twenty-shared/types';

import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { type MessagingMessageParticipantService } from 'src/modules/messaging/message-participant-manager/services/messaging-message-participant.service';
import { SEED_APPLE_WORKSPACE_ID } from 'src/engine/workspace-manager/dev-seeder/core/constants/seeder-workspaces.constant';

import { getAppProviderByClassName } from 'test/integration/utils/get-app-provider-by-class-name.util';

const client = request(`http://localhost:${APP_PORT}`);

const PENDING_PROPOSALS = `
  query PendingProposals {
    pendingProposals {
      id
      status
      items { id actionType objectNameSingular recordId payload baseline }
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

const graphqlRequest = (
  query: string,
  variables: Record<string, unknown> = {},
) => post('/graphql', query, variables);

const metadataRequest = (
  query: string,
  variables: Record<string, unknown> = {},
) => post('/metadata', query, variables);

const RUN_SUFFIX = randomUUID().slice(0, 8);
const DOMAIN = `acme-msg-${RUN_SUFFIX}.test`;
// The setup person's own email — deliberately NOT the handle the message
// arrives from, so the exact-match pass leaves the participant unlinked.
const PERSON_EMAIL = `jane@${DOMAIN}`;
const INBOUND_HANDLE = `jane.doe@${DOMAIN}`;

type ProposalItem = {
  id: string;
  actionType: string;
  objectNameSingular: string;
  recordId: string;
  payload: Record<string, unknown>;
  baseline: Record<string, unknown>;
};

type Proposal = { id: string; status: string; items: ProposalItem[] };

const createRecord = async (
  mutationName: string,
  inputTypeName: string,
  input: Record<string, unknown>,
): Promise<string> => {
  const id = randomUUID();
  const response = await graphqlRequest(
    `
      mutation Create($input: ${inputTypeName}!) {
        ${mutationName}(data: $input) { id }
      }
    `,
    { input: { id, ...input } },
  );

  expect(response.body.errors).toBeUndefined();

  return response.body.data[mutationName].id;
};

type ParticipantNode = {
  id: string;
  handle: string;
  person: { id: string } | null;
};

// Read through the API rather than the workspace schema directly: the schema
// name is a generated token, not derivable from the workspace id.
const findParticipant = async (
  messageId: string,
  handle: string,
): Promise<ParticipantNode> => {
  const response = await graphqlRequest(
    `
      query FindParticipants($filter: MessageParticipantFilterInput!) {
        messageParticipants(filter: $filter) {
          edges { node { id handle person { id } } }
        }
      }
    `,
    { filter: { messageId: { eq: messageId } } },
  );

  expect(response.body.errors).toBeUndefined();

  const node = response.body.data.messageParticipants.edges
    .map((edge: { node: ParticipantNode }) => edge.node)
    .find((participant: ParticipantNode) => participant.handle === handle);

  expect(node).toBeDefined();

  return node;
};

describe('participant identity proposal (e2e)', () => {
  let messagingMessageParticipantService: MessagingMessageParticipantService;
  let globalWorkspaceOrmManager: GlobalWorkspaceOrmManager;
  let setupPersonId: string;
  let messageId: string;

  // Production always calls saveMessageParticipants from inside an open
  // workspace transaction (messaging-save-messages-and-enqueue-contact-
  // creation.service.ts). Calling it without one exercises a shape that
  // never occurs and hid the missing transaction manager on the
  // still-unmatched lookup.
  const saveParticipantsAsProductionDoes = async () =>
    globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const dataSource =
          await globalWorkspaceOrmManager.getGlobalWorkspaceDataSource();

        await dataSource.transaction(async (manager) => {
          await messagingMessageParticipantService.saveMessageParticipants(
            [
              {
                messageId,
                handle: INBOUND_HANDLE,
                displayName: 'Jane Doe',
                role: MessageParticipantRole.FROM,
              },
            ],
            SEED_APPLE_WORKSPACE_ID,
            manager as WorkspaceEntityManager,
          );
        });
      },
      buildSystemAuthContext(SEED_APPLE_WORKSPACE_ID),
      { lite: true },
    );

  beforeAll(async () => {
    messagingMessageParticipantService =
      getAppProviderByClassName<MessagingMessageParticipantService>(
        'MessagingMessageParticipantService',
      );
    globalWorkspaceOrmManager =
      getAppProviderByClassName<GlobalWorkspaceOrmManager>(
        'GlobalWorkspaceOrmManager',
      );

    const companyId = await createRecord('createCompany', 'CompanyCreateInput', {
      name: `Acme ${RUN_SUFFIX}`,
      domainName: { primaryLinkUrl: DOMAIN },
    });

    setupPersonId = await createRecord('createPerson', 'PersonCreateInput', {
      emails: { primaryEmail: PERSON_EMAIL },
      name: { firstName: 'Jane', lastName: 'Doe' },
      companyId,
    });

    messageId = await createRecord('createMessage', 'MessageCreateInput', {
      subject: `Hello ${RUN_SUFFIX}`,
      text: 'Body',
      receivedAt: new Date().toISOString(),
    });
  });

  const findParticipantId = async (): Promise<string> =>
    (await findParticipant(messageId, INBOUND_HANDLE)).id;

  const findProposalForParticipant = async (
    participantId: string,
  ): Promise<Proposal | undefined> => {
    const pending = await metadataRequest(PENDING_PROPOSALS);

    expect(pending.body.errors).toBeUndefined();

    return (pending.body.data.pendingProposals as Proposal[]).find((proposal) =>
      proposal.items.some((item) => item.recordId === participantId),
    );
  };

  it('leaves the participant unlinked and proposes the candidate person instead', async () => {
    // The exact code path a real inbound email import takes, minus the driver.
    await saveParticipantsAsProductionDoes();

    const participantId = await findParticipantId();

    // No exact email match, so nothing was linked directly.
    expect((await findParticipant(messageId, INBOUND_HANDLE)).person).toBeNull();

    const proposal = await findProposalForParticipant(participantId);

    expect(proposal).toBeDefined();
    expect(proposal?.status).toBe('PENDING');
    expect(proposal?.items).toHaveLength(1);
    expect(proposal?.items[0]).toEqual(
      expect.objectContaining({
        actionType: 'UPDATE_RECORD',
        objectNameSingular: 'messageParticipant',
        recordId: participantId,
        payload: { personId: setupPersonId },
      }),
    );

    const [row] = await global.testDataSource.query(
      `SELECT "sourceKey", "workspaceId" FROM core."proposal" WHERE id = $1`,
      [proposal?.id],
    );

    expect(row.sourceKey).toBe(`ingestion:messageParticipant:${participantId}`);
    expect(row.workspaceId).toBe(SEED_APPLE_WORKSPACE_ID);
  });

  it('links the person only once the proposal is approved', async () => {
    const participantId = await findParticipantId();
    const proposal = await findProposalForParticipant(participantId);

    expect(proposal).toBeDefined();

    const approveResponse = await metadataRequest(APPROVE_PROPOSAL, {
      input: {
        proposalId: proposal?.id,
        selectedItemIds: [proposal?.items[0].id],
      },
    });

    expect(approveResponse.body.errors).toBeUndefined();

    const result = approveResponse.body.data.approveProposal;

    expect(result.aborted).toBe(false);
    expect(result.failedItemIds).toEqual([]);
    expect(result.appliedItemIds).toEqual([proposal?.items[0].id]);

    expect((await findParticipant(messageId, INBOUND_HANDLE)).person?.id).toBe(
      setupPersonId,
    );
  });

  it('creates no second proposal when the same participant is re-ingested', async () => {
    const participantId = await findParticipantId();

    // Re-run the save with the same message/handle: the participant already
    // exists, so nothing new is inserted and no duplicate proposal appears.
    await saveParticipantsAsProductionDoes();

    const proposals = await global.testDataSource.query(
      `SELECT id FROM core."proposal" WHERE "sourceKey" = $1`,
      [`ingestion:messageParticipant:${participantId}`],
    );

    expect(proposals).toHaveLength(1);
  });
});
