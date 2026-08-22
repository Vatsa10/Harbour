import { Module } from '@nestjs/common';

import { IngestionNoiseFilterModule } from 'src/modules/ingestion-noise-filter/ingestion-noise-filter.module';
import { MatchParticipantService } from 'src/modules/match-participant/match-participant.service';
import { IdentityResolutionService } from 'src/modules/match-participant/services/identity-resolution.service';
import { ParticipantIdentityProposalService } from 'src/modules/match-participant/services/participant-identity-proposal.service';

// AiWriteApprovalModule is deliberately NOT imported here — see the ModuleRef
// comment in ParticipantIdentityProposalService for the require cycle it
// would create.
@Module({
  imports: [IngestionNoiseFilterModule],
  providers: [
    MatchParticipantService,
    IdentityResolutionService,
    ParticipantIdentityProposalService,
  ],
  exports: [
    MatchParticipantService,
    IdentityResolutionService,
    ParticipantIdentityProposalService,
  ],
})
export class MatchParticipantModule {}
