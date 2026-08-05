import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { KeyValuePairModule } from 'src/engine/core-modules/key-value-pair/key-value-pair.module';
import { RecordCrudModule } from 'src/engine/core-modules/record-crud/record-crud.module';
import { ProposalItemEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal-item.entity';
import { ProposalEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal.entity';
import { AiWritePolicyService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/ai-write-policy.service';
import { ProposalGateService } from 'src/engine/metadata-modules/ai/ai-write-approval/services/proposal-gate.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProposalEntity, ProposalItemEntity], 'core'),
    KeyValuePairModule,
    RecordCrudModule,
  ],
  providers: [AiWritePolicyService, ProposalGateService],
  exports: [AiWritePolicyService, ProposalGateService],
})
export class AiWriteApprovalModule {}
