// Freshness buckets for the trust dashboard. Ordered oldest-last: the UI
// renders them in this order, and zero-fill depends on the array, so a bucket
// with no facts still shows as an explicit zero rather than vanishing.
//
// Bucketed on Fact.lastObservedAt — when the *world* was observed — not on
// createdAt or updatedAt. A fact re-read from a two-year-old page today is
// stale, and a dashboard that called it fresh would be selling the opposite
// of what this product sells.
export const FACT_FRESHNESS_BUCKETS = [
  'LAST_7_DAYS',
  'LAST_30_DAYS',
  'LAST_90_DAYS',
  'OLDER_THAN_90_DAYS',
] as const;

export type FactFreshnessBucket = (typeof FACT_FRESHNESS_BUCKETS)[number];

// A CURRENT fact whose evidenceIds array is empty, or whose primary evidence
// row is missing. Reported as its own slice instead of being dropped from the
// denominator: an unattributed fact is a live evidence-contract violation, and
// the dashboard exists to make exactly that visible.
export const UNATTRIBUTED_SOURCE_TYPE = 'UNATTRIBUTED';
