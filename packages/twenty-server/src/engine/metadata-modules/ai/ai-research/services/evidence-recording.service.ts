import { Injectable } from '@nestjs/common';

import { EvidenceEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/evidence.entity';
import { FactDerivationService } from 'src/engine/metadata-modules/ai/ai-research/services/fact-derivation.service';
import {
  type EvidenceAssertedBy,
  type EvidencePayload,
  type EvidenceSourceType,
  resolveEvidenceStrength,
} from 'src/engine/metadata-modules/ai/ai-research/types/evidence.type';
import { hashEvidencePayload } from 'src/engine/metadata-modules/ai/ai-research/utils/hash-evidence-payload.util';
import { InjectWorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/inject-workspace-scoped-repository.decorator';
import { WorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/workspace-scoped-repository';

export type RecordEvidenceParams = {
  workspaceId: string;
  runId: string | null;
  objectNameSingular: string;
  recordId: string;
  sourceType: EvidenceSourceType;
  // Required, not defaulted: a new caller must state whether a model chose the
  // source type or the server did. A default would silently hand the next
  // model-facing path the STRONG badge this parameter exists to withhold.
  assertedBy: EvidenceAssertedBy;
  sourceLocator: string;
  extractor: string;
  observedAt?: Date;
  payload: EvidencePayload;
};

@Injectable()
export class EvidenceRecordingService {
  constructor(
    // Scoped wrapper stamps and enforces workspaceId on the insert, so an
    // observation can never be filed against another tenant's record.
    @InjectWorkspaceScopedRepository(EvidenceEntity)
    private readonly evidenceRepository: WorkspaceScopedRepository<EvidenceEntity>,
    private readonly factDerivationService: FactDerivationService,
  ) {}

  // The only way a fact is ever born: an observation is persisted first, then
  // derived from. Nothing may write a fact without going through here, which
  // is what makes "every fact cites evidence" structural rather than a
  // convention someone has to remember.
  async recordEvidence(params: RecordEvidenceParams): Promise<EvidenceEntity> {
    const evidence = (await this.evidenceRepository.save(params.workspaceId, {
      runId: params.runId,
      objectNameSingular: params.objectNameSingular,
      recordId: params.recordId,
      sourceType: params.sourceType,
      sourceLocator: params.sourceLocator,
      extractor: params.extractor,
      observedAt: params.observedAt ?? new Date(),
      payload: params.payload,
      payloadHash: hashEvidencePayload(params.payload),
      // Deterministic — this is the one line that decides strength, and it
      // reads from the fixed table only for source types the SERVER observed.
      // Anything a model asserted is WEAK regardless of what it called it.
      strength: resolveEvidenceStrength({
        sourceType: params.sourceType,
        assertedBy: params.assertedBy,
      }),
    })) as EvidenceEntity;

    // Deliberately not caught: a derivation failure leaves the observation on
    // file but must reach the caller, otherwise the evidence→fact chain can
    // break silently and the agent believes its finding was captured.
    await this.factDerivationService.deriveFact(evidence);

    return evidence;
  }
}
