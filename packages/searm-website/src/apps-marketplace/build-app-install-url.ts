const DEFAULT_SEARM_APP_BASE_URL = 'https://app.searm.com';

export const buildAppInstallUrl = (universalIdentifier: string): string => {
  const baseUrl =
    process.env.SEARM_APP_BASE_URL ?? DEFAULT_SEARM_APP_BASE_URL;

  const returnToPath = `/settings/applications/available/${universalIdentifier}`;

  return `${baseUrl.replace(/\/$/, '')}/?returnToPath=${encodeURIComponent(returnToPath)}`;
};
