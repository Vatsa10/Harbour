import { Field, ID, InputType } from '@nestjs/graphql';

import { IsArray, IsUUID } from 'class-validator';

@InputType()
export class ApproveProposalInput {
  @Field(() => ID)
  @IsUUID()
  proposalId: string;

  @Field(() => [ID])
  @IsArray()
  selectedItemIds: string[];
}

@InputType()
export class RejectProposalInput {
  @Field(() => ID)
  @IsUUID()
  proposalId: string;
}
