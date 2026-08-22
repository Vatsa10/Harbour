import {
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

import {
  AI_WRITE_MODES,
  isAiWriteMode,
} from 'src/engine/metadata-modules/ai/ai-write-approval/types/ai-write-policy.type';

@ValidatorConstraint({ name: 'isAiWriteModeMap', async: false })
export class IsAiWriteModeMapConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return false;
    }

    return Object.values(value as Record<string, unknown>).every((mode) =>
      isAiWriteMode(mode),
    );
  }

  defaultMessage(): string {
    return `overrides must map each key to one of ${AI_WRITE_MODES.join(', ')}`;
  }
}
