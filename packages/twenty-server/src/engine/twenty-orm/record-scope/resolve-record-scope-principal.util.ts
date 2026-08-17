import { isDefined } from 'twenty-shared/utils';

import { isUserAuthContext } from 'src/engine/core-modules/auth/guards/is-user-auth-context.guard';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type RecordScopePrincipal } from 'src/engine/twenty-orm/record-scope/types/record-scope-principal.type';

// The principal is derived from the auth context and from nothing else. It is
// never read off a request body, a header or a rule, because a rule that could
// name its own principal would be a rule that grants itself anything.
export const resolveRecordScopePrincipal = (
  authContext: WorkspaceAuthContext | undefined,
): RecordScopePrincipal => {
  if (!isDefined(authContext)) {
    return {};
  }

  if (isUserAuthContext(authContext)) {
    return {
      workspaceMemberId: authContext.workspaceMemberId,
      userWorkspaceId: authContext.userWorkspaceId,
      userId: authContext.user.id,
    };
  }

  // A pending activation user has a user and a user-workspace but no workspace
  // member row yet, so any rule mentioning workspaceMemberId must fail closed
  // for them rather than compare against undefined.
  if (authContext.type === 'pendingActivationUser') {
    return {
      userWorkspaceId: authContext.userWorkspaceId,
      userId: authContext.user.id,
    };
  }

  // apiKey, application and system carry no human identity at all. Returning an
  // empty principal is what makes every principal-parameterised rule on their
  // role compile to denyAll rather than to a comparison against nothing.
  return {};
};
