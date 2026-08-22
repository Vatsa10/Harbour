import { type ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Test, type TestingModule } from '@nestjs/testing';

import { OIDCAuthGuard } from 'src/engine/core-modules/auth/guards/oidc-auth.guard';
import { WorkspaceDomainsService } from 'src/engine/core-modules/domain/workspace-domains/services/workspace-domains.service';
import { GuardRedirectService } from 'src/engine/core-modules/guard-redirect/services/guard-redirect.service';
import { SSOService } from 'src/engine/core-modules/sso/services/sso.service';

// Companion to `oidc-auth.spec.ts` (existing AGPL spec, covers the null-lookup and
// happy-path cases). This file adds: (1) the throw-from-SSOService fail-closed case, and
// (2) proof that a rejection from the underlying passport strategy (which is where OIDC
// id-token/state/nonce validation actually happens) also fails closed.
jest.mock('openid-client', () => ({
  Strategy: jest.fn(),
  Issuer: { discover: jest.fn() },
}));

const createMockExecutionContext = (mockedRequest: any): ExecutionContext => {
  return {
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue(mockedRequest),
    }),
  } as unknown as ExecutionContext;
};

const createMockedRequest = (params = {}) => ({ params });

describe('OIDCAuthGuard (SSOService delegation, fail-closed)', () => {
  let guard: OIDCAuthGuard;
  let ssoService: SSOService;
  let guardRedirectService: GuardRedirectService;
  let superCanActivateSpy: jest.SpyInstance;

  beforeEach(async () => {
    superCanActivateSpy = jest
      .spyOn(AuthGuard('openidconnect').prototype, 'canActivate')
      .mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OIDCAuthGuard,
        {
          provide: SSOService,
          useValue: {
            findSSOIdentityProviderById: jest.fn(),
            getOIDCClient: jest.fn(),
          },
        },
        {
          provide: GuardRedirectService,
          useValue: { dispatchErrorFromGuard: jest.fn() },
        },
        {
          provide: WorkspaceDomainsService,
          useValue: {
            getSubdomainAndCustomDomainFromWorkspaceFallbackOnDefaultSubdomain:
              jest.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get<OIDCAuthGuard>(OIDCAuthGuard);
    ssoService = module.get<SSOService>(SSOService);
    guardRedirectService =
      module.get<GuardRedirectService>(GuardRedirectService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects (fail closed) when the identity provider lookup throws', async () => {
    const context = createMockExecutionContext(
      createMockedRequest({ identityProviderId: 'idp-1' }),
    );

    jest
      .spyOn(ssoService, 'findSSOIdentityProviderById')
      .mockRejectedValue(new Error('SSOService unavailable'));

    await expect(guard.canActivate(context)).resolves.toBe(false);
    expect(guardRedirectService.dispatchErrorFromGuard).toHaveBeenCalled();
    expect(superCanActivateSpy).not.toHaveBeenCalled();
  });

  it('rejects (fail closed) when the underlying OIDC passport strategy rejects (id token/state/nonce validation failure)', async () => {
    const context = createMockExecutionContext(
      createMockedRequest({ identityProviderId: 'idp-1' }),
    );

    jest.spyOn(ssoService, 'findSSOIdentityProviderById').mockResolvedValue({
      id: 'idp-1',
      issuer: 'https://issuer.example.com',
      workspace: {},
    } as any);

    superCanActivateSpy.mockRejectedValue(new Error('invalid id_token'));

    await expect(guard.canActivate(context)).resolves.toBe(false);
    expect(guardRedirectService.dispatchErrorFromGuard).toHaveBeenCalled();
  });
});
