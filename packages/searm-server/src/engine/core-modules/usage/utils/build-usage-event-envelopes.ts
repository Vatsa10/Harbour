// SeaRM — AGPL-3.0. Clean-room reimplementation of the usage ledger
// (no SeaRM Enterprise source consulted; derived from consumer call sites
// and from src/engine/core-modules/event-logs/types/workspace-event-envelope.type.ts).

import { formatDateTimeForClickHouse } from 'src/database/clickHouse/clickHouse.util';
import { type UsageEvent } from 'src/engine/core-modules/usage/types/usage-event.type';
import { type WorkspaceEventEnvelope } from 'src/engine/core-modules/event-logs/types/workspace-event-envelope.type';

// Turns a batch of UsageEvent payloads into ClickHouse `usageEvent` row
// envelopes ready for EventLogEmitterService#dispatch.
export const buildUsageEventEnvelopes = (
  workspaceId: string,
  events: UsageEvent[],
): WorkspaceEventEnvelope[] => {
  const timestamp = formatDateTimeForClickHouse(new Date());

  return events.map((event) => ({
    table: 'usageEvent' as const,
    row: {
      timestamp,
      workspaceId,
      userWorkspaceId: event.userWorkspaceId ?? '',
      resourceType: event.resourceType,
      operationType: event.operationType,
      quantity: event.quantity,
      unit: event.unit,
      creditsUsedMicro: event.creditsUsedMicro,
      resourceId: event.resourceId ?? '',
      resourceContext: event.resourceContext ?? '',
      metadata: event.metadata ?? {},
      ...(event.periodStart !== undefined && {
        periodStart: formatDateTimeForClickHouse(event.periodStart),
      }),
    },
  }));
};
