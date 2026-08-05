export enum ProposalStatus {
  PENDING = 'PENDING',
  APPLIED = 'APPLIED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}

export enum ProposalItemStatus {
  PENDING = 'PENDING',
  APPLIED = 'APPLIED',
  REJECTED = 'REJECTED',
  CONFLICTED = 'CONFLICTED',
  FAILED = 'FAILED',
}

export enum ProposalActionType {
  CREATE_RECORD = 'CREATE_RECORD',
  UPDATE_RECORD = 'UPDATE_RECORD',
  DELETE_RECORD = 'DELETE_RECORD',
  SEND_EMAIL = 'SEND_EMAIL',
  CREATE_CALENDAR_EVENT = 'CREATE_CALENDAR_EVENT',
}

// A pending proposal older than this is treated as expired at read time.
// Computed, not enforced by a cron job.
export const PROPOSAL_TTL_DAYS = 7;
