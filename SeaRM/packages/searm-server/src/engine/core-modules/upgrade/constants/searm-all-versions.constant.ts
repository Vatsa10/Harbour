import { SEARM_CURRENT_VERSION } from 'src/engine/core-modules/upgrade/constants/searm-current-version.constant';
import { SEARM_NEXT_VERSIONS } from 'src/engine/core-modules/upgrade/constants/searm-next-versions.constant';
import { SEARM_PREVIOUS_VERSIONS } from 'src/engine/core-modules/upgrade/constants/searm-previous-versions.constant';

export const SEARM_ALL_VERSIONS = [
  ...SEARM_PREVIOUS_VERSIONS,
  SEARM_CURRENT_VERSION,
  ...SEARM_NEXT_VERSIONS,
] as const;

export type SearmAllVersion = (typeof SEARM_ALL_VERSIONS)[number];
