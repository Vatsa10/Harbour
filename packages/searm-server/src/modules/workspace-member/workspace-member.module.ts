import { Module } from '@nestjs/common';

import { FeatureFlagModule } from 'src/engine/core-modules/feature-flag/feature-flag.module';
import { FileModule } from 'src/engine/core-modules/file/file.module';
import { SearmORMModule } from 'src/engine/searm-orm/searm-orm.module';
import { WorkspaceMemberAvatarFileDeletionListener } from 'src/modules/workspace-member/listeners/workspace-member-avatar-file-deletion.listener';

@Module({
  imports: [SearmORMModule, FeatureFlagModule, FileModule],

  providers: [WorkspaceMemberAvatarFileDeletionListener],
})
export class WorkspaceMemberModule {}
