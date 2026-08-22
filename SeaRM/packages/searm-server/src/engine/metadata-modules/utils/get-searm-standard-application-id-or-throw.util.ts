import { SEARM_STANDARD_APPLICATION_UNIVERSAL_IDENTIFIER } from 'searm-shared/application';
import { isDefined } from 'searm-shared/utils';

import {
  ApplicationException,
  ApplicationExceptionCode,
} from 'src/engine/core-modules/application/application.exception';
import { type FlatApplicationCacheMaps } from 'src/engine/core-modules/application/types/flat-application-cache-maps.type';

export const getSearmStandardApplicationIdOrThrow = (
  flatApplicationMaps: FlatApplicationCacheMaps,
): string => {
  const searmStandardApplicationId =
    flatApplicationMaps.idByUniversalIdentifier[
      SEARM_STANDARD_APPLICATION_UNIVERSAL_IDENTIFIER
    ];

  if (!isDefined(searmStandardApplicationId)) {
    throw new ApplicationException(
      'Could not find the searm-standard application in the workspace cache',
      ApplicationExceptionCode.APPLICATION_NOT_FOUND,
    );
  }

  return searmStandardApplicationId;
};
