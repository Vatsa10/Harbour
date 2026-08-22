import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isDefined } from 'searm-shared/utils';
import { Repository } from 'typeorm';

import { MessageChannelPendingGroupEmailsAction } from 'searm-shared/types';
import { MessageFolderEntity } from 'src/engine/metadata-modules/message-folder/entities/message-folder.entity';
import { GlobalWorkspaceOrmManager } from 'src/engine/searm-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/searm-orm/utils/build-system-auth-context.util';
import { MessagingDeleteGroupEmailMessagesService } from 'src/modules/messaging/message-import-manager/services/messaging-delete-group-email-messages.service';
import { MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';

@Injectable()
export class MessagingProcessGroupEmailActionsService {
  private readonly logger = new Logger(
    MessagingProcessGroupEmailActionsService.name,
  );

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    @InjectRepository(MessageChannelEntity)
    private readonly messageChannelRepository: Repository<MessageChannelEntity>,
    @InjectRepository(MessageFolderEntity)
    private readonly messageFolderRepository: Repository<MessageFolderEntity>,
    private readonly messagingDeleteGroupEmailMessagesService: MessagingDeleteGroupEmailMessagesService,
  ) {}

  async markMessageChannelAsPendingGroupEmailsAction(
    messageChannel: MessageChannelEntity,
    workspaceId: string,
    pendingGroupEmailsAction: MessageChannelPendingGroupEmailsAction,
  ): Promise<void> {
    await this.messageChannelRepository.update(
      { id: messageChannel.id, workspaceId },
      { pendingGroupEmailsAction },
    );

    this.logger.debug(
      `WorkspaceId: ${workspaceId}, MessageChannelId: ${messageChannel.id} - Marked message channel as pending group emails action: ${pendingGroupEmailsAction}`,
    );
  }

  async processGroupEmailActions(
    messageChannel: MessageChannelEntity,
    workspaceId: string,
  ): Promise<void> {
    const { pendingGroupEmailsAction } = messageChannel;

    if (
      !isDefined(pendingGroupEmailsAction) ||
      pendingGroupEmailsAction === MessageChannelPendingGroupEmailsAction.NONE
    ) {
      return;
    }

    this.logger.debug(
      `WorkspaceId: ${workspaceId}, MessageChannelId: ${messageChannel.id} - Processing group email action: ${pendingGroupEmailsAction}`,
    );

    const authContext = buildSystemAuthContext(workspaceId);

    try {
      await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        async () => {
          switch (pendingGroupEmailsAction) {
            case MessageChannelPendingGroupEmailsAction.GROUP_EMAILS_DELETION:
              await this.handleGroupEmailsDeletion(
                workspaceId,
                messageChannel.id,
              );
              break;
            case MessageChannelPendingGroupEmailsAction.GROUP_EMAILS_IMPORT:
              await this.handleGroupEmailsImport(
                workspaceId,
                messageChannel.id,
              );
              break;
          }
        },
        authContext,
        { lite: true },
      );

      await this.messageChannelRepository.update(
        { id: messageChannel.id, workspaceId },
        {
          pendingGroupEmailsAction: MessageChannelPendingGroupEmailsAction.NONE,
        },
      );

      this.logger.debug(
        `WorkspaceId: ${workspaceId}, MessageChannelId: ${messageChannel.id} - Reset pendingGroupEmailsAction to NONE`,
      );
    } catch (error) {
      this.logger.error(
        `WorkspaceId: ${workspaceId}, MessageChannelId: ${messageChannel.id} - Error processing group email action: ${error.message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  private async handleGroupEmailsDeletion(
    workspaceId: string,
    messageChannelId: string,
  ): Promise<void> {
    await this.messagingDeleteGroupEmailMessagesService.deleteGroupEmailMessages(
      workspaceId,
      messageChannelId,
    );

    await this.resetCursors(workspaceId, messageChannelId);

    this.logger.debug(
      `WorkspaceId: ${workspaceId}, MessageChannelId: ${messageChannelId} - Completed GROUP_EMAILS_DELETION action`,
    );
  }

  private async handleGroupEmailsImport(
    workspaceId: string,
    messageChannelId: string,
  ): Promise<void> {
    await this.resetCursors(workspaceId, messageChannelId);

    this.logger.debug(
      `WorkspaceId: ${workspaceId}, MessageChannelId: ${messageChannelId} - Completed GROUP_EMAILS_IMPORT action`,
    );
  }

  private async resetCursors(workspaceId: string, messageChannelId: string) {
    await this.messageChannelRepository.update(
      { id: messageChannelId, workspaceId },
      { syncCursor: '' },
    );

    await this.messageFolderRepository.update(
      { messageChannelId, workspaceId },
      { syncCursor: '' },
    );
  }
}
