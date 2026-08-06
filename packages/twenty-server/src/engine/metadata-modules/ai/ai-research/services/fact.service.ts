import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isDefined } from 'twenty-shared/utils';
import { In, Repository } from 'typeorm';

import { EvidenceEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/evidence.entity';
import { FactEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/fact.entity';
import { FactStatus } from 'src/engine/metadata-modules/ai/ai-research/types/fact-status.type';

// The flat citation projection the approval UI renders. Deliberately not
// FactEntity and not EvidenceEntity: this is the whole contract other modules
// get, so promoting Fact to a standard object later changes this file only.
export type ProposalItemFact = {
  id: string;
  fieldName: string;
  strength: string;
  hasConflict: boolean;
  // Nulls when a fact somehow has no evidence row — a corrupt state the UI
  // must render as "no citation" rather than crash on.
  sourceType: string | null;
  sourceLocator: string | null;
  observedAt: Date | null;
};

@Injectable()
export class FactService {
  constructor(
    @InjectRepository(FactEntity)
    private readonly factRepository: Repository<FactEntity>,
    @InjectRepository(EvidenceEntity)
    private readonly evidenceRepository: Repository<EvidenceEntity>,
  ) {}

  async findCurrentFactIdsForFields(params: {
    workspaceId: string;
    objectNameSingular: string;
    recordId: string;
    fieldNames: string[];
  }): Promise<string[]> {
    if (params.fieldNames.length === 0) {
      return [];
    }

    const facts = await this.factRepository.find({
      where: {
        workspaceId: params.workspaceId,
        objectNameSingular: params.objectNameSingular,
        recordId: params.recordId,
        fieldName: In(params.fieldNames),
        status: FactStatus.CURRENT,
      },
    });

    return facts.map((fact) => fact.id);
  }

  // The single citation surface for the approval UI. Two queries total for a
  // whole proposal item, not one per fact and one per evidence row: the
  // earlier design nested a FactDTO.evidence resolve field inside a
  // ProposalItemDTO.facts resolve field, an N+1 pair rendering one line.
  async findProposalItemFacts(ids: string[]): Promise<ProposalItemFact[]> {
    if (ids.length === 0) {
      return [];
    }

    const facts = await this.factRepository.find({ where: { id: In(ids) } });

    // Only the first evidence row per fact is cited, so only those are
    // fetched. evidenceIds[0] is the observation that created the fact;
    // later entries corroborate the same value.
    const primaryEvidenceIds = facts
      .map((fact) => fact.evidenceIds[0])
      .filter((evidenceId): evidenceId is string => isDefined(evidenceId));

    const evidence =
      primaryEvidenceIds.length === 0
        ? []
        : await this.evidenceRepository.find({
            where: { id: In(primaryEvidenceIds) },
          });

    const evidenceById = new Map(evidence.map((row) => [row.id, row]));

    return facts.map((fact) => {
      const primary = evidenceById.get(fact.evidenceIds[0]);

      return {
        id: fact.id,
        fieldName: fact.fieldName,
        strength: fact.strength,
        hasConflict: fact.hasConflict,
        sourceType: primary?.sourceType ?? null,
        sourceLocator: primary?.sourceLocator ?? null,
        observedAt: primary?.observedAt ?? null,
      };
    });
  }

  // Permanently dismisses the facts behind a rejected proposal item, so a
  // later run does not re-propose a value a human already refused.
  async markDismissed(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await this.factRepository.update(
      { id: In(ids) },
      { status: FactStatus.DISMISSED },
    );
  }
}
