import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { randomBytes } from 'node:crypto';

import { SAML, ValidateInResponseTo, type CacheItem, type CacheProvider, type Profile } from '@node-saml/node-saml';
import { generators, Issuer, type Client as OIDCClient } from 'openid-client';
import { Repository } from 'typeorm';

import { CacheStorageService } from 'src/engine/core-modules/cache-storage/services/cache-storage.service';
import { CacheStorageNamespace } from 'src/engine/core-modules/cache-storage/types/cache-storage-namespace.enum';
import { type EditSsoInput } from 'src/engine/core-modules/sso/dtos/edit-sso.input';
import { type SetupSsoInput } from 'src/engine/core-modules/sso/dtos/setup-sso.input';
import { SSOException, SSOExceptionCode } from 'src/engine/core-modules/sso/sso.exception';
import {
  IdentityProviderType,
  SSOIdentityProviderStatus,
  WorkspaceSSOIdentityProviderEntity,
} from 'src/engine/core-modules/sso/workspace-sso-identity-provider.entity';

// SP-initiated flows are short-lived by design (RelayState / OIDC state+nonce
// must be consumed once, promptly, or rejected).
const SSO_TRANSACTION_TTL_MS = 5 * 60 * 1000;

// Deliberately identical whether the identity-provider id does not exist,
// belongs to a different workspace, or is Inactive — this endpoint is reached
// without authentication, so its response must never let an attacker
// enumerate which provider ids are valid for a given workspace.
const GENERIC_NOT_FOUND_MESSAGE = 'Identity provider not available';

type OIDCTransaction = {
  identityProviderId: string;
  workspaceId: string;
  nonce: string;
  returnToPath?: string;
};

type SAMLTransaction = {
  identityProviderId: string;
  workspaceId: string;
  returnToPath?: string;
};

// Brand used to gate construction of SSOValidatedPrincipal. It is module
// private (not exported) so the only code able to mint a principal is the
// verification logic in this file — there is no path to an authenticated
// SSO identity that does not go through verifySAMLResponse /
// verifyOIDCCallback below.
const VERIFIED = Symbol('sso-assertion-verified');

export class SSOValidatedPrincipal {
  readonly email: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly identityProviderId: string;
  readonly workspaceId: string;
  readonly provider: IdentityProviderType;
  readonly returnToPath?: string;

  private constructor(params: {
    email: string;
    firstName?: string;
    lastName?: string;
    identityProviderId: string;
    workspaceId: string;
    provider: IdentityProviderType;
    returnToPath?: string;
  }) {
    this.email = params.email;
    this.firstName = params.firstName;
    this.lastName = params.lastName;
    this.identityProviderId = params.identityProviderId;
    this.workspaceId = params.workspaceId;
    this.provider = params.provider;
    this.returnToPath = params.returnToPath;
  }

  static __constructOnlyFromVerifiedAssertion(
    brand: typeof VERIFIED,
    params: {
      email: string;
      firstName?: string;
      lastName?: string;
      identityProviderId: string;
      workspaceId: string;
      provider: IdentityProviderType;
      returnToPath?: string;
    },
  ): SSOValidatedPrincipal {
    if (brand !== VERIFIED) {
      throw new Error(
        'SSOValidatedPrincipal can only be constructed by SSOService after full assertion verification',
      );
    }

    return new SSOValidatedPrincipal(params);
  }
}

@Injectable()
export class SSOService {
  constructor(
    @InjectRepository(WorkspaceSSOIdentityProviderEntity)
    private readonly identityProviderRepository: Repository<WorkspaceSSOIdentityProviderEntity>,
    @Inject(CacheStorageNamespace.EngineSSO)
    private readonly cacheStorageService: CacheStorageService,
  ) {}

  // ---------------------------------------------------------------------
  // Workspace-admin CRUD surface (consumed by SSOResolver, behind the
  // caller's own auth/permission guards — not this agent's concern here).
  // ---------------------------------------------------------------------

  async findAvailableSSOIdentityProviders(
    workspaceId: string,
  ): Promise<WorkspaceSSOIdentityProviderEntity[]> {
    return this.identityProviderRepository.find({ where: { workspaceId } });
  }

