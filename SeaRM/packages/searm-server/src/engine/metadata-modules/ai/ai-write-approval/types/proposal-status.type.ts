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
  // The situation the proposal was drafted against no longer holds. Terminal
  // like REJECTED, but not a human decision — nobody said no, the question
  // stopped being the question. Rows are kept, never deleted, exactly as
  // FactStatus.SUPERSEDED keeps the outgoing fact queryable.
  SUPERSEDED = 'SUPERSEDED',
}

export enum ProposalItemStatus {
  PENDING = 'PENDING',
  APPLIED = 'APPLIED',
  REJECTED = 'REJECTED',
  CONFLICTED = 'CONFLICTED',
  // The target row lies outside the approving user's record scope. Distinct
  // from CONFLICTED on purpose: CONFLICTED tells the reviewer the record
  // changed and to re-read it, which is advice they cannot follow for a record
  // they are not allowed to see.
  OUT_OF_SCOPE = 'OUT_OF_SCOPE',
  FAILED = 'FAILED',
  SUPERSEDED = 'SUPERSEDED',
}

// Why an item stopped being answerable. Deliberately three named causes and
// not a free-text note: the inbox has to explain the disappearance to the
// human who was about to review the card.
export const PROPOSAL_SUPERSESSION_REASONS = [
  // A newer proposal item targets the same record and at least one of the
  // same fields. The later draft saw a later world.
  'NEWER_PROPOSAL',
  // The record moved underneath the draft — the baseline captured at creation
  // no longer matches the record. This is the same comparison approval makes,
  // run early so the card leaves the inbox instead of failing at approval.
  'RECORD_CHANGED',
  // Every fact cited by the item left CURRENT (superseded by a later
  // observation, or dismissed by a reviewer). The evidence is gone, so the
  // proposed value has nothing standing behind it.
  'FACT_SUPERSEDED',
] as const;

export type ProposalSupersessionReason =
  (typeof PROPOSAL_SUPERSESSION_REASONS)[number];

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
