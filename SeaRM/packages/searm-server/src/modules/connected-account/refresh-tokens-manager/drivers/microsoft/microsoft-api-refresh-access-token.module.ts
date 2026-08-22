import { Module } from '@nestjs/common';

import { JwtModule } from 'src/engine/core-modules/jwt/jwt.module';
import { SearmConfigModule } from 'src/engine/core-modules/searm-config/searm-config.module';
import { MicrosoftAPIRefreshAccessTokenService } from 'src/modules/connected-account/refresh-tokens-manager/drivers/microsoft/services/microsoft-api-refresh-tokens.service';

@Module({
  imports: [SearmConfigModule, JwtModule],
  providers: [MicrosoftAPIRefreshAccessTokenService],
  exports: [MicrosoftAPIRefreshAccessTokenService],
})
export class MicrosoftAPIRefreshAccessTokenModule {}
