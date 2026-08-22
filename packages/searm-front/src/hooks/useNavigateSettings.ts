import { useOpenSettingsMenu } from '@/navigation/hooks/useOpenSettings';
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { type SettingsPath } from 'searm-shared/types';
import { getSettingsPath } from 'searm-shared/utils';

export const useNavigateSettings = () => {
  const navigate = useNavigate();
  const { openSettingsMenu } = useOpenSettingsMenu();

  return useCallback(
    <T extends SettingsPath>(
      to: T,
      params?: Parameters<typeof getSettingsPath<T>>[1],
      queryParams?: Record<string, any>,
      options?: {
        replace?: boolean;
        state?: any;
      },
      hash?: string,
    ) => {
      openSettingsMenu();

      const path = getSettingsPath(to, params, queryParams, hash);
      return navigate(path, options);
    },
    [navigate, openSettingsMenu],
  );
};
