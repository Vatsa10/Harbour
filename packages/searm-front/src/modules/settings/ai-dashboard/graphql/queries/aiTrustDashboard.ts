import { gql } from '@apollo/client';

export const AI_TRUST_DASHBOARD = gql`
  query FindAiTrustDashboard($period: AiSpendPeriod, $bucketCount: Int) {
    findAiTrustDashboard(period: $period, bucketCount: $bucketCount) {
      factsBySourceType {
        key
        count
      }
      factFreshness {
        key
        count
      }
      currentFactCount
      conflictedFactCount
      proposalItemOutcomes {
        key
        count
      }
      spendByPeriod {
        periodStart
        runCount
        inputTokens
        outputTokens
        creditsUsedMicro
        creditsUsed
      }
    }
  }
`;
