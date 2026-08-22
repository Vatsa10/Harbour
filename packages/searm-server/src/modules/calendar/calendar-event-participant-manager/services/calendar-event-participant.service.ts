import { Injectable } from '@nestjs/common';

import { isDefined } from 'class-validator';
import chunk from 'lodash.chunk';
import differenceWith from 'lodash.differencewith';
import { FieldActorSource } from 'searm-shared/types';
import { Any, In, IsNull } from 'typeorm';

import { type CalendarChannelEntity } from 'src/engine/metadata-modules/calendar-channel/entities/calendar-channel.entity';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { type WorkspaceEntityManager } from 'src/engine/searm-orm/entity-manager/workspace-entity-manager';
import { GlobalWorkspaceOrmManager } from 'src/engine/searm-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/searm-orm/utils/build-system-auth-context.util';
import { type CalendarEventParticipantWorkspaceEntity } from 'src/modules/calendar/common/standard-objects/calendar-event-participant.workspace-entity';
import { type FetchedCalendarEventParticipant } from 'src/modules/calendar/common/types/fetched-calendar-event';
import { type ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import {
  CreateCompanyAndContactJob,
  type CreateCompanyAndContactJobData,
} from 'src/modules/contact-creation-manager/jobs/create-company-and-contact.job';
import { MatchParticipantService } from 'src/modules/match-participant/match-participant.service';
import { ParticipantIdentityProposalService } from 'src/modules/match-participant/services/participant-identity-proposal.service';

type FetchedCalendarEventParticipantWithCalendarEventId =
  FetchedCalendarEventParticipant & {
    calendarEventId: string;
  };

type FetchedCalendarEventParticipantWithCalendarEventIdAndExistingId =
  FetchedCalendarEventParticipantWithCalendarEventId & {
    id: string;
  };

@Injectable()
export class CalendarEventParticipantService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly matchParticipantService: MatchParticipantService<CalendarEventParticipantWorkspaceEntity>,
    @InjectMessageQueue(MessageQueue.contactCreationQueue)
    private readonly messageQueueService: MessageQueueService,
    private readonly participantIdentityProposalService: ParticipantIdentityProposalService,
  ) {}

  public async upsertAndDeleteCalendarEventParticipants({
    participantsToCreate,
    participantsToUpdate,
    transactionManager,
    calendarChannel,
    connectedAccount,
    workspaceId,
  }: {
    participantsToCreate: FetchedCalendarEventParticipantWithCalendarEventId[];
    participantsToUpdate: FetchedCalendarEventParticipantWithCalendarEventId[];
    transactionManager?: WorkspaceEntityManager;
    calendarChannel: CalendarChannelEntity;
    connectedAccount: ConnectedAccountEntity;
    workspaceId: string;
  }): Promise<void> {
    const authContext = buildSystemAuthContext(workspaceId);

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const chunkedParticipantsToUpdate = chunk(participantsToUpdate, 200);

        const calendarEventParticipantRepository =
          await this.globalWorkspaceOrmManager.getRepository<CalendarEventParticipantWorkspaceEntity>(
            workspaceId,
            'calendarEventParticipant',
          );

        for (const participantsToUpdateChunk of chunkedParticipantsToUpdate) {
          const existingCalendarEventParticipants =
            await calendarEventParticipantRepository.find({
              where: {
                calendarEventId: Any(
                  participantsToUpdateChunk
                    .map((participant) => participant.calendarEventId)
                    .filter(isDefined),
                ),
              },
            });

          const {
            calendarEventParticipantsToUpdate,
            newCalendarEventParticipants,
          } = participantsToUpdateChunk.reduce<{
            calendarEventParticipantsToUpdate: FetchedCalendarEventParticipantWithCalendarEventIdAndExistingId[];
            newCalendarEventParticipants: FetchedCalendarEventParticipantWithCalendarEventId[];
          }>(
            (acc, calendarEventParticipant) => {
              const existingCalendarEventParticipant =
                existingCalendarEventParticipants.find(
                  (existingCalendarEventParticipant) =>
                    existingCalendarEventParticipant.handle ===
                      calendarEventParticipant.handle &&
                    existingCalendarEventParticipant.calendarEventId ===
                      calendarEventParticipant.calendarEventId,
                );

              if (existingCalendarEventParticipant) {
                acc.calendarEventParticipantsToUpdate.push({
                  ...calendarEventParticipant,
                  id: existingCalendarEventParticipant.id,
                });
              } else {
                acc.newCalendarEventParticipants.push(calendarEventParticipant);
              }

              return acc;
            },
            {
              calendarEventParticipantsToUpdate: [],
              newCalendarEventParticipants: [],
            },
          );

          const calendarEventParticipantsToDelete = differenceWith(
            existingCalendarEventParticipants,
            participantsToUpdateChunk,
            (existingCalendarEventParticipant, participantToUpdate) =>
              existingCalendarEventParticipant.handle ===
                participantToUpdate.handle &&
              existingCalendarEventParticipant.calendarEventId ===
                participantToUpdate.calendarEventId,
          );

          await calendarEventParticipantRepository.delete(
            {
              id: Any(
                calendarEventParticipantsToDelete.map(
                  (calendarEventParticipant) => calendarEventParticipant.id,
                ),
              ),
            },
            transactionManager,
          );

          await calendarEventParticipantRepository.updateMany(
            calendarEventParticipantsToUpdate.map((participant) => ({
              criteria: participant.id,
              partialEntity: participant,
            })),
            transactionManager,
          );
          participantsToCreate.push(...newCalendarEventParticipants);
        }

        const chunkedParticipantsToCreate = chunk(participantsToCreate, 200);
        const savedParticipants: CalendarEventParticipantWorkspaceEntity[] = [];

        for (const participantsToCreateChunk of chunkedParticipantsToCreate) {
          const savedParticipantsChunk =
            await calendarEventParticipantRepository.insert(
              participantsToCreateChunk,
              transactionManager,
            );

          savedParticipants.push(...savedParticipantsChunk.raw);
        }

        if (calendarChannel.isContactAutoCreationEnabled) {
          await this.messageQueueService.add<CreateCompanyAndContactJobData>(
            CreateCompanyAndContactJob.name,
            {
              workspaceId,
              connectedAccount,
              contactsToCreate: savedParticipants.map((participant) => ({
                handle: participant.handle ?? '',
                displayName:
                  participant.displayName ?? participant.handle ?? '',
              })),
              source: FieldActorSource.CALENDAR,
            },
          );
        }

        await this.matchParticipantService.matchParticipants({
          participants: savedParticipants,
          objectMetadataName: 'calendarEventParticipant',
          transactionManager,
          matchWith: 'workspaceMemberAndPerson',
          workspaceId,
        });

        // Second pass: anything the exact-match pass above left unlinked gets
        // a CANDIDATE lookup, which can only ever become a proposal.
        const savedParticipantIds: string[] = savedParticipants.map(
          (participant) => participant.id,
        );

        if (savedParticipantIds.length > 0) {
          // Must read through the caller's transaction manager: the rows above
          // were inserted inside it, so a default-connection read cannot see
          // them and would always yield an empty list.
          const stillUnmatched = await calendarEventParticipantRepository.find(
            {
              where: { id: In(savedParticipantIds), personId: IsNull() },
            },
            transactionManager,
          );

          await this.participantIdentityProposalService.reviewUnmatchedParticipants(
            {
              participants: stillUnmatched.map((participant) => ({
                id: participant.id,
                handle: participant.handle,
                displayName: participant.displayName,
                calendarEventId: participant.calendarEventId,
              })),
              objectMetadataName: 'calendarEventParticipant',
              workspaceId,
            },
          );
        }
      },
      authContext,
      { lite: true },
    );
  }
}
