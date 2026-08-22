import { type CurrentWorkspace } from '@/auth/states/currentWorkspaceState';
import { type SettingsAgentToolItem } from '~/pages/settings/ai/types/SettingsAgentToolItem';
import { SEARM_STANDARD_APPLICATION_UNIVERSAL_IDENTIFIER } from 'searm-shared/application';
import { isDefined } from 'searm-shared/utils';

export const getToolApplicationId = (
  tool: SettingsAgentToolItem,
  currentWorkspace: CurrentWorkspace | null,
): string => {
  if (isDefined(tool.applicationId)) {
    return tool.applicationId;
  }

  return (
    currentWorkspace?.installedApplications?.find(
      (app) =>
        app.universalIdentifier ===
        SEARM_STANDARD_APPLICATION_UNIVERSAL_IDENTIFIER,
    )?.id ?? ''
  );
};
