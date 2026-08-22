import { Module } from '@nestjs/common';

import { ObjectMetadataRepositoryModule } from 'src/engine/object-metadata-repository/object-metadata-repository.module';
import { SearmORMModule } from 'src/engine/searm-orm/searm-orm.module';
import { BlocklistValidationService } from 'src/modules/blocklist/blocklist-validation-manager/services/blocklist-validation.service';
import { BlocklistWorkspaceEntity } from 'src/modules/blocklist/standard-objects/blocklist.workspace-entity';

@Module({
  imports: [
    ObjectMetadataRepositoryModule.forFeature([BlocklistWorkspaceEntity]),
    SearmORMModule,
  ],
  providers: [BlocklistValidationService],
  exports: [BlocklistValidationService],
})
export class BlocklistValidationManagerModule {}
