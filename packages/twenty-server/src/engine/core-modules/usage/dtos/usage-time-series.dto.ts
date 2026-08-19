// SeaRM — AGPL-3.0. Clean-room reimplementation of the usage ledger
// (no Twenty Enterprise source consulted).

import { Field, Float, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class UsageTimeSeriesDTO {
  @Field()
  date: string;

  @Field(() => Float)
  creditsUsed: number;
}
