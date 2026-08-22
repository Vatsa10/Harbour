import { SEARM_STANDARD_APPLICATION_UNIVERSAL_IDENTIFIER } from 'searm-shared/application';
import { isDefined } from 'searm-shared/utils';

type ApplicationLike = {
  universalIdentifier?: string | null;
};

export const isSearmStandardApplication = (
  application: ApplicationLike | null | undefined,
): boolean =>
  isDefined(application?.universalIdentifier) &&
  application.universalIdentifier ===
    SEARM_STANDARD_APPLICATION_UNIVERSAL_IDENTIFIER;
