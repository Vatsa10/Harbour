import { Injectable } from '@nestjs/common';

import {
  type AiSpendBucketDTO,
  type AiTrustDashboardDTO,
} from 'src/engine/metadata-modules/ai/ai-trust-dashboard/dtos/ai-trust-dashboard.dto';
import {
  AI_SPEND_MAX_BUCKET_COUNT,
  AI_SPEND_PERIOD_TRUNC_UNIT,
  AiSpendPeriod,
} from 'src/engine/metadata-modules/ai/ai-trust-dashboard/types/ai-spend-period.type';
import { computeSpendWindowStart } from 'src/engine/metadata-modules/ai/ai-trust-dashboard/utils/compute-spend-window-start.util';
import {
  parseSpendRow,
  type RawSpendRow,
} from 'src/engine/metadata-modules/ai/ai-trust-dashboard/utils/parse-spend-row.util';
import { zeroFillCounts } from 'src/engine/metadata-modules/ai/ai-trust-dashboard/utils/zero-fill-counts.util';
import { AgentRunEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/agent-run.entity';
import { FactService } from 'src/engine/metadata-modules/ai/ai-research/services/fact.service';
import {
  FACT_FRESHNESS_BUCKETS,
  UNATTRIBUTED_SOURCE_TYPE,
} from 'src/engine/metadata-modules/ai/ai-research/types/fact-freshness.type';
import { EVIDENCE_SOURCE_STRENGTH } from 'src/engine/metadata-modules/ai/ai-research/types/evidence.type';
import { ProposalItemEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal-item.entity';
import { ProposalEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal.entity';
import { ProposalItemStatus } from 'src/engine/metadata-modules/ai/ai-write-approval/types/proposal-status.type';
import { InjectWorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/inject-workspace-scoped-repository.decorator';
import { WorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/workspace-scoped-repository';

// Derived from the one owning table rather than restated, so a source type
// added to Evidence shows up on the dashboard without a second edit here.
const EVIDENCE_SOURCE_TYPES = Object.keys(EVIDENCE_SOURCE_STRENGTH);

const FACT_SOURCE_TYPE_KEYS = [
  ...EVIDENCE_SOURCE_TYPES,
  UNATTRIBUTED_SOURCE_TYPE,
];

const PROPOSAL_ITEM_STATUS_KEYS = Object.values(ProposalItemStatus);

@Injectable()
export class AiTrustDashboardService {
  constructor(
    // Fact is read ONLY through FactService — Owner Decision 1. This module
    // deliberately holds no Fact repository, so promoting Fact to a standard
    // object stays a change inside ai-research.
    private readonly factService: FactService,
    @InjectWorkspaceScopedRepository(AgentRunEntity)
    private readonly agentRunRepository: WorkspaceScopedRepository<AgentRunEntity>,
    // Proposal, not ProposalItem: the item table carries no workspaceId and
    // is reachable only through its parent, so the tenant predicate has to sit
    // on the proposal side of the join.
    @InjectWorkspaceScopedRepository(ProposalEntity)
    private readonly proposalRepository: WorkspaceScopedRepository<ProposalEntity>,
  ) {}

  async computeDashboard(params: {
    workspaceId: string;
    period: AiSpendPeriod;
    bucketCount: number;
    now?: Date;
  }): Promise<AiTrustDashboardDTO> {
    const { workspaceId, period } = params;

    const bucketCount = Math.min(
      Math.max(Math.trunc(params.bucketCount), 1),
      AI_SPEND_MAX_BUCKET_COUNT,
    );

    const [sourceTypeRows, freshnessRows, factTotals, outcomeRows, spend] =
      await Promise.all([
        this.factService.countCurrentFactsBySourceType(workspaceId),
        this.factService.countCurrentFactsByFreshness(workspaceId),
        this.factService.countCurrentAndConflictedFacts(workspaceId),
        this.countProposalItemOutcomes(workspaceId),
        this.computeSpendByPeriod({
          workspaceId,
          period,
          bucketCount,
          now: params.now ?? new Date(),
        }),
      ]);

    return {
      factsBySourceType: zeroFillCounts(sourceTypeRows, FACT_SOURCE_TYPE_KEYS),
      factFreshness: zeroFillCounts(freshnessRows, FACT_FRESHNESS_BUCKETS),
      currentFactCount: factTotals.currentCount,
      conflictedFactCount: factTotals.conflictedCount,
      proposalItemOutcomes: zeroFillCounts(
        outcomeRows,
        PROPOSAL_ITEM_STATUS_KEYS,
      ),
      spendByPeriod: spend,
    };
  }

  private async countProposalItemOutcomes(
    workspaceId: string,
  ): Promise<{ key: string; count: number }[]> {
    const rows = await this.proposalRepository
      .createQueryBuilder('proposal')
      .innerJoin(ProposalItemEntity, 'item', 'item."proposalId" = proposal.id')
      .select('item.status', 'key')
      .addSelect('COUNT(*)::int', 'count')
      // createQueryBuilder is the unscoped escape hatch; the tenant predicate
      // is ours to add and it must be on the proposal side.
      .where('proposal.workspaceId = :workspaceId', { workspaceId })
      .groupBy('item.status')
      .getRawMany<{ key: string; count: number }>();

    return rows.map((row) => ({ key: row.key, count: Number(row.count) }));
  }

  private async computeSpendByPeriod(params: {
    workspaceId: string;
    period: AiSpendPeriod;
    bucketCount: number;
    now: Date;
  }): Promise<AiSpendBucketDTO[]> {
    const truncUnit = AI_SPEND_PERIOD_TRUNC_UNIT[params.period];

    const since = computeSpendWindowStart({
      period: params.period,
      bucketCount: params.bucketCount,
      now: params.now,
    });

    // Buckets with no runs are absent from this series rather than zero-filled.
    // Unlike the categorical charts above, generating time buckets in JS and
    // expecting them to line up with Postgres date_trunc is a real source of
    // off-by-one-bucket bugs, and a wrong bar is worse than a missing one.
    const rows = await this.agentRunRepository
      .createQueryBuilder('run')
      .select(`date_trunc('${truncUnit}', run."startedAt")`, 'periodStart')
      .addSelect('COUNT(*)::int', 'runCount')
      .addSelect('COALESCE(SUM(run."inputTokens"), 0)', 'inputTokens')
      .addSelect('COALESCE(SUM(run."outputTokens"), 0)', 'outputTokens')
      .addSelect('COALESCE(SUM(run."creditsUsedMicro"), 0)', 'creditsUsedMicro')
      .where('run.workspaceId = :workspaceId', {
        workspaceId: params.workspaceId,
      })
      .andWhere('run."startedAt" >= :since', { since })
      .groupBy(`date_trunc('${truncUnit}', run."startedAt")`)
      .orderBy(`date_trunc('${truncUnit}', run."startedAt")`, 'ASC')
      .getRawMany<RawSpendRow>();

    return rows.map(parseSpendRow);
  }
}
