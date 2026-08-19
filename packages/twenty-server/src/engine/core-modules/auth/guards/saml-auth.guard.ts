import { type ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { type Request } from 'express';

import {
  AuthException,
  AuthExceptionCode,
} from 'src/engine/core-modules/auth/auth.exception';
import { WorkspaceDomainsService } from 'src/engine/core-modules/domain/workspace-domains/services/workspace-domains.service';
import { GuardRedirectService } from 'src/engine/core-modules/guard-redirect/services/guard-redirect.service';
import { SSOService } from 'src/engine/core-modules/sso/services/sso.service';

/**
 * Guards the SAML assertion-consumer-service (ACS) endpoint. This guard performs no SAML
 * validation itself — signature, audience, condition/expiry, and replay checks all live in
 * `SSOService` (called by `SamlAuthStrategy`). Its only responsibilities are: (1) resolve
 * the identity provider referenced by the request so errors can be redirected to the right
 * workspace, and (2) fail closed — any missing/unknown identity provider, or any exception
 * anywhere in this flow, rejects the request rather than letting it fall through to the
 * underlying passport strategy.
 */
@Injectable()
export class SamlAuthGuard extends AuthGuard('saml') {
  constructor(
    private readonly ssoService: SSOService,
    private readonly guardRedirectService: GuardRedirectService,
    private readonly workspaceDomainsService: WorkspaceDomainsService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const identityProviderId = request.params?.identityProviderId;

    try {
      if (
        typeof identityProviderId !== 'string' ||
        identityProviderId.length === 0
      ) {
        throw new AuthException(
          'Missing SSO identity provider',
          AuthExceptionCode.SSO_AUTH_FAILED,
        );
      }

      const identityProvider =
        await this.ssoService.findSSOIdentityProviderById(identityProviderId);

      if (!identityProvider) {
        throw new AuthException(
          'SSO identity provider not found',
          AuthExceptionCode.SSO_AUTH_FAILED,
        );
      }

      return (await super.canActivate(context)) as boolean;
    } catch (err) {
      this.guardRedirectService.dispatchErrorFromGuard(
        context,
        err instanceof Error ? err : new Error(String(err)),
        this.workspaceDomainsService.getSubdomainAndCustomDomainFromWorkspaceFallbackOnDefaultSubdomain(
          null,
        ),
      );

      return false;
    }
  }
}
