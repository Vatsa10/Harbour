import { Test, type TestingModule } from '@nestjs/testing';

import { AiTrustDashboardService } from 'src/engine/metadata-modules/ai/ai-trust-dashboard/services/ai-trust-dashboard.service';
import { AI_SPEND_MAX_BUCKET_COUNT } from 'src/engine/metadata-modules/ai/ai-trust-dashboard/types/ai-spend-period.type';
import { AiSpendPeriod } from 'src/engine/metadata-modules/ai/ai-trust-dashboard/types/ai-spend-period.type';
import { AgentRunEntity } from 'src/engine/metadata-modules/ai/ai-research/entities/agent-run.entity';
import { FactService } from 'src/engine/metadata-modules/ai/ai-research/services/fact.service';
import { ProposalEntity } from 'src/engine/metadata-modules/ai/ai-write-approval/entities/proposal.entity';
import { getWorkspaceScopedRepositoryToken } from 'src/engine/searm-orm/workspace-scoped-repository/get-workspace-scoped-repository-token.util';

const WORKSPACE_ID = '20202020-0000-0000-0000-000000000001';

// A chainable query-builder double that records the parameters it was given
// and replays a canned raw result. The SQL itself is not under test here —
// only what the service does with the rows and which predicates it supplies.
const createQueryBuilderDouble = (rows: unknown[]) => {
  const parameters: Record<string, unknown> = {};

  const builder: Record<string, unknown> = {};

  const chain = (...args: unknown[]) => {
    const maybeParams = args[1];

    if (typeof maybeParams === 'object' && maybeParams !== null) {
      Object.assign(parameters, maybeParams);
    }

    return builder;
  };

  for (const method of [
    'select',
    'addSelect',
    'leftJoin',
    'innerJoin',
    'where',
    'andWhere',
    'groupBy',
    'orderBy',
  ]) {
    builder[method] = jest.fn(chain);
  }

  builder.getRawMany = jest.fn(async () => rows);

  return { builder, parameters };
};

