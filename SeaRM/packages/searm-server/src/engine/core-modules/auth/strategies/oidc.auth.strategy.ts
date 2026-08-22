import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';

import { type Request } from 'express';
import { Strategy as PassportBaseStrategy } from 'passport-strategy';
import { type APP_LOCALES } from 'searm-shared/translations';

import { SSOService } from 'src/engine/core-modules/sso/services/sso.service';

export type SSORequest = Omit<
  Request,
  'user' | 'workspace' | 'workspaceMetadataVersion'
> & {
  user: {
    firstName?: string | null;
    lastName?: string | null;
    email: string;
    picture: string | null;
    workspaceId: string;
    identityProviderId: string;
    returnToPath?: string;
    workspaceInviteHash?: string;
    billingCheckoutSessionState?: string;
    locale?: keyof typeof APP_LOCALES | null;
  };
  params: {
    identityProviderId: string;
  };
  // Set by OIDCAuthGuard after it resolves the workspace from the request
  // origin. The strategy never derives it from client-supplied data.
  ssoWorkspaceId?: string;
};

/**
 * Passport strategy for the OIDC authorization-code callback. All security-critical
 * validation of the callback — `state` match, `nonce` match, ID token signature
 * verification against the discovered JWKS, issuer/audience/exp checks, and single-use
 * consumption of the `state` transaction (replay protection) — is performed exclusively by
 * `SSOService.verifyOIDCCallback`. This strategy never inspects, decodes, or trusts any part
 * of the callback request itself: it only forwards the raw callback URL and query/body
 * params to `SSOService` and acts on the validated result. Any rejection (including
 * SSOService being unreachable or throwing for any reason) fails the authentication attempt
 * closed — no user is ever produced from a callback this strategy has not gotten an explicit
 * validated principal for.
 *
 * Reference: OpenID Connect Core 1.0 (Authorization Code Flow, ID Token validation) —
 * https://openid.net/specs/openid-connect-core-1_0.html
 */
@Injectable()
export class OIDCAuthStrategy extends PassportStrategy(
  PassportBaseStrategy,
  'openidconnect',
) {
  constructor(private readonly ssoService: SSOService) {
    super();
  }

  // The passport base `Strategy` class declares `authenticate` as `(req, options?) => void`
  // and expects `this.success`/`this.fail` (not a return value) to signal the outcome; the
  // async body below still respects that contract, it just doesn't resolve its promise
  // until success()/fail() has been called.
  authenticate(req: Request): void {
    void this.doAuthenticate(req as unknown as SSORequest);
  }

  // oxlint-disable-next-line typescript/no-explicit-any
  validate(..._args: any[]): void {
    // Never called: this strategy overrides `authenticate` directly instead of using
    // passport's verify-callback pattern, since the "verification" step here is delegated
    // entirely to SSOService.verifyOIDCCallback rather than a local verify callback.
    throw new Error('OIDCAuthStrategy.validate should never be invoked');
  }

  private async doAuthenticate(req: SSORequest): Promise<void> {
    const identityProviderId = req.params?.identityProviderId;

    if (
      typeof identityProviderId !== 'string' ||
      identityProviderId.length === 0
    ) {
      // Fail closed: never call into validation with a malformed/missing request.
      this.fail('Missing identity provider', 400);

      return;
    }

    const workspaceId = req.ssoWorkspaceId;

    if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
      // The guard resolves this from the request origin. Its absence means the
      // guard did not run or could not resolve a workspace - fail closed rather
      // than validating against an unscoped provider lookup.
      this.fail('Unresolved workspace for SSO response', 400);

      return;
    }

    const callbackUrl = this.buildCallbackUrl(req);

    if (!callbackUrl) {
      this.fail('Unable to determine OIDC callback URL', 400);

      return;
    }

    try {
      const validatedPrincipal = await this.ssoService.verifyOIDCCallback({
        workspaceId,
        identityProviderId,
        callbackUrl,
        // The raw query params from the OIDC authorization-code callback redirect.
        // SSOService is the only party that reads/trusts these (state, code, etc.).
        callbackParams: { ...req.query } as Record<
          string,
          string | string[] | undefined
        >,
      });

      const user: SSORequest['user'] = {
        email: validatedPrincipal.email,
        firstName: validatedPrincipal.firstName ?? null,
        lastName: validatedPrincipal.lastName ?? null,
        picture: null,
        workspaceId: validatedPrincipal.workspaceId,
        identityProviderId: validatedPrincipal.identityProviderId,
        returnToPath: validatedPrincipal.returnToPath,
      };

      this.success(user);
    } catch {
      // Any exception from SSOService (invalid state, nonce mismatch, bad signature,
      // expired/replayed callback, issuer mismatch, etc.) fails the login attempt closed.
      // The underlying error is intentionally not forwarded to the client to avoid leaking
      // validation details; it is left for SSOService/callers to log server-side without
      // secret material.
      this.fail('OIDC authentication failed', 401);
    }
  }

  // Reconstructs the absolute callback URL from the request, the same way the
  // openid-client based passport strategy this replaces would have. Never trusts a
  // client-supplied absolute URL/host override; only the framework-provided pieces.
  private buildCallbackUrl(req: SSORequest): string | undefined {
    const protocol = req.protocol;
    const host = req.get?.('host');

    if (!protocol || !host) {
      return undefined;
    }

    return `${protocol}://${host}${req.originalUrl ?? req.url ?? ''}`;
  }
}
