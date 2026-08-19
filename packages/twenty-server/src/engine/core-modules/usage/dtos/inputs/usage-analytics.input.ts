// SeaRM — AGPL-3.0. Clean-room reimplementation of the usage ledger
// (no Twenty Enterprise source consulted).

import { Field, InputType } from '@nestjs/graphql';

import { UsageOperationType } from 'src/engine/core-modules/usage/enums/usage-operation-type.enum';

@InputType()
export class UsageAnalyticsInput {
  @Field()
  periodStart: Date;

  @Field()
  periodEnd: Date;

  @Field(() => UsageOperationType, { nullable: true })
  operationType?: UsageOperationType;
}
