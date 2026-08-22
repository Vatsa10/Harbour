import { Module } from '@nestjs/common';

import { SearmORMModule } from 'src/engine/searm-orm/searm-orm.module';
import { UpsertTimelineActivityFromInternalEvent } from 'src/modules/timeline/jobs/upsert-timeline-activity-from-internal-event.job';
import { TimelineActivityModule } from 'src/modules/timeline/timeline-activity.module';

@Module({
  imports: [TimelineActivityModule, SearmORMModule],
  providers: [UpsertTimelineActivityFromInternalEvent],
})
export class TimelineJobModule {}
