import { AiSpendPeriod } from 'src/engine/metadata-modules/ai/ai-trust-dashboard/types/ai-spend-period.type';
import { computeSpendWindowStart } from 'src/engine/metadata-modules/ai/ai-trust-dashboard/utils/compute-spend-window-start.util';

const now = new Date('2026-08-17T13:45:12.000Z');

describe('computeSpendWindowStart', () => {
  it('counts the current bucket as one of the requested buckets', () => {
    // 1 bucket of DAY means "today", not "today and yesterday".
    const start = computeSpendWindowStart({
      period: AiSpendPeriod.DAY,
      bucketCount: 1,
      now,
    });

    expect(start.toISOString()).toBe('2026-08-17T00:00:00.000Z');
  });

  it('walks back whole days and truncates the time of day', () => {
    const start = computeSpendWindowStart({
      period: AiSpendPeriod.DAY,
      bucketCount: 7,
      now,
    });

    expect(start.toISOString()).toBe('2026-08-11T00:00:00.000Z');
  });

  it('walks back in seven-day steps for WEEK', () => {
    const start = computeSpendWindowStart({
      period: AiSpendPeriod.WEEK,
      bucketCount: 4,
      now,
    });

    // 4 buckets including the current one = 3 weeks back from 2026-08-17.
    expect(start.toISOString()).toBe('2026-07-27T00:00:00.000Z');
  });

  it('uses calendar months for MONTH rather than 30-day arithmetic', () => {
    const start = computeSpendWindowStart({
      period: AiSpendPeriod.MONTH,
      bucketCount: 3,
      now,
    });

    expect(start.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  it('rolls the year backwards when the month window crosses January', () => {
    const start = computeSpendWindowStart({
      period: AiSpendPeriod.MONTH,
      bucketCount: 12,
      now: new Date('2026-02-05T09:00:00.000Z'),
    });

    expect(start.toISOString()).toBe('2025-03-01T00:00:00.000Z');
  });
});
