import { checkUrlType } from '~/utils/checkUrlType';
import { LinkType } from 'searm-ui/navigation';

describe('checkUrlType', () => {
  it('should detect LinkedIn urls', () => {
    expect(checkUrlType('https://www.linkedin.com/in/john')).toBe(
      LinkType.LinkedIn,
    );
    expect(checkUrlType('linkedin.com/company/searm')).toBe(LinkType.LinkedIn);
  });

  it('should detect Twitter urls', () => {
    expect(checkUrlType('https://twitter.com/searm')).toBe(LinkType.Twitter);
  });

  it('should detect X urls as Twitter', () => {
    expect(checkUrlType('https://x.com/searm')).toBe(LinkType.Twitter);
  });

  it('should detect Facebook urls', () => {
    expect(checkUrlType('https://www.facebook.com/searm')).toBe(
      LinkType.Facebook,
    );
  });

  it('should detect Instagram urls', () => {
    expect(checkUrlType('https://www.instagram.com/ptcrash')).toBe(
      LinkType.Instagram,
    );
    expect(checkUrlType('instagram.com/ptcrash')).toBe(LinkType.Instagram);
  });

  it('should detect TikTok urls', () => {
    expect(checkUrlType('https://www.tiktok.com/@searm')).toBe(
      LinkType.TikTok,
    );
    expect(checkUrlType('tiktok.com/@searm')).toBe(LinkType.TikTok);
  });

  it('should detect Bluesky urls', () => {
    expect(checkUrlType('https://bsky.app/profile/searm.bsky.social')).toBe(
      LinkType.Bluesky,
    );
  });

  it('should fall back to a generic url type', () => {
    expect(checkUrlType('https://example.com')).toBe(LinkType.Url);
    expect(checkUrlType('not-a-url')).toBe(LinkType.Url);
    expect(checkUrlType('https://instagram.com')).toBe(LinkType.Url);
    expect(checkUrlType('https://www.tiktok.com/video/123')).toBe(LinkType.Url);
    expect(checkUrlType('https://bsky.app')).toBe(LinkType.Url);
  });
});
