import { Injectable } from '@nestjs/common';

import { RecordBriefEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/record-brief.entity';
import { FactService } from 'src/engine/metadata-modules/ai/ai-research/services/fact.service';
import { type BriefRefusalReason } from 'src/engine/metadata-modules/ai/ai-research/types/record-brief.type';
import {
  composeRecordBrief,
  isBriefWorthy,
} from 'src/engine/metadata-modules/ai/ai-research/utils/compose-record-brief.util';
import { InjectWorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/inject-workspace-scoped-repository.decorator';
import { WorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/workspace-scoped-repository';

export type BriefGenerationResult =
  | { written: true; brief: RecordBriefEntity }
  // Not an error. A record with nothing sourced well enough to say has no
  // brief, and reporting that as a failure would push a caller to retry until
  // it got prose — the exact behaviour the gate exists to prevent.
  | { written: false; reason: BriefRefusalReason };

@Injectable()
export class RecordBriefService {
  constructor(
    @InjectWorkspaceScopedRepository(RecordBriefEntity)
    private readonly recordBriefRepository: WorkspaceScopedRepository<RecordBriefEntity>,
    // Fact is read only through FactService (Owner Decision 1) — no
    // FactEntity repository is injected here on purpose.
    private readonly factService: FactService,
  ) {}

  async findBrief(params: {
    workspaceId: string;
    objectNameSingular: string;
    recordId: string;
  }): Promise<RecordBriefEntity | null> {
    return this.recordBriefRepository.findOne(params.workspaceId, {
      where: {
        objectNameSingular: params.objectNameSingular,
        recordId: params.recordId,
      },
    });
  }

  async generateBrief(params: {
    workspaceId: string;
    objectNameSingular: string;
    recordId: string;
  }): Promise<BriefGenerationResult> {
    const facts = await this.factService.findCurrentFactsForRecord(params);

    const composed = composeRecordBrief({
      facts,
      objectNameSingular: params.objectNameSingular,
    });

    if (composed === null) {
      // A refusal deletes any previous brief rather than leaving it standing.
      // Regeneration is a full replacement, and replacement with nothing is a
      // legitimate outcome: once the evidence behind a sentence is dismissed
      // or contradicted, the panel must go quiet, not go stale.
      await this.recordBriefRepository.delete(params.workspaceId, {
        objectNameSingular: params.objectNameSingular,
        recordId: params.recordId,
      });

      return {
        written: false,
        reason: facts.some(isBriefWorthy)
          ? 'NARRATIVE_BELOW_FLOOR'
          : 'NO_QUALIFYING_EVIDENCE',
      };
    }

    const brief = await this.recordBriefRepository.upsertAndReturnOne(
      params.workspaceId,
      {
        objectNameSingular: params.objectNameSingular,
        recordId: params.recordId,
        narrative: composed.narrative,
        sections: composed.sections,
        factIds: composed.factIds,
        oldestObservedAt: composed.oldestObservedAt,
        refreshedAt: new Date(),
      },
      ['workspaceId', 'objectNameSingular', 'recordId'],
    );

    return { written: true, brief };
  }
}
