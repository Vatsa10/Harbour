import { Module } from '@nestjs/common';

import { ApplicationModule } from 'src/engine/core-modules/application/application.module';
import { SearmConfigModule } from 'src/engine/core-modules/searm-config/searm-config.module';
import { WorkspaceManyOrAllFlatEntityMapsCacheModule } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.module';
import { GlobalWorkspaceDataSourceModule } from 'src/engine/searm-orm/global-workspace-datasource/global-workspace-datasource.module';
import { WorkspaceCacheModule } from 'src/engine/workspace-cache/workspace-cache.module';
import { WorkspaceMigrationModule } from 'src/engine/workspace-manager/workspace-migration/workspace-migration.module';

import { SearmStandardApplicationService } from './services/searm-standard-application.service';

@Module({
  providers: [SearmStandardApplicationService],
  imports: [
    ApplicationModule,
    SearmConfigModule,
    WorkspaceCacheModule,
    WorkspaceMigrationModule,
    GlobalWorkspaceDataSourceModule,
    WorkspaceManyOrAllFlatEntityMapsCacheModule,
  ],
  exports: [SearmStandardApplicationService],
})
export class SearmStandardApplicationModule {}
