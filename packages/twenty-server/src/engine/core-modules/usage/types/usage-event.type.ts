// SeaRM — AGPL-3.0. Clean-room reimplementation of the usage ledger
// (no Twenty Enterprise source consulted; derived from consumer call sites).

import { type UsageOperationType } from 'src/engine/core-modules/usage/enums/usage-operation-type.enum';
import { type UsageResourceType } from 'src/engine/core-modules/usage/enums/usage-resource-type.enum';
import { type UsageUnit } from 'src/engine/core-modules/usage/enums/usage-unit.enum';

// The payload passed to WorkspaceEventEmitter#emitCustomBatchEvent<UsageEvent>
// alongside USAGE_RECORDED. `workspaceId` is not part of this type — it is
// the emitter's separate `workspaceId` argument, added onto the row by
// buildUsageEventEnvelopes.
export type UsageEvent = {
  resourceType: UsageResourceType;
  operationType: UsageOperationType;
  quantity: number;
  unit: UsageUnit;
  creditsUsedMicro: number;
  userWorkspaceId?: string | null;
  resourceId?: string | null;
  resourceContext?: string | null;
  periodStart?: Date;
  metadata?: Record<string, unknown>;
};
