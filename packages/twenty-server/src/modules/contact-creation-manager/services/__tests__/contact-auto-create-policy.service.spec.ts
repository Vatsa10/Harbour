import { MessageParticipantRole } from 'twenty-shared/types';

import { type ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { ContactAutoCreatePolicyService } from 'src/modules/contact-creation-manager/services/contact-auto-create-policy.service';
import { MessageParticipantWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-participant.workspace-entity';
import { MessageWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message.workspace-entity';

type StoredMessage = { id: string; messageThreadId: string | null };
type StoredParticipant = {
  messageId: string;
  handle: string;
  role: MessageParticipantRole;
};

// In-memory stand-ins for the two workspace tables the gate reads. They honour
// the actual `In(...)` filters rather than returning a fixed array, because the
// thread-level fan-out (read every message of every candidate thread, not only
// the ingested ones) is precisely the seam under test.
const buildOrmManager = (
  messages: StoredMessage[],
  participants: StoredParticipant[],
) => {
  const inValues = (clause: unknown): string[] =>
    ((clause as { _value?: string[] })?._value ?? []) as string[];

  const messageRepository = {
    find: jest.fn(async (options: { where: Record<string, unknown> }) => {
      if ('id' in options.where) {
        const ids = inValues(options.where.id);

        return messages.filter((message) => ids.includes(message.id));
      }

      const threadIds = inValues(options.where.messageThreadId);

      return messages.filter(
        (message) =>
          message.messageThreadId !== null &&
          threadIds.includes(message.messageThreadId),
      );
    }),
  };

  const participantRepository = {
    find: jest.fn(async (options: { where: Record<string, unknown> }) => {
      const messageIds = inValues(options.where.messageId);

      return participants.filter(
        (participant) =>
          messageIds.includes(participant.messageId) &&
          participant.role === options.where.role,
      );
    }),
  };

  return {
    executeInWorkspaceContext: jest.fn(async (callback: () => unknown) =>
      callback(),
    ),
    getRepository: jest.fn(async (_workspaceId: string, entity: unknown) =>
      entity === MessageWorkspaceEntity
        ? messageRepository
        : entity === MessageParticipantWorkspaceEntity
          ? participantRepository
          : (() => {
              throw new Error('Unexpected repository requested');
            })(),
    ),
    messageRepository,
    participantRepository,
  };
};

describe('ContactAutoCreatePolicyService', () => {
  const connectedAccount = {
    handle: 'me@ourcompany.com',
    handleAliases: ['sales@ourcompany.com'],
  } as unknown as ConnectedAccountEntity;

  const build = (
    messages: StoredMessage[],
    participants: StoredParticipant[],
  ) => {
    const ormManager = buildOrmManager(messages, participants);

    return {
      ormManager,
      service: new ContactAutoCreatePolicyService(
        ormManager as unknown as GlobalWorkspaceOrmManager,
      ),
    };
  };

  // Rule 1: inbound-only mail never mints records.
  it('should gate a contact on a thread we never replied to', async () => {
    const { service } = build(
      [{ id: 'message-1', messageThreadId: 'thread-1' }],
      [
        {
          messageId: 'message-1',
          handle: 'cold@prospect.com',
          role: MessageParticipantRole.FROM,
        },
      ],
    );

    const { enrichOnlyHandles } = await service.evaluate({
      workspaceId: 'workspace-1',
      connectedAccount,
      contacts: [
        {
          handle: 'cold@prospect.com',
          displayName: 'Cold Prospect',
          messageId: 'message-1',
        },
      ],
    });

    expect([...enrichOnlyHandles]).toEqual(['cold@prospect.com']);
  });

  it('should allow a contact once we have ourselves sent into the thread', async () => {
    const { service } = build(
      [
        { id: 'message-1', messageThreadId: 'thread-1' },
        // Our own reply, older and not itself part of this ingestion batch.
        { id: 'message-0', messageThreadId: 'thread-1' },
      ],
      [
        {
          messageId: 'message-1',
          handle: 'customer@acme.com',
          role: MessageParticipantRole.FROM,
        },
        {
          messageId: 'message-0',
          handle: 'me@ourcompany.com',
          role: MessageParticipantRole.FROM,
        },
      ],
    );

    const { enrichOnlyHandles } = await service.evaluate({
      workspaceId: 'workspace-1',
      connectedAccount,
      contacts: [
        {
          handle: 'customer@acme.com',
          displayName: 'A Customer',
          messageId: 'message-1',
        },
      ],
    });

    expect(enrichOnlyHandles.size).toBe(0);
  });

  it('should count a handle alias as our own reply', async () => {
    const { service } = build(
      [{ id: 'message-1', messageThreadId: 'thread-1' }],
      [
        {
          messageId: 'message-1',
          handle: 'SALES@ourcompany.com',
          role: MessageParticipantRole.FROM,
        },
      ],
    );

    const { enrichOnlyHandles } = await service.evaluate({
      workspaceId: 'workspace-1',
      connectedAccount,
      contacts: [
        {
          handle: 'customer@acme.com',
          displayName: 'A Customer',
          messageId: 'message-1',
        },
      ],
    });

    expect(enrichOnlyHandles.size).toBe(0);
  });

  // Rule 3: the verdict belongs to the thread, so every message of that thread
  // inherits it rather than being re-resolved.
  it('should apply one thread verdict to every message of that thread', async () => {
    const { service, ormManager } = build(
      [
        { id: 'message-1', messageThreadId: 'thread-1' },
        { id: 'message-2', messageThreadId: 'thread-1' },
        { id: 'message-0', messageThreadId: 'thread-1' },
      ],
      [
        {
          messageId: 'message-0',
          handle: 'me@ourcompany.com',
          role: MessageParticipantRole.FROM,
        },
      ],
    );

    const { enrichOnlyHandles } = await service.evaluate({
      workspaceId: 'workspace-1',
      connectedAccount,
      contacts: [
        { handle: 'a@acme.com', displayName: 'A', messageId: 'message-1' },
        { handle: 'b@acme.com', displayName: 'B', messageId: 'message-2' },
      ],
    });

    expect(enrichOnlyHandles.size).toBe(0);
    // Resolved once for the run: two message lookups and one participant
    // lookup, regardless of how many messages or contacts came in.
    expect(ormManager.messageRepository.find).toHaveBeenCalledTimes(2);
    expect(ormManager.participantRepository.find).toHaveBeenCalledTimes(1);
  });

  it('should allow a handle that appears on both a gated and a replied-to thread', async () => {
    const { service } = build(
      [
        { id: 'message-1', messageThreadId: 'thread-1' },
        { id: 'message-2', messageThreadId: 'thread-2' },
        { id: 'message-0', messageThreadId: 'thread-2' },
      ],
      [
        {
          messageId: 'message-0',
          handle: 'me@ourcompany.com',
          role: MessageParticipantRole.FROM,
        },
      ],
    );

    const { enrichOnlyHandles } = await service.evaluate({
      workspaceId: 'workspace-1',
      connectedAccount,
      contacts: [
        { handle: 'dual@acme.com', displayName: 'Dual', messageId: 'message-1' },
        { handle: 'dual@acme.com', displayName: 'Dual', messageId: 'message-2' },
      ],
    });

    expect(enrichOnlyHandles.size).toBe(0);
  });

  it('should say nothing about contacts with no originating message', async () => {
    const { service, ormManager } = build([], []);

    const { enrichOnlyHandles } = await service.evaluate({
      workspaceId: 'workspace-1',
      connectedAccount,
      contacts: [{ handle: 'guest@acme.com', displayName: 'Guest' }],
    });

    expect(enrichOnlyHandles.size).toBe(0);
    expect(ormManager.executeInWorkspaceContext).not.toHaveBeenCalled();
  });

  it('should gate everything when the message is on no thread at all', async () => {
    const { service } = build(
      [{ id: 'message-1', messageThreadId: null }],
      [],
    );

    const { enrichOnlyHandles } = await service.evaluate({
      workspaceId: 'workspace-1',
      connectedAccount,
      contacts: [
        { handle: 'cold@prospect.com', displayName: 'Cold', messageId: 'message-1' },
      ],
    });

    expect([...enrichOnlyHandles]).toEqual(['cold@prospect.com']);
  });
});
