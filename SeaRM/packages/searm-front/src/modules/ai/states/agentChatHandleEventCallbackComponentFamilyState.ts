import { type AgentChatSubscriptionEvent } from 'searm-shared/ai';

import { AgentChatComponentInstanceContext } from '@/ai/contexts/AgentChatComponentInstanceContext';
import { createAtomComponentFamilyState } from '@/ui/utilities/state/jotai/utils/createAtomComponentFamilyState';

export const agentChatHandleEventCallbackComponentFamilyState =
  createAtomComponentFamilyState<
    ((event: AgentChatSubscriptionEvent) => void) | null,
    { threadId: string | null }
  >({
    key: 'agentChatHandleEventCallbackComponentFamilyState',
    defaultValue: null,
    componentInstanceContext: AgentChatComponentInstanceContext,
  });
