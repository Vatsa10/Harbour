import { type Request } from 'express';

import { USER_SESSION_COOKIE_NAME } from 'src/engine/core-modules/user-session/constants/user-session-cookie-name.constant';
import { USER_SESSION_SECURE_COOKIE_NAME } from 'src/engine/core-modules/user-session/constants/user-session-secure-cookie-name.constant';
import { extractUserSessionTokenFromRequestCookie } from 'src/engine/core-modules/user-session/utils/extract-user-session-token-from-request.util';

const buildRequest = (cookieHeader?: string): Request =>
  ({
    headers: cookieHeader === undefined ? {} : { cookie: cookieHeader },
  }) as Request;

const extractOnHttpDeployment = (cookieHeader?: string) =>
  extractUserSessionTokenFromRequestCookie(buildRequest(cookieHeader), {
    secureCookieName: USER_SESSION_SECURE_COOKIE_NAME,
    insecureCookieName: USER_SESSION_COOKIE_NAME,
    allowInsecureCookieName: true,
  });

const extractOnHttpsDeployment = (cookieHeader?: string) =>
  extractUserSessionTokenFromRequestCookie(buildRequest(cookieHeader), {
    secureCookieName: USER_SESSION_SECURE_COOKIE_NAME,
    insecureCookieName: USER_SESSION_COOKIE_NAME,
    allowInsecureCookieName: false,
  });

describe('extractUserSessionTokenFromRequestCookie', () => {
  it('should return undefined without a cookie header', () => {
    expect(extractOnHttpDeployment()).toBe(undefined);
  });

  it('should read the plain cookie name when the deployment cannot set Secure', () => {
    expect(
      extractOnHttpDeployment('foo=bar; searm-session=sess_abc; other=1'),
    ).toBe('sess_abc');
  });

  it('should ignore the plain cookie name on a secure deployment', () => {
    expect(extractOnHttpsDeployment('searm-session=sess_tossed')).toBe(
      undefined,
    );
  });

  it('should read the __Host- cookie name on a secure deployment', () => {
    expect(extractOnHttpsDeployment('__Host-searm-session=sess_abc')).toBe(
      'sess_abc',
    );
  });

  it('should prefer the __Host- cookie name', () => {
    expect(
      extractOnHttpDeployment(
        'searm-session=sess_old; __Host-searm-session=sess_new',
      ),
    ).toBe('sess_new');
  });

  it('should ignore values without the session token prefix', () => {
    expect(extractOnHttpDeployment('searm-session=not-a-session-token')).toBe(
      undefined,
    );
  });

  it('should ignore lookalike cookie names', () => {
    expect(extractOnHttpDeployment('not-searm-session=sess_abc')).toBe(
      undefined,
    );
  });
});