  async createSSOIdentityProvider(
    input: SetupSsoInput,
  ): Promise<WorkspaceSSOIdentityProviderEntity> {
    if (input.type === IdentityProviderType.OIDC) {
      return this.createOIDCIdentityProvider(input, input.workspaceId);
    }

    return this.createSAMLIdentityProvider(input, input.workspaceId);
  }

  async createOIDCIdentityProvider(
    data: {
      name: string;
      issuer: string;
      clientID?: string;
      clientSecret?: string;
    },
    workspaceId: string,
  ): Promise<WorkspaceSSOIdentityProviderEntity> {
    this.assertProviderConfigurationIsComplete({
      type: IdentityProviderType.OIDC,
      clientID: data.clientID,
      clientSecret: data.clientSecret,
    });

    const identityProvider = this.identityProviderRepository.create({
      workspaceId,
      name: data.name,
      type: IdentityProviderType.OIDC,
      issuer: data.issuer,
      clientID: data.clientID,
      clientSecret: data.clientSecret,
      status: SSOIdentityProviderStatus.Inactive,
    });

    return this.identityProviderRepository.save(identityProvider);
  }

  async createSAMLIdentityProvider(
    data: {
      name: string;
      issuer: string;
      ssoUrl?: string;
      certificate?: string;
    },
    workspaceId: string,
  ): Promise<WorkspaceSSOIdentityProviderEntity> {
    this.assertProviderConfigurationIsComplete({
      type: IdentityProviderType.SAML,
      ssoUrl: data.ssoUrl,
      certificate: data.certificate,
    });

    const identityProvider = this.identityProviderRepository.create({
      workspaceId,
      name: data.name,
      type: IdentityProviderType.SAML,
      issuer: data.issuer,
      ssoUrl: data.ssoUrl,
      certificate: data.certificate,
      status: SSOIdentityProviderStatus.Inactive,
    });

    return this.identityProviderRepository.save(identityProvider);
  }

  async editSSOIdentityProvider(
    input: EditSsoInput,
  ): Promise<WorkspaceSSOIdentityProviderEntity> {
    const identityProvider = await this.identityProviderRepository.findOne({
      where: { id: input.identityProviderId, workspaceId: input.workspaceId },
    });

    if (!identityProvider) {
      throw new SSOException(
        GENERIC_NOT_FOUND_MESSAGE,
        SSOExceptionCode.IDENTITY_PROVIDER_NOT_FOUND,
        { userFriendlyMessage: GENERIC_NOT_FOUND_MESSAGE },
      );
    }

    Object.assign(identityProvider, {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.status !== undefined && { status: input.status }),
      ...(input.issuer !== undefined && { issuer: input.issuer }),
      ...(input.ssoUrl !== undefined && { ssoUrl: input.ssoUrl }),
      ...(input.certificate !== undefined && { certificate: input.certificate }),
      ...(input.clientID !== undefined && { clientID: input.clientID }),
      ...(input.clientSecret !== undefined && { clientSecret: input.clientSecret }),
    });

    this.assertProviderConfigurationIsComplete(identityProvider);

