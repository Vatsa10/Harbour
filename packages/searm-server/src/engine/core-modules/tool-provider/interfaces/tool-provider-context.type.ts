import { type ActorMetadata } from 'searm-shared/types';
import { type APP_LOCALES } from 'searm-shared/translations';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type CodeExecutionStreamEmitter } from 'src/engine/core-modules/tool-provider/interfaces/code-execution-stream-emitter.type';
import { type RolePermissionConfig } from 'src/engine/searm-orm/types/role-permission-config';

export type ToolProviderContext = {
  workspaceId: string;
  roleId: string;
  rolePermissionConfig: RolePermissionConfig;
  authContext?: WorkspaceAuthContext;
  actorContext?: ActorMetadata;
  userId?: string;
  userWorkspaceId?: string;
  threadId?: string;
  locale?: keyof typeof APP_LOCALES;
  onCodeExecutionUpdate?: CodeExecutionStreamEmitter;
  requireExplicitObjectGrants?: boolean;
};
