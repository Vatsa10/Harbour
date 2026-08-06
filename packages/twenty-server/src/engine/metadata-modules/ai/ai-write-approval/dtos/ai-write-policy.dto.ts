import { Field, InputType, ObjectType } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-type-json';

import { IsIn, Validate } from 'class-validator';

import { AI_WRITE_MODES } from 'src/engine/metadata-modules/ai/ai-write-approval/types/ai-write-policy.type';
import { IsAiWriteModeMapConstraint } from 'src/engine/metadata-modules/ai/ai-write-approval/validators/is-ai-write-mode-map.validator';

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
  @IsIn(AI_WRITE_MODES)
  default: string;

  // GraphQLJSON accepts any shape, so the override values are validated here
  // rather than trusted into the policy blob.
  @Field(() => GraphQLJSON)
  @Validate(IsAiWriteModeMapConstraint)
  overrides: Record<string, string>;
}