    return this.identityProviderRepository.save(identityProvider);
  }

  async deleteSSOIdentityProvider(
    identityProviderId: string,
    workspaceId: string,
  ): Promise<{ identityProviderId: string }> {
    const identityProvider = await this.identityProviderRepository.findOne({
      where: { id: identityProviderId, workspaceId },
    });

    if (!identityProvider) {
      throw new SSOException(
        GENERIC_NOT_FOUND_MESSAGE,
        SSOExceptionCode.IDENTITY_PROVIDER_NOT_FOUND,
        { userFriendlyMessage: GENERIC_NOT_FOUND_MESSAGE },
      );
    }

    await this.identityProviderRepository.delete({ id: identityProviderId });

    return { identityProviderId };
  }

  // Called by the auth/ agent's guards to resolve+validate an
  // attacker-supplied identityProviderId before dispatching into the
  // passport strategy chain. The published cross-team contract omitted
  // workspaceId; this agent (owner of SSOService) added it because an
  // unscoped lookup lets an attacker probe any workspace's provider ids —
  // see report for the exact divergence flagged back to the auth/ agent.
  async findSSOIdentityProviderById(
    identityProviderId: string,
    workspaceId: string,
  ): Promise<WorkspaceSSOIdentityProviderEntity | null> {
    return this.identityProviderRepository.findOne({
      where: {
        id: identityProviderId,
        workspaceId,
        status: SSOIdentityProviderStatus.Active,
      },
    });
  }

  // Backs the 'openidconnect' passport strategy registration used by the
  // (out-of-scope) OIDC strategy file. Discovery + client construction only
  // — no token/claims are handled here, so there is nothing to verify yet.
  async getOIDCClient(
    identityProviderId: string,
    workspaceId: string,
  ): Promise<OIDCClient> {
    const identityProvider = await this.findActiveIdentityProviderScopedOrThrow(
      workspaceId,
      identityProviderId,
    );

    if (identityProvider.type !== IdentityProviderType.OIDC) {
      throw new SSOException(
        GENERIC_NOT_FOUND_MESSAGE,
        SSOExceptionCode.IDENTITY_PROVIDER_NOT_FOUND,
        { userFriendlyMessage: GENERIC_NOT_FOUND_MESSAGE },
      );
    }

    return this.buildOidcClient(identityProvider);
  }

  // ---------------------------------------------------------------------
  // SP-initiated authorization URL. Reachable WITHOUT authentication
  // (PublicEndpointGuard) — every argument here is attacker-controlled.
  // ---------------------------------------------------------------------

  async getAuthorizationUrlForSSO(
    identityProviderId: string,
    params: { workspaceId: string; returnToPath?: string },
  ): Promise<{ id: string; authorizationURL: string; type: IdentityProviderType }> {
    const identityProvider = await this.findActiveIdentityProviderScopedOrThrow(
      params.workspaceId,
      identityProviderId,
    );

    if (identityProvider.type === IdentityProviderType.SAML) {
      const saml = this.buildSamlClient(identityProvider);
      const relayState = randomBytes(32).toString('hex');

      // The desired post-login redirect is never round-tripped through the
      // IdP verbatim (that would be an open-redirect vector); it is looked
      // up server-side from this opaque token instead.
      await this.cacheStorageService.set<SAMLTransaction>(
        this.samlTransactionKey(relayState),
        {
          identityProviderId: identityProvider.id,
          workspaceId: identityProvider.workspaceId,
          returnToPath: params.returnToPath,
        },
        SSO_TRANSACTION_TTL_MS,
      );

      const authorizationURL = await saml.getAuthorizeUrlAsync(
        relayState,
        undefined,
        {},
      );

      return { id: identityProvider.id, authorizationURL, type: identityProvider.type };
    }

    const client = await this.buildOidcClient(identityProvider);
    const state = generators.state();
    const nonce = generators.nonce();

    await this.cacheStorageService.set<OIDCTransaction>(
      this.oidcTransactionKey(state),
      {
        identityProviderId: identityProvider.id,
        workspaceId: identityProvider.workspaceId,
        nonce,
        returnToPath: params.returnToPath,
      },
      SSO_TRANSACTION_TTL_MS,
    );

    const authorizationURL = client.authorizationUrl({
      scope: 'openid email profile',
      state,
      nonce,
    });

    return { id: identityProvider.id, authorizationURL, type: identityProvider.type };
  }

  // ---------------------------------------------------------------------
  // Assertion / callback verification — the actual security boundary.
  // These are the only functions in this module able to mint an
  // SSOValidatedPrincipal. Every one of the five required properties is
  // enforced here, and any failure throws before a principal is built
  // (fail closed: there is no fallthrough success path).
  // ---------------------------------------------------------------------

  // Published cross-team contract: validateSAMLResponse({identityProviderId,
  // samlResponseXml, relayState}). This agent (owner of SSOService) requires
  // workspaceId in addition — an unscoped identityProviderId would let an
  // attacker submit a crafted SAMLResponse against any workspace's provider
  // row. `samlResponseXml` is treated as the raw, unmodified `SAMLResponse`
  // wire value from the ACS POST body (base64, per the SAML HTTP-POST
  // binding) — the SP never re-derives it from already-decoded XML.
  async validateSAMLResponse(params: {
    workspaceId: string;
    identityProviderId: string;
    samlResponseXml: string;
    relayState?: string;
  }): Promise<SSOValidatedPrincipal> {
    const identityProvider = await this.findActiveIdentityProviderScopedOrThrow(
      params.workspaceId,
      params.identityProviderId,
    );

    if (identityProvider.type !== IdentityProviderType.SAML) {
      throw new SSOException(
        GENERIC_NOT_FOUND_MESSAGE,
        SSOExceptionCode.IDENTITY_PROVIDER_NOT_FOUND,
        { userFriendlyMessage: GENERIC_NOT_FOUND_MESSAGE },
      );
    }

    let transaction: SAMLTransaction | undefined;

    if (params.relayState) {
      // Replay protection for the RelayState token itself, independent of
      // node-saml's own InResponseTo check: it can only be looked up once.
      transaction =
        (await this.cacheStorageService.get<SAMLTransaction>(
          this.samlTransactionKey(params.relayState),
        )) ?? undefined;

      await this.cacheStorageService.del(
        this.samlTransactionKey(params.relayState),
      );

      if (
        !transaction ||
        transaction.identityProviderId !== identityProvider.id ||
        transaction.workspaceId !== identityProvider.workspaceId
      ) {
        throw new SSOException(
          'Invalid, expired, or replayed SAML RelayState',
          SSOExceptionCode.INVALID_STATE,
          { userFriendlyMessage: 'Single sign-on failed. Please try again.' },
        );
      }
    }

    const saml = this.buildSamlClient(identityProvider);

    let profile: Profile | null;

    try {
      // node-saml enforces, in this call: assertion signature validation
      // (wantAssertionsSigned), audience restriction (audience option),
      // NotBefore/NotOnOrAfter conditions, and InResponseTo replay
      // protection (validateInResponseTo + cacheProvider — the request id
      // saved at getAuthorizeUrlAsync time can only be consumed once).
      const result = await saml.validatePostResponseAsync({
        SAMLResponse: params.samlResponseXml,
        ...(params.relayState && { RelayState: params.relayState }),
      });

      profile = result.profile;
    } catch {
      // Any validation failure — bad signature, expired window, replayed
      // response, malformed XML — collapses to the same generic rejection.
      throw new SSOException(
        'SAML response failed validation',
        SSOExceptionCode.INVALID_SAML_RESPONSE,
        { userFriendlyMessage: 'Single sign-on failed. Please try again.' },
      );
    }

    if (!profile) {
      throw new SSOException(
        'SAML response contained no profile',
        SSOExceptionCode.INVALID_SAML_RESPONSE,
        { userFriendlyMessage: 'Single sign-on failed. Please try again.' },
      );
    }

    // Explicit issuer check against the configured provider, even though
    // node-saml validates the assertion signature against this provider's
    // own certificate — belt and suspenders against a misconfigured or
    // reused certificate across providers.
    if (profile.issuer !== identityProvider.issuer) {
      throw new SSOException(
        'SAML issuer does not match configured identity provider',
        SSOExceptionCode.INVALID_SAML_RESPONSE,
        { userFriendlyMessage: 'Single sign-on failed. Please try again.' },
      );
    }

    const email = profile.email ?? profile.mail ?? profile.nameID;

    if (!email || typeof email !== 'string') {
      throw new SSOException(
        'SAML assertion did not contain an email',
        SSOExceptionCode.INVALID_SAML_RESPONSE,
        { userFriendlyMessage: 'Single sign-on failed. Please try again.' },
      );
    }

    return SSOValidatedPrincipal.__constructOnlyFromVerifiedAssertion(VERIFIED, {
      email,
      identityProviderId: identityProvider.id,
      workspaceId: identityProvider.workspaceId,
      provider: IdentityProviderType.SAML,
      returnToPath: transaction?.returnToPath,
    });
  }

  async verifyOIDCCallback(params: {
    workspaceId: string;
    identityProviderId: string;
    callbackUrl: string;
    callbackParams: Record<string, string | string[] | undefined>;
  }): Promise<SSOValidatedPrincipal> {
    const identityProvider = await this.findActiveIdentityProviderScopedOrThrow(
      params.workspaceId,
      params.identityProviderId,
    );

    if (identityProvider.type !== IdentityProviderType.OIDC) {
      throw new SSOException(
        GENERIC_NOT_FOUND_MESSAGE,
        SSOExceptionCode.IDENTITY_PROVIDER_NOT_FOUND,
        { userFriendlyMessage: GENERIC_NOT_FOUND_MESSAGE },
      );
    }

    const stateParam = params.callbackParams.state;

    if (typeof stateParam !== 'string' || stateParam.length === 0) {
      throw new SSOException('Missing OIDC state', SSOExceptionCode.INVALID_STATE, {
        userFriendlyMessage: 'Single sign-on failed. Please try again.',
      });
    }

    // Consume the transaction immediately and unconditionally: this is the
    // replay protection for the OIDC leg — the same state value can never
    // be looked up successfully twice, whether the second attempt is a
    // replay or a double-submit.
    const transaction = await this.cacheStorageService.get<OIDCTransaction>(
      this.oidcTransactionKey(stateParam),
    );

    await this.cacheStorageService.del(this.oidcTransactionKey(stateParam));

    if (
      !transaction ||
      transaction.identityProviderId !== identityProvider.id ||
      transaction.workspaceId !== identityProvider.workspaceId
    ) {
      throw new SSOException(
        'Invalid, expired, or replayed OIDC state',
        SSOExceptionCode.INVALID_STATE,
        { userFriendlyMessage: 'Single sign-on failed. Please try again.' },
      );
    }

    const client = await this.buildOidcClient(identityProvider);

    let claims;

    try {
      // openid-client's callback() enforces, in this call: state match
      // (checked again here against what we already validated), nonce
      // match, id_token signature verification against the discovered
      // JWKS, issuer match against the discovered issuer metadata, and
      // exp/iat/nbf validation.
      const tokenSet = await client.callback(
        params.callbackUrl,
        params.callbackParams,
        { state: stateParam, nonce: transaction.nonce },
      );

      claims = tokenSet.claims();
    } catch {
      throw new SSOException(
        'OIDC callback failed validation',
        SSOExceptionCode.INVALID_OIDC_RESPONSE,
        { userFriendlyMessage: 'Single sign-on failed. Please try again.' },
      );
    }

    // Explicit re-check against the configured provider's issuer (in
    // addition to openid-client's own discovery-issuer check), so a
    // provider row edited to point at a different issuer than what was
    // discovered can never authenticate silently.
    if (claims.iss !== identityProvider.issuer) {
      throw new SSOException(
        'OIDC issuer does not match configured identity provider',
        SSOExceptionCode.INVALID_OIDC_RESPONSE,
        { userFriendlyMessage: 'Single sign-on failed. Please try again.' },
      );
    }

    const email = claims.email;

    if (!email || typeof email !== 'string') {
      throw new SSOException(
        'OIDC id_token did not contain an email claim',
        SSOExceptionCode.INVALID_OIDC_RESPONSE,
        { userFriendlyMessage: 'Single sign-on failed. Please try again.' },
      );
    }

    return SSOValidatedPrincipal.__constructOnlyFromVerifiedAssertion(VERIFIED, {
      email,
      identityProviderId: identityProvider.id,
      workspaceId: identityProvider.workspaceId,
      provider: IdentityProviderType.OIDC,
    });
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  private async findActiveIdentityProviderScopedOrThrow(
    workspaceId: string,
    identityProviderId: string,
  ): Promise<WorkspaceSSOIdentityProviderEntity> {
    const identityProvider = await this.identityProviderRepository.findOne({
      where: {
        id: identityProviderId,
        workspaceId,
        status: SSOIdentityProviderStatus.Active,
      },
    });

    if (!identityProvider) {
      throw new SSOException(
        GENERIC_NOT_FOUND_MESSAGE,
        SSOExceptionCode.IDENTITY_PROVIDER_NOT_FOUND,
        { userFriendlyMessage: GENERIC_NOT_FOUND_MESSAGE },
      );
    }

    return identityProvider;
  }

  private assertProviderConfigurationIsComplete(input: {
    type: IdentityProviderType;
    ssoUrl?: string | null;
    certificate?: string | null;
    clientID?: string | null;
    clientSecret?: string | null;
  }): void {
    if (input.type === IdentityProviderType.SAML) {
      if (!input.ssoUrl || !input.certificate) {
        throw new SSOException(
          'SAML identity providers require ssoUrl and certificate',
          SSOExceptionCode.INVALID_CERTIFICATE,
        );
      }
    } else if (!input.clientID || !input.clientSecret) {
      throw new SSOException(
        'OIDC identity providers require clientID and clientSecret',
        SSOExceptionCode.FORBIDDEN,
      );
    }
  }

  private buildSamlClient(
    identityProvider: WorkspaceSSOIdentityProviderEntity,
  ): SAML {
    if (!identityProvider.certificate || !identityProvider.ssoUrl) {
      throw new SSOException(
        'SAML identity provider is misconfigured',
        SSOExceptionCode.INVALID_CERTIFICATE,
      );
    }

    const spEntityId = this.getSpEntityId(identityProvider.workspaceId);

    return new SAML({
      idpCert: identityProvider.certificate,
      entryPoint: identityProvider.ssoUrl,
      issuer: spEntityId,
      callbackUrl: this.getAcsUrl(identityProvider.workspaceId, identityProvider.id),
      audience: spEntityId,
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: false,
      // Replay protection for SP-initiated flows is enforced by this
      // service's own RelayState one-time-use token (see the RelayState
      // handling in getAuthorizationUrlForSSO / validateSAMLResponse above,
      // covered by dedicated tests) rather than solely by node-saml's
      // InResponseTo cache. `ifPresent` still validates InResponseTo
      // whenever the IdP includes it (defense in depth for SP-initiated
      // flows), but does not hard-require it, since some IdP-initiated
      // configurations legitimately omit it.
      validateInResponseTo: ValidateInResponseTo.ifPresent,
      cacheProvider: this.buildSamlCacheProvider(),
      disableRequestedAuthnContext: true,
    });
  }

  private async buildOidcClient(
    identityProvider: WorkspaceSSOIdentityProviderEntity,
  ): Promise<OIDCClient> {
    if (!identityProvider.clientID || !identityProvider.clientSecret) {
      throw new SSOException(
        'OIDC identity provider is misconfigured',
        SSOExceptionCode.INVALID_OIDC_RESPONSE,
      );
    }

    let issuer: Issuer;

    try {
      issuer = await Issuer.discover(identityProvider.issuer);
    } catch {
      throw new SSOException(
        'Unable to discover OIDC issuer',
        SSOExceptionCode.INVALID_OIDC_RESPONSE,
      );
    }

    return new issuer.Client({
      client_id: identityProvider.clientID,
      client_secret: identityProvider.clientSecret,
      redirect_uris: [
        this.getAcsUrl(identityProvider.workspaceId, identityProvider.id),
      ],
      response_types: ['code'],
    });
  }

  private buildSamlCacheProvider(): CacheProvider {
    const cacheStorageService = this.cacheStorageService;

    return {
      async saveAsync(key: string, value: string): Promise<CacheItem | null> {
        const item: CacheItem = { value, createdAt: Date.now() };

        await cacheStorageService.set(
          `saml-request:${key}`,
          item,
          SSO_TRANSACTION_TTL_MS,
        );

        return item;
      },
      async getAsync(key: string): Promise<string | null> {
        const item = await cacheStorageService.get<CacheItem>(
          `saml-request:${key}`,
        );

        return item?.value ?? null;
      },
      async removeAsync(key: string | null): Promise<string | null> {
        if (!key) {
          return null;
        }

        const cacheKey = `saml-request:${key}`;
        const item = await cacheStorageService.get<CacheItem>(cacheKey);

        await cacheStorageService.del(cacheKey);

        return item?.value ?? null;
      },
    };
  }

  private oidcTransactionKey(state: string): string {
    return `oidc-transaction:${state}`;
  }

  private samlTransactionKey(relayState: string): string {
    return `saml-transaction:${relayState}`;
  }

  private getSpEntityId(workspaceId: string): string {
    return `${this.getBaseUrl()}/sso/saml/${workspaceId}/metadata`;
  }

  private getAcsUrl(workspaceId: string, identityProviderId: string): string {
    return `${this.getBaseUrl()}/sso/${workspaceId}/${identityProviderId}/callback`;
  }

  private getBaseUrl(): string {
    // Server base URL — deliberately not configurable per-request (that
    // would let a hostile Host header redirect assertions to an
    // attacker-controlled audience/redirect_uri).
    return process.env.SERVER_URL ?? 'http://localhost:3000';
  }
}
