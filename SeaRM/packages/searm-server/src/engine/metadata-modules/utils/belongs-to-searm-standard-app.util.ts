import { SEARM_STANDARD_APPLICATION } from 'src/engine/workspace-manager/searm-standard-application/constants/searm-standard-applications';
import { type UniversalSyncableFlatEntity } from 'src/engine/workspace-manager/workspace-migration/universal-flat-entity/types/universal-flat-entity-from.type';

export const belongsToSearmStandardApp = <
  T extends UniversalSyncableFlatEntity,
>({
  applicationUniversalIdentifier,
}: T) =>
  applicationUniversalIdentifier ===
  SEARM_STANDARD_APPLICATION.universalIdentifier;
