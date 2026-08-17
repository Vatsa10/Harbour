import { Injectable } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';
import { In } from 'typeorm';

import { EvidenceEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/evidence.entity';
import { FactEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/fact.entity';
import { UNATTRIBUTED_SOURCE_TYPE } from 'src/engine/metadata-modules/ai/ai-research/types/fact-freshness.type';
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

// One flat count row. Same boundary rule as the projections above: the
// dashboard gets keys and numbers, never a Fact.
export type FactCountByKey = {
  key: string;
  count: number;
};

// Bucketing runs in SQL against now(), so "fresh" is evaluated at query time
// on the database clock rather than against a timestamp the caller passed in.
// Duplicated verbatim in SELECT and GROUP BY because Postgres will not group
// by a select alias in this position.
const FRESHNESS_BUCKET_EXPRESSION = `CASE
  WHEN fact."lastObservedAt" >= now() - interval '7 days' THEN 'LAST_7_DAYS'
  WHEN fact."lastObservedAt" >= now() - interval '30 days' THEN 'LAST_30_DAYS'
  WHEN fact."lastObservedAt" >= now() - interval '90 days' THEN 'LAST_90_DAYS'
  ELSE 'OLDER_THAN_90_DAYS'
END`;

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

  // ---------------------------------------------------------------------
  // Aggregates for the evidence & cost dashboard.
  //
  // Owner Decision 1 again: the dashboard module never sees FactEntity or a
  // Fact repository, only these flat count rows. That is also why the
  // fact-to-evidence join lives here rather than in the dashboard service —
  // it is a Fact-internal detail (evidenceIds[0] is the originating
  // observation) and moving it out would leak the schema this boundary hides.
  // ---------------------------------------------------------------------

  // Facts grouped by the source type of the evidence that created them.
  // Aggregated in SQL, not by loading rows: a workspace with a year of
  // research has far more facts than a request should pull into memory.
  async countCurrentFactsBySourceType(
    workspaceId: string,
  ): Promise<FactCountByKey[]> {
    const rows = await this.factRepository
      .createQueryBuilder('fact')
      .leftJoin(
        EvidenceEntity,
        'evidence',
        // NULLIF guards the empty-array case: `'[]'::jsonb ->> 0` is NULL
        // already, but a stored empty string would fail the uuid cast and
        // take the whole query down. Re-asserting workspaceId on the joined
        // side keeps a cross-tenant evidence row unreachable even if a fact
        // somehow cited one.
        `evidence.id = NULLIF(fact."evidenceIds" ->> 0, '')::uuid
         AND evidence."workspaceId" = fact."workspaceId"`,
      )
      .select('evidence.sourceType', 'key')
      .addSelect('COUNT(*)::int', 'count')
      // createQueryBuilder is an unscoped escape hatch — the workspace
      // predicate is ours to add.
      .where('fact.workspaceId = :workspaceId', { workspaceId })
      .andWhere('fact.status = :status', { status: FactStatus.CURRENT })
      .groupBy('evidence.sourceType')
      .getRawMany<{ key: string | null; count: number }>();

    return rows.map((row) => ({
      key: row.key ?? UNATTRIBUTED_SOURCE_TYPE,
      count: Number(row.count),
    }));
  }

  async countCurrentFactsByFreshness(
    workspaceId: string,
  ): Promise<FactCountByKey[]> {
    const rows = await this.factRepository
      .createQueryBuilder('fact')
      .select(FRESHNESS_BUCKET_EXPRESSION, 'key')
      .addSelect('COUNT(*)::int', 'count')
      .where('fact.workspaceId = :workspaceId', { workspaceId })
      .andWhere('fact.status = :status', { status: FactStatus.CURRENT })
      .groupBy(FRESHNESS_BUCKET_EXPRESSION)
      .getRawMany<{ key: string; count: number }>();

    return rows.map((row) => ({ key: row.key, count: Number(row.count) }));
  }

  // Facts currently asserting a value, and how many of those are contradicted.
  // Returned together because the conflict count is meaningless without its
  // denominator — "12 conflicts" reads very differently against 40 facts than
  // against 40,000.
  async countCurrentAndConflictedFacts(
    workspaceId: string,
  ): Promise<{ currentCount: number; conflictedCount: number }> {
    const [currentCount, conflictedCount] = await Promise.all([
      this.factRepository.count(workspaceId, {
        where: { status: FactStatus.CURRENT },
      }),
      this.factRepository.count(workspaceId, {
        where: { status: FactStatus.CURRENT, hasConflict: true },
      }),
    ]);

    return { currentCount, conflictedCount };
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
