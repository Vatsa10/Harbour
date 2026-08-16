import { Injectable } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';
import { In } from 'typeorm';

import { EvidenceEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/evidence.entity';
import { FactEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/fact.entity';
import { FactStatus } from 'src/engine/metadata-modules/ai/ai-research/types/fact-status.type';
import { InjectWorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/inject-workspace-scoped-repository.decorator';
import { WorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/workspace-scoped-repository';

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

// The projection the record-brief composer reads. Same boundary rule as
// ProposalItemFact above: a flat shape, not the entity.
export type RecordBriefFact = {
  id: string;
  fieldName: string;
  value: unknown;
  strength: string;
  hasConflict: boolean;
  lastObservedAt: Date;
  evidenceCount: number;
};

@Injectable()
export class FactService {
  constructor(
    // Scoped wrappers, not raw repositories: every read below is keyed by ids
    // supplied by a caller, and without the workspace guard a caller holding
    // another tenant's fact id would be handed that tenant's citation.
    @InjectWorkspaceScopedRepository(FactEntity)
    private readonly factRepository: WorkspaceScopedRepository<FactEntity>,
    @InjectWorkspaceScopedRepository(EvidenceEntity)
    private readonly evidenceRepository: WorkspaceScopedRepository<EvidenceEntity>,
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

    const facts = await this.factRepository.find(params.workspaceId, {
      where: {
        objectNameSingular: params.objectNameSingular,
        recordId: params.recordId,
        fieldName: In(params.fieldNames),
        status: FactStatus.CURRENT,
      },
    });

    return facts.map((fact) => fact.id);
  }

  // The brief composer's whole view of Fact. Owner Decision 1: the brief
  // module never touches FactEntity or the repository, so promoting Fact to a
  // standard object stays a change to this file. Deliberately a flat
  // projection — evidenceCount, not evidenceIds, because corroboration count
  // is the only thing a gate needs and handing out ids invites a second query
  // path into Evidence from outside this module.
  async findCurrentFactsForRecord(params: {
    workspaceId: string;
    objectNameSingular: string;
    recordId: string;
  }): Promise<RecordBriefFact[]> {
    const facts = await this.factRepository.find(params.workspaceId, {
      where: {
        objectNameSingular: params.objectNameSingular,
        recordId: params.recordId,
        status: FactStatus.CURRENT,
      },
    });

    return facts.map((fact) => ({
      id: fact.id,
      fieldName: fact.fieldName,
      value: fact.value,
      strength: fact.strength,
      hasConflict: fact.hasConflict,
      lastObservedAt: fact.lastObservedAt,
      evidenceCount: fact.evidenceIds.length,
    }));
  }

  // The single citation surface for the approval UI. Two queries total for a
  // whole proposal item, not one per fact and one per evidence row: the
  // earlier design nested a FactDTO.evidence resolve field inside a
  // ProposalItemDTO.facts resolve field, an N+1 pair rendering one line.
  async findProposalItemFacts(
    workspaceId: string,
    ids: string[],
  ): Promise<ProposalItemFact[]> {
    if (ids.length === 0) {
      return [];
    }

    const facts = await this.factRepository.find(workspaceId, {
      where: { id: In(ids) },
    });

    // Only the first evidence row per fact is cited, so only those are
    // fetched. evidenceIds[0] is the observation that created the fact;
    // later entries corroborate the same value.
    const primaryEvidenceIds = facts
      .map((fact) => fact.evidenceIds[0])
      .filter((evidenceId): evidenceId is string => isDefined(evidenceId));

    const evidence =
      primaryEvidenceIds.length === 0
        ? []
        : await this.evidenceRepository.find(workspaceId, {
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

  // Which of these facts have left CURRENT — superseded by a later
  // observation, or dismissed by a reviewer. Proposal supersession asks this
  // to find drafts whose evidence no longer stands. Returns ids, not rows:
  // the caller only needs the set difference, and handing out FactEntity
  // would widen the one sanctioned Fact boundary this service exists to keep
  // narrow.
  async findNonCurrentFactIds(
    workspaceId: string,
    ids: string[],
  ): Promise<string[]> {
    if (ids.length === 0) {
      return [];
    }

    const facts = await this.factRepository.find(workspaceId, {
      where: { id: In(ids) },
    });

    const currentIds = new Set(
      facts
        .filter((fact) => fact.status === FactStatus.CURRENT)
        .map((fact) => fact.id),
    );

    // A cited id with no row at all counts as non-current: the citation is
    // dangling, which is strictly worse than superseded, not better.
    return ids.filter((id) => !currentIds.has(id));
  }

  // Permanently dismisses the facts behind a rejected proposal item, so a
  // later run does not re-propose a value a human already refused.
  async markDismissed(workspaceId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await this.factRepository.update(
      workspaceId,
      { id: In(ids) },
      { status: FactStatus.DISMISSED },
    );
  }
}
