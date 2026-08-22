import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FeatureFlagModule } from 'src/engine/core-modules/feature-flag/feature-flag.module';
import { SearmConfigModule } from 'src/engine/core-modules/searm-config/searm-config.module';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { WorkspaceManyOrAllFlatEntityMapsCacheModule } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.module';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { PermissionsModule } from 'src/engine/metadata-modules/permissions/permissions.module';
import { RoleTargetEntity } from 'src/engine/metadata-modules/role-target/role-target.entity';
import { WorkspaceFeatureFlagsMapCacheModule } from 'src/engine/metadata-modules/workspace-feature-flags-map-cache/workspace-feature-flags-map-cache.module';
import { entitySchemaFactories } from 'src/engine/searm-orm/factories';
import { EntitySchemaFactory } from 'src/engine/searm-orm/factories/entity-schema.factory';
import { WorkspaceCacheStorageModule } from 'src/engine/workspace-cache-storage/workspace-cache-storage.module';
import { WorkspaceCacheModule } from 'src/engine/workspace-cache/workspace-cache.module';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ObjectMetadataEntity,
      RoleTargetEntity,
      WorkspaceEntity,
    ]),
    WorkspaceCacheStorageModule,
    WorkspaceManyOrAllFlatEntityMapsCacheModule,
    PermissionsModule,
    WorkspaceFeatureFlagsMapCacheModule,
    FeatureFlagModule,
    SearmConfigModule,
    WorkspaceCacheModule,
  ],
  providers: [...entitySchemaFactories],
  exports: [EntitySchemaFactory],
})
export class SearmORMModule {}
