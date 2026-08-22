import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SecureHttpClientModule } from 'src/engine/core-modules/secure-http-client/secure-http-client.module';
import { SearmConfigModule } from 'src/engine/core-modules/searm-config/searm-config.module';
import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { ConnectedAccountTokenEncryptionModule } from 'src/engine/metadata-modules/connected-account/services/connected-account-token-encryption.module';
import { CalDavClientProvider } from 'src/modules/calendar/calendar-event-import-manager/drivers/caldav/providers/caldav-client.provider';
import { CalDavClientService } from 'src/modules/calendar/calendar-event-import-manager/drivers/caldav/services/caldav-client.service';
import { CalDavFetchEventsService } from 'src/modules/calendar/calendar-event-import-manager/drivers/caldav/services/caldav-fetch-events.service';
import { CalDavGetEventsService } from 'src/modules/calendar/calendar-event-import-manager/drivers/caldav/services/caldav-get-events.service';
import { CalDavImportEventsService } from 'src/modules/calendar/calendar-event-import-manager/drivers/caldav/services/caldav-import-events.service';

@Module({
  imports: [
    SecureHttpClientModule,
    SearmConfigModule,
    ConnectedAccountTokenEncryptionModule,
    TypeOrmModule.forFeature([ConnectedAccountEntity]),
  ],
  providers: [
    CalDavClientProvider,
    CalDavClientService,
    CalDavFetchEventsService,
    CalDavGetEventsService,
    CalDavImportEventsService,
  ],
  exports: [
    CalDavClientProvider,
    CalDavClientService,
    CalDavFetchEventsService,
    CalDavGetEventsService,
    CalDavImportEventsService,
  ],
})
export class CalDavDriverModule {}
