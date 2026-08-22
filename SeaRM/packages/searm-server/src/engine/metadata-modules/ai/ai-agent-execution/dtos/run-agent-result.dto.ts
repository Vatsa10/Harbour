import { Field, ObjectType } from '@nestjs/graphql';

import GraphQLJSON from 'graphql-type-json';
import { type RunAgentResult } from 'searm-shared/application';

@ObjectType('RunAgentResult')
export class RunAgentResultDTO implements RunAgentResult {
  @Field(() => GraphQLJSON, { nullable: true })
  result: object | null;

  @Field(() => String, { nullable: true })
  error: string | null;

  @Field()
  success: boolean;
}
