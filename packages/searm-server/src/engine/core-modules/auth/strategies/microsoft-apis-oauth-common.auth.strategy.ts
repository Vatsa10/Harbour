import { PassportStrategy } from '@nestjs/passport';

import { Strategy } from 'passport-microsoft';
import { type VerifyCallback } from 'passport-google-oauth20';

import { getMicrosoftApisOauthScopes } from 'src/engine/core-modules/auth/utils/get-microsoft-apis-oauth-scopes';
import { type SearmConfigService } from 'src/engine/core-modules/searm-config/searm-config.service';

export type MicrosoftAPIScopeConfig = {
  isCalendarEnabled?: boolean;
  isMessagingAliasFetchingEnabled?: boolean;
};

export abstract class MicrosoftAPIsOauthCommonStrategy extends PassportStrategy(
  Strategy,
  'microsoft-apis',
) {
  constructor(searmConfigService: SearmConfigService) {
    const scopes = getMicrosoftApisOauthScopes();

    super({
      clientID: searmConfigService.get('AUTH_MICROSOFT_CLIENT_ID'),
      clientSecret: searmConfigService.get('AUTH_MICROSOFT_CLIENT_SECRET'),
      tenant: 'common',
      callbackURL: searmConfigService.get('AUTH_MICROSOFT_APIS_CALLBACK_URL'),
      scope: scopes,
      passReqToCallback: true,
    });
  }

  abstract validate(
    request: Express.Request,
    accessToken: string,
    refreshToken: string,
    profile: unknown,
    done: VerifyCallback,
  ): Promise<void>;
}
