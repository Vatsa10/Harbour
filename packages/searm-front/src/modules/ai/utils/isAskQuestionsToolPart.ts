import { getToolName, isToolUIPart } from 'ai';
import {
  ASK_QUESTIONS_TOOL_NAME,
  type ExtendedUIMessagePart,
} from 'searm-shared/ai';

export const isAskQuestionsToolPart = (part: ExtendedUIMessagePart): boolean =>
  isToolUIPart(part) && getToolName(part) === ASK_QUESTIONS_TOOL_NAME;
