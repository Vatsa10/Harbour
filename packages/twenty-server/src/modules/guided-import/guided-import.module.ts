import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ImportBatchEntity } from 'src/modules/guided-import/entities/import-batch.entity';
import { ImportRowEntity } from 'src/modules/guided-import/entities/import-row.entity';
import { PermissionsModule } from 'src/engine/metadata-modules/permissions/permissions.module';
import { ImportBatchResolver } from 'src/modules/guided-import/resolvers/import-batch.resolver';

@Module({
  // ImportBatchResolver injects PermissionsService; without this import Nest
  // cannot resolve it and the whole application fails to boot.
  imports: [
    TypeOrmModule.forFeature([ImportBatchEntity, ImportRowEntity]),
    PermissionsModule,
  ],
  providers: [ImportBatchResolver],
})
export class GuidedImportModule {}
