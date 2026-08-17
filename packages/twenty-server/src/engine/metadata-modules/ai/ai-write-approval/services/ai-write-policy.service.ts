import { Injectable } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { KeyValuePairType } from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { KeyValuePairService } from 'src/engine/core-modules/key-value-pair/key-value-pair.service';
import {
  AI_WRITE_APPROVAL_POLICY_KEY,
  DEFAULT_AI_WRITE_POLICY,
  isAiWriteMode,
  type AiWriteMode,
  type AiWritePolicy,
  type AiWritePolicyKeyValueTypeMap,
  type AiWritePolicyTarget,
} from 'src/engine/metadata-modules/ai/ai-write-approval/types/ai-write-policy.type';

// Only used to combine the per-field results of one write. Specificity, not
// severity, decides which override applies to a given field.
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

    return isDefined(stored)
      ? this.sanitize(stored as Partial<AiWritePolicy>)
      : DEFAULT_AI_WRITE_POLICY;
  }

  // A policy blob written before input validation existed can hold values that
  // are not modes. Drop them rather than let `undefined` leak into comparisons.
  private sanitize(stored: Partial<AiWritePolicy>): AiWritePolicy {
    const overrides = Object.entries(stored.overrides ?? {}).filter(
      (entry): entry is [string, AiWriteMode] => isAiWriteMode(entry[1]),
    );

    return {
      default: isAiWriteMode(stored.default)
        ? stored.default
        : DEFAULT_AI_WRITE_POLICY.default,
      overrides: Object.fromEntries(overrides),
    };
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

  // Most specific match wins: `<object>.<field>`, then `<object>`, then the
  // workspace default. A write touching several fields resolves each field
  // independently and the most restrictive result governs the whole call.
  resolveMode(policy: AiWritePolicy, target: AiWritePolicyTarget): AiWriteMode {
    if (target.kind === 'tool') {
      return getOverride(policy.overrides, target.toolId) ?? policy.default;
    }

    const { objectNameSingular, fieldNames } = target;

    if (fieldNames.length === 0) {
      return getOverride(policy.overrides, objectNameSingular) ?? policy.default;
    }

    return fieldNames
      .map(
        (fieldName) =>
          getOverride(policy.overrides, `${objectNameSingular}.${fieldName}`) ??
          getOverride(policy.overrides, objectNameSingular) ??
          policy.default,
      )
      .reduce((mostRestrictive, mode) =>
        MODE_SEVERITY[mode] > MODE_SEVERITY[mostRestrictive]
          ? mode
          : mostRestrictive,
      );
  }
}

// `policy.overrides` is a plain object literal, so a key that names an
// inherited Object.prototype member — `constructor`, `toString`,
// `hasOwnProperty`, `__proto__` — resolves through the prototype chain
// instead of returning undefined. An agent-controlled object name or field
// name reaching here (e.g. an object literally named "constructor") would
// then bypass the `?? policy.default` fallback and hand a live function
// into MODE_SEVERITY lookups, which is neither AUTO, PROPOSE, nor FORBID.
// hasOwnProperty scopes every lookup to keys the admin actually set.
const getOverride = (
  overrides: Record<string, AiWriteMode>,
  key: string,
): AiWriteMode | undefined =>
  Object.prototype.hasOwnProperty.call(overrides, key)
    ? overrides[key]
    : undefined;
