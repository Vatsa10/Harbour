export enum ImportBatchStatus {
  // Rows staged, mapping already confirmed by the frontend wizard.
  PENDING = 'PENDING',
  // Task 8's validation pass has run; every row has a matchAction and a
  // validationErrors verdict.
  READY = 'READY',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum ImportRowStatus {
  PENDING = 'PENDING',
  PROCESSED = 'PROCESSED',
  FAILED = 'FAILED',
}

// CREATE/UPDATE: EXACT identity match or no match at all — safe to write
// directly, same as a human filling the form by hand. PROPOSE: a CANDIDATE
// identity match — the row becomes a ProposalItem instead. SKIP: the
// reviewer excluded the row (or mapping produced no writable fields).
export enum ImportRowMatchAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  PROPOSE = 'PROPOSE',
  SKIP = 'SKIP',
}
