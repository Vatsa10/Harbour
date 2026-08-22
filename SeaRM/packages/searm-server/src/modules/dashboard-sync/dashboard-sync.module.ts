import { Module } from '@nestjs/common';

import { WorkspaceManyOrAllFlatEntityMapsCacheModule } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.module';
import { SearmORMModule } from 'src/engine/searm-orm/searm-orm.module';
import { DashboardSyncService } from 'src/modules/dashboard-sync/services/dashboard-sync.service';

@Module({
  imports: [SearmORMModule, WorkspaceManyOrAllFlatEntityMapsCacheModule],
  providers: [DashboardSyncService],
  exports: [DashboardSyncService],
})
export class DashboardSyncModule {}
