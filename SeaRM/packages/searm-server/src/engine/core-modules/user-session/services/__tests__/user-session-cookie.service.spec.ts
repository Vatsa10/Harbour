import { type Request } from 'express';

import { type SearmConfigService } from 'src/engine/core-modules/searm-config/searm-config.service';
import { UserSessionCookieService } from 'src/engine/core-modules/user-session/services/user-session-cookie.service';

describe('UserSessionCookieService', () => {
  const buildService = (
    config: Record<string, unknown> = { AUTH_COOKIE_SESSIONS_ENABLED: true },
  ) =>
    new UserSessionCookieService({
      get: jest.fn((key: string) => config[key]),
    } as unknown as SearmConfigService);

  const buildRequest = (cookieHeader?: string): Request =>
    ({ headers: cookieHeader ? { cookie: cookieHeader } : {} }) as Request;

  describe('hasSessionCookie', () => {
    it('should detect the secure cookie name', () => {
      expect(
        buildService().hasSessionCookie(
          buildRequest('__Host-searm-session=sess_abc'),
        ),
      ).toBe(true);
    });

    it('should detect the legacy plain cookie name', () => {
      expect(
        buildService().hasSessionCookie(
          buildRequest('searm-session=sess_abc'),
        ),
      ).toBe(true);
    });

    it('should ignore a cookie header carrying only unrelated cookies', () => {
      expect(
        buildService().hasSessionCookie(buildRequest('other=1; another=2')),
      ).toBe(false);
    });

    it('should report no cookie when the request carries none', () => {
      expect(buildService().hasSessionCookie(buildRequest())).toBe(false);
    });

    it('should report no cookie when cookie sessions are disabled', () => {
      expect(
        buildService({ AUTH_COOKIE_SESSIONS_ENABLED: false }).hasSessionCookie(
          buildRequest('__Host-searm-session=sess_abc'),
        ),
      ).toBe(false);
    });

    it('should not match a cookie whose name merely ends with ours', () => {
      expect(
        buildService().hasSessionCookie(
          buildRequest('not-searm-session=sess_abc'),
        ),
      ).toBe(false);
    });
  });
});
