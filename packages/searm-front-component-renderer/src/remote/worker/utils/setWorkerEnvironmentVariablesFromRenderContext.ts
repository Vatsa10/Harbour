import { isDefined } from 'searm-shared/utils';

import { setWorkerEnvironmentVariables } from '@/remote/worker/utils/setWorkerEnvironmentVariables';
import { type HostToWorkerRenderContext } from '@/types/HostToWorkerRenderContext';

export const setWorkerEnvironmentVariablesFromRenderContext = (
  renderContext: HostToWorkerRenderContext,
): void => {
  if (isDefined(renderContext.applicationVariables)) {
    setWorkerEnvironmentVariables({
      applicationVariables: JSON.stringify(renderContext.applicationVariables),
    });
  }

  if (isDefined(renderContext.apiUrl)) {
    setWorkerEnvironmentVariables({
      SEARM_API_URL: renderContext.apiUrl,
    });
  }

  if (isDefined(renderContext.functionsBaseUrl)) {
    setWorkerEnvironmentVariables({
      SEARM_FUNCTIONS_URL: renderContext.functionsBaseUrl,
    });
  }

  if (isDefined(renderContext.applicationAccessToken)) {
    setWorkerEnvironmentVariables({
      SEARM_APP_ACCESS_TOKEN: renderContext.applicationAccessToken,
    });
  }
};
