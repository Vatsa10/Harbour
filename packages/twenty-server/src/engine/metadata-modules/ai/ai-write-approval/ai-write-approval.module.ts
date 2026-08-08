import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { KeyValuePairModule } from 'src/engine/core-modules/key-value-pair/key-value-pair.module';
import { RecordCrudModule } from 'src/engine/core-modules/record-crud/record-crud.module';
import { ToolModule } from 'src/engine/core-modules/tool/tool.module';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { PermissionsModule } from 'src/engine/metadata-modules/permissions/permissions.module';
import { WorkspaceCacheModule } from 'src/engine/workspace-cache/workspace-cache.module';
import { AiResearchModule } from 'src/engine/metadata-modules/ai/ai-research/ai-research.module';
import { ProposalItemEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal-item.entity';
import { ProposalEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal.entity';
import { AiWritePolicyResolver } from 'src/engine/metadata-modules/ai/ai-write-approval/resolvers/ai-write-policy.resolver';
import { ProposalItemFieldsResolver } from 'src/engine/metadata-modules/ai/ai-write-approval/resolvers/proposal-item-fields.resolver';
import { ProposalResolver } from 'src/engine/metadata-modules/ai/ai-write-approval/resolvers/proposal.resolver';
import { AiWritePolicyService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/ai-write-policy.service';
import { ProposalExecutionService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-execution.service';
import { ProposalGateService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-gate.service';
import { UserRoleModule } from 'src/engine/metadata-modules/user-role/user-role.module';

@Module({
  imports: [
    // FactService only — the module exports no Fact repository.
    AiResearchModule,
    TypeOrmModule.forFeature([
      ProposalEntity,
      ProposalItemEntity,
      UserEntity,
      UserWorkspaceEntity,
    ]),
    KeyValuePairModule,
    RecordCrudModule,
    UserRoleModule,
    PermissionsModule,
    WorkspaceCacheModule,
    ToolModule,
  ],
  providers: [
    AiWritePolicyService,
    ProposalGateService,
    ProposalExecutionService,
    ProposalResolver,
    AiWritePolicyResolver,
    ProposalItemFieldsResolver,
  ],
  exports: [
    AiWritePolicyService,
    ProposalGateService,
    ProposalExecutionService,
  ],
})
export class AiWriteApprovalModule {}
