import { SEARM_CURRENT_VERSION } from 'src/engine/core-modules/upgrade/constants/searm-current-version.constant';
import { SEARM_PREVIOUS_VERSIONS } from 'src/engine/core-modules/upgrade/constants/searm-previous-versions.constant';

export const SEARM_CROSS_UPGRADE_SUPPORTED_VERSIONS = [
  ...SEARM_PREVIOUS_VERSIONS,
  SEARM_CURRENT_VERSION,
] as const;

export type SearmCrossUpgradeSupportedVersion =
  (typeof SEARM_CROSS_UPGRADE_SUPPORTED_VERSIONS)[number];
