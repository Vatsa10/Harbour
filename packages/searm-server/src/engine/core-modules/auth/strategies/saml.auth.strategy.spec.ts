import { type Request } from 'express';

import { SSOService } from 'src/engine/core-modules/sso/services/sso.service';

import {
  SamlAuthStrategy,
  type SSORequest,
} from 'src/engine/core-modules/auth/strategies/saml.auth.strategy';

describe('SamlAuthStrategy', () => {
  let ssoService: { validateSAMLResponse: jest.Mock };
  let strategy: SamlAuthStrategy;
  let success: jest.Mock;
  let fail: jest.Mock;

  const buildRequest = (
    overrides: Partial<SSORequest> = {},
  ): SSORequest => {
    return {
      params: { identityProviderId: 'idp-1' },
      body: { SAMLResponse: 'base64-saml-response' },
      ssoWorkspaceId: 'workspace-1',
      ...overrides,
    } as SSORequest;
  };

  beforeEach(() => {
    ssoService = { validateSAMLResponse: jest.fn() };
    strategy = new SamlAuthStrategy(ssoService as unknown as SSOService);

    success = jest.fn();
    fail = jest.fn();
    // passport-strategy's success()/fail() are assigned onto the instance at
    // authenticate-time by the passport middleware; assign them directly here.
    (strategy as unknown as { success: jest.Mock }).success = success;
    (strategy as unknown as { fail: jest.Mock }).fail = fail;
  });

  const authenticate = async (req: SSORequest) => {
    strategy.authenticate(req as unknown as Request);
    // authenticate() fires an unawaited async function internally; flush pending
    // microtasks. Fake timers are enabled globally in this project's jest config,
    // so a real setImmediate/setTimeout never fires - flush via the fake-timer API
    // instead, which also drains microtasks queued by resolved/rejected promises.
    await jest.advanceTimersByTimeAsync(0);
  };

  it('succeeds and forwards the validated principal when SSOService validates the response', async () => {
    ssoService.validateSAMLResponse.mockResolvedValue({
      email: 'user@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      workspaceId: 'workspace-1',
      identityProviderId: 'idp-1',
      returnToPath: '/settings',
    });

    await authenticate(buildRequest());

    expect(ssoService.validateSAMLResponse).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      identityProviderId: 'idp-1',
      samlResponseXml: 'base64-saml-response',
      relayState: undefined,
    });
    expect(success).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'user@example.com',
        workspaceId: 'workspace-1',
        identityProviderId: 'idp-1',
        returnToPath: '/settings',
      }),
    );
    expect(fail).not.toHaveBeenCalled();
  });

  it('passes RelayState through to SSOService when present', async () => {
    ssoService.validateSAMLResponse.mockResolvedValue({
      email: 'user@example.com',
      workspaceId: 'workspace-1',
      identityProviderId: 'idp-1',
    });

    await authenticate(
      buildRequest({
        body: {
          SAMLResponse: 'base64-saml-response',
          RelayState: 'relay-token',
        } as unknown as SSORequest['body'],
      }),
    );

    expect(ssoService.validateSAMLResponse).toHaveBeenCalledWith(
      expect.objectContaining({ relayState: 'relay-token' }),
    );
  });

  it('fails closed without calling SSOService when ssoWorkspaceId is missing', async () => {
    await authenticate(buildRequest({ ssoWorkspaceId: undefined }));

    expect(ssoService.validateSAMLResponse).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
  });

  it('fails closed without calling SSOService when SAMLResponse is missing', async () => {
    await authenticate(
      buildRequest({ body: {} as unknown as SSORequest['body'] }),
    );

    expect(ssoService.validateSAMLResponse).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
  });

  it('fails closed without calling SSOService when identityProviderId is missing', async () => {
    await authenticate(
      buildRequest({ params: {} as unknown as SSORequest['params'] }),
    );

    expect(ssoService.validateSAMLResponse).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
  });

  it('fails closed and does not authenticate when SSOService throws', async () => {
    ssoService.validateSAMLResponse.mockRejectedValue(
      new Error('invalid signature'),
    );

    await authenticate(buildRequest());

    expect(fail).toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
  });

  it('does not leak the underlying SSOService error message to the client', async () => {
    ssoService.validateSAMLResponse.mockRejectedValue(
      new Error('secret assertion contents'),
    );

    await authenticate(buildRequest());

    const failMessage = fail.mock.calls[0]?.[0];

    expect(String(failMessage)).not.toContain('secret assertion contents');
  });
});
