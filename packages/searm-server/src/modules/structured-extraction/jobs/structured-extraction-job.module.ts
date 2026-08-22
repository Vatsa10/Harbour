import { Module } from '@nestjs/common';

import { CalendarEventExtractionJob } from 'src/modules/structured-extraction/jobs/calendar-event-extraction.job';
import { MessageExtractionJob } from 'src/modules/structured-extraction/jobs/message-extraction.job';
import { StructuredExtractionModule } from 'src/modules/structured-extraction/structured-extraction.module';

@Module({
  imports: [StructuredExtractionModule],
  providers: [MessageExtractionJob, CalendarEventExtractionJob],
})
export class StructuredExtractionJobModule {}
