// SeaRM: clean-room AGPL-3.0 rewrite. See
// .superpowers/sdd/enterprise-rewrite/event-logs-spec.md for design notes.
// No entitlement/license gating — event logs are unconditionally on.
import { Injectable } from '@nestjs/common';

import { EventLogTable } from 'searm-shared/types';

import { ClickHouseService } from 'src/database/clickHouse/clickHouse.service';
import {
  EventLogQueryResult,
  type EventLogRecord,
} from 'src/engine/core-modules/event-logs/dtos/event-log-result.dto';
import { type EventLogQueryInput } from 'src/engine/core-modules/event-logs/dtos/event-log-query.input';
import {
  EventLogsException,
  EventLogsExceptionCode,
} from 'src/engine/core-modules/event-logs/event-logs.exception';
import {
  EVENT_LOG_TYPES,
  getClickHouseTableName,
} from 'src/engine/core-modules/event-logs/registry/event-log-registry';
import { normalizeEventLogRecords } from 'src/engine/core-modules/event-logs/utils/normalize-event-log-records';

const DEFAULT_PAGE_SIZE = 100;

@Injectable()
export class EventLogsService {
  constructor(private readonly clickHouseService: ClickHouseService) {}

  async validateAccess(
    _workspaceId: string,
    _table: EventLogTable,
  ): Promise<void> {
    if (!this.clickHouseService.getMainClient()) {
      throw new EventLogsException(
        'ClickHouse is not configured for this instance',
        EventLogsExceptionCode.CLICKHOUSE_NOT_CONFIGURED,
      );
    }
  }

  async findEventLogs(
    workspaceId: string,
    input: EventLogQueryInput,
  ): Promise<EventLogQueryResult> {
    await this.validateAccess(workspaceId, input.table);

    const definition = EVENT_LOG_TYPES[input.table];
    const clickHouseTable = getClickHouseTableName(input.table);
    const first = input.first ?? DEFAULT_PAGE_SIZE;
    const offset = this.decodeCursor(input.after);

    const { whereClause, params } = this.buildWhereClause(
      definition,
      workspaceId,
      input,
    );

    const rows = await this.clickHouseService.select<Record<string, unknown>>(
      `SELECT * FROM ${clickHouseTable} WHERE ${whereClause} ORDER BY timestamp DESC LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
      { ...params, limit: first + 1, offset },
    );

    const hasNextPage = rows.length > first;
    const pageRows = hasNextPage ? rows.slice(0, first) : rows;
    const records: EventLogRecord[] = normalizeEventLogRecords(
      pageRows,
      input.table,
    );

    const countRows = await this.clickHouseService.select<{
      total: number;
    }>(
      `SELECT count() as total FROM ${clickHouseTable} WHERE ${whereClause}`,
      params,
    );
    const totalCount = countRows[0]?.total ?? records.length;

    return {
      records,
      totalCount,
      pageInfo: {
        endCursor: hasNextPage
          ? this.encodeCursor(offset + first)
          : undefined,
        hasNextPage,
      },
    };
  }

  private buildWhereClause(
    definition: (typeof EVENT_LOG_TYPES)[EventLogTable],
    workspaceId: string,
    input: EventLogQueryInput,
  ): { whereClause: string; params: Record<string, unknown> } {
    const conditions: string[] = ['workspaceId = {workspaceId:String}'];
    const params: Record<string, unknown> = { workspaceId };

    const filters = input.filters;

    if (filters?.eventType) {
      conditions.push(`${definition.eventFieldName} = {eventType:String}`);
      params.eventType = filters.eventType;
    }

    if (filters?.userWorkspaceId && definition.userIdFieldName) {
      conditions.push(
        `${definition.userIdFieldName} = {userWorkspaceId:String}`,
      );
      params.userWorkspaceId = filters.userWorkspaceId;
    }

    if (filters?.recordId && input.table === EventLogTable.OBJECT_EVENT) {
      conditions.push('recordId = {recordId:String}');
      params.recordId = filters.recordId;
    }

    if (
      filters?.objectMetadataId &&
      input.table === EventLogTable.OBJECT_EVENT
    ) {
      conditions.push('objectMetadataId = {objectMetadataId:String}');
      params.objectMetadataId = filters.objectMetadataId;
    }

    if (filters?.dateRange?.start) {
      conditions.push('timestamp >= {rangeStart:DateTime64}');
      params.rangeStart = filters.dateRange.start;
    }

    if (filters?.dateRange?.end) {
      conditions.push('timestamp <= {rangeEnd:DateTime64}');
      params.rangeEnd = filters.dateRange.end;
    }

    return { whereClause: conditions.join(' AND '), params };
  }

  private decodeCursor(after?: string): number {
    if (!after) {
      return 0;
    }

    const decoded = Number.parseInt(
      Buffer.from(after, 'base64').toString('utf-8'),
      10,
    );

    return Number.isFinite(decoded) && decoded > 0 ? decoded : 0;
  }

  private encodeCursor(offset: number): string {
    return Buffer.from(String(offset), 'utf-8').toString('base64');
  }
}
