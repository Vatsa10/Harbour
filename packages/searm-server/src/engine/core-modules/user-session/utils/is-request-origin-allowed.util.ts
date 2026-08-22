import { type Request } from 'express';
import { isDefined } from 'searm-shared/utils';

import { type SearmConfigService } from 'src/engine/core-modules/searm-config/searm-config.service';
import { resolveAllowedCredentialedOrigins } from 'src/engine/core-modules/user-session/utils/resolve-allowed-credentialed-origins.util';
import { getRequestBaseUrl } from 'src/utils/get-request-base-url.util';

const toComparableOrigin = (value: string): string | undefined => {
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return undefined;
  }
};

export const isRequestOriginAllowed = ({
  origin,
  request,
  searmConfigService,
}: {
  origin: string;
  request: Request;
  searmConfigService: SearmConfigService;
}): boolean => {
  const normalizedOrigin = origin.toLowerCase();

  // Compared through URL rather than as strings: browsers omit :443 and :80
  // from Origin while Host keeps whatever port the client spelled, so a genuine
  // same-origin POST would otherwise 403 on the port alone.
  const comparableOrigin = toComparableOrigin(normalizedOrigin);
  const comparableRequestOrigin = toComparableOrigin(
    getRequestBaseUrl(request),
  );

  if (
    isDefined(comparableOrigin) &&
    comparableOrigin === comparableRequestOrigin
  ) {
    return true;
  }

  return resolveAllowedCredentialedOrigins(searmConfigService).has(
    normalizedOrigin,
  );
};
