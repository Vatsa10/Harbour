import {
  Controller,
  Param,
  Post,
  Get,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';

import { Response } from 'express';
import { ConnectedAccountProvider } from 'searm-shared/types';

import { AuthOAuthExceptionFilter } from 'src/engine/core-modules/auth/filters/auth-oauth-exception.filter';
import { AuthRestApiExceptionFilter } from 'src/engine/core-modules/auth/filters/auth-rest-api-exception.filter';
import { OIDCAuthGuard } from 'src/engine/core-modules/auth/guards/oidc-auth.guard';
import { SamlAuthGuard } from 'src/engine/core-modules/auth/guards/saml-auth.guard';
import { AuthService } from 'src/engine/core-modules/auth/services/auth.service';
import { type SSORequest } from 'src/engine/core-modules/auth/strategies/saml.auth.strategy';
import { AuthProviderEnum } from 'src/engine/core-modules/workspace/types/workspace.type';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';

/**
 * Assertion-consumer-service / callback endpoints for SAML and OIDC SSO. By the time a
 * handler in this controller runs, the request has already passed `SamlAuthGuard` /
 * `OIDCAuthGuard`, which delegate all cryptographic/protocol validation to `SSOService`
 * (SAML: signature, audience, `NotBefore`/`NotOnOrAfter`, `InResponseTo` replay; OIDC:
 * `state`, `nonce`, ID token signature/`iss`/`aud`/`exp`) — this controller never inspects
 * raw assertions or tokens, and only ever acts on the guard-populated, already-validated
 * `req.user` principal.
 */
@Controller('auth')
@UseFilters(AuthRestApiExceptionFilter)
export class SSOAuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('saml/:identityProviderId/redirect')
  @UseGuards(SamlAuthGuard, PublicEndpointGuard, NoPermissionGuard)
  @UseFilters(AuthOAuthExceptionFilter)
  async samlAuthRedirect(@Req() req: SSORequest, @Res() res: Response) {
    return res.redirect(
      await this.authService.signInUpWithSocialSSO(
        req.user,
        AuthProviderEnum.SSO,
        ConnectedAccountProvider.SAML,
      ),
    );
  }

  @Get('oidc/:identityProviderId/redirect')
  @UseGuards(OIDCAuthGuard, PublicEndpointGuard, NoPermissionGuard)
  @UseFilters(AuthOAuthExceptionFilter)
  async oidcAuthRedirect(
    @Req() req: SSORequest,
    @Res() res: Response,
    @Param('identityProviderId') _identityProviderId: string,
  ) {
    return res.redirect(
      await this.authService.signInUpWithSocialSSO(
        req.user,
        AuthProviderEnum.SSO,
        ConnectedAccountProvider.OIDC,
      ),
    );
  }
}
