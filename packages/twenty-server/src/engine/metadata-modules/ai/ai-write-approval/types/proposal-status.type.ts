export enum ProposalStatus {
  PENDING = 'PENDING',
  // Claimed by an approval in flight. Only a PENDING proposal can be claimed,
  // so a second concurrent approval claims zero rows and bails.
  APPLYING = 'APPLYING',
  APPLIED = 'APPLIED',
  PARTIALLY_APPLIED = 'PARTIALLY_APPLIED',
  FAILED = 'FAILED',
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
  // Bulk operations keep their own action types so approval replays the real
  // envelope through the matching *ManyRecordsService instead of collapsing a
  // batch into one record.
  CREATE_RECORDS = 'CREATE_RECORDS',
  UPSERT_RECORDS = 'UPSERT_RECORDS',
  UPDATE_RECORDS = 'UPDATE_RECORDS',
  DELETE_RECORDS = 'DELETE_RECORDS',
  SEND_EMAIL = 'SEND_EMAIL',
  CREATE_CALENDAR_EVENT = 'CREATE_CALENDAR_EVENT',
  // Any other gated static tool. Replayed through its own tool provider.
  STATIC_TOOL = 'STATIC_TOOL',
}

// A pending proposal older than this is treated as expired at read time.
// Computed, not enforced by a cron job.
export const PROPOSAL_TTL_DAYS = 7;
