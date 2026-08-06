import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ImportBatchEntity } from 'src/modules/guided-import/entities/import-batch.entity';
import { ImportRowEntity } from 'src/modules/guided-import/entities/import-row.entity';
import { ImportBatchResolver } from 'src/modules/guided-import/resolvers/import-batch.resolver';

@Module({
  imports: [TypeOrmModule.forFeature([ImportBatchEntity, ImportRowEntity])],
  providers: [ImportBatchResolver],
})
export class GuidedImportModule {}
