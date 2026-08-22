import { useLocation } from 'react-router-dom';
import { AppPath } from 'searm-shared/types';

export const useIsWorkspaceSetupChat = () => {
  const { pathname } = useLocation();

  return pathname === AppPath.WorkspaceSetup;
};
