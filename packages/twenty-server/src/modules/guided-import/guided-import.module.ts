import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { TokenModule } from 'src/engine/core-modules/auth/token/token.module';
import { WorkspaceCacheStorageModule } from 'src/engine/workspace-cache-storage/workspace-cache-storage.module';
import { RecordCrudModule } from 'src/engine/core-modules/record-crud/record-crud.module';
import { AiWriteApprovalModule } from 'src/engine/metadata-modules/ai/ai-write-approval/ai-write-approval.module';
import { UserRoleModule } from 'src/engine/metadata-modules/user-role/user-role.module';
import { WorkspaceCacheModule } from 'src/engine/workspace-cache/workspace-cache.module';
import { ImportExecutionService } from 'src/modules/guided-import/services/import-execution.service';
import { ImportBatchEntity } from 'src/modules/guided-import/entities/import-batch.entity';
import { ImportRowEntity } from 'src/modules/guided-import/entities/import-row.entity';
import { PermissionsModule } from 'src/engine/metadata-modules/permissions/permissions.module';
import { ImportBatchResolver } from 'src/modules/guided-import/resolvers/import-batch.resolver';
import { ImportFailedRowsController } from 'src/modules/guided-import/controllers/import-failed-rows.controller';
import { ImportMatchResolutionService } from 'src/modules/guided-import/services/import-match-resolution.service';
import { ImportValidationService } from 'src/modules/guided-import/services/import-validation.service';
import { MatchParticipantModule } from 'src/modules/match-participant/match-participant.module';
import { WorkspaceManyOrAllFlatEntityMapsCacheModule } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.module';

@Module({
  // ImportBatchResolver injects PermissionsService; without this import Nest
  // cannot resolve it and the whole application fails to boot.
  imports: [
    // One forFeature call, not two: two dynamic TypeOrmModule imports in the
    // same module collide on the same module token and only one survives.
    TypeOrmModule.forFeature([
      ImportBatchEntity,
      ImportRowEntity,
      UserEntity,
      UserWorkspaceEntity,
    ]),
    RecordCrudModule,
    AiWriteApprovalModule,
    UserRoleModule,
    WorkspaceCacheModule,
    PermissionsModule,
    // WorkspaceAuthGuard on ImportBatchResolver builds a JwtAuthGuard, which
    // needs AccessTokenService and WorkspaceCacheStorageService; without these
    // the whole application fails to boot.
    TokenModule,
    WorkspaceCacheStorageModule,
    MatchParticipantModule,
    WorkspaceManyOrAllFlatEntityMapsCacheModule,
  ],
  controllers: [ImportFailedRowsController],
  providers: [
    ImportBatchResolver,
    ImportMatchResolutionService,
    ImportValidationService,
    ImportExecutionService,
  ],
  exports: [ImportExecutionService],
})
export class GuidedImportModule {}
