import { Test } from '@nestjs/testing';

import { MessageParticipantRole } from 'searm-shared/types';
import type { TestingModule } from '@nestjs/testing';

import type { WorkspaceEntityManager } from 'src/engine/searm-orm/entity-manager/workspace-entity-manager';
import { GlobalWorkspaceOrmManager } from 'src/engine/searm-orm/global-workspace-datasource/global-workspace-orm.manager';
import { MatchParticipantService } from 'src/modules/match-participant/match-participant.service';
import { ParticipantIdentityProposalService } from 'src/modules/match-participant/services/participant-identity-proposal.service';
import { MessagingMessageParticipantService } from 'src/modules/messaging/message-participant-manager/services/messaging-message-participant.service';

const WORKSPACE_ID = '20202020-0000-0000-0000-000000000001';

describe('MessagingMessageParticipantService', () => {
  let service: MessagingMessageParticipantService;
  let reviewUnmatchedParticipants: jest.Mock;
  let repositoryFind: jest.Mock;

  // A repository whose rows are only visible when the caller's transaction
  // manager is threaded through — mirrors the real ORM, where an uncommitted
  // insert is invisible on a different connection.
  const transactionManager = {
    __tx: true,
  } as unknown as WorkspaceEntityManager;

  const insertedRows = [
    {
      id: 'participant-1',
      handle: 'jane@acme.com',
      displayName: 'Jane',
      personId: null,
    },
  ];

  beforeEach(async () => {
    reviewUnmatchedParticipants = jest.fn();
    repositoryFind = jest.fn(
      async (_options: unknown, entityManager?: WorkspaceEntityManager) => {
        if (entityManager !== transactionManager) {
          // Uncommitted rows are invisible outside the transaction.
          return [];
        }

        return insertedRows;
      },
    );

    const repository = {
      find: repositoryFind,
      insert: jest.fn(async () => ({ raw: insertedRows })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagingMessageParticipantService,
        {
          provide: GlobalWorkspaceOrmManager,
          useValue: {
            executeInWorkspaceContext: jest.fn(
              async (callback: () => Promise<void>) => callback(),
            ),
            getRepository: jest.fn(async () => repository),
          },
        },
        {
          provide: MatchParticipantService,
          useValue: { matchParticipants: jest.fn() },
        },
        {
          provide: ParticipantIdentityProposalService,
          useValue: { reviewUnmatchedParticipants },
        },
      ],
    }).compile();

    service = module.get(MessagingMessageParticipantService);
  });

  it('should review participants left unmatched by the exact-match pass', async () => {
    await service.saveMessageParticipants(
      [
        {
          messageId: 'message-1',
          handle: 'jane@acme.com',
          displayName: 'Jane',
          role: MessageParticipantRole.FROM,
        },
      ],
      WORKSPACE_ID,
      transactionManager,
    );

    expect(reviewUnmatchedParticipants).toHaveBeenCalledWith(
      expect.objectContaining({
        participants: [
          {
            id: 'participant-1',
            handle: 'jane@acme.com',
            displayName: 'Jane',
          },
        ],
        objectMetadataName: 'messageParticipant',
        workspaceId: WORKSPACE_ID,
      }),
    );
  });

  it('should read the unmatched participants through the caller transaction manager', async () => {
    await service.saveMessageParticipants(
      [
        {
          messageId: 'message-1',
          handle: 'jane@acme.com',
          displayName: 'Jane',
          role: MessageParticipantRole.FROM,
        },
      ],
      WORKSPACE_ID,
      transactionManager,
    );

    const unmatchedLookup = repositoryFind.mock.calls.find(
      ([options]) => options?.where?.personId !== undefined,
    );

    expect(unmatchedLookup).toBeDefined();
    expect(unmatchedLookup?.[1]).toBe(transactionManager);
  });
});
