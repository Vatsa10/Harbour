// SeaRM — AGPL-3.0. Clean-room reimplementation of the usage ledger
// (no SeaRM Enterprise source consulted).

import { Field, Float, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class UsageUserDailyDTO {
  @Field()
  userWorkspaceId: string;

  @Field()
  date: string;

  @Field(() => Float)
  creditsUsed: number;
}
