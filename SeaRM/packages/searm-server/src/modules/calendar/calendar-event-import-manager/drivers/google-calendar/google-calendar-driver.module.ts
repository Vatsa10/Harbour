import { Module } from '@nestjs/common';

import { SearmConfigModule } from 'src/engine/core-modules/searm-config/searm-config.module';
import { GoogleCalendarGetEventsService } from 'src/modules/calendar/calendar-event-import-manager/drivers/google-calendar/services/google-calendar-get-events.service';
import { GoogleCalendarImportEventsService } from 'src/modules/calendar/calendar-event-import-manager/drivers/google-calendar/services/google-calendar-import-events.service';
import { OAuth2ClientManagerModule } from 'src/modules/connected-account/oauth2-client-manager/oauth2-client-manager.module';

@Module({
  imports: [SearmConfigModule, OAuth2ClientManagerModule],
  providers: [
    GoogleCalendarGetEventsService,
    GoogleCalendarImportEventsService,
  ],
  exports: [GoogleCalendarGetEventsService, GoogleCalendarImportEventsService],
})
export class GoogleCalendarDriverModule {}
