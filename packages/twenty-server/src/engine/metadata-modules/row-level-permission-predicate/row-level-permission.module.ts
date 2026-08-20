// SeaRM — AGPL-3.0. Clean-room reimplementation, mirroring the structure of
// the already-AGPL ViewFilterGroupModule (no Enterprise source consulted).
// Class name (RowLevelPermissionModule) and provider/export shape fixed by
// its AGPL consumers: core-engine.module.ts and role.module.ts import
// { RowLevelPermissionModule }; role/tools/services/role-tool.workspace-service.ts
// and role/tools/types/role-tool-dependencies.type.ts inject both
// RowLevelPermissionPredicateService and RowLevelPermissionPredicateGroupService
// directly, so both must be exported providers here.

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ApplicationModule } from 'src/engine/core-modules/application/application.module';
import { WorkspaceManyOrAllFlatEntityMapsCacheModule } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.module';
import { RowLevelPermissionPredicateGroupEntity } from 'src/engine/metadata-modules/row-level-permission-predicate/entities/row-level-permission-predicate-group.entity';
import { RowLevelPermissionPredicateEntity } from 'src/engine/metadata-modules/row-level-permission-predicate/entities/row-level-permission-predicate.entity';
import { RowLevelPermissionPredicateGroupService } from 'src/engine/metadata-modules/row-level-permission-predicate/services/row-level-permission-predicate-group.service';
import { RowLevelPermissionPredicateService } from 'src/engine/metadata-modules/row-level-permission-predicate/services/row-level-permission-predicate.service';
import { provideWorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/provide-workspace-scoped-repository';
import { WorkspaceCacheStorageModule } from 'src/engine/workspace-cache-storage/workspace-cache-storage.module';
import { WorkspaceMigrationModule } from 'src/engine/workspace-manager/workspace-migration/workspace-migration.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RowLevelPermissionPredicateEntity,
      RowLevelPermissionPredicateGroupEntity,
    ]),
    WorkspaceCacheStorageModule,
    ApplicationModule,
    WorkspaceMigrationModule,
    WorkspaceManyOrAllFlatEntityMapsCacheModule,
  ],
  providers: [
    RowLevelPermissionPredicateService,
    RowLevelPermissionPredicateGroupService,
    provideWorkspaceScopedRepository(RowLevelPermissionPredicateEntity),
    provideWorkspaceScopedRepository(RowLevelPermissionPredicateGroupEntity),
  ],
  exports: [
    RowLevelPermissionPredicateService,
    RowLevelPermissionPredicateGroupService,
  ],
})
export class RowLevelPermissionModule {}
