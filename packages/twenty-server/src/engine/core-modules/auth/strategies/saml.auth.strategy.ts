import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';

import { type Request } from 'express';
import { Strategy as PassportBaseStrategy } from 'passport-strategy';
import { type APP_LOCALES } from 'twenty-shared/translations';

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
  // Set by SamlAuthGuard after it resolves the workspace from the request
  // origin. The strategy never derives it from client-supplied data.
  ssoWorkspaceId?: string;
};

/**
 * Passport strategy for SAML 2.0 Web Browser SSO (HTTP-POST binding, IdP-initiated
 * assertion consumer service). All security-critical validation of the SAML response —
 * signature verification against the identity provider's trust anchor, audience/recipient
 * restriction, `NotBefore`/`NotOnOrAfter` conditions with clock-skew tolerance, and
 * `InResponseTo` replay protection — is performed exclusively by
 * `SSOService.validateSAMLResponse`. This strategy never inspects, parses, or trusts any
 * field of the SAML response itself: it only forwards the raw response to `SSOService` and
 * acts on the validated result. Any rejection (including SSOService being unreachable or
 * throwing for any reason) fails the authentication attempt closed — no user is ever
 * produced from an assertion this strategy has not gotten an explicit validated principal
 * for.
 *
 * Reference: SAML 2.0 Core (assertion `Conditions`, `SubjectConfirmationData`), SAML 2.0
 * Bindings (HTTP-POST binding), SAML 2.0 Profiles (Web Browser SSO profile) —
 * https://docs.oasis-open.org/security/saml/v2.0/
 */
@Injectable()
export class SamlAuthStrategy extends PassportStrategy(
  PassportBaseStrategy,
  'saml',
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
    // entirely to SSOService.validateSAMLResponse rather than a local verify callback.
    throw new Error('SamlAuthStrategy.validate should never be invoked');
  }

  private async doAuthenticate(req: SSORequest): Promise<void> {
    const identityProviderId = req.params?.identityProviderId;
    const samlResponse = req.body?.SAMLResponse;

    if (
      typeof identityProviderId !== 'string' ||
      identityProviderId.length === 0 ||
      typeof samlResponse !== 'string' ||
      samlResponse.length === 0
    ) {
      // Fail closed: never call into validation with a malformed/missing request.
      this.fail('Missing SAML response or identity provider', 400);

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

    try {
      const validatedPrincipal = await this.ssoService.validateSAMLResponse({
        workspaceId,
        identityProviderId,
        samlResponseXml: samlResponse,
        // RelayState round-trips whatever the authorization-URL generation step encoded
        // (e.g. returnToPath); SSOService is the only party that decodes/trusts it.
        relayState:
          typeof req.body?.RelayState === 'string'
            ? req.body.RelayState
            : undefined,
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
      // Any exception from SSOService (invalid signature, expired assertion, replayed
      // InResponseTo, audience mismatch, etc.) fails the login attempt closed. The
      // underlying error is intentionally not forwarded to the client to avoid leaking
      // assertion/validation details; it is left for SSOService/callers to log server-side
      // without secret material.
      this.fail('SAML authentication failed', 401);
    }
  }
}
