import { type ActorMetadata } from 'searm-shared/types';

import { type ProposalActionType } from 'src/engine/metadata-modules/ai/ai-write-approval/types/proposal-status.type';

// One candidate change produced by a background job (ingestion extraction,
// guided import). Shaped exactly like the item the gate builds from a tool
// call, so both entry points land the same reviewable row.
export type ExtractionProposalItemInput = {
  actionType: ProposalActionType;
  objectNameSingular: string;
  recordId: string | null;
  payload: Record<string, unknown>;
  baseline: Record<string, unknown>;
};

export type CreateFromExtractionInput = {
  workspaceId: string;
  // Batch-level idempotency key. Distinct from Phase 4's item-level dedupe
  // inside evaluate(): different granularity, different entry point.
  sourceKey: string;
  reason: string;
  // Principal contract: a background job still names who or what caused the
  // write (EMAIL/CALENDAR for ingestion, IMPORT for a guided import).
  createdByActor: ActorMetadata;
  items: ExtractionProposalItemInput[];
};

export type CreateFromExtractionResult = {
  proposalId: string;
  itemIds: string[];
};
