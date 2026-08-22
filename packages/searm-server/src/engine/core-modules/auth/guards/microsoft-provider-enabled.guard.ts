import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';

import {
  AuthException,
  AuthExceptionCode,
} from 'src/engine/core-modules/auth/auth.exception';
import { MicrosoftStrategy } from 'src/engine/core-modules/auth/strategies/microsoft.auth.strategy';
import { GuardRedirectService } from 'src/engine/core-modules/guard-redirect/services/guard-redirect.service';
import { SearmConfigService } from 'src/engine/core-modules/searm-config/searm-config.service';

@Injectable()
export class MicrosoftProviderEnabledGuard implements CanActivate {
  constructor(
    private readonly searmConfigService: SearmConfigService,
    private readonly guardRedirectService: GuardRedirectService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    try {
      if (!this.searmConfigService.get('AUTH_MICROSOFT_ENABLED')) {
        throw new AuthException(
          'Microsoft auth is not enabled',
          AuthExceptionCode.MICROSOFT_API_AUTH_DISABLED,
        );
      }

      new MicrosoftStrategy(this.searmConfigService);

      return true;
    } catch (err) {
      this.guardRedirectService.dispatchErrorFromGuard(
        context,
        err,
        this.guardRedirectService.getSubdomainAndCustomDomainFromContext(
          context,
        ),
      );

      return false;
    }
  }
}
