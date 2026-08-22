// SeaRM — AGPL-3.0. Clean-room reimplementation of the usage ledger
// (no SeaRM Enterprise source consulted; consumer contract derived from
// admin-panel.resolver.ts's getAdminAiUsageByWorkspace call site).

import { Injectable } from '@nestjs/common';

import { formatDateTimeForClickHouse } from 'src/database/clickHouse/clickHouse.util';
import { ClickHouseService } from 'src/database/clickHouse/clickHouse.service';
import { UsageBreakdownItemDTO } from 'src/engine/core-modules/usage/dtos/usage-breakdown-item.dto';
import { UsageAnalyticsDTO } from 'src/engine/core-modules/usage/dtos/usage-analytics.dto';
import { type UsageOperationType } from 'src/engine/core-modules/usage/enums/usage-operation-type.enum';
import {
  fillUsageTimeSeriesGaps,
  type UsageTimeSeriesPoint,
} from 'src/engine/core-modules/usage/utils/fill-usage-time-series-gaps.util';
import { toDisplayCredits } from 'src/engine/core-modules/usage/utils/to-display-credits.util';
import { toDollars } from 'src/engine/core-modules/usage/utils/to-dollars.util';

export type { UsageTimeSeriesPoint };

type WorkspaceCreditsRow = { workspaceId: string; totalCreditsUsedMicro: string };
type DailyCreditsRow = { date: string; totalCreditsUsedMicro: string };
type UserDailyCreditsRow = {
  userWorkspaceId: string;
  date: string;
  totalCreditsUsedMicro: string;
};

@Injectable()
export class UsageAnalyticsService {
  constructor(private readonly clickHouseService: ClickHouseService) {}

  // Usage grouped by workspaceId, ranked by cost, for the admin panel's
  // "AI usage by workspace" table. `useDollarMode` picks the display
  // conversion (dollars when billing is disabled, display-credits otherwise).
  async getAdminAiUsageByWorkspace(params: {
    periodStart: Date;
    periodEnd: Date;
    useDollarMode: boolean;
  }): Promise<UsageBreakdownItemDTO[]> {
    const rows = await this.clickHouseService.select<WorkspaceCreditsRow>(
      `
        SELECT workspaceId, sum(creditsUsedMicro) as totalCreditsUsedMicro
        FROM usageEvent
        WHERE resourceType = 'AI'
          AND timestamp >= {periodStart:DateTime64(3)}
          AND timestamp < {periodEnd:DateTime64(3)}
        GROUP BY workspaceId
        ORDER BY totalCreditsUsedMicro DESC
      `,
      {
        periodStart: formatDateTimeForClickHouse(params.periodStart),
        periodEnd: formatDateTimeForClickHouse(params.periodEnd),
      },
    );

    const convert = params.useDollarMode ? toDollars : toDisplayCredits;

    return rows.map((row) => ({
      key: row.workspaceId,
      value: convert(Number(row.totalCreditsUsedMicro)),
    }));
  }

  // Full analytics payload backing the usage.resolver GraphQL query:
  // a per-operationType breakdown, a daily time series (gap-filled), and a
  // per-user daily breakdown, all scoped to one workspace and period.
  async getUsageAnalytics(params: {
    workspaceId: string;
    periodStart: Date;
    periodEnd: Date;
    operationType?: UsageOperationType;
  }): Promise<UsageAnalyticsDTO> {
    const operationTypeClause = params.operationType
      ? 'AND operationType = {operationType:String}'
      : '';
    const queryParams: Record<string, unknown> = {
      workspaceId: params.workspaceId,
      periodStart: formatDateTimeForClickHouse(params.periodStart),
      periodEnd: formatDateTimeForClickHouse(params.periodEnd),
      ...(params.operationType && { operationType: params.operationType }),
    };

    const [breakdownRows, dailyRows, userDailyRows] = await Promise.all([
      this.clickHouseService.select<{
        operationType: string;
        totalCreditsUsedMicro: string;
      }>(
        `
          SELECT operationType, sum(creditsUsedMicro) as totalCreditsUsedMicro
          FROM usageEvent
          WHERE workspaceId = {workspaceId:String}
            AND timestamp >= {periodStart:DateTime64(3)}
            AND timestamp < {periodEnd:DateTime64(3)}
            ${operationTypeClause}
          GROUP BY operationType
          ORDER BY totalCreditsUsedMicro DESC
        `,
        queryParams,
      ),
      this.clickHouseService.select<DailyCreditsRow>(
        `
          SELECT toDate(timestamp) as date, sum(creditsUsedMicro) as totalCreditsUsedMicro
          FROM usageEvent
          WHERE workspaceId = {workspaceId:String}
            AND timestamp >= {periodStart:DateTime64(3)}
            AND timestamp < {periodEnd:DateTime64(3)}
            ${operationTypeClause}
          GROUP BY date
          ORDER BY date ASC
        `,
        queryParams,
      ),
      this.clickHouseService.select<UserDailyCreditsRow>(
        `
          SELECT userWorkspaceId, toDate(timestamp) as date, sum(creditsUsedMicro) as totalCreditsUsedMicro
          FROM usageEvent
          WHERE workspaceId = {workspaceId:String}
            AND timestamp >= {periodStart:DateTime64(3)}
            AND timestamp < {periodEnd:DateTime64(3)}
            AND userWorkspaceId != ''
            ${operationTypeClause}
          GROUP BY userWorkspaceId, date
          ORDER BY date ASC
        `,
        queryParams,
      ),
    ]);

    const timeSeries = fillUsageTimeSeriesGaps({
      rows: dailyRows.map((row) => ({
        date: row.date,
        creditsUsed: toDisplayCredits(Number(row.totalCreditsUsedMicro)),
      })),
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
    });

    return {
      breakdown: breakdownRows.map((row) => ({
        key: row.operationType,
        value: toDisplayCredits(Number(row.totalCreditsUsedMicro)),
      })),
      timeSeries,
      byUser: userDailyRows.map((row) => ({
        userWorkspaceId: row.userWorkspaceId,
        date: row.date,
        creditsUsed: toDisplayCredits(Number(row.totalCreditsUsedMicro)),
      })),
    };
  }
}
