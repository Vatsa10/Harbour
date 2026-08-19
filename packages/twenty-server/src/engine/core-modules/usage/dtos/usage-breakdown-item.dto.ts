// SeaRM — AGPL-3.0. Clean-room reimplementation of the usage ledger
// (no Twenty Enterprise source consulted; derived from consumer call sites —
// admin-panel.resolver.ts's getAdminAiUsageByWorkspace uses `.key`).

import { Field, Float, ObjectType } from '@nestjs/graphql';

// One row of a "usage grouped by X" breakdown, e.g. usage grouped by
// workspaceId for the admin panel.
@ObjectType()
export class UsageBreakdownItemDTO {
  @Field()
  key: string;

  @Field(() => Float)
  value: number;

  @Field({ nullable: true })
  label?: string;
}
