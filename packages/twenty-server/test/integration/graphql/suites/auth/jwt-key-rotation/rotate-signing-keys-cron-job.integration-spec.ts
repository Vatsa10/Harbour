// SeaRM — AGPL-3.0. Clean-room integration coverage for the JWT signing key
// rotation cron job/service (no Twenty Enterprise source consulted; written
// against SigningKeyRotationService/JwtKeyManagerService's public behavior
// and the real "signingKey" table, following the conventions of the
// sibling AGPL specs in this suite and user-session-cleanup-cron.integration-spec.ts).

import * as jwt from 'jsonwebtoken';

import { getAppProviderByClassName } from 'test/integration/utils/get-app-provider-by-class-name.util';
import { getCoreRepository } from 'test/integration/utils/get-core-repository.util';

import { SigningKeyEntity } from 'src/engine/core-modules/jwt/entities/signing-key.entity';
import {
  type CurrentSigningKey,
  JwtKeyManagerService,
} from 'src/engine/core-modules/jwt/services/jwt-key-manager.service';
import { SigningKeyRotationService } from 'src/engine/core-modules/jwt/services/signing-key-rotation.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

const ROTATION_DAYS = 30;

describe('rotate signing keys cron job (integration)', () => {
  let signingKeyRotationService: SigningKeyRotationService;
  let jwtKeyManagerService: JwtKeyManagerService;
  let twentyConfigService: TwentyConfigService;
  let signingKeyRepository: ReturnType<
    typeof getCoreRepository<SigningKeyEntity>
  >;

  const createdSigningKeyIds: string[] = [];

  const wipeSigningKeyTable = async (): Promise<void> => {
    await global.testDataSource.query('DELETE FROM core."signingKey"');
  };

  beforeAll(async () => {
    signingKeyRotationService =
      getAppProviderByClassName<SigningKeyRotationService>(
        'SigningKeyRotationService',
      );
    jwtKeyManagerService = getAppProviderByClassName<JwtKeyManagerService>(
      'JwtKeyManagerService',
    );
    twentyConfigService = getAppProviderByClassName<TwentyConfigService>(
      'TwentyConfigService',
    );
    signingKeyRepository = getCoreRepository<SigningKeyEntity>(
      SigningKeyEntity,
    );

    await twentyConfigService.set('SIGNING_KEY_ROTATION_DAYS', ROTATION_DAYS);
  });

  afterAll(async () => {
    await twentyConfigService.delete('SIGNING_KEY_ROTATION_DAYS');
    await signingKeyRepository.delete({});
  });

  beforeEach(async () => {
    // Every test in this suite starts from a clean signingKey table so the
    // "no current key" / "due" / "not due" scenarios don't interfere with
    // each other via the unique partial index on isCurrent.
    await wipeSigningKeyTable();
  });

  it('creates a new current signing key when none exists yet', async () => {
    const result = await signingKeyRotationService.rotateIfDue();

    expect(result.rotated).toBe(true);
    expect(result.signingKeyId).toBeDefined();

    createdSigningKeyIds.push(result.signingKeyId as string);

    const rows = await signingKeyRepository.find();

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(result.signingKeyId);
    expect(rows[0].isCurrent).toBe(true);
    expect(rows[0].revokedAt).toBeNull();
    expect(rows[0].publicKey).toMatch(
      /^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----\s*$/,
    );
  });

  it('does not rotate when the current key is still within the rotation threshold', async () => {
    const firstResult = await signingKeyRotationService.rotateIfDue();

    expect(firstResult.rotated).toBe(true);

    const secondResult = await signingKeyRotationService.rotateIfDue();

    expect(secondResult.rotated).toBe(false);
    expect(secondResult.signingKeyId).toBeUndefined();

    const rows = await signingKeyRepository.find();

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(firstResult.signingKeyId);
    expect(rows[0].isCurrent).toBe(true);
  });

  it('rotates when the current key has aged past the threshold, retiring the old key without revoking it', async () => {
    const firstResult = await signingKeyRotationService.rotateIfDue();

    expect(firstResult.rotated).toBe(true);

    const oldKeyId = firstResult.signingKeyId as string;

    // Simulate the passage of time by backdating createdAt directly in the
    // real DB, mirroring how sibling specs in this suite mimic elapsed time.
    await global.testDataSource.query(
      `UPDATE core."signingKey" SET "createdAt" = NOW() - INTERVAL '${
        ROTATION_DAYS + 1
      } days' WHERE "id" = $1`,
      [oldKeyId],
    );

    const secondResult = await signingKeyRotationService.rotateIfDue();

    expect(secondResult.rotated).toBe(true);
    expect(secondResult.signingKeyId).toBeDefined();
    expect(secondResult.signingKeyId).not.toBe(oldKeyId);

    const newKeyId = secondResult.signingKeyId as string;

    const oldKeyRow = await signingKeyRepository.findOneByOrFail({
      id: oldKeyId,
    });
    const newKeyRow = await signingKeyRepository.findOneByOrFail({
      id: newKeyId,
    });

    expect(oldKeyRow.isCurrent).toBe(false);
    expect(oldKeyRow.revokedAt).toBeNull();
    expect(newKeyRow.isCurrent).toBe(true);
    expect(newKeyRow.revokedAt).toBeNull();
  });

  it('keeps a JWT signed with the pre-rotation key verifiable after rotation (retired-key-still-valid)', async () => {
    const beforeRotation: CurrentSigningKey | null =
      await jwtKeyManagerService.getCurrentSigningKey();

    expect(beforeRotation).not.toBeNull();

    const preRotationKeyId = (beforeRotation as CurrentSigningKey).id;
    const preRotationPrivateKeyPem = (beforeRotation as CurrentSigningKey)
      .privateKeyPem;

    const tokenSignedBeforeRotation = jwt.sign(
      { sub: 'integration-test-subject' },
      preRotationPrivateKeyPem,
      { algorithm: 'ES256', keyid: preRotationKeyId, expiresIn: '5m' },
    );

    await global.testDataSource.query(
      `UPDATE core."signingKey" SET "createdAt" = NOW() - INTERVAL '${
        ROTATION_DAYS + 1
      } days' WHERE "id" = $1`,
      [preRotationKeyId],
    );

    const rotationResult = await signingKeyRotationService.rotateIfDue();

    expect(rotationResult.rotated).toBe(true);
    expect(rotationResult.signingKeyId).not.toBe(preRotationKeyId);

    const retiredPublicKeyPem =
      await jwtKeyManagerService.getValidPublicKeyPemById(preRotationKeyId);

    expect(retiredPublicKeyPem).not.toBeNull();

    const decodedAfterRotation = jwt.verify(
      tokenSignedBeforeRotation,
      retiredPublicKeyPem as string,
      { algorithms: ['ES256'] },
    ) as { sub: string };

    expect(decodedAfterRotation.sub).toBe('integration-test-subject');
  });
});
