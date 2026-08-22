import { currentWorkspaceState } from '@/auth/states/currentWorkspaceState';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { type WorkspaceActivationStatus } from 'searm-shared/workspace';

export const useIsWorkspaceActivationStatusEqualsTo = (
  activationStatus: WorkspaceActivationStatus,
): boolean => {
  const currentWorkspace = useAtomStateValue(currentWorkspaceState);
  return currentWorkspace?.activationStatus === activationStatus;
};
