import { generateKeyPairSync } from 'crypto';

import * as jwt from 'jsonwebtoken';

import { AuthException } from 'src/engine/core-modules/auth/auth.exception';
import { AuthProviderEnum } from 'src/engine/core-modules/workspace/types/workspace.type';
import { JwtTokenTypeEnum } from 'src/engine/core-modules/auth/types/jwt-token-type.enum';
import { JWT_ASYMMETRIC_ALGORITHM } from 'src/engine/core-modules/jwt/constants/jwt-algorithm.constant';

import { JwtWrapperService } from './jwt-wrapper.service';

const APP_SECRET = 'test-app-secret';

const generateEcKeyPair = () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });

  return {
    privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
  };
};

describe('JwtWrapperService (security-critical verification path)', () => {
  const currentKey = generateEcKeyPair();
  const currentKeyId = 'current-key-id';
  const retiredKey = generateEcKeyPair();
  const retiredKeyId = 'retired-key-id';
  const revokedKey = generateEcKeyPair();
  const revokedKeyId = 'revoked-key-id';
  const foreignKey = generateEcKeyPair();

  // Simulates SigningKeyEntityCacheProviderService.computeForCache, which only
  // returns a public key for rows where revokedAt IS NULL. isCurrent is
  // irrelevant to verification, which is the retired-key design under test.
  const publicKeysByRevokedAtIsNull: Record<string, string> = {
    [currentKeyId]: currentKey.publicKeyPem,
    [retiredKeyId]: retiredKey.publicKeyPem,
  };

  let jwtKeyManagerService: {
    getCurrentSigningKey: jest.Mock;
    getValidPublicKeyPemById: jest.Mock;
  };
  let signingKeyVerifyCounterService: {
    recordKidVerify: jest.Mock;
    recordLegacyVerify: jest.Mock;
  };
  let searmConfigService: { get: jest.Mock };
  let nestJwtService: { decode: jest.Mock };
  let service: JwtWrapperService;

  beforeEach(() => {
    jwtKeyManagerService = {
      getCurrentSigningKey: jest.fn().mockResolvedValue({
        id: currentKeyId,
        privateKeyPem: currentKey.privateKeyPem,
      }),
      getValidPublicKeyPemById: jest
        .fn()
        .mockImplementation(async (id: string) =>
          Object.prototype.hasOwnProperty.call(
            publicKeysByRevokedAtIsNull,
            id,
          )
            ? publicKeysByRevokedAtIsNull[id]
            : null,
        ),
    };
    signingKeyVerifyCounterService = {
      recordKidVerify: jest.fn(),
      recordLegacyVerify: jest.fn(),
    };
    searmConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'APP_SECRET') return APP_SECRET;
        if (key === 'SERVER_URL') return 'http://localhost:3000';

        return undefined;
      }),
    };
    nestJwtService = {
      decode: jest.fn().mockImplementation((payload, options) =>
        jwt.decode(payload, options),
      ),
    };

    service = new JwtWrapperService(
      // oxlint-disable-next-line typescript/no-explicit-any
      nestJwtService as any,
      // oxlint-disable-next-line typescript/no-explicit-any
      searmConfigService as any,
      // oxlint-disable-next-line typescript/no-explicit-any
      jwtKeyManagerService as any,
      // oxlint-disable-next-line typescript/no-explicit-any
      signingKeyVerifyCounterService as any,
    );
  });

  const signAsymmetric = (
    payload: object,
    keyPem: string,
    kid: string,
    options: jwt.SignOptions = {},
  ) =>
    jwt.sign(payload, keyPem, {
      algorithm: JWT_ASYMMETRIC_ALGORITHM,
      keyid: kid,
      ...options,
    });

  const legacyAppSecret = (
    type: JwtTokenTypeEnum,
    body: { workspaceId?: string; userId?: string },
  ) =>
    service.generateAppSecret(
      type,
      body.workspaceId ?? (body.userId as string),
    );

  it('signs and verifies a normal ES256 access token round-trip (sanity check)', async () => {
    const token = await service.signAsyncOrThrow(
      {
          sub: 'user-1',
          type: JwtTokenTypeEnum.ACCESS,
          workspaceId: 'workspace-1',
          userId: 'user-1',
          userWorkspaceId: 'user-workspace-1',
          authProvider: AuthProviderEnum.Password,
        },
      { expiresIn: '1h' },
    );

    const decodedHeader = jwt.decode(token, { complete: true })?.header;

    expect(decodedHeader?.alg).toBe('ES256');
    expect(decodedHeader?.kid).toBe(currentKeyId);

    const verified = await service.verifyJwtToken(token);

    expect(verified.sub).toBe('user-1');
    expect(signingKeyVerifyCounterService.recordKidVerify).toHaveBeenCalledWith(
      currentKeyId,
    );
  });

  describe('alg:none rejection', () => {
    it('rejects a token with header alg "none" and no signature', async () => {
      const header = Buffer.from(
        JSON.stringify({ alg: 'none', typ: 'JWT' }),
      ).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({ workspaceId: 'ws-1', type: JwtTokenTypeEnum.ACCESS }),
      ).toString('base64url');
      const noneToken = `${header}.${payload}.`;

      await expect(service.verifyJwtToken(noneToken)).rejects.toThrow(
        AuthException,
      );
    });

    it('rejects alg:none even when a kid for a real asymmetric key is present in the header', async () => {
      const header = Buffer.from(
        JSON.stringify({ alg: 'none', typ: 'JWT', kid: currentKeyId }),
      ).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({ workspaceId: 'ws-1', type: JwtTokenTypeEnum.ACCESS }),
      ).toString('base64url');
      const noneToken = `${header}.${payload}.`;

      await expect(service.verifyJwtToken(noneToken)).rejects.toThrow(
        AuthException,
      );
      // Must never have resolved the asymmetric branch for this token.
      expect(
        jwtKeyManagerService.getValidPublicKeyPemById,
      ).not.toHaveBeenCalled();
    });
  });

  describe('HMAC-vs-RSA/EC algorithm confusion', () => {
    it('rejects a token whose header claims HS256 but is signed using a real EC public key as the HMAC secret, even when kid names a real signing key', () => {
      const forgedToken = jwt.sign(
        { workspaceId: 'ws-1', type: JwtTokenTypeEnum.ACCESS },
        currentKey.publicKeyPem,
        { algorithm: 'HS256', keyid: currentKeyId },
      );

      return expect(service.verifyJwtToken(forgedToken)).rejects.toThrow(
        AuthException,
      );
    });

    it('rejects a token whose header claims ES256 but the payload/signature was actually produced with HS256 semantics (header/algorithm tampering)', async () => {
      // Build a legitimate legacy HS256 token, then tamper only the header to
      // claim ES256 with a kid pointing at a real key, while keeping the
      // original HS256 signature bytes untouched.
      const legacySecret = legacyAppSecret(JwtTokenTypeEnum.ACCESS, {
        workspaceId: 'ws-1',
      });
      const legacyToken = jwt.sign(
        { workspaceId: 'ws-1', type: JwtTokenTypeEnum.ACCESS },
        legacySecret,
        { algorithm: 'HS256' },
      );
      const [, payloadB64, sigB64] = legacyToken.split('.');
      const tamperedHeader = Buffer.from(
        JSON.stringify({
          alg: JWT_ASYMMETRIC_ALGORITHM,
          typ: 'JWT',
          kid: currentKeyId,
        }),
      ).toString('base64url');
      const tamperedToken = `${tamperedHeader}.${payloadB64}.${sigB64}`;

      await expect(service.verifyJwtToken(tamperedToken)).rejects.toThrow(
        AuthException,
      );
    });
  });

  describe('wrong / foreign key', () => {
    it('rejects an ES256 token signed by a foreign private key, even when the header kid names a real, valid signing key id', async () => {
      const forgedToken = signAsymmetric(
        { sub: 'attacker', type: JwtTokenTypeEnum.ACCESS },
        foreignKey.privateKeyPem,
        currentKeyId,
        { expiresIn: '1h' },
      );

      await expect(service.verifyJwtToken(forgedToken)).rejects.toThrow(
        AuthException,
      );
    });

    it('rejects an ES256 token whose kid does not correspond to any known signing key', async () => {
      const token = signAsymmetric(
        {
          sub: 'user-1',
          type: JwtTokenTypeEnum.ACCESS,
          workspaceId: 'workspace-1',
          userId: 'user-1',
          userWorkspaceId: 'user-workspace-1',
          authProvider: AuthProviderEnum.Password,
        },
        currentKey.privateKeyPem,
        'unknown-kid',
        { expiresIn: '1h' },
      );

      await expect(service.verifyJwtToken(token)).rejects.toThrow(
        AuthException,
      );
    });
  });

  describe('expiry and not-before', () => {
    it('rejects an expired token (exp in the past)', async () => {
      const token = signAsymmetric(
        {
          sub: 'user-1',
          type: JwtTokenTypeEnum.ACCESS,
          iat: Math.floor(Date.now() / 1000) - 3600,
          exp: Math.floor(Date.now() / 1000) - 1,
        },
        currentKey.privateKeyPem,
        currentKeyId,
      );

      await expect(service.verifyJwtToken(token)).rejects.toThrow(
        AuthException,
      );
      await expect(service.verifyJwtToken(token)).rejects.toThrow(
        'Token has expired.',
      );
    });

    it('rejects a token that is expired by only 1 second (no clock-skew tolerance is configured: default jsonwebtoken clockTolerance = 0)', async () => {
      const token = signAsymmetric(
        {
          sub: 'user-1',
          type: JwtTokenTypeEnum.ACCESS,
          exp: Math.floor(Date.now() / 1000) - 1,
        },
        currentKey.privateKeyPem,
        currentKeyId,
      );

      await expect(service.verifyJwtToken(token)).rejects.toThrow(
        AuthException,
      );
    });

    it('rejects a not-yet-valid token (nbf in the future)', async () => {
      const token = signAsymmetric(
        {
          sub: 'user-1',
          type: JwtTokenTypeEnum.ACCESS,
          nbf: Math.floor(Date.now() / 1000) + 3600,
          exp: Math.floor(Date.now() / 1000) + 7200,
        },
        currentKey.privateKeyPem,
        currentKeyId,
      );

      await expect(service.verifyJwtToken(token)).rejects.toThrow(
        AuthException,
      );
    });
  });

  describe('issuer / audience (strict by default)', () => {
    it('rejects a token with a forged iss, even though it is validly signed by a real current key with the correct aud', async () => {
      const token = signAsymmetric(
        {
          sub: 'user-1',
          type: JwtTokenTypeEnum.ACCESS,
          iss: 'https://attacker.example.com',
          aud: 'urn:searm:jwt-audience:access',
        },
        currentKey.privateKeyPem,
        currentKeyId,
        { expiresIn: '1h' },
      );

      await expect(service.verifyJwtToken(token)).rejects.toThrow(
        AuthException,
      );
    });

    it('rejects a token with a forged aud, even though it is validly signed by a real current key with the correct iss', async () => {
      const token = signAsymmetric(
        {
          sub: 'user-1',
          type: JwtTokenTypeEnum.ACCESS,
          iss: 'http://localhost:3000',
          aud: 'some-other-audience',
        },
        currentKey.privateKeyPem,
        currentKeyId,
        { expiresIn: '1h' },
      );

      await expect(service.verifyJwtToken(token)).rejects.toThrow(
        AuthException,
      );
    });

    it('verifies successfully when a token carries the correct iss/aud pair for its type (round-trip via signAsyncOrThrow)', async () => {
      const token = await service.signAsyncOrThrow(
        {
          sub: 'user-1',
          type: JwtTokenTypeEnum.ACCESS,
          workspaceId: 'workspace-1',
          userId: 'user-1',
          userWorkspaceId: 'user-workspace-1',
          authProvider: AuthProviderEnum.Password,
        },
        { expiresIn: '1h' },
      );

      const decoded = jwt.decode(token) as { iss?: string; aud?: string };

      expect(decoded.iss).toBe('http://localhost:3000');
      expect(decoded.aud).toBe('urn:searm:jwt-audience:access');

      const verified = await service.verifyJwtToken(token);

      expect(verified.sub).toBe('user-1');
    });

    it('rejects a token issued for one audience/type (REFRESH) when verification expects a different one (ACCESS) — audience confusion', async () => {
      const refreshToken = await service.signAsyncOrThrow(
        {
          sub: 'user-1',
          type: JwtTokenTypeEnum.REFRESH,
          userId: 'user-1',
          targetedTokenType: JwtTokenTypeEnum.ACCESS,
        },
        { expiresIn: '1h' },
      );

      // Sanity check: verifying with no expectation, or with the matching
      // expected type, both succeed.
      await expect(service.verifyJwtToken(refreshToken)).resolves.toBeDefined();
      await expect(
        service.verifyJwtToken(
          refreshToken,
          undefined,
          JwtTokenTypeEnum.REFRESH,
        ),
      ).resolves.toBeDefined();

      // A caller expecting ACCESS must reject this REFRESH-audience token.
      await expect(
        service.verifyJwtToken(
          refreshToken,
          undefined,
          JwtTokenTypeEnum.ACCESS,
        ),
      ).rejects.toThrow(AuthException);
    });
  });

  describe('retired vs revoked signing keys', () => {
    it('POSITIVE CASE: a token signed by a RETIRED key (isCurrent=false, revokedAt=null) still verifies successfully until natural expiry', async () => {
      const token = signAsymmetric(
        {
          sub: 'user-1',
          type: JwtTokenTypeEnum.ACCESS,
          workspaceId: 'workspace-1',
          userId: 'user-1',
          userWorkspaceId: 'user-workspace-1',
          authProvider: AuthProviderEnum.Password,
        },
        retiredKey.privateKeyPem,
        retiredKeyId,
        {
          expiresIn: '1h',
          // Retirement must not change the claim contract: a retired key still
          // signs a fully-formed token, so it carries the same iss/aud a
          // current key would. Omitting them here would make this pass or fail
          // for the wrong reason.
          issuer: 'http://localhost:3000',
          audience: 'urn:searm:jwt-audience:access',
        },
      );

      const verified = await service.verifyJwtToken(token);

      expect(verified.sub).toBe('user-1');
      expect(
        jwtKeyManagerService.getValidPublicKeyPemById,
      ).toHaveBeenCalledWith(retiredKeyId);
    });

    it('NEGATIVE CASE: a token signed by a REVOKED key (revokedAt set) does NOT verify, unlike the retired case above', async () => {
      const token = signAsymmetric(
        {
          sub: 'user-1',
          type: JwtTokenTypeEnum.ACCESS,
          workspaceId: 'workspace-1',
          userId: 'user-1',
          userWorkspaceId: 'user-workspace-1',
          authProvider: AuthProviderEnum.Password,
        },
        revokedKey.privateKeyPem,
        revokedKeyId,
        { expiresIn: '1h' },
      );

      // revokedKeyId is intentionally absent from publicKeysByRevokedAtIsNull,
      // simulating SigningKeyEntityCacheProviderService.computeForCache()
      // returning null because `revokedAt IS NOT NULL` for this row.
      await expect(service.verifyJwtToken(token)).rejects.toThrow(
        AuthException,
      );
    });
  });

  describe('legacy HS256 path (still exercised for API_KEY/back-compat tokens)', () => {
    it('verifies a legitimate legacy HS256 token bound to workspaceId + type', async () => {
      const secret = legacyAppSecret(JwtTokenTypeEnum.ACCESS, {
        workspaceId: 'ws-1',
      });
      const token = jwt.sign(
        { workspaceId: 'ws-1', type: JwtTokenTypeEnum.ACCESS },
        secret,
        {
          algorithm: 'HS256',
          expiresIn: '1h',
          issuer: 'http://localhost:3000',
          audience: 'urn:searm:jwt-audience:access',
        },
      );

      const verified = await service.verifyJwtToken(token);

      expect(verified.workspaceId).toBe('ws-1');
      expect(signingKeyVerifyCounterService.recordLegacyVerify).toHaveBeenCalled();
    });

    it('rejects a legacy token signed with the wrong type bound into the secret (type confusion within the legacy scheme)', async () => {
      const secret = legacyAppSecret(JwtTokenTypeEnum.REFRESH, {
        workspaceId: 'ws-1',
      });
      const token = jwt.sign(
        { workspaceId: 'ws-1', type: JwtTokenTypeEnum.ACCESS },
        secret,
        { algorithm: 'HS256', expiresIn: '1h' },
      );

      await expect(service.verifyJwtToken(token)).rejects.toThrow(
        AuthException,
      );
    });
  });
});
