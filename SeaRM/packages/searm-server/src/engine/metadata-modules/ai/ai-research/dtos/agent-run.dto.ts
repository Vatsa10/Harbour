import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

import { GraphQLBigInt } from 'graphql-scalars';

@ObjectType('AgentRun')
export class AgentRunDTO {
  @Field(() => ID)
  id: string;

  @Field(() => ID, { nullable: true })
  agentTaskId: string | null;

  @Field(() => String, { nullable: true })
  modelId: string | null;

  @Field(() => Int, { nullable: true })
  elapsedMs: number | null;

  @Field(() => Int)
  inputTokens: number;

  @Field(() => Int)
  outputTokens: number;

  @Field(() => GraphQLBigInt)
  creditsUsedMicro: number;

  @Field(() => String, { nullable: true })
  resultSummary: string | null;

  @Field(() => String, { nullable: true })
  errorMessage: string | null;

  @Field(() => Date)
  createdAt: Date;
}
