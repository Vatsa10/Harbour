// SeaRM — AGPL-3.0. Clean-room reimplementation of the usage ledger
// (no Twenty Enterprise source consulted; derived from consumer call sites).

import { registerEnumType } from '@nestjs/graphql';

// The category of resource that was consumed.
export enum UsageResourceType {
  AI = 'AI',
  EMAIL = 'EMAIL',
  LOGIC_FUNCTION = 'LOGIC_FUNCTION',
  WORKFLOW = 'WORKFLOW',
}

registerEnumType(UsageResourceType, { name: 'UsageResourceType' });
