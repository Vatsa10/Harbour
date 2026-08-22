import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { CalendarChannelEntity } from 'src/engine/metadata-modules/calendar-channel/entities/calendar-channel.entity';
import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';
import { GlobalWorkspaceOrmManager } from 'src/engine/searm-orm/global-workspace-datasource/global-workspace-orm.manager';
import { AiExtractionExclusionService } from 'src/modules/structured-extraction/services/ai-extraction-exclusion.service';

type Row = Record<string, unknown>;

// A tiny in-memory table that understands the two things this service asks of
// a repository: equality filters and In([...]). It is NOT a mock of the
// service under test — it stands in for Postgres, so the resolution chain
// (association -> channel -> connectedAccount) is really executed, and a wrong
// join key or a dropped filter makes the assertions fail.
const buildTable = (rows: Row[]) => {
  const matches = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([key, condition]) => {
      const isInOperator =
        typeof condition === 'object' &&
        condition !== null &&
        '_type' in (condition as Row) &&
        (condition as Row)._type === 'in';

      if (isInOperator) {
        return ((condition as { _value: unknown[] })._value ?? []).includes(
          row[key],
        );
      }

      return row[key] === condition;
    });

  const find = jest.fn(async ({ where }: { where: Row }) =>
    rows.filter((row) => matches(row, where)),
  );

  return {
    rows,
    find,
    count: jest.fn(
      async ({ where }: { where: Row }) =>
        rows.filter((row) => matches(row, where)).length,
    ),
  };
};

describe('AiExtractionExclusionService (Owner Decision 3)', () => {
  let service: AiExtractionExclusionService;

  let messageAssociations: ReturnType<typeof buildTable>;
  let calendarAssociations: ReturnType<typeof buildTable>;
  let messageChannels: ReturnType<typeof buildTable>;
  let calendarChannels: ReturnType<typeof buildTable>;
  let connectedAccounts: ReturnType<typeof buildTable>;

  const globalWorkspaceOrmManager = {
    getRepository: jest.fn(async (_workspaceId: string, objectName: string) => {
      if (objectName === 'messageChannelMessageAssociation') {
        return messageAssociations;
      }

      if (objectName === 'calendarChannelEventAssociation') {
        return calendarAssociations;
      }

      throw new Error(`Unexpected object ${objectName}`);
    }),
  };

  const buildService = async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiExtractionExclusionService,
        {
          provide: GlobalWorkspaceOrmManager,
          useValue: globalWorkspaceOrmManager,
        },
        {
          provide: getRepositoryToken(MessageChannelEntity),
          useValue: messageChannels,
        },
        {
          provide: getRepositoryToken(CalendarChannelEntity),
          useValue: calendarChannels,
        },
        {
          provide: getRepositoryToken(ConnectedAccountEntity),
          useValue: connectedAccounts,
        },
      ],
    }).compile();

    return module.get(AiExtractionExclusionService);
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    messageAssociations = buildTable([
      { messageId: 'msg-excluded', messageChannelId: 'chan-excluded' },
      { messageId: 'msg-allowed', messageChannelId: 'chan-allowed' },
      // Same message copied into two mailboxes, one of which opted out.
      { messageId: 'msg-shared', messageChannelId: 'chan-allowed' },
      { messageId: 'msg-shared', messageChannelId: 'chan-excluded' },
    ]);
    calendarAssociations = buildTable([
      { calendarEventId: 'evt-excluded', calendarChannelId: 'cal-excluded' },
      { calendarEventId: 'evt-allowed', calendarChannelId: 'cal-allowed' },
    ]);
    messageChannels = buildTable([
      { id: 'chan-excluded', connectedAccountId: 'account-excluded' },
      { id: 'chan-allowed', connectedAccountId: 'account-allowed' },
    ]);
    calendarChannels = buildTable([
      { id: 'cal-excluded', connectedAccountId: 'account-excluded' },
      { id: 'cal-allowed', connectedAccountId: 'account-allowed' },
    ]);
    connectedAccounts = buildTable([
      { id: 'account-excluded', excludeFromAiExtraction: true },
      { id: 'account-allowed', excludeFromAiExtraction: false },
    ]);

    service = await buildService();
  });

  it('excludes a message whose connected account opted out', async () => {
    await expect(
      service.isMessageExcluded({
        workspaceId: 'workspace-1',
        messageId: 'msg-excluded',
      }),
    ).resolves.toBe(true);
  });

  it('allows a message whose connected account did not opt out', async () => {
    await expect(
      service.isMessageExcluded({
        workspaceId: 'workspace-1',
        messageId: 'msg-allowed',
      }),
    ).resolves.toBe(false);
  });

  it('excludes a message when only one of several accounts opted out', async () => {
    await expect(
      service.isMessageExcluded({
        workspaceId: 'workspace-1',
        messageId: 'msg-shared',
      }),
    ).resolves.toBe(true);
  });

  it('allows a message with no channel association at all', async () => {
    await expect(
      service.isMessageExcluded({
        workspaceId: 'workspace-1',
        messageId: 'msg-orphan',
      }),
    ).resolves.toBe(false);
  });

  it('never widens the lookup: only the queried message id is resolved', async () => {
    await service.isMessageExcluded({
      workspaceId: 'workspace-1',
      messageId: 'msg-allowed',
    });

    expect(messageAssociations.find).toHaveBeenCalledWith({
      where: { messageId: 'msg-allowed' },
    });
  });

  it('reads the workspace association with permission checks bypassed', async () => {
    await service.isMessageExcluded({
      workspaceId: 'workspace-1',
      messageId: 'msg-allowed',
    });

    expect(globalWorkspaceOrmManager.getRepository).toHaveBeenCalledWith(
      'workspace-1',
      'messageChannelMessageAssociation',
      { shouldBypassPermissionChecks: true },
    );
  });

  it('excludes a calendar event whose connected account opted out', async () => {
    await expect(
      service.isCalendarEventExcluded({
        workspaceId: 'workspace-1',
        calendarEventId: 'evt-excluded',
      }),
    ).resolves.toBe(true);
  });

  it('allows a calendar event whose connected account did not opt out', async () => {
    await expect(
      service.isCalendarEventExcluded({
        workspaceId: 'workspace-1',
        calendarEventId: 'evt-allowed',
      }),
    ).resolves.toBe(false);
  });

  it('fails closed when the exclusion state cannot be resolved', async () => {
    messageChannels.find.mockRejectedValueOnce(new Error('db down'));

    await expect(
      service.isMessageExcluded({
        workspaceId: 'workspace-1',
        messageId: 'msg-allowed',
      }),
    ).resolves.toBe(true);
  });
});
