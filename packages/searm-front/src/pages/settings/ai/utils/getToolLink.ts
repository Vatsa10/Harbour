import { type SettingsAgentToolItem } from '~/pages/settings/ai/types/SettingsAgentToolItem';
import { SettingsPath } from 'searm-shared/types';
import { getSettingsPath } from 'searm-shared/utils';

export const getToolLink = (tool: SettingsAgentToolItem): string =>
  getSettingsPath(SettingsPath.AiToolDetail, {
    toolIdentifier: tool.identifier,
  });
