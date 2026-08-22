// SeaRM: clean-room AGPL-3.0 rewrite. See
// .superpowers/sdd/enterprise-rewrite/event-logs-spec.md for design notes.
import { Module } from '@nestjs/common';

import { ClickHouseModule } from 'src/database/clickHouse/clickHouse.module';
import { EventLogCleanupCronCommand } from 'src/engine/core-modules/event-logs/cleanup/commands/event-log-cleanup.cron.command';
import { EventLogCleanupCronJob } from 'src/engine/core-modules/event-logs/cleanup/crons/event-log-cleanup.cron.job';
import { EventLogCleanupJob } from 'src/engine/core-modules/event-logs/cleanup/jobs/event-log-cleanup.job';
import { EventLogCleanupService } from 'src/engine/core-modules/event-logs/cleanup/services/event-log-cleanup.service';

@Module({
  imports: [ClickHouseModule],
  providers: [
    EventLogCleanupService,
    EventLogCleanupJob,
    EventLogCleanupCronJob,
    EventLogCleanupCronCommand,
  ],
  exports: [EventLogCleanupCronCommand],
})
export class EventLogCleanupModule {}
