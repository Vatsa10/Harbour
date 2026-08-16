import { Module } from '@nestjs/common';

import { KeyValuePairModule } from 'src/engine/core-modules/key-value-pair/key-value-pair.module';
import { IngestionSuppressionResolver } from 'src/modules/ingestion-noise-filter/resolvers/ingestion-suppression.resolver';
import { IngestionSuppressionService } from 'src/modules/ingestion-noise-filter/services/ingestion-suppression.service';

@Module({
  imports: [KeyValuePairModule],
  providers: [IngestionSuppressionService, IngestionSuppressionResolver],
  exports: [IngestionSuppressionService],
})
export class IngestionNoiseFilterModule {}
