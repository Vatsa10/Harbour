import { type AskQuestionItem } from 'searm-shared/ai';

export type AgentChatPendingQuestion = {
  messageId: string;
  toolCallId: string;
  questions: AskQuestionItem[];
};
