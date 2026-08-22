import { type AiSpendBucketDTO } from 'src/engine/metadata-modules/ai/ai-trust-dashboard/dtos/ai-trust-dashboard.dto';

// AgentRun.creditsUsedMicro is bigint, and node-postgres hands bigint sums
// back as strings to avoid silently truncating past 2^53. Keeping the string
// is the whole point of this util: the exact micro value crosses the wire
// untouched, and only the display Float is derived from it.
export const MICRO_PER_CREDIT = 1_000_000;

export type RawSpendRow = {
  periodStart: Date | string;
  runCount: string | number | null;
  inputTokens: string | number | null;
  outputTokens: string | number | null;
  creditsUsedMicro: string | number | null;
};

// SUM() over zero rows is NULL, not 0. A bucket that exists but summed to
// NULL is a real bucket with no spend, so it becomes 0 rather than NaN.
const toNumber = (value: string | number | null): number => {
  if (value === null || value === undefined || value === '') {
    return 0;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
};

const toBigIntString = (value: string | number | null): string => {
  if (value === null || value === undefined || value === '') {
    return '0';
  }

  return String(value);
};

export const parseSpendRow = (row: RawSpendRow): AiSpendBucketDTO => {
  const creditsUsedMicro = toBigIntString(row.creditsUsedMicro);

  return {
    periodStart:
      row.periodStart instanceof Date
        ? row.periodStart
        : new Date(row.periodStart),
    runCount: toNumber(row.runCount),
    inputTokens: toNumber(row.inputTokens),
    outputTokens: toNumber(row.outputTokens),
    creditsUsedMicro,
    creditsUsed: toNumber(creditsUsedMicro) / MICRO_PER_CREDIT,
  };
};
