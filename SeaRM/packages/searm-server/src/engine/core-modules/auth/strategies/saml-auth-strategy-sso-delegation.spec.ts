import {
  SamlAuthStrategy,
  type SSORequest,
} from 'src/engine/core-modules/auth/strategies/saml.auth.strategy';
import { SSOService } from 'src/engine/core-modules/sso/services/sso.service';

// NOTE: named to avoid colliding with the pre-existing Enterprise-licensed
// `saml.auth.strategy.spec.ts` in this directory (out of scope for this rewrite — not
// opened, not modified). This file exercises the rewritten `authenticate`/`doAuthenticate`
// entry point (not the unused `validate` method) against the current AGPL implementation.
//
// Verifies the design assertion in saml.auth.strategy.ts's header: SamlAuthStrategy performs
// no SAML XML parsing/signature validation itself — it forwards the raw SAMLResponse/
// RelayState to SSOService.validateSAMLResponse and acts only on that result (success on a
// resolved principal, fail on any thrown error). No SAMLResponse content is ever inspected
// here.
const createRequest = (overrides: Partial<SSORequest> = {}): SSORequest =>
  ({
    params: { identityProviderId: 'idp-1' },
    body: {
      SAMLResponse: 'base64-raw-saml-response',
      RelayState: 'relay-state-token',
    },
    ...overrides,
  }) as unknown as SSORequest;

jest.setTimeout(20000);

describe('SamlAuthStrategy (SSOService delegation, fail-closed)', () => {
  let strategy: SamlAuthStrategy;
  let ssoService: SSOService;
  let successSpy: jest.Mock;
  let failSpy: jest.Mock;

  beforeEach(() => {
    ssoService = {
      validateSAMLResponse: jest.fn(),
    } as unknown as SSOService;

    strategy = new SamlAuthStrategy(ssoService);

    successSpy = jest.fn();
    failSpy = jest.fn();
    // passport-strategy normally injects success()/fail() at request time; assign them
    // directly here since we're calling authenticate() outside of a real passport pipeline.
    (strategy as any).success = successSpy;
    (strategy as any).fail = failSpy;
  });

  // Jest's global config enables fake timers (`fakeTimers: { enableGlobally: true }` in
  // jest.config.mjs), so real setTimeout/setImmediate never fire. Flush pending microtasks
  // (the awaits inside doAuthenticate resolving mocked promises) via the fake-timer-aware
  // async advance instead.
  const waitForAsync = () => jest.advanceTimersByTimeAsync(0);

  it('forwards the raw SAMLResponse/RelayState to SSOService.validateSAMLResponse without parsing it locally, and succeeds on a validated principal (positive path)', async () => {
    jest.spyOn(ssoService, 'validateSAMLResponse').mockResolvedValue({
      email: 'user@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
      workspaceId: 'workspace-1',
      identityProviderId: 'idp-1',
      returnToPath: '/dashboard',
    } as any);

    strategy.authenticate(createRequest() as any);
    await waitForAsync();

    expect(ssoService.validateSAMLResponse).toHaveBeenCalledWith({
      identityProviderId: 'idp-1',
      samlResponseXml: 'base64-raw-saml-response',
      relayState: 'relay-state-token',
    });
    expect(successSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'user@example.com',
        workspaceId: 'workspace-1',
        identityProviderId: 'idp-1',
      }),
    );
    expect(failSpy).not.toHaveBeenCalled();
  });

  it('fails closed (never calls success) when SSOService.validateSAMLResponse throws — e.g. a forged/invalid SAML response', async () => {
    jest
      .spyOn(ssoService, 'validateSAMLResponse')
      .mockRejectedValue(new Error('SAML signature validation failed'));

    strategy.authenticate(createRequest() as any);
    await waitForAsync();

    expect(ssoService.validateSAMLResponse).toHaveBeenCalled();
    expect(failSpy).toHaveBeenCalledWith('SAML authentication failed', 401);
    expect(successSpy).not.toHaveBeenCalled();
  });

  it('fails closed without ever calling SSOService when the SAMLResponse body is missing (never validates a malformed request)', async () => {
    const request = createRequest({ body: {} } as any);

    strategy.authenticate(request as any);
    await waitForAsync();

    expect(ssoService.validateSAMLResponse).not.toHaveBeenCalled();
    expect(failSpy).toHaveBeenCalled();
    expect(successSpy).not.toHaveBeenCalled();
  });

  it('fails closed without ever calling SSOService when identityProviderId is missing', async () => {
    const request = createRequest({ params: {} } as any);

    strategy.authenticate(request as any);
    await waitForAsync();

    expect(ssoService.validateSAMLResponse).not.toHaveBeenCalled();
    expect(failSpy).toHaveBeenCalled();
    expect(successSpy).not.toHaveBeenCalled();
  });
});
