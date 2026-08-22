import { isDefined } from 'searm-shared/utils';
import { FeatureFlagKey } from 'searm-shared/types';

import { type CustomException } from 'src/utils/custom-exception';

const assertIsFeatureFlagKey = (
  featureFlagKey: string,
  exceptionToThrow: CustomException,
): asserts featureFlagKey is FeatureFlagKey => {
  // @ts-expect-error legacy noImplicitAny
  if (isDefined(FeatureFlagKey[featureFlagKey])) return;
  throw exceptionToThrow;
};

export const featureFlagValidator: {
  assertIsFeatureFlagKey: typeof assertIsFeatureFlagKey;
} = {
  assertIsFeatureFlagKey: assertIsFeatureFlagKey,
};
