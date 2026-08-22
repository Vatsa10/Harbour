// A CURRENT fact older than this is treated as no longer trustworthy enough to
// leave unchecked. Matches the dashboard's LAST_30_DAYS freshness boundary
// (fact-freshness.type.ts) on purpose: a record the trust dashboard is about to
// paint as "aging" is exactly the record the sweep should already have queued.
export const RECORD_SWEEP_STALE_AFTER_DAYS = 30;

// A high-value record whose last activity is older than this is not "active",
// it is dormant, and the sweep leaves it alone. Without this, every open
// opportunity in the workspace is permanently a candidate.
export const RECORD_SWEEP_RECENT_ACTIVITY_DAYS = 14;

// A record scheduled within this window is skipped no matter which lane picks
// it. This is the sweep's whole defence against re-queueing the same record
// every tick: research takes time to land, and a record whose facts are still
// stale an hour after a run is not a new signal.
export const RECORD_SWEEP_COOLDOWN_DAYS = 7;

// Per-workspace ceiling per tick. The budget/lease machinery in AgentTaskService
// bounds what a single task costs; this bounds how many the sweep may create at
// once, so one workspace with a large stale backlog drains over days rather
// than filling the queue in one tick.
export const RECORD_SWEEP_MAX_TASKS_PER_WORKSPACE = 25;

// How many rows each lane pulls before filtering. Larger than the task ceiling
// because cooldown filtering happens after selection — otherwise a workspace
// whose top 25 stalest records are all in cooldown would schedule nothing at
// all, forever.
export const RECORD_SWEEP_LANE_CANDIDATE_LIMIT = 100;

// Stale facts are the weaker signal (something we knew went old); an active
// high-value record is the stronger one (money is moving and we are blind).
// Both are above the default 0 that tool- and user-scheduled tasks get, so a
// human asking for research still outranks... nothing, which is the point:
// these are background work and must not starve the interactive lane.
export const RECORD_SWEEP_STALE_PRIORITY = -20;
export const RECORD_SWEEP_HIGH_VALUE_PRIORITY = -10;

// Opportunity stages that still represent an open deal. CUSTOMER is the
// terminal won stage in the standard application (see
// compute-opportunity-standard-flat-field-metadata.util.ts) and is excluded:
// re-researching closed deals spends budget on decisions already made.
export const OPEN_OPPORTUNITY_STAGES = [
  'NEW',
  'SCREENING',
  'MEETING',
  'PROPOSAL',
] as const;

export const OPPORTUNITY_OBJECT_NAME_SINGULAR = 'opportunity';
