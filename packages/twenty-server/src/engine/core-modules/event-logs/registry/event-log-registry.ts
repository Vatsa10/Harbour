// SeaRM: clean-room AGPL-3.0 rewrite of the event-log table registry.
// Replaces the removed Enterprise-licensed implementation. No entitlement or
// license gating — event logs are unconditionally available. See
// .superpowers/sdd/enterprise-rewrite/event-logs-spec.md for design notes.
import { EventLogTable } from 'twenty-shared/types';

import { type EventLogRecord } from 'src/engine/core-modules/event-logs/dtos/event-log-result.dto';
import {
  type WorkspaceEventTable,
} from 'src/engine/core-modules/event-logs/types/workspace-event-envelope.type';

export type EventLogTableDefinition = {
  // The physical ClickHouse table this EventLogTable value reads from.
  clickHouseTable: WorkspaceEventTable;
  // Column holding the "event name" for this table (varies per table shape).
  eventFieldName: string;
  // Column holding the acting user/user-workspace id, if this table has one.
  userIdFieldName?: string;
  // Maps a raw ClickHouse row for this table into the GraphQL-facing shape.
  // The `timestamp` field is filled in separately by normalizeEventLogRecords.
  normalize: (row: Record<string, unknown>) => Omit<EventLogRecord, 'timestamp'>;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

// SeaRM Principal-contract addition: derives actor-kind and an optional
// proposal reference from data already present in the row, with no
// ClickHouse schema change. See event-logs-spec.md.
const deriveActorAttribution = (
  row: Record<string, unknown>,
  userId: string | undefined,
): Pick<EventLogRecord, 'actorKind' | 'proposalReference'> => {
  const properties = asRecord(row.properties ?? row.metadata);
  const explicitActorKind = asString(properties.actorKind);
  const proposalReference = asString(properties.proposalId);

  return {
    actorKind: explicitActorKind ?? (userId ? 'user' : 'system'),
    proposalReference,
  };
};

export const EVENT_LOG_TYPES: Record<EventLogTable, EventLogTableDefinition> = {
  [EventLogTable.WORKSPACE_EVENT]: {
    clickHouseTable: 'workspaceEvent',
    eventFieldName: 'event',
    userIdFieldName: 'userId',
    normalize: (row) => ({
      event: asString(row.event) ?? '',
      userId: asString(row.userId),
      properties: asRecord(row.properties),
      ...deriveActorAttribution(row, asString(row.userId)),
    }),
  },
  [EventLogTable.PAGEVIEW]: {
    clickHouseTable: 'pageview',
    eventFieldName: 'name',
    userIdFieldName: 'userId',
    normalize: (row) => ({
      event: asString(row.name) ?? '',
      userId: asString(row.userId),
      properties: asRecord(row.properties),
      ...deriveActorAttribution(row, asString(row.userId)),
    }),
  },
  [EventLogTable.OBJECT_EVENT]: {
    clickHouseTable: 'objectEvent',
    eventFieldName: 'event',
    userIdFieldName: 'userId',
    normalize: (row) => ({
      event: asString(row.event) ?? '',
      userId: asString(row.userId),
      properties: asRecord(row.properties),
      recordId: asString(row.recordId),
      objectMetadataId: asString(row.objectMetadataId),
      isCustom: typeof row.isCustom === 'boolean' ? row.isCustom : undefined,
      ...deriveActorAttribution(row, asString(row.userId)),
    }),
  },
  [EventLogTable.USAGE_EVENT]: {
    clickHouseTable: 'usageEvent',
    eventFieldName: 'resourceType',
    userIdFieldName: 'userWorkspaceId',
    normalize: (row) => ({
      event: asString(row.resourceType) ?? '',
      userId: asString(row.userWorkspaceId),
      properties: {
        ...asRecord(row.metadata),
        quantity: row.quantity,
        operationType: row.operationType,
        unit: row.unit,
        creditsUsedMicro: row.creditsUsedMicro,
        resourceId: row.resourceId,
        resourceContext: row.resourceContext,
      },
      ...deriveActorAttribution(row, asString(row.userWorkspaceId)),
    }),
  },
  [EventLogTable.APPLICATION_LOG]: {
    clickHouseTable: 'applicationLog',
    eventFieldName: 'logicFunctionName',
    normalize: (row) => ({
      event: asString(row.logicFunctionName) ?? '',
      properties: {
        level: row.level,
        message: row.message,
        applicationId: row.applicationId,
        logicFunctionId: row.logicFunctionId,
        executionId: row.executionId,
      },
      actorKind: 'system',
    }),
  },
};

export const getClickHouseTableName = (table: EventLogTable): string =>
  EVENT_LOG_TYPES[table].clickHouseTable;
