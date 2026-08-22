import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AiModelsModule } from 'src/engine/metadata-modules/ai/ai-models/ai-models.module';
import { AiResearchModule } from 'src/engine/metadata-modules/ai/ai-research/ai-research.module';
import { AiWriteApprovalModule } from 'src/engine/metadata-modules/ai/ai-write-approval/ai-write-approval.module';
import { CalendarChannelEntity } from 'src/engine/metadata-modules/calendar-channel/entities/calendar-channel.entity';
import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';
import { GlobalWorkspaceDataSourceModule } from 'src/engine/searm-orm/global-workspace-datasource/global-workspace-datasource.module';
import { CalendarEventExtractionListener } from 'src/modules/structured-extraction/listeners/calendar-event-extraction.listener';
import { MessageExtractionListener } from 'src/modules/structured-extraction/listeners/message-extraction.listener';
import { IngestionNoiseFilterModule } from 'src/modules/ingestion-noise-filter/ingestion-noise-filter.module';
import { AiExtractionExclusionService } from 'src/modules/structured-extraction/services/ai-extraction-exclusion.service';
import { StructuredExtractionService } from 'src/modules/structured-extraction/services/structured-extraction.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MessageChannelEntity,
      CalendarChannelEntity,
      ConnectedAccountEntity,
    ]),
    GlobalWorkspaceDataSourceModule,
    // EvidenceRecordingService only: facts are never written directly, they
    // are derived from a recorded observation.
    AiResearchModule,
    // ProposalCreationService, which is also where the write policy is
    // consulted — extraction has no second route to a CRM record.
    AiWriteApprovalModule,
    AiModelsModule,
    IngestionNoiseFilterModule,
  ],
  providers: [
    AiExtractionExclusionService,
    StructuredExtractionService,
    MessageExtractionListener,
    CalendarEventExtractionListener,
  ],
  exports: [AiExtractionExclusionService, StructuredExtractionService],
})
export class StructuredExtractionModule {}
