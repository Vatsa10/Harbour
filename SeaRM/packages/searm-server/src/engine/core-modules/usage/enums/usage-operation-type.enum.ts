// SeaRM — AGPL-3.0. Clean-room reimplementation of the usage ledger
// (no SeaRM Enterprise source consulted; derived from consumer call sites).

import { registerEnumType } from '@nestjs/graphql';

// The specific kind of operation that consumed a resource. Members are
// derived from every call site that constructs a UsageEvent.
export enum UsageOperationType {
  AI_CHAT_TOKEN = 'AI_CHAT_TOKEN',
  AI_WORKFLOW_TOKEN = 'AI_WORKFLOW_TOKEN',
  WEB_SEARCH = 'WEB_SEARCH',
  CODE_EXECUTION = 'CODE_EXECUTION',
  EMAIL_SEND = 'EMAIL_SEND',
  WORKFLOW_EXECUTION = 'WORKFLOW_EXECUTION',
}

registerEnumType(UsageOperationType, { name: 'UsageOperationType' });
