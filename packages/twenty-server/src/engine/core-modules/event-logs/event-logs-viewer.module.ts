// SeaRM: clean-room AGPL-3.0 rewrite. See
// .superpowers/sdd/enterprise-rewrite/event-logs-spec.md for design notes.
// No entitlement/license gating — event logs are unconditionally on.
import { Module } from '@nestjs/common';

import { ClickHouseModule } from 'src/database/clickHouse/clickHouse.module';
import { EventLogEmitterModule } from 'src/engine/core-modules/event-logs/emit/event-log-emitter.module';
import { EventLogEmitterResolver } from 'src/engine/core-modules/event-logs/emit/event-log-emitter.resolver';
import { EventLogsLiveResolver } from 'src/engine/core-modules/event-logs/event-logs-live.resolver';
import { EventLogsResolver } from 'src/engine/core-modules/event-logs/event-logs.resolver';
import { EventLogsService } from 'src/engine/core-modules/event-logs/event-logs.service';
import { EventLogLiveModule } from 'src/engine/core-modules/event-logs/live/event-log-live.module';
import { TwentyConfigModule } from 'src/engine/core-modules/twenty-config/twenty-config.module';
import { SubscriptionsModule } from 'src/engine/subscriptions/subscriptions.module';

@Module({
  imports: [
    ClickHouseModule,
    EventLogEmitterModule,
    EventLogLiveModule,
    SubscriptionsModule,
    TwentyConfigModule,
  ],
  providers: [
    EventLogEmitterResolver,
    EventLogsResolver,
    EventLogsLiveResolver,
    EventLogsService,
  ],
  exports: [EventLogsService],
})
export class EventLogsViewerModule {}
