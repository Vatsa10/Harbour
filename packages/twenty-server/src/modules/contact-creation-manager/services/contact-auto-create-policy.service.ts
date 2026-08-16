import { Injectable } from '@nestjs/common';

import { MessageParticipantRole } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { In } from 'typeorm';

import { type ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { type Contact } from 'src/modules/contact-creation-manager/types/contact.type';
import { MessageParticipantWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-participant.workspace-entity';
import { MessageWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message.workspace-entity';

// The three auto-create rules this service enforces, all ported deliberately:
//
// 1. RECIPROCITY GATE — a new Person or Company is minted from an ingested
//    message only if the workspace has *itself* sent something into that
//    thread. Inbound-only mail (cold outreach, newsletters, receipts) never
//    mints records, however permissive the channel's auto-creation policy is.
//
// 2. NO MATCH, NO ROW — a gated contact that also matches no existing CRM
//    record produces nothing at all. There is no orphan-contact table. (Rule 2
//    is completed in CreateCompanyAndPersonService, which is the only place
//    that knows whether an existing Person matched: a gated handle is dropped
//    from the create, restore and company-mint lists, leaving it eligible for
//    name enrichment of an already-existing Person and nothing else.)
//
// 3. THREAD LINKAGE RESOLVED ONCE — the reciprocity verdict is computed per
//    *thread*, once per ingestion run, and every message in that thread
//    inherits it. It is never re-resolved per message, so a thread cannot
//    drift between verdicts mid-run.
export type AutoCreatePolicyDecision = {
  // Handles (lowercased) that may not mint new records. They remain eligible
  // for enrichment of records that already exist.
  enrichOnlyHandles: Set<string>;
};

@Injectable()
export class ContactAutoCreatePolicyService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  async evaluate({
    workspaceId,
    connectedAccount,
    contacts,
  }: {
    workspaceId: string;
    connectedAccount: ConnectedAccountEntity;
    contacts: Contact[];
  }): Promise<AutoCreatePolicyDecision> {
    const messageIds = [
      ...new Set(
        contacts.map((contact) => contact.messageId).filter(isDefined),
      ),
    ];

    // Contacts with no originating message (the calendar path, and any legacy
    // caller) are outside this gate's evidence: it cannot say anything about
    // them, so it says nothing.
    if (messageIds.length === 0) {
      return { enrichOnlyHandles: new Set<string>() };
    }

    const { repliedToThreadIds, messageIdToThreadId } =
      await this.resolveRepliedToThreadIds({
        workspaceId,
        connectedAccount,
        messageIds,
      });

    const enrichOnlyHandles = new Set<string>();
    const allowedHandles = new Set<string>();

    for (const contact of contacts) {
      const handle = contact.handle.toLowerCase();

      if (!isDefined(contact.messageId)) {
        allowedHandles.add(handle);
        continue;
      }

      const threadId = messageIdToThreadId.get(contact.messageId);

      if (isDefined(threadId) && repliedToThreadIds.has(threadId)) {
        allowedHandles.add(handle);
        continue;
      }

      enrichOnlyHandles.add(handle);
    }

    // A handle seen on both a replied-to thread and an inbound-only one is
    // allowed: the reciprocity evidence exists somewhere for that person.
    for (const handle of allowedHandles) {
      enrichOnlyHandles.delete(handle);
    }

    return { enrichOnlyHandles };
  }

  // Rule 3: threads are resolved once per run and every message inherits its
  // thread's verdict. The map is returned, never held on the service — this is
  // a singleton and two ingestion runs overlap freely.
  private async resolveRepliedToThreadIds({
    workspaceId,
    connectedAccount,
    messageIds,
  }: {
    workspaceId: string;
    connectedAccount: ConnectedAccountEntity;
    messageIds: string[];
  }): Promise<{
    repliedToThreadIds: Set<string>;
    messageIdToThreadId: Map<string, string>;
  }> {
    const ourHandles = [
      connectedAccount.handle,
      ...(connectedAccount.handleAliases ?? []),
    ]
      .filter(isDefined)
      .map((handle) => handle.toLowerCase());

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const messageRepository =
          await this.globalWorkspaceOrmManager.getRepository(
            workspaceId,
            MessageWorkspaceEntity,
            { shouldBypassPermissionChecks: true },
          );

        const ingestedMessages = await messageRepository.find({
          where: { id: In(messageIds) },
          select: { id: true, messageThreadId: true },
        });

        const messageIdToThreadId = new Map<string, string>();

        for (const message of ingestedMessages) {
          if (isDefined(message.messageThreadId)) {
            messageIdToThreadId.set(message.id, message.messageThreadId);
          }
        }

        const threadIds = [...new Set(messageIdToThreadId.values())];

        if (threadIds.length === 0 || ourHandles.length === 0) {
          return { repliedToThreadIds: new Set<string>(), messageIdToThreadId };
        }

        // Every message of every candidate thread, not only the ingested ones:
        // the reply that establishes reciprocity is usually an older message.
        const threadMessages = await messageRepository.find({
          where: { messageThreadId: In(threadIds) },
          select: { id: true, messageThreadId: true },
        });

        const threadIdByMessageId = new Map(
          threadMessages
            .filter((message) => isDefined(message.messageThreadId))
            .map((message) => [
              message.id,
              message.messageThreadId as string,
            ]),
        );

        if (threadIdByMessageId.size === 0) {
          return { repliedToThreadIds: new Set<string>(), messageIdToThreadId };
        }

        const participantRepository =
          await this.globalWorkspaceOrmManager.getRepository(
            workspaceId,
            MessageParticipantWorkspaceEntity,
            { shouldBypassPermissionChecks: true },
          );

        const senders = await participantRepository.find({
          where: {
            messageId: In([...threadIdByMessageId.keys()]),
            role: MessageParticipantRole.FROM,
          },
          select: { messageId: true, handle: true },
        });

        const repliedToThreadIds = new Set<string>();

        for (const sender of senders) {
          if (
            !isDefined(sender.handle) ||
            !ourHandles.includes(sender.handle.toLowerCase())
          ) {
            continue;
          }

          const threadId = threadIdByMessageId.get(sender.messageId);

          if (isDefined(threadId)) {
            repliedToThreadIds.add(threadId);
          }
        }

        return { repliedToThreadIds, messageIdToThreadId };
      },
      buildSystemAuthContext(workspaceId),
      { lite: true },
    );
  }
}
