import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isDefined } from 'searm-shared/utils';
import { In, type Repository } from 'typeorm';

import { CalendarChannelEntity } from 'src/engine/metadata-modules/calendar-channel/entities/calendar-channel.entity';
import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';
import { GlobalWorkspaceOrmManager } from 'src/engine/searm-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type CalendarChannelEventAssociationWorkspaceEntity } from 'src/modules/calendar/common/standard-objects/calendar-channel-event-association.workspace-entity';
import { type MessageChannelMessageAssociationWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-channel-message-association.workspace-entity';

/**
 * Owner Decision 3.
 *
 * Structured extraction sends raw message bodies and call-recording summaries
 * to a third-party LLM. This service answers the one question that must be
 * asked before any of that content is read: may this account's content leave
 * the instance at all?
 *
 * It is deliberately a separate service from the extraction itself so the
 * check can be made at the *enqueue* boundary — an excluded account's content
 * is never loaded, never serialised into a job payload, and never reaches a
 * model call.
 */
@Injectable()
export class AiExtractionExclusionService {
  private readonly logger = new Logger(AiExtractionExclusionService.name);

  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    // The association rows are workspace-schema; the channel and
    // connected-account rows they point at are core-schema, hence the mix of
    // GlobalWorkspaceOrmManager and plain @InjectRepository below.
    @InjectRepository(MessageChannelEntity)
    private readonly messageChannelRepository: Repository<MessageChannelEntity>,
    @InjectRepository(CalendarChannelEntity)
    private readonly calendarChannelRepository: Repository<CalendarChannelEntity>,
    @InjectRepository(ConnectedAccountEntity)
    private readonly connectedAccountRepository: Repository<ConnectedAccountEntity>,
  ) {}

  async isMessageExcluded(params: {
    workspaceId: string;
    messageId: string;
  }): Promise<boolean> {
    const { workspaceId, messageId } = params;

    try {
      const associationRepository =
        await this.globalWorkspaceOrmManager.getRepository<MessageChannelMessageAssociationWorkspaceEntity>(
          workspaceId,
          'messageChannelMessageAssociation',
          // Read-only provenance lookup: the exclusion decision must not
          // depend on what the actor that triggered ingestion can see, or a
          // narrow role would silently re-enable a disabled account.
          { shouldBypassPermissionChecks: true },
        );

      const associations = await associationRepository.find({
        where: { messageId },
      });

      const channelIds = associations
        .map((association) => association.messageChannelId)
        .filter(isDefined);

      if (channelIds.length === 0) {
        return false;
      }

      const channels = await this.messageChannelRepository.find({
        where: { id: In(channelIds) },
      });

      return await this.isAnyConnectedAccountExcluded(
        channels.map((channel) => channel.connectedAccountId),
      );
    } catch (error) {
      // Fail closed. An unresolvable exclusion state must not be read as
      // "allowed" — the cost of skipping one extraction is nothing next to
      // shipping an opted-out mailbox's content to a third party.
      this.logger.error(
        `Could not resolve AI-extraction exclusion for message ${messageId}; treating as excluded`,
        error instanceof Error ? error.stack : undefined,
      );

      return true;
    }
  }

  async isCalendarEventExcluded(params: {
    workspaceId: string;
    calendarEventId: string;
  }): Promise<boolean> {
    const { workspaceId, calendarEventId } = params;

    try {
      const associationRepository =
        await this.globalWorkspaceOrmManager.getRepository<CalendarChannelEventAssociationWorkspaceEntity>(
          workspaceId,
          'calendarChannelEventAssociation',
          { shouldBypassPermissionChecks: true },
        );

      const associations = await associationRepository.find({
        where: { calendarEventId },
      });

      const channelIds = associations
        .map((association) => association.calendarChannelId)
        .filter(isDefined);

      if (channelIds.length === 0) {
        return false;
      }

      const channels = await this.calendarChannelRepository.find({
        where: { id: In(channelIds) },
      });

      return await this.isAnyConnectedAccountExcluded(
        channels.map((channel) => channel.connectedAccountId),
      );
    } catch (error) {
      this.logger.error(
        `Could not resolve AI-extraction exclusion for calendar event ${calendarEventId}; treating as excluded`,
        error instanceof Error ? error.stack : undefined,
      );

      return true;
    }
  }

  // A message or event can be associated with several channels, and therefore
  // several connected accounts. One opted-out account is enough to suppress
  // extraction: the content is that account's regardless of who else holds a
  // copy, so the most restrictive setting wins.
  private async isAnyConnectedAccountExcluded(
    connectedAccountIds: (string | null)[],
  ): Promise<boolean> {
    const ids = connectedAccountIds.filter(isDefined);

    if (ids.length === 0) {
      return false;
    }

    const excludedCount = await this.connectedAccountRepository.count({
      where: { id: In(ids), excludeFromAiExtraction: true },
    });

    return excludedCount > 0;
  }
}
