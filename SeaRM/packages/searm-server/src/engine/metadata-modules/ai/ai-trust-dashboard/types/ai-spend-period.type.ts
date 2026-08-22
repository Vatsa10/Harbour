import { registerEnumType } from '@nestjs/graphql';

// Bucket width for the AI spend series. A real TS enum, not a string-literal
// union, because it crosses the GraphQL boundary as an argument.
export enum AiSpendPeriod {
  DAY = 'DAY',
  WEEK = 'WEEK',
  MONTH = 'MONTH',
}

registerEnumType(AiSpendPeriod, { name: 'AiSpendPeriod' });

// Postgres date_trunc units. Kept as an explicit allow-list rather than
// lowercasing the enum value: the unit is interpolated into SQL, and a map
// makes it impossible for a future enum member to reach the query as
// unvalidated text.
export const AI_SPEND_PERIOD_TRUNC_UNIT: Record<AiSpendPeriod, string> = {
  [AiSpendPeriod.DAY]: 'day',
  [AiSpendPeriod.WEEK]: 'week',
  [AiSpendPeriod.MONTH]: 'month',
};

// How far back each period looks by default, in buckets.
export const AI_SPEND_DEFAULT_BUCKET_COUNT = 30;
export const AI_SPEND_MAX_BUCKET_COUNT = 365;
