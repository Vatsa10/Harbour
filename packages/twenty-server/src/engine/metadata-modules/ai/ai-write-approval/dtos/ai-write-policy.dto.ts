import { Field, InputType, ObjectType } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-type-json';

@ObjectType('AiWritePolicy')
export class AiWritePolicyDTO {
  @Field(() => String)
  default: string;

  @Field(() => GraphQLJSON)
  overrides: Record<string, string>;
}

@InputType()
export class UpdateAiWritePolicyInput {
  @Field(() => String)
  default: string;

  @Field(() => GraphQLJSON)
  overrides: Record<string, string>;
}
