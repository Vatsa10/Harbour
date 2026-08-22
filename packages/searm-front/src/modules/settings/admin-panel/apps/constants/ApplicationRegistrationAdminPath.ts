import { SettingsPath } from 'searm-shared/types';
import { getSettingsPath } from 'searm-shared/utils';

export const APPLICATION_REGISTRATION_ADMIN_PATH = getSettingsPath(
  SettingsPath.AdminPanel,
  undefined,
  undefined,
  'apps',
);
