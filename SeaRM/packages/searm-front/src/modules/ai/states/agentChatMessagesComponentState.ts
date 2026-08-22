import { AgentChatComponentInstanceContext } from '@/ai/contexts/AgentChatComponentInstanceContext';
import { createAtomComponentState } from '@/ui/utilities/state/jotai/utils/createAtomComponentState';
import { type ExtendedUIMessage } from 'searm-shared/ai';

export const agentChatMessagesComponentState = createAtomComponentState<
  ExtendedUIMessage[]
>({
  key: 'agentChatMessagesComponentState',
  defaultValue: [],
  componentInstanceContext: AgentChatComponentInstanceContext,
});
