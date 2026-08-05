import { Injectable } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { KeyValuePairType } from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { KeyValuePairService } from 'src/engine/core-modules/key-value-pair/key-value-pair.service';
import {
  AI_WRITE_APPROVAL_POLICY_KEY,
  DEFAULT_AI_WRITE_POLICY,
  type AiWriteMode,
  type AiWritePolicy,
  type AiWritePolicyKeyValueTypeMap,
} from 'src/engine/metadata-modules/ai/ai-write-approval/types/ai-write-policy.type';

// Most restrictive mode wins when several keys apply to one write.
const MODE_SEVERITY: Record<AiWriteMode, number> = {
  AUTO: 0,
  PROPOSE: 1,
  FORBID: 2,
};

@Injectable()
export class AiWritePolicyService {
  constructor(
    private readonly keyValuePairService: KeyValuePairService<AiWritePolicyKeyValueTypeMap>,
  ) {}

  async getPolicy(workspaceId: string): Promise<AiWritePolicy> {
    const result = await this.keyValuePairService.get({
      workspaceId,
      userId: null,
      type: KeyValuePairType.CONFIG_VARIABLE,
      key: AI_WRITE_APPROVAL_POLICY_KEY,
    });

    // KeyValuePairService.get() resolves an array of matching rows; a workspace
    // only ever holds one policy row for this key, so take the first row's
    // value. Stays defensive around a bare value for stubbed callers.
    const stored = Array.isArray(result)
      ? (result[0] as { value?: AiWritePolicy } | undefined)?.value
      : result;

    return isDefined(stored) ? stored : DEFAULT_AI_WRITE_POLICY;
  }

  async setPolicy(workspaceId: string, policy: AiWritePolicy): Promise<void> {
    await this.keyValuePairService.set({
      workspaceId,
      userId: null,
      type: KeyValuePairType.CONFIG_VARIABLE,
      key: AI_WRITE_APPROVAL_POLICY_KEY,
      value: policy,
    });
  }

  resolveMode(policy: AiWritePolicy, keys: string[]): AiWriteMode {
    // Seeding the reduce with policy.default would let the default outrank a
    // less restrictive override (a lone 'AUTO' override must stay 'AUTO'), so
    // the default only applies when a key has no override, or when no keys
    // are supplied at all.
    const modes =
      keys.length === 0
        ? [policy.default]
        : keys.map((key) => policy.overrides[key] ?? policy.default);

    return modes.reduce((mostRestrictive, mode) =>
      MODE_SEVERITY[mode] > MODE_SEVERITY[mostRestrictive]
        ? mode
        : mostRestrictive,
    );
  }
}
