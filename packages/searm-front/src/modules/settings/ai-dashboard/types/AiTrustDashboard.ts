export type AiTrustCountByKey = {
  key: string;
  count: number;
};

export type AiSpendBucket = {
  periodStart: string;
  runCount: number;
  inputTokens: number;
  outputTokens: number;
  // Exact bigint value as a string. The float below is what gets plotted.
  creditsUsedMicro: string;
  creditsUsed: number;
};

export type AiTrustDashboard = {
  factsBySourceType: AiTrustCountByKey[];
  factFreshness: AiTrustCountByKey[];
  currentFactCount: number;
  conflictedFactCount: number;
  proposalItemOutcomes: AiTrustCountByKey[];
  spendByPeriod: AiSpendBucket[];
};

export type AiTrustDashboardData = {
  findAiTrustDashboard: AiTrustDashboard;
};
