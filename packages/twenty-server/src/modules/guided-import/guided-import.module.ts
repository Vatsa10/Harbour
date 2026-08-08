import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ImportBatchEntity } from 'src/modules/guided-import/entities/import-batch.entity';
import { ImportRowEntity } from 'src/modules/guided-import/entities/import-row.entity';
import { PermissionsModule } from 'src/engine/metadata-modules/permissions/permissions.module';
import { ImportBatchResolver } from 'src/modules/guided-import/resolvers/import-batch.resolver';
import { ImportMatchResolutionService } from 'src/modules/guided-import/services/import-match-resolution.service';
import { ImportValidationService } from 'src/modules/guided-import/services/import-validation.service';
import { MatchParticipantModule } from 'src/modules/match-participant/match-participant.module';
import { WorkspaceManyOrAllFlatEntityMapsCacheModule } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.module';

@Module({
  // ImportBatchResolver injects PermissionsService; without this import Nest
  // cannot resolve it and the whole application fails to boot.
  imports: [
    TypeOrmModule.forFeature([ImportBatchEntity, ImportRowEntity]),
    PermissionsModule,
    MatchParticipantModule,
    WorkspaceManyOrAllFlatEntityMapsCacheModule,
  ],
  providers: [
    ImportBatchResolver,
    ImportMatchResolutionService,
    ImportValidationService,
  ],
})
export class GuidedImportModule {}
