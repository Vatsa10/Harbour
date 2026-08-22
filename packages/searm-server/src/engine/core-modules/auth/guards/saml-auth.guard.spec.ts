import { type ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Test, type TestingModule } from '@nestjs/testing';

import { SamlAuthGuard } from 'src/engine/core-modules/auth/guards/saml-auth.guard';
import { WorkspaceDomainsService } from 'src/engine/core-modules/domain/workspace-domains/services/workspace-domains.service';
import { GuardRedirectService } from 'src/engine/core-modules/guard-redirect/services/guard-redirect.service';
import { SSOService } from 'src/engine/core-modules/sso/services/sso.service';

const createMockExecutionContext = (mockedRequest: any): ExecutionContext => {
  return {
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue(mockedRequest),
    }),
  } as unknown as ExecutionContext;
};

const createMockedRequest = (params = {}) => ({ params });

describe('SamlAuthGuard', () => {
  let guard: SamlAuthGuard;
  let ssoService: SSOService;
  let guardRedirectService: GuardRedirectService;
  let superCanActivateSpy: jest.SpyInstance;

  beforeEach(async () => {
    superCanActivateSpy = jest
      .spyOn(AuthGuard('saml').prototype, 'canActivate')
      .mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SamlAuthGuard,
        {
          provide: SSOService,
          useValue: {
            findSSOIdentityProviderById: jest.fn(),
          },
        },
        {
          provide: GuardRedirectService,
          useValue: {
            dispatchErrorFromGuard: jest.fn(),
          },
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

    guard = module.get<SamlAuthGuard>(SamlAuthGuard);
    ssoService = module.get<SSOService>(SSOService);
    guardRedirectService =
      module.get<GuardRedirectService>(GuardRedirectService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('activates and delegates to the passport strategy when SSOService resolves a valid identity provider (positive path)', async () => {
    const request = createMockedRequest({ identityProviderId: 'idp-1' });
    const context = createMockExecutionContext(request);

    jest.spyOn(ssoService, 'findSSOIdentityProviderById').mockResolvedValue({
      id: 'idp-1',
      issuer: 'https://issuer.example.com',
      workspace: {},
    } as any);

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(ssoService.findSSOIdentityProviderById).toHaveBeenCalledWith(
      'idp-1',
    );
    expect(superCanActivateSpy).toHaveBeenCalledWith(context);
    expect(guardRedirectService.dispatchErrorFromGuard).not.toHaveBeenCalled();
  });

  it('rejects (fail closed) when the identity provider lookup returns null', async () => {
    const request = createMockedRequest({ identityProviderId: 'unknown-id' });
    const context = createMockExecutionContext(request);

    jest
      .spyOn(ssoService, 'findSSOIdentityProviderById')
      .mockResolvedValue(null);

    await expect(guard.canActivate(context)).resolves.toBe(false);
    expect(guardRedirectService.dispatchErrorFromGuard).toHaveBeenCalled();
    expect(superCanActivateSpy).not.toHaveBeenCalled();
  });

  it('rejects (fail closed) when the identity provider lookup throws', async () => {
    const request = createMockedRequest({ identityProviderId: 'idp-1' });
    const context = createMockExecutionContext(request);

    jest
      .spyOn(ssoService, 'findSSOIdentityProviderById')
      .mockRejectedValue(new Error('SSOService unavailable'));

    await expect(guard.canActivate(context)).resolves.toBe(false);
    expect(guardRedirectService.dispatchErrorFromGuard).toHaveBeenCalled();
    expect(superCanActivateSpy).not.toHaveBeenCalled();
  });

  it('rejects (fail closed) when identityProviderId is missing from the request', async () => {
    const request = createMockedRequest({});
    const context = createMockExecutionContext(request);

    await expect(guard.canActivate(context)).resolves.toBe(false);
    expect(ssoService.findSSOIdentityProviderById).not.toHaveBeenCalled();
    expect(guardRedirectService.dispatchErrorFromGuard).toHaveBeenCalled();
    expect(superCanActivateSpy).not.toHaveBeenCalled();
  });

  it('rejects (fail closed) when the underlying passport strategy (which performs SAML validation via SSOService) rejects', async () => {
    const request = createMockedRequest({ identityProviderId: 'idp-1' });
    const context = createMockExecutionContext(request);

    jest.spyOn(ssoService, 'findSSOIdentityProviderById').mockResolvedValue({
      id: 'idp-1',
      issuer: 'https://issuer.example.com',
      workspace: {},
    } as any);

    superCanActivateSpy.mockRejectedValue(new Error('invalid SAML response'));

    await expect(guard.canActivate(context)).resolves.toBe(false);
    expect(guardRedirectService.dispatchErrorFromGuard).toHaveBeenCalled();
  });
});
