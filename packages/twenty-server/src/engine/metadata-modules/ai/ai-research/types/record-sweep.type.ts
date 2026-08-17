// Why a record was selected. Carried onto the AgentTask's reason and its
// idempotency key, so an operator looking at a queued task can always answer
// "why is the agent looking at this record" without reading the sweep code.
export const RECORD_SWEEP_LANES = ['STALE_FACTS', 'HIGH_VALUE'] as const;

export type RecordSweepLane = (typeof RECORD_SWEEP_LANES)[number];

export type RecordSweepCandidate = {
  objectNameSingular: string;
  recordId: string;
  lane: RecordSweepLane;
  reason: string;
  priority: number;
};

export type RecordSweepResult = {
  workspaceId: string;
  candidateCount: number;
  enqueuedTaskIds: string[];
  // Records a lane picked but the sweep declined to schedule, split by cause.
  // Reported rather than silently dropped: "the sweep did nothing" and "the
  // sweep found forty records and every one was in cooldown" are different
  // operational states and the log has to tell them apart.
  skippedForCooldownCount: number;
  skippedForPolicyCount: number;
};
