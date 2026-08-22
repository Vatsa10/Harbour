import { useParams, useSearchParams } from 'react-router-dom';

import { useAuth } from '@/auth/hooks/useAuth';
import { type SocialSSOSignInUpActionType } from '@/auth/types/socialSSOSignInUp.type';

export const useSignInWithMicrosoft = () => {
  const workspaceInviteHash = useParams().workspaceInviteHash;
  const [searchParams] = useSearchParams();
  const workspacePersonalInviteToken =
    searchParams.get('inviteToken') ?? undefined;

  const { signInWithMicrosoft } = useAuth();
  return {
    signInWithMicrosoft: ({
      action,
    }: {
      action: SocialSSOSignInUpActionType;
    }) =>
      signInWithMicrosoft({
        workspaceInviteHash,
        workspacePersonalInviteToken,
        action,
      }),
  };
};
