import * as searmSdkDefine from '@/sdk/define';
import {
  SEARM_SDK_DEFINE_STUBBED_EXPORTS,
  isDefineFactoryExportName,
} from '@/cli/utilities/build/common/plugins/stub-searm-sdk-define.plugin';

describe('stub-searm-sdk-define plugin', () => {
  const realExports = Object.keys(searmSdkDefine).sort();
  const stubbedExports = [
    ...SEARM_SDK_DEFINE_STUBBED_EXPORTS.factories,
    ...SEARM_SDK_DEFINE_STUBBED_EXPORTS.any,
  ].sort();

  it('classifies every searm-sdk/define value-export', () => {
    expect(stubbedExports).toEqual(realExports);
  });

  it('classifies all defineX exports (and createValidationResult) as factories', () => {
    const expectedFactories = realExports
      .filter(isDefineFactoryExportName)
      .sort();

    expect([...SEARM_SDK_DEFINE_STUBBED_EXPORTS.factories].sort()).toEqual(
      expectedFactories,
    );
  });

  it('every factory is callable in the real module (would-be misclassification guard)', () => {
    for (const name of SEARM_SDK_DEFINE_STUBBED_EXPORTS.factories) {
      const actual = (searmSdkDefine as unknown as Record<string, unknown>)[
        name
      ];
      expect(typeof actual).toBe('function');
    }
  });

  // Snapshot to surface new exports in PR review. Update with
  // `npx vitest -u` when intentional.
  it('matches the recorded export partition', () => {
    expect(SEARM_SDK_DEFINE_STUBBED_EXPORTS).toMatchSnapshot();
  });
});
