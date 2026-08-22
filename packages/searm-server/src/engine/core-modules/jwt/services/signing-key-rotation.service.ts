// SeaRM — AGPL-3.0. Clean-room reimplementation of the JWT signing key
// rotation service (no SeaRM Enterprise source consulted; derived from
// JwtKeyManagerService's public API and the SIGNING_KEY_ROTATION_DAYS
// config description in searm-config/config-variables.ts).

import { Injectable, Logger } from '@nestjs/common';

import { isDefined } from 'searm-shared/utils';

import { JwtKeyManagerService } from 'src/engine/core-modules/jwt/services/jwt-key-manager.service';
import { SearmConfigService } from 'src/engine/core-modules/searm-config/searm-config.service';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type SigningKeyRotationResult = {
  rotated: boolean;
  signingKeyId?: string;
};

@Injectable()
export class SigningKeyRotationService {
  private readonly logger = new Logger(SigningKeyRotationService.name);

  constructor(
    private readonly jwtKeyManagerService: JwtKeyManagerService,
    private readonly searmConfigService: SearmConfigService,
  ) {}

  // Rotates the current JWT signing key when it has exceeded the configured
  // retention period, or when there is no current signing key yet. Never
  // logs key material (private key or secret content) — only key ids,
  // ages, and timestamps.
  async rotateIfDue(): Promise<SigningKeyRotationResult> {
    const rotationDays = this.searmConfigService.get(
      'SIGNING_KEY_ROTATION_DAYS',
    );

    if (!isDefined(rotationDays) || rotationDays <= 0) {
      this.logger.log(
        'JWT signing key auto-rotation is disabled (SIGNING_KEY_ROTATION_DAYS is unset)',
      );

      return { rotated: false };
    }

    const currentSigningKey = await this.findCurrentSigningKey();

    if (isDefined(currentSigningKey)) {
      const ageMs = Date.now() - currentSigningKey.createdAt.getTime();
      const thresholdMs = rotationDays * MS_PER_DAY;

      if (ageMs < thresholdMs) {
        this.logger.log(
          `Current signing key (kid=${currentSigningKey.id}) is ${Math.floor(
            ageMs / MS_PER_DAY,
          )}d old; rotation not due yet (threshold=${rotationDays}d)`,
        );

        return { rotated: false };
      }
    }

    const rotated = await this.jwtKeyManagerService.rotateCurrent();

    this.logger.log(
      `Rotated JWT signing key. New current signing key kid=${rotated.id}`,
    );

    return { rotated: true, signingKeyId: rotated.id };
  }

  private async findCurrentSigningKey() {
    const signingKeys = await this.jwtKeyManagerService.listSigningKeys();

    return signingKeys.find(
      (signingKey) => signingKey.isCurrent && !isDefined(signingKey.revokedAt),
    );
  }
}
