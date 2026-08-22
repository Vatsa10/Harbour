import { JwtKeyManagerService } from 'src/engine/core-modules/jwt/services/jwt-key-manager.service';
import { SigningKeyRotationService } from 'src/engine/core-modules/jwt/services/signing-key-rotation.service';

// Narrow structural fakes to the service's real dependency types without
// restating them; the spec exercises behaviour, not the ORM surface.
type JwtKeyManagerDeps = ConstructorParameters<typeof JwtKeyManagerService>;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe('SigningKeyRotationService', () => {
  let jwtKeyManagerService: {
    listSigningKeys: jest.Mock;
    rotateCurrent: jest.Mock;
  };
  let searmConfigService: { get: jest.Mock };
  let service: SigningKeyRotationService;

  beforeEach(() => {
    jwtKeyManagerService = {
      listSigningKeys: jest.fn(),
      rotateCurrent: jest.fn(),
    };
    searmConfigService = { get: jest.fn() };

    service = new SigningKeyRotationService(
      // oxlint-disable-next-line typescript/no-explicit-any
      jwtKeyManagerService as any,
      // oxlint-disable-next-line typescript/no-explicit-any
      searmConfigService as any,
    );
  });

  it('is a no-op when SIGNING_KEY_ROTATION_DAYS is unset', async () => {
    searmConfigService.get.mockReturnValue(undefined);

    const result = await service.rotateIfDue();

    expect(result).toEqual({ rotated: false });
    expect(jwtKeyManagerService.rotateCurrent).not.toHaveBeenCalled();
    expect(jwtKeyManagerService.listSigningKeys).not.toHaveBeenCalled();
  });

  it('does not rotate when the current key is younger than the configured threshold', async () => {
    searmConfigService.get.mockReturnValue(30);
    jwtKeyManagerService.listSigningKeys.mockResolvedValue([
      {
        id: 'young-key',
        isCurrent: true,
        revokedAt: null,
        createdAt: new Date(Date.now() - 5 * MS_PER_DAY),
      },
    ]);

    const result = await service.rotateIfDue();

    expect(result).toEqual({ rotated: false });
    expect(jwtKeyManagerService.rotateCurrent).not.toHaveBeenCalled();
  });

  it('rotates and returns the new signingKeyId once the current key exceeds the configured threshold', async () => {
    searmConfigService.get.mockReturnValue(30);
    jwtKeyManagerService.listSigningKeys.mockResolvedValue([
      {
        id: 'old-key',
        isCurrent: true,
        revokedAt: null,
        createdAt: new Date(Date.now() - 31 * MS_PER_DAY),
      },
    ]);
    jwtKeyManagerService.rotateCurrent.mockResolvedValue({
      id: 'new-key',
      privateKeyPem: 'irrelevant',
    });

    const result = await service.rotateIfDue();

    expect(result).toEqual({ rotated: true, signingKeyId: 'new-key' });
    expect(jwtKeyManagerService.rotateCurrent).toHaveBeenCalledTimes(1);
  });

  it('rotates when there is no current signing key at all', async () => {
    searmConfigService.get.mockReturnValue(30);
    jwtKeyManagerService.listSigningKeys.mockResolvedValue([]);
    jwtKeyManagerService.rotateCurrent.mockResolvedValue({
      id: 'first-key',
      privateKeyPem: 'irrelevant',
    });

    const result = await service.rotateIfDue();

    expect(result).toEqual({ rotated: true, signingKeyId: 'first-key' });
  });

  it('never calls revokeSigningKey as part of routine rotation (retirement, not revocation)', async () => {
    searmConfigService.get.mockReturnValue(30);
    jwtKeyManagerService.listSigningKeys.mockResolvedValue([
      {
        id: 'old-key',
        isCurrent: true,
        revokedAt: null,
        createdAt: new Date(Date.now() - 31 * MS_PER_DAY),
      },
    ]);
    jwtKeyManagerService.rotateCurrent.mockResolvedValue({
      id: 'new-key',
      privateKeyPem: 'irrelevant',
    });

    await service.rotateIfDue();

    expect(jwtKeyManagerService.rotateCurrent).toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((jwtKeyManagerService as any).revokeSigningKey).toBeUndefined();
  });
});

describe('JwtKeyManagerService.rotateCurrent (retire-not-revoke, exercised against the real implementation)', () => {
  it('marks the previous current row isCurrent=false, privateKey=null, and does NOT touch/set revokedAt — while inserting the new row as isCurrent=true, revokedAt=null', async () => {
    const updateCalls: unknown[][] = [];
    const insertCalls: unknown[][] = [];

    const fakeTransactionalRepository = {
      update: (...args: unknown[]) => {
        updateCalls.push(args);

        return Promise.resolve();
      },
      insert: (...args: unknown[]) => {
        insertCalls.push(args);

        return Promise.resolve();
      },
    };

    const fakeEntityManager = {
      getRepository: () => fakeTransactionalRepository,
    };

    const fakeSigningKeyRepository = {
      manager: {
        transaction: async (
          callback: (entityManager: unknown) => Promise<void>,
        ) => callback(fakeEntityManager),
      },
    };

    const fakeCoreEntityCacheService = {
      invalidate: jest.fn().mockResolvedValue(undefined),
    };

    const fakeSecretEncryptionService = {
      encryptVersioned: (plaintext: string) => `enc:v2:${plaintext}`,
    };

    const service = new JwtKeyManagerService(
      fakeSigningKeyRepository as unknown as JwtKeyManagerDeps[0],
      fakeCoreEntityCacheService as unknown as JwtKeyManagerDeps[1],
      fakeSecretEncryptionService as unknown as JwtKeyManagerDeps[2],
    );

    const result = await service.rotateCurrent();

    expect(updateCalls).toHaveLength(1);
    const [updateWhere, updatePayload] = updateCalls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];

    expect(updateWhere).toEqual({ isCurrent: true });
    expect(updatePayload).toEqual({ isCurrent: false, privateKey: null });
    // The single most important retire-not-revoke assertion: rotateCurrent's
    // update payload for the previous row must never include revokedAt.
    expect(Object.prototype.hasOwnProperty.call(updatePayload, 'revokedAt')).toBe(
      false,
    );

    expect(insertCalls).toHaveLength(1);
    const [insertPayload] = insertCalls[0] as [Record<string, unknown>];

    expect(insertPayload).toMatchObject({
      id: result.id,
      isCurrent: true,
      revokedAt: null,
    });
    expect(typeof insertPayload.publicKey).toBe('string');
    expect(String(insertPayload.privateKey)).toMatch(/^enc:v2:/);
    expect(typeof result.privateKeyPem).toBe('string');
    expect(result.privateKeyPem).toContain('BEGIN PRIVATE KEY');
  });
});
