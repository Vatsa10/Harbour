import { gql } from '@apollo/client';

// Mirrors AgentRunDTO (agent-run.dto.ts). Filtered by agentTaskId so the
// settings page can drill from a task row into the runs it produced.
export const AGENT_RUNS = gql`
  query AgentRuns($agentTaskId: ID) {
    agentRuns(agentTaskId: $agentTaskId) {
      id
      agentTaskId
      modelId
      elapsedMs
      inputTokens
      outputTokens
      creditsUsedMicro
      resultSummary
      errorMessage
      createdAt
    }
  }
`;
