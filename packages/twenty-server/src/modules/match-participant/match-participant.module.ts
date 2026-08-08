import { Module } from '@nestjs/common';

import { MatchParticipantService } from 'src/modules/match-participant/match-participant.service';
import { IdentityResolutionService } from 'src/modules/match-participant/services/identity-resolution.service';

@Module({
  imports: [],
  providers: [MatchParticipantService, IdentityResolutionService],
  exports: [MatchParticipantService, IdentityResolutionService],
})
export class MatchParticipantModule {}
