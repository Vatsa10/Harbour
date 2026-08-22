import { AiSpendPeriod } from 'src/engine/metadata-modules/ai/ai-trust-dashboard/types/ai-spend-period.type';

const DAY_MS = 24 * 60 * 60 * 1000;

// Lower bound for the spend query, computed here rather than in SQL so the
// bucket count never reaches Postgres as interpolated text.
//
// This is only a `>=` cutoff, so it does not have to agree with the database's
// date_trunc to the hour — a session timezone differing from UTC shifts the
// window edge, not the bucketing. That is deliberately the weaker coupling:
// generating bucket boundaries in JS and expecting them to line up with
// Postgres date_trunc is the version of this that breaks.
export const computeSpendWindowStart = (params: {
  period: AiSpendPeriod;
  bucketCount: number;
  now: Date;
}): Date => {
  const { period, bucketCount, now } = params;

  // bucketCount buckets *including* the current one.
  const bucketsBack = Math.max(bucketCount - 1, 0);

  if (period === AiSpendPeriod.MONTH) {
    // Month arithmetic cannot be done in milliseconds. setUTCMonth handles
    // the year rollover and normalizes overflow itself.
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - bucketsBack, 1),
    );

    return start;
  }

  const daysPerBucket = period === AiSpendPeriod.WEEK ? 7 : 1;

  const startOfToday = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );

  return new Date(startOfToday - bucketsBack * daysPerBucket * DAY_MS);
};
