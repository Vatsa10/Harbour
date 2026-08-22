import { type BarChartDatum } from '@/page-layout/widgets/graph/graph-widget-bar-chart/types/BarChartDatum';
import {
  type AiSpendBucket,
  type AiTrustCountByKey,
} from '@/settings/ai-dashboard/types/AiTrustDashboard';

// Human labels for the enum keys the server groups by. A key with no entry
// falls back to its raw value rather than rendering blank — an unlabelled
// category is still information.
const READABLE_KEY_LABELS: Record<string, string> = {
  CRM_RECORD: 'CRM record',
  CRM_ACTIVITY: 'CRM activity',
  WEB_SEARCH: 'Web search',
  MANUAL: 'Manual',
  EMAIL_MESSAGE: 'Email',
  CALL_RECORDING: 'Call',
  IMPORT_FILE: 'Import',
  UNATTRIBUTED: 'No source',
  LAST_7_DAYS: '≤ 7 days',
  LAST_30_DAYS: '≤ 30 days',
  LAST_90_DAYS: '≤ 90 days',
  OLDER_THAN_90_DAYS: '> 90 days',
  PENDING: 'Pending',
  APPLIED: 'Approved',
  REJECTED: 'Rejected',
  CONFLICTED: 'Conflicted',
  FAILED: 'Failed',
  SUPERSEDED: 'Superseded',
};

export const getReadableKeyLabel = (key: string): string =>
  READABLE_KEY_LABELS[key] ?? key;

export const buildCountBarChartData = (
  rows: readonly AiTrustCountByKey[],
  valueKey: string,
): BarChartDatum[] =>
  rows.map((row) => ({
    category: getReadableKeyLabel(row.key),
    [valueKey]: row.count,
  }));

// Tokens and credits share one chart but not one unit, so only credits are
// plotted here. Mixing a token count in the thousands with a credit value in
// the single digits on one axis produces a bar chart where the cost — the
// number this page exists to show — is an invisible sliver.
export const buildSpendBarChartData = (
  buckets: readonly AiSpendBucket[],
): BarChartDatum[] =>
  buckets.map((bucket) => ({
    period: formatSpendBucketLabel(bucket.periodStart),
    credits: bucket.creditsUsed,
  }));

export const formatSpendBucketLabel = (periodStart: string): string => {
  const date = new Date(periodStart);

  if (Number.isNaN(date.getTime())) {
    return periodStart;
  }

  // UTC, matching the server's date_trunc, so a bucket does not shift a day
  // for a reader in a negative-offset timezone.
  return date.toISOString().slice(0, 10);
};

// Totals for the summary tiles. Derived from the same rows the charts render,
// so the headline number and the bars can never disagree.
export const sumCounts = (rows: readonly AiTrustCountByKey[]): number =>
  rows.reduce((total, row) => total + row.count, 0);

export const sumCredits = (buckets: readonly AiSpendBucket[]): number =>
  buckets.reduce((total, bucket) => total + bucket.creditsUsed, 0);

export const sumTokens = (buckets: readonly AiSpendBucket[]): number =>
  buckets.reduce(
    (total, bucket) => total + bucket.inputTokens + bucket.outputTokens,
    0,
  );

// Share of proposed changes a human actually accepted. Returns null rather
// than 0 when nothing has been reviewed yet: "0% approved" is a claim about
// reviewer behaviour, and with an empty inbox we have no such claim to make.
export const computeApprovalRate = (
  outcomes: readonly AiTrustCountByKey[],
): number | null => {
  const byKey = new Map(outcomes.map((row) => [row.key, row.count]));

  const applied = byKey.get('APPLIED') ?? 0;
  const rejected = byKey.get('REJECTED') ?? 0;

  const decided = applied + rejected;

  if (decided === 0) {
    return null;
  }

  return applied / decided;
};
