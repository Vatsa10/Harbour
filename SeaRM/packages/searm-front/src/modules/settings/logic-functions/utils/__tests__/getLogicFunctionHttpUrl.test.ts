import {
  getFunctionsBaseUrl,
  getLogicFunctionHttpUrl,
} from '@/settings/logic-functions/utils/getLogicFunctionHttpUrl';

describe('getFunctionsBaseUrl', () => {
  it('builds the isolated base from subdomain + public domain', () => {
    expect(
      getFunctionsBaseUrl({
        serverBaseUrl: 'https://api.searm.com',
        publicFunctionDomain: 'withsearm.com',
        workspaceSubdomain: 'acme',
      }),
    ).toBe('https://acme.withsearm.com');
  });

  it('falls back to the /s server route when the public domain is missing', () => {
    expect(
      getFunctionsBaseUrl({
        serverBaseUrl: 'https://api.searm.com',
        publicFunctionDomain: null,
        workspaceSubdomain: 'acme',
      }),
    ).toBe('https://api.searm.com/s');
  });

  it('falls back to the /s server route when the subdomain is missing', () => {
    expect(
      getFunctionsBaseUrl({
        serverBaseUrl: 'https://api.searm.com',
        publicFunctionDomain: 'withsearm.com',
        workspaceSubdomain: undefined,
      }),
    ).toBe('https://api.searm.com/s');
  });
});

describe('getLogicFunctionHttpUrl', () => {
  it('builds the isolated public-domain URL when configured', () => {
    expect(
      getLogicFunctionHttpUrl({
        path: '/webhook/stripe',
        serverBaseUrl: 'https://api.searm.com',
        publicFunctionDomain: 'withsearm.com',
        workspaceSubdomain: 'acme',
      }),
    ).toBe('https://acme.withsearm.com/webhook/stripe');
  });

  it('normalizes a path that does not start with a slash', () => {
    expect(
      getLogicFunctionHttpUrl({
        path: 'webhook',
        serverBaseUrl: 'https://api.searm.com',
        publicFunctionDomain: 'withsearm.com',
        workspaceSubdomain: 'acme',
      }),
    ).toBe('https://acme.withsearm.com/webhook');
  });

  it('falls back to the legacy /s/ route when no public domain is configured', () => {
    expect(
      getLogicFunctionHttpUrl({
        path: '/webhook/stripe',
        serverBaseUrl: 'https://api.searm.com',
        publicFunctionDomain: null,
        workspaceSubdomain: 'acme',
      }),
    ).toBe('https://api.searm.com/s/webhook/stripe');
  });

  it('falls back to the legacy /s/ route when the workspace has no subdomain', () => {
    expect(
      getLogicFunctionHttpUrl({
        path: '/webhook',
        serverBaseUrl: 'https://api.searm.com',
        publicFunctionDomain: 'withsearm.com',
        workspaceSubdomain: undefined,
      }),
    ).toBe('https://api.searm.com/s/webhook');
  });
});
