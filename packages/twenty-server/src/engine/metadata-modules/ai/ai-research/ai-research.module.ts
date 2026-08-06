import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CreateAgentTaskTool } from 'src/engine/core-modules/tool/tools/create-agent-task-tool/create-agent-task-tool';
import { RecordEvidenceTool } from 'src/engine/core-modules/tool/tools/record-evidence-tool/record-evidence-tool';
import { AgentEntity } from 'src/engine/metadata-modules/ai/ai-agent/entities/agent.entity';
import { AiAgentRoleModule } from 'src/engine/metadata-modules/ai/ai-agent-role/ai-agent-role.module';
import { AgentRunEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/agent-run.entity';
import { AgentTaskEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/agent-task.entity';
import { EvidenceEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/evidence.entity';
import { FactEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/fact.entity';
import { AgentTaskService } from 'src/engine/metadata-modules/ai/ai-research/services/agent-task.service';
import { EvidenceRecordingService } from 'src/engine/metadata-modules/ai/ai-research/services/evidence-recording.service';
import { FactDerivationService } from 'src/engine/metadata-modules/ai/ai-research/services/fact-derivation.service';
import { ResearchAgentService } from 'src/engine/metadata-modules/ai/ai-research/services/research-agent.service';
import { RoleTargetEntity } from 'src/engine/metadata-modules/role-target/role-target.entity';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';
import { provideWorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/provide-workspace-scoped-repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      EvidenceEntity,
      FactEntity,
      AgentTaskEntity,
      AgentRunEntity,
      AgentEntity,
      RoleEntity,
      RoleTargetEntity,
    ]),
    AiAgentRoleModule,
  ],
  providers: [
    AgentTaskService,
    ResearchAgentService,
    CreateAgentTaskTool,
    RecordEvidenceTool,
    EvidenceRecordingService,
    FactDerivationService,
    provideWorkspaceScopedRepository(EvidenceEntity),
    provideWorkspaceScopedRepository(FactEntity),
  ],
  // TypeOrmModule is deliberately NOT re-exported. Exporting it would put
  // Repository<FactEntity> in every importing module's injector and reopen the
  // direct-query path the evidence contract closes.
  // EvidenceRecordingService is exported, FactDerivationService is not:
  // deriving a fact without first persisting the observation it came from is
  // exactly the evidence-contract violation this module exists to prevent.
  exports: [
    AgentTaskService,
    ResearchAgentService,
    CreateAgentTaskTool,
    RecordEvidenceTool,
    EvidenceRecordingService,
  ],
})
export class AiResearchModule {}