describe('AiTrustDashboardService', () => {
  let service: AiTrustDashboardService;
  let factService: jest.Mocked<
    Pick<
      FactService,
      | 'countCurrentFactsBySourceType'
      | 'countCurrentFactsByFreshness'
      | 'countCurrentAndConflictedFacts'
    >
  >;
  let agentRunQuery: ReturnType<typeof createQueryBuilderDouble>;
  let proposalQuery: ReturnType<typeof createQueryBuilderDouble>;

  const build = async (options?: {
    spendRows?: unknown[];
    outcomeRows?: unknown[];
  }) => {
    agentRunQuery = createQueryBuilderDouble(options?.spendRows ?? []);
    proposalQuery = createQueryBuilderDouble(options?.outcomeRows ?? []);

    factService = {
      countCurrentFactsBySourceType: jest.fn().mockResolvedValue([]),
      countCurrentFactsByFreshness: jest.fn().mockResolvedValue([]),
      countCurrentAndConflictedFacts: jest
        .fn()
        .mockResolvedValue({ currentCount: 0, conflictedCount: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiTrustDashboardService,
        { provide: FactService, useValue: factService },
        {
          provide: getWorkspaceScopedRepositoryToken(AgentRunEntity),
          useValue: {
            createQueryBuilder: jest.fn(() => agentRunQuery.builder),
          },
        },
        {
          provide: getWorkspaceScopedRepositoryToken(ProposalEntity),
          useValue: {
            createQueryBuilder: jest.fn(() => proposalQuery.builder),
          },
        },
      ],
    }).compile();

    service = module.get(AiTrustDashboardService);
  };

  beforeEach(async () => {
    await build();
  });

  it('reports facts by source type with every known source zero-filled', async () => {
    factService.countCurrentFactsBySourceType.mockResolvedValue([
      { key: 'WEB_SEARCH', count: 12 },
      { key: 'UNATTRIBUTED', count: 1 },
    ]);

    const dashboard = await service.computeDashboard({
      workspaceId: WORKSPACE_ID,
      period: AiSpendPeriod.DAY,
      bucketCount: 7,
    });

    const byKey = Object.fromEntries(
      dashboard.factsBySourceType.map((row) => [row.key, row.count]),
    );

    expect(byKey.WEB_SEARCH).toBe(12);
    expect(byKey.CRM_RECORD).toBe(0);
    expect(byKey.EMAIL_MESSAGE).toBe(0);
    // The evidence-contract violation gets its own visible slice.
    expect(byKey.UNATTRIBUTED).toBe(1);
  });

  it('reports the conflict count alongside its denominator', async () => {
    factService.countCurrentAndConflictedFacts.mockResolvedValue({
      currentCount: 400,
      conflictedCount: 12,
    });

    const dashboard = await service.computeDashboard({
      workspaceId: WORKSPACE_ID,
      period: AiSpendPeriod.DAY,
      bucketCount: 7,
    });

    expect(dashboard.currentFactCount).toBe(400);
    expect(dashboard.conflictedFactCount).toBe(12);
  });

  it('reports approved and rejected proposal items, zero-filling untouched statuses', async () => {
    await build({
      outcomeRows: [
        { key: 'APPLIED', count: 9 },
        { key: 'REJECTED', count: 4 },
      ],
    });

    const dashboard = await service.computeDashboard({
      workspaceId: WORKSPACE_ID,
      period: AiSpendPeriod.DAY,
      bucketCount: 7,
    });

    const byKey = Object.fromEntries(
      dashboard.proposalItemOutcomes.map((row) => [row.key, row.count]),
    );

    expect(byKey.APPLIED).toBe(9);
    expect(byKey.REJECTED).toBe(4);
    expect(byKey.CONFLICTED).toBe(0);
    expect(byKey.SUPERSEDED).toBe(0);
  });

  it('scopes the proposal outcome aggregate to the calling workspace', async () => {
    await build({ outcomeRows: [] });

    await service.computeDashboard({
      workspaceId: WORKSPACE_ID,
      period: AiSpendPeriod.DAY,
      bucketCount: 7,
    });

    // createQueryBuilder is an unscoped escape hatch — if the service ever
    // stops passing the tenant predicate, this dashboard leaks another
    // workspace's approval record.
    expect(proposalQuery.parameters.workspaceId).toBe(WORKSPACE_ID);
    expect(agentRunQuery.parameters.workspaceId).toBe(WORKSPACE_ID);
  });

  it('converts a bigint credit sum into spend without losing the exact value', async () => {
    await build({
      spendRows: [
        {
          periodStart: '2026-08-17T00:00:00.000Z',
          runCount: '4',
          inputTokens: '5000',
          outputTokens: '900',
          creditsUsedMicro: '7250000',
        },
      ],
    });

    const dashboard = await service.computeDashboard({
      workspaceId: WORKSPACE_ID,
      period: AiSpendPeriod.DAY,
      bucketCount: 7,
    });

    expect(dashboard.spendByPeriod).toHaveLength(1);
    expect(dashboard.spendByPeriod[0]).toMatchObject({
      runCount: 4,
      inputTokens: 5000,
      outputTokens: 900,
      creditsUsedMicro: '7250000',
      creditsUsed: 7.25,
    });
  });

  it('clamps an absurd bucket count instead of asking Postgres for it', async () => {
    await service.computeDashboard({
      workspaceId: WORKSPACE_ID,
      period: AiSpendPeriod.DAY,
      bucketCount: 100_000,
      now: new Date('2026-08-17T00:00:00.000Z'),
    });

    const since = agentRunQuery.parameters.since as Date;
    const expected = new Date('2026-08-17T00:00:00.000Z');

    expected.setUTCDate(expected.getUTCDate() - (AI_SPEND_MAX_BUCKET_COUNT - 1));

    expect(since.toISOString()).toBe(expected.toISOString());
  });

  it('clamps a zero or negative bucket count up to a single bucket', async () => {
    await service.computeDashboard({
      workspaceId: WORKSPACE_ID,
      period: AiSpendPeriod.DAY,
      bucketCount: 0,
      now: new Date('2026-08-17T13:00:00.000Z'),
    });

    expect((agentRunQuery.parameters.since as Date).toISOString()).toBe(
      '2026-08-17T00:00:00.000Z',
    );
  });
});
