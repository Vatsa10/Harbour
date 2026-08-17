import {
  buildCountBarChartData,
  buildSpendBarChartData,
  computeApprovalRate,
  formatSpendBucketLabel,
  getReadableKeyLabel,
  sumCounts,
  sumCredits,
  sumTokens,
} from '@/settings/ai-dashboard/utils/buildAiTrustChartData';

const bucket = (overrides: Partial<Record<string, unknown>> = {}) => ({
  periodStart: '2026-08-17T00:00:00.000Z',
  runCount: 1,
  inputTokens: 100,
  outputTokens: 50,
  creditsUsedMicro: '1500000',
  creditsUsed: 1.5,
  ...overrides,
});

describe('buildCountBarChartData', () => {
  it('labels enum keys for humans and keeps the count under the series key', () => {
    expect(
      buildCountBarChartData([{ key: 'WEB_SEARCH', count: 7 }], 'facts'),
    ).toEqual([{ category: 'Web search', facts: 7 }]);
  });

  it('keeps zero rows so an empty category is visible rather than absent', () => {
    const result = buildCountBarChartData(
      [
        { key: 'CRM_RECORD', count: 0 },
        { key: 'WEB_SEARCH', count: 3 },
      ],
      'facts',
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ category: 'CRM record', facts: 0 });
  });

  it('falls back to the raw key when there is no label for it', () => {
    expect(getReadableKeyLabel('SOME_FUTURE_SOURCE')).toBe(
      'SOME_FUTURE_SOURCE',
    );
  });

  it('renders APPLIED as Approved, which is the word the buyer uses', () => {
    expect(getReadableKeyLabel('APPLIED')).toBe('Approved');
    expect(getReadableKeyLabel('REJECTED')).toBe('Rejected');
  });
});

describe('buildSpendBarChartData', () => {
  it('plots credits only, so a token count cannot dwarf the cost bar', () => {
    const result = buildSpendBarChartData([
      bucket({ inputTokens: 900000, creditsUsed: 2.25 }) as never,
    ]);

    expect(result).toEqual([{ period: '2026-08-17', credits: 2.25 }]);
  });

  it('labels a bucket in UTC so it does not shift a day for western readers', () => {
    expect(formatSpendBucketLabel('2026-08-17T00:00:00.000Z')).toBe(
      '2026-08-17',
    );
  });

  it('passes an unparseable period start through instead of showing NaN', () => {
    expect(formatSpendBucketLabel('not-a-date')).toBe('not-a-date');
  });
});

describe('computeApprovalRate', () => {
  it('divides approved by approved plus rejected', () => {
    expect(
      computeApprovalRate([
        { key: 'APPLIED', count: 3 },
        { key: 'REJECTED', count: 1 },
      ]),
    ).toBe(0.75);
  });

  it('ignores statuses that are not a human verdict', () => {
    // PENDING, CONFLICTED, SUPERSEDED and FAILED are not decisions. Counting
    // them would report a reviewer as rejecting changes nobody looked at.
    expect(
      computeApprovalRate([
        { key: 'APPLIED', count: 1 },
        { key: 'REJECTED', count: 1 },
        { key: 'PENDING', count: 50 },
        { key: 'SUPERSEDED', count: 20 },
        { key: 'CONFLICTED', count: 5 },
        { key: 'FAILED', count: 5 },
      ]),
    ).toBe(0.5);
  });

  it('returns null rather than zero when nothing has been reviewed', () => {
    expect(
      computeApprovalRate([
        { key: 'APPLIED', count: 0 },
        { key: 'REJECTED', count: 0 },
        { key: 'PENDING', count: 8 },
      ]),
    ).toBeNull();
  });

  it('returns null for an empty outcome list', () => {
    expect(computeApprovalRate([])).toBeNull();
  });
});

describe('totals', () => {
  it('sums counts', () => {
    expect(
      sumCounts([
        { key: 'A', count: 2 },
        { key: 'B', count: 5 },
      ]),
    ).toBe(7);
  });

  it('sums credits across buckets', () => {
    expect(
      sumCredits([
        bucket({ creditsUsed: 1.5 }) as never,
        bucket({ creditsUsed: 2.25 }) as never,
      ]),
    ).toBe(3.75);
  });

  it('sums input and output tokens together', () => {
    expect(
      sumTokens([
        bucket({ inputTokens: 100, outputTokens: 50 }) as never,
        bucket({ inputTokens: 7, outputTokens: 3 }) as never,
      ]),
    ).toBe(160);
  });

  it('totals to zero on an empty series without producing NaN', () => {
    expect(sumCredits([])).toBe(0);
    expect(sumTokens([])).toBe(0);
    expect(sumCounts([])).toBe(0);
  });
});
