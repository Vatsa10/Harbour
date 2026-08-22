// Long enough for a full research run (multiple tool calls, possibly a web
// search) — mirrors the "research lane" lease duration the crm repo scouting
// report recommended (30 minutes), the only number ported from that source.
export const AGENT_TASK_LEASE_DURATION_MS = 30 * 60 * 1000;

export const AGENT_TASK_CLAIM_BATCH_SIZE = 10;

export const AGENT_TASK_DEFAULT_BUDGET = 8;

export const AGENT_TASK_DEFAULT_MAX_ATTEMPTS = 3;

export const AGENT_TASK_MAX_BACKOFF_MS = 30 * 60 * 1000;

// Exponential backoff capped at 30 minutes: 1st retry in 1 min, 2nd in 4 min,
// then flat at the cap.
export const computeAgentTaskBackoffMs = (attempts: number): number =>
  Math.min(2 ** attempts * 60_000, AGENT_TASK_MAX_BACKOFF_MS);
