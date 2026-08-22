import { SEARM_STANDARD_APPLICATION } from 'src/engine/workspace-manager/searm-standard-application/constants/searm-standard-applications';
import { type WorkspaceMigrationBuilderOptions } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/types/workspace-migration-builder-options.type';

export const isCallerSearmStandardApp = (
  buildOptions: WorkspaceMigrationBuilderOptions,
) =>
  buildOptions.applicationUniversalIdentifier ===
  SEARM_STANDARD_APPLICATION.universalIdentifier;
