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
 * Guards the OIDC authorization-code callback endpoint. All OIDC security validation —
 * `state` CSRF check, `nonce` check, ID token signature/`iss`/`aud`/`exp` verification — is
 * performed by the underlying 'openidconnect' passport strategy (via `openid-client`'s
 * `client.callback(...)`), driven by the per-identity-provider client `SSOService` builds.
 * This guard resolves the identity provider up front purely so an unknown/missing provider
 * fails immediately (fail closed) instead of reaching the strategy at all, and so any error
 * anywhere in the flow redirects to the correct workspace rather than throwing generically.
 */
@Injectable()
export class OIDCAuthGuard extends AuthGuard('openidconnect') {
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

      // Scope the lookup to the workspace this request actually arrived for.
      // An unscoped lookup by id alone lets an unauthenticated caller probe
      // any workspace's identity-provider rows.
      const { workspace } =
        await this.workspaceDomainsService.resolveWorkspaceAndPublicDomain(
          request.headers.origin ?? request.headers.host ?? '',
        );

      if (!workspace) {
        throw new AuthException(
          'SSO identity provider not found',
          AuthExceptionCode.SSO_AUTH_FAILED,
        );
      }

      const identityProvider =
        await this.ssoService.findSSOIdentityProviderById(
          identityProviderId,
          workspace.id,
        );

      // Hand the resolved workspace to the strategy so it validates against a
      // scoped provider rather than re-deriving scope from client input.
      (request as Request & { ssoWorkspaceId?: string }).ssoWorkspaceId =
        workspace.id;

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
