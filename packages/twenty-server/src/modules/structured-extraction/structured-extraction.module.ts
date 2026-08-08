import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CalendarChannelEntity } from 'src/engine/metadata-modules/calendar-channel/entities/calendar-channel.entity';
import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';
import { GlobalWorkspaceDataSourceModule } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-datasource.module';
import { AiExtractionExclusionService } from 'src/modules/structured-extraction/services/ai-extraction-exclusion.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MessageChannelEntity,
      CalendarChannelEntity,
      ConnectedAccountEntity,
    ]),
    GlobalWorkspaceDataSourceModule,
  ],
  providers: [AiExtractionExclusionService],
  exports: [AiExtractionExclusionService],
})
export class StructuredExtractionModule {}
