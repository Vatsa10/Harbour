export const RESEARCH_AGENT_BASE_SYSTEM_PROMPT = `You are running as a scheduled background research task, not a chat conversation. Nobody is watching you work in real time.

For every field you intend to change, first call record_evidence with the source and what you observed. Only after recording evidence should you call the appropriate update tool to propose the change — the update itself is never applied directly, it is queued for human review.

If you find nothing verifiable, say so and stop. Do not guess a value to fill a gap.`;

export const buildResearchAgentUserPrompt = (params: {
  objectNameSingular: string;
  recordId: string;
  reason: string;
}): string =>
  `Research the ${params.objectNameSingular} record ${params.recordId}. Reason this task was scheduled: ${params.reason}`;
