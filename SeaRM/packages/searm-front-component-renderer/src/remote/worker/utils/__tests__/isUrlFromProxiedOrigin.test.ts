import { isUrlFromProxiedOrigin } from '../isUrlFromProxiedOrigin';

describe('isUrlFromProxiedOrigin', () => {
  it('should return true when the url origin is in the proxied origins', () => {
    expect(
      isUrlFromProxiedOrigin('https://api.searm.test/graphql', [
        'https://api.searm.test',
      ]),
    ).toBe(true);
  });

  it('should return false when the origin differs', () => {
    expect(
      isUrlFromProxiedOrigin('https://evil.test/graphql', [
        'https://api.searm.test',
      ]),
    ).toBe(false);
  });

  it('should return false when the url is malformed', () => {
    expect(
      isUrlFromProxiedOrigin('not a url', ['https://api.searm.test']),
    ).toBe(false);
  });

  it('should match on origin regardless of path', () => {
    expect(
      isUrlFromProxiedOrigin(
        'https://api.searm.test/rest/front-components/id',
        ['https://api.searm.test'],
      ),
    ).toBe(true);
  });
});
