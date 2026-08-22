import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';

import { getQueueToken } from 'src/engine/core-modules/message-queue/utils/get-queue-token.util';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import type { WorkspaceEntityManager } from 'src/engine/searm-orm/entity-manager/workspace-entity-manager';
import { GlobalWorkspaceOrmManager } from 'src/engine/searm-orm/global-workspace-datasource/global-workspace-orm.manager';
import { CalendarEventParticipantService } from 'src/modules/calendar/calendar-event-participant-manager/services/calendar-event-participant.service';
import { MatchParticipantService } from 'src/modules/match-participant/match-participant.service';
import { ParticipantIdentityProposalService } from 'src/modules/match-participant/services/participant-identity-proposal.service';

const WORKSPACE_ID = '20202020-0000-0000-0000-000000000002';

describe('CalendarEventParticipantService', () => {
  let service: CalendarEventParticipantService;
  let reviewUnmatchedParticipants: jest.Mock;
  let repositoryFind: jest.Mock;

  // Rows are only visible when the caller's transaction manager is threaded
  // through — mirrors the real ORM, where an uncommitted insert is invisible
  // on a different connection.
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
          return [];
        }

        return insertedRows;
      },
    );

    const repository = {
      find: repositoryFind,
      delete: jest.fn(),
      updateMany: jest.fn(),
      insert: jest.fn(async () => ({ raw: insertedRows })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CalendarEventParticipantService,
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
          provide: getQueueToken(MessageQueue.contactCreationQueue),
          useValue: { add: jest.fn() },
        },
        {
          provide: ParticipantIdentityProposalService,
          useValue: { reviewUnmatchedParticipants },
        },
      ],
    }).compile();

    service = module.get(CalendarEventParticipantService);
  });

  const run = () =>
    service.upsertAndDeleteCalendarEventParticipants({
      participantsToCreate: [
        {
          calendarEventId: 'event-1',
          handle: 'jane@acme.com',
          displayName: 'Jane',
          isOrganizer: false,
          responseStatus: 'NEEDS_ACTION',
        },
      ] as never,
      participantsToUpdate: [],
      transactionManager,
      calendarChannel: { isContactAutoCreationEnabled: false } as never,
      connectedAccount: { id: 'connected-account-1' } as never,
      workspaceId: WORKSPACE_ID,
    });

  it('should review participants left unmatched by the exact-match pass', async () => {
    await run();

    expect(reviewUnmatchedParticipants).toHaveBeenCalledWith(
      expect.objectContaining({
        participants: [
          {
            id: 'participant-1',
            handle: 'jane@acme.com',
            displayName: 'Jane',
          },
        ],
        objectMetadataName: 'calendarEventParticipant',
        workspaceId: WORKSPACE_ID,
      }),
    );
  });

  it('should read the unmatched participants through the caller transaction manager', async () => {
    await run();

    const unmatchedLookup = repositoryFind.mock.calls.find(
      ([options]) => options?.where?.personId !== undefined,
    );

    expect(unmatchedLookup).toBeDefined();
    expect(unmatchedLookup?.[1]).toBe(transactionManager);
  });
});
