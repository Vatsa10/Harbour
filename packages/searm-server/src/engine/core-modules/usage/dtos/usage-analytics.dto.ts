// SeaRM — AGPL-3.0. Clean-room reimplementation of the usage ledger
// (no SeaRM Enterprise source consulted).

import { Field, ObjectType } from '@nestjs/graphql';

import { UsageBreakdownItemDTO } from 'src/engine/core-modules/usage/dtos/usage-breakdown-item.dto';
import { UsageTimeSeriesDTO } from 'src/engine/core-modules/usage/dtos/usage-time-series.dto';
import { UsageUserDailyDTO } from 'src/engine/core-modules/usage/dtos/usage-user-daily.dto';

@ObjectType()
export class UsageAnalyticsDTO {
  @Field(() => [UsageBreakdownItemDTO])
  breakdown: UsageBreakdownItemDTO[];

  @Field(() => [UsageTimeSeriesDTO])
  timeSeries: UsageTimeSeriesDTO[];

  @Field(() => [UsageUserDailyDTO])
  byUser: UsageUserDailyDTO[];
}
