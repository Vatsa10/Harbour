import { useParams, useSearchParams } from 'react-router-dom';

import { useAuth } from '@/auth/hooks/useAuth';
import { type SocialSSOSignInUpActionType } from '@/auth/types/socialSSOSignInUp.type';

export const useSignInWithGoogle = () => {
  const workspaceInviteHash = useParams().workspaceInviteHash;
  const [searchParams] = useSearchParams();
  const workspacePersonalInviteToken =
    searchParams.get('inviteToken') ?? undefined;

  const { signInWithGoogle } = useAuth();

  return {
    signInWithGoogle: ({ action }: { action: SocialSSOSignInUpActionType }) =>
      signInWithGoogle({
        workspaceInviteHash,
        workspacePersonalInviteToken,
        action,
      }),
  };
};
