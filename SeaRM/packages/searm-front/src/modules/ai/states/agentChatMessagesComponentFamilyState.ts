import { AgentChatComponentInstanceContext } from '@/ai/contexts/AgentChatComponentInstanceContext';
import { createAtomComponentFamilyState } from '@/ui/utilities/state/jotai/utils/createAtomComponentFamilyState';
import { type ExtendedUIMessage } from 'searm-shared/ai';

export const agentChatMessagesComponentFamilyState =
  createAtomComponentFamilyState<
    ExtendedUIMessage[],
    { threadId: string | null }
  >({
    key: 'agentChatMessagesComponentFamilyState',
    defaultValue: [],
    componentInstanceContext: AgentChatComponentInstanceContext,
  });
