export type AgentRun = {
  id: string;
  agentTaskId: string | null;
  modelId: string | null;
  elapsedMs: number | null;
  inputTokens: number;
  outputTokens: number;
  creditsUsedMicro: number;
  resultSummary: string | null;
  errorMessage: string | null;
  createdAt: string;
};

export type AgentRunsData = {
  agentRuns: AgentRun[];
};
