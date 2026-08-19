// SeaRM: clean-room AGPL-3.0 rewrite. See
// .superpowers/sdd/enterprise-rewrite/event-logs-spec.md for design notes.
// No entitlement/license gating — cleanup runs unconditionally.
import { Injectable, Logger } from '@nestjs/common';

import { EventLogTable } from 'twenty-shared/types';

import { ClickHouseService } from 'src/database/clickHouse/clickHouse.service';
import { getClickHouseTableName } from 'src/engine/core-modules/event-logs/registry/event-log-registry';

// Kept as a plain constant rather than a TwentyConfigService entry to avoid
// touching the shared config-variable surface for this rewrite. Revisit if
// per-instance retention tuning becomes a real requirement.
const EVENT_LOG_RETENTION_DAYS = 90;

@Injectable()
export class EventLogCleanupService {
  private readonly logger = new Logger(EventLogCleanupService.name);

  constructor(private readonly clickHouseService: ClickHouseService) {}

  async cleanup(): Promise<void> {
    if (!this.clickHouseService.getMainClient()) {
      return;
    }

    const retentionDays = EVENT_LOG_RETENTION_DAYS;

    for (const table of Object.values(EventLogTable)) {
      const clickHouseTable = getClickHouseTableName(table);

      const success = await this.clickHouseService.executeCommand(
        `ALTER TABLE ${clickHouseTable} DELETE WHERE timestamp < now() - INTERVAL {retentionDays:UInt32} DAY`,
        { retentionDays },
      );

      if (!success) {
        // ClickHouseService already logs the underlying error. We surface it
        // here too so the cron job / queue infra can see cleanup failed for
        // this table without throwing and dropping the other tables' cleanup.
        this.logger.error(
          `Event log cleanup failed for ClickHouse table "${clickHouseTable}"`,
        );
      }
    }
  }
}
