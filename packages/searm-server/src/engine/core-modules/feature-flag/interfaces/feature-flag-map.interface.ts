import { type FeatureFlagKey } from 'searm-shared/types';

export type FeatureFlagMap = Record<`${FeatureFlagKey}`, boolean>;
