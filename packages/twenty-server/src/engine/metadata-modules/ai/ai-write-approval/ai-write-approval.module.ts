import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { RecordCrudModule } from 'src/engine/core-modules/record-crud/record-crud.module';
import { ToolModule } from 'src/engine/core-modules/tool/tool.module';
import { ProposalItemEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal-item.entity';
import { ProposalEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal.entity';
import { ProposalExecutionService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-execution.service';
import { UserRoleModule } from 'src/engine/metadata-modules/user-role/user-role.module';

// Note: AiWritePolicyService and ProposalGateService (Task 3/4) are not yet
// wired into any module — that remains out of scope for this task, which
// only registers ProposalExecutionService (Task 5).
@Module({
  imports: [
    TypeOrmModule.forFeature([ProposalEntity, ProposalItemEntity], 'core'),
    RecordCrudModule,
    UserRoleModule,
    ToolModule,
  ],
  providers: [ProposalExecutionService],
  exports: [ProposalExecutionService],
})
export class AiWriteApprovalModule {}
