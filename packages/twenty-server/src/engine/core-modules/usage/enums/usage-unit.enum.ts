// SeaRM — AGPL-3.0. Clean-room reimplementation of the usage ledger
// (no Twenty Enterprise source consulted; derived from consumer call sites).

import { registerEnumType } from '@nestjs/graphql';

// The unit `quantity` is expressed in. CREDIT is kept for schema
// compatibility (ClickHouse `usageEvent.unit` defaults to 'CREDIT') even
// though no current call site emits it directly.
export enum UsageUnit {
  CREDIT = 'CREDIT',
  TOKEN = 'TOKEN',
  INVOCATION = 'INVOCATION',
}

registerEnumType(UsageUnit, { name: 'UsageUnit' });
