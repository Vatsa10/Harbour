import { SettingsPath } from 'searm-shared/types';
import { getSettingsPath } from 'searm-shared/utils';

export const AI_ADMIN_PATH = getSettingsPath(
  SettingsPath.AdminPanel,
  undefined,
  undefined,
  'ai',
);
