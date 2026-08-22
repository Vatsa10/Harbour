// SeaRM — AGPL-3.0. Clean-room reimplementation of the usage ledger
// (no SeaRM Enterprise source consulted).

import { Module } from '@nestjs/common';

import { ClickHouseModule } from 'src/database/clickHouse/clickHouse.module';
import { EventLogEmitterModule } from 'src/engine/core-modules/event-logs/emit/event-log-emitter.module';
import { UsageEventListener } from 'src/engine/core-modules/usage/listeners/usage-event.listener';
import { UsageAnalyticsService } from 'src/engine/core-modules/usage/services/usage-analytics.service';
import { UsageResolver } from 'src/engine/core-modules/usage/usage.resolver';

@Module({
  imports: [ClickHouseModule, EventLogEmitterModule],
  providers: [UsageEventListener, UsageAnalyticsService, UsageResolver],
  exports: [UsageAnalyticsService],
})
export class UsageModule {}
