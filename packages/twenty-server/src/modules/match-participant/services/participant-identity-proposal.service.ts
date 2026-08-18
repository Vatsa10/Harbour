import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import { FieldActorSource } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

import { In, IsNull, Not } from 'typeorm';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { ProposalCreationService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-creation.service';
import { ProposalActionType } from 'src/engine/metadata-modules/ai/ai-write-approval/types/proposal-status.type';
import { type CalendarEventParticipantWorkspaceEntity } from 'src/modules/calendar/common/standard-objects/calendar-event-participant.workspace-entity';
import { IngestionSuppressionService } from 'src/modules/ingestion-noise-filter/services/ingestion-suppression.service';
import { IdentityResolutionService } from 'src/modules/match-participant/services/identity-resolution.service';
import { type MessageParticipantWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-participant.workspace-entity';
import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';

export type ParticipantObjectMetadataName =
  | 'messageParticipant'
  | 'calendarEventParticipant';

type UnmatchedParticipant = {
  id: string;
  handle: string | null;
  displayName: string | null;
  // The message or calendar-event this participant belongs to. Optional and
  // unused by the email/domain lanes — only the relationship lane below
  // needs it, to find co-participants already linked to a company.
  messageId?: string;
  calendarEventId?: string;
};

@Injectable()
export class ParticipantIdentityProposalService implements OnModuleInit {
  private readonly logger = new Logger(ParticipantIdentityProposalService.name);

  private proposalCreationService: ProposalCreationService;

  // Resolved through ModuleRef rather than declared as a module import:
  // AiWriteApprovalModule pulls in RecordCrudModule, which imports
  // CoreCommonApiModule, which transitively reaches this module again. That
  // module-file cycle crashes at CommonJS require time (TDZ), before Nest's
  // forwardRef can help, so the module graph edge is deliberately not created.
  constructor(
    private readonly identityResolutionService: IdentityResolutionService,
    private readonly ingestionSuppressionService: IngestionSuppressionService,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit() {
    this.proposalCreationService = this.moduleRef.get(ProposalCreationService, {
      strict: false,
    });
  }

  // Called after MatchParticipantService's exact-match pass with whatever is
  // still unmatched. A CANDIDATE result becomes a one-item proposal linking
  // personId — never a direct write, because a CANDIDATE is a guess and
  // linking the wrong person silently merges two people's correspondence.
  async reviewUnmatchedParticipants(params: {
    participants: UnmatchedParticipant[];
    objectMetadataName: ParticipantObjectMetadataName;
    workspaceId: string;
  }): Promise<void> {
    const { participants, objectMetadataName, workspaceId } = params;

    // The inbound noise filter runs here too: a noreply/machine participant
    // must not become a proposal any more than it may become a record.
    const noiseFilter =
      await this.ingestionSuppressionService.buildFilter(workspaceId);

    const relatedCompanyIdsByParticipantId = await this.buildRelatedCompanyIds(
      { participants, objectMetadataName, workspaceId },
    );

    for (const participant of participants) {
      if (!isDefined(participant.handle) || participant.handle === '') {
        continue;
      }

      if (noiseFilter.isSuppressed(participant.handle)) {
        continue;
      }

      try {
        const match = await this.identityResolutionService.resolvePerson({
          workspaceId,
          email: participant.handle,
          displayName: participant.displayName,
          relatedCompanyIds: relatedCompanyIdsByParticipantId.get(
            participant.id,
          ),
        });

        if (match.kind !== 'CANDIDATE') {
          continue;
        }

        await this.proposalCreationService.createFromExtraction({
          workspaceId,
          // Keyed on the participant row so a retried sync job re-proposing
          // the same link is a no-op rather than a duplicate proposal.
          sourceKey: `ingestion:${objectMetadataName}:${participant.id}`,
          reason: match.explanation,
          createdByActor: {
            source: FieldActorSource.EMAIL,
            workspaceMemberId: null,
            name: 'Participant identity matching',
            context: {},
          },
          items: [
            {
              actionType: ProposalActionType.UPDATE_RECORD,
              objectNameSingular: objectMetadataName,
              recordId: participant.id,
              payload: { personId: match.recordId },
              baseline: { personId: null },
            },
          ],
        });
      } catch (error) {
        // A failed identity proposal must never fail the surrounding message
        // or calendar sync — the participant simply stays unlinked.
        this.logger.warn(
          `Identity proposal failed for ${objectMetadataName} ${participant.id}: ${error}`,
        );
      }
    }
  }

  // Relationship signal: for each unmatched participant, find OTHER
  // participants on the same message/calendar-event who are already linked
  // to a person, and surface the companies those known people belong to.
  // Deliberately scoped to the same message/event — not the wider thread —
  // so the relationship stays a fact a reviewer can verify in one glance
  // ("this other attendee on the same email is already Jane at Acme").
  private async buildRelatedCompanyIds(params: {
    participants: UnmatchedParticipant[];
    objectMetadataName: ParticipantObjectMetadataName;
    workspaceId: string;
  }): Promise<Map<string, string[]>> {
    const { participants, objectMetadataName, workspaceId } = params;

    const parentIds = [
      ...new Set(
        participants
          .map((participant) =>
            objectMetadataName === 'messageParticipant'
              ? participant.messageId
              : participant.calendarEventId,
          )
          .filter(isDefined),
      ),
    ];

    const result = new Map<string, string[]>();

    if (parentIds.length === 0) {
      return result;
    }

    const participantRepository =
      objectMetadataName === 'messageParticipant'
        ? await this.globalWorkspaceOrmManager.getRepository<MessageParticipantWorkspaceEntity>(
            workspaceId,
            'messageParticipant',
            { shouldBypassPermissionChecks: true },
          )
        : await this.globalWorkspaceOrmManager.getRepository<CalendarEventParticipantWorkspaceEntity>(
            workspaceId,
            'calendarEventParticipant',
            { shouldBypassPermissionChecks: true },
          );

    const parentIdField =
      objectMetadataName === 'messageParticipant'
        ? 'messageId'
        : 'calendarEventId';

    const knownCoParticipants = (await participantRepository.find({
      where: {
        [parentIdField]: In(parentIds),
        personId: Not(IsNull()),
      } as never,
    })) as Array<{
      messageId?: string;
      calendarEventId?: string;
      personId: string | null;
    }>;

    const knownPersonIds = [
      ...new Set(
        knownCoParticipants
          .map((coParticipant) => coParticipant.personId)
          .filter(isDefined),
      ),
    ];

    if (knownPersonIds.length === 0) {
      return result;
    }

    const personRepository =
      await this.globalWorkspaceOrmManager.getRepository<PersonWorkspaceEntity>(
        workspaceId,
        'person',
        { shouldBypassPermissionChecks: true },
      );

    const knownPeople = await personRepository.find({
      where: { id: In(knownPersonIds) },
    });

    const companyIdByPersonId = new Map(
      knownPeople
        .filter((person) => isDefined(person.companyId))
        .map((person) => [person.id, person.companyId as string]),
    );

    // Group co-participants' company ids by parent (message/event) id.
    const companyIdsByParentId = new Map<string, Set<string>>();

    for (const coParticipant of knownCoParticipants) {
      const parentId =
        objectMetadataName === 'messageParticipant'
          ? coParticipant.messageId
          : coParticipant.calendarEventId;
      const companyId = isDefined(coParticipant.personId)
        ? companyIdByPersonId.get(coParticipant.personId)
        : undefined;

      if (!isDefined(parentId) || !isDefined(companyId)) {
        continue;
      }

      const existing = companyIdsByParentId.get(parentId) ?? new Set<string>();

      existing.add(companyId);
      companyIdsByParentId.set(parentId, existing);
    }

    for (const participant of participants) {
      const parentId =
        objectMetadataName === 'messageParticipant'
          ? participant.messageId
          : participant.calendarEventId;

      if (!isDefined(parentId)) {
        continue;
      }

      const companyIds = companyIdsByParentId.get(parentId);

      if (isDefined(companyIds) && companyIds.size > 0) {
        result.set(participant.id, [...companyIds]);
      }
    }

    return result;
  }
}
