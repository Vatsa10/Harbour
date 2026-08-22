import { getUniqueHttpOriginsFromUrls } from '../getUniqueHttpOriginsFromUrls';

describe('getUniqueHttpOriginsFromUrls', () => {
  it('should reduce urls to their origins', () => {
    expect(
      getUniqueHttpOriginsFromUrls([
        'https://api.searm.test/graphql',
        'http://functions.searm.test/base/path',
      ]),
    ).toEqual(['https://api.searm.test', 'http://functions.searm.test']);
  });

  it('should deduplicate identical origins', () => {
    expect(
      getUniqueHttpOriginsFromUrls([
        'https://api.searm.test/graphql',
        'https://api.searm.test/rest/front-components/id',
      ]),
    ).toEqual(['https://api.searm.test']);
  });

  it('should drop undefined urls', () => {
    expect(
      getUniqueHttpOriginsFromUrls([undefined, 'https://api.searm.test']),
    ).toEqual(['https://api.searm.test']);
  });

  it('should drop malformed urls', () => {
    expect(
      getUniqueHttpOriginsFromUrls(['not a url', 'https://api.searm.test']),
    ).toEqual(['https://api.searm.test']);
  });

  it('should drop urls with non http schemes', () => {
    expect(
      getUniqueHttpOriginsFromUrls([
        'data:text/html,<script>alert(1)</script>',
        'file:///etc/passwd',
        'blob:https://api.searm.test/id',
        'https://api.searm.test',
      ]),
    ).toEqual(['https://api.searm.test']);
  });
});
