import semver from 'semver';
import { isDefined } from 'searm-shared/utils';

export const shouldRefreshApplicationRegistrationOnInstall = ({
  installedVersion,
  latestAvailableVersion,
}: {
  installedVersion: string;
  latestAvailableVersion: string | null;
}): boolean => {
  if (
    !isDefined(latestAvailableVersion) ||
    !isDefined(semver.valid(latestAvailableVersion))
  ) {
    return true;
  }

  if (!isDefined(semver.valid(installedVersion))) {
    return false;
  }

  return semver.gte(installedVersion, latestAvailableVersion);
};
