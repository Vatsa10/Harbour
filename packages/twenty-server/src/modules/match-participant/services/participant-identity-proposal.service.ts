import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import { FieldActorSource } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

import { ProposalCreationService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-creation.service';
import { ProposalActionType } from 'src/engine/metadata-modules/ai/ai-write-approval/types/proposal-status.type';
import { IngestionSuppressionService } from 'src/modules/ingestion-noise-filter/services/ingestion-suppression.service';
import { IdentityResolutionService } from 'src/modules/match-participant/services/identity-resolution.service';

export type ParticipantObjectMetadataName =
  | 'messageParticipant'
  | 'calendarEventParticipant';

type UnmatchedParticipant = {
  id: string;
  handle: string | null;
  displayName: string | null;
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
}
