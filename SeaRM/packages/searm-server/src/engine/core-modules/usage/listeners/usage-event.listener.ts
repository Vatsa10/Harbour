// SeaRM — AGPL-3.0. Clean-room reimplementation of the usage ledger
// (no SeaRM Enterprise source consulted; derived from consumer call sites
// and from src/engine/core-modules/event-logs/emit/event-log-emitter.service.ts).

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { USAGE_RECORDED } from 'src/engine/core-modules/usage/constants/usage-recorded.constant';
import { type UsageEvent } from 'src/engine/core-modules/usage/types/usage-event.type';
import { buildUsageEventEnvelopes } from 'src/engine/core-modules/usage/utils/build-usage-event-envelopes';
import { EventLogEmitterService } from 'src/engine/core-modules/event-logs/emit/event-log-emitter.service';
import { type CustomWorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/custom-workspace-batch-event.type';

@Injectable()
export class UsageEventListener {
  private readonly logger = new Logger(UsageEventListener.name);

  constructor(
    private readonly eventLogEmitterService: EventLogEmitterService,
  ) {}

  @OnEvent(USAGE_RECORDED)
  async handleUsageRecordedEvent(
    batch: CustomWorkspaceEventBatch<UsageEvent>,
  ): Promise<void> {
    if (!batch.workspaceId) {
      return;
    }

    if (!this.eventLogEmitterService.isEnabled()) {
      return;
    }

    const envelopes = buildUsageEventEnvelopes(
      batch.workspaceId,
      batch.events,
    );

    try {
      await this.eventLogEmitterService.dispatch(envelopes);
    } catch (error) {
      // Usage analytics is best-effort — never let a ClickHouse hiccup
      // break the operation that generated the usage.
      this.logger.error('Failed to dispatch usage event batch', error);
    }
  }
}
