import { Field, ID, InputType, Int } from '@nestjs/graphql';

import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

@InputType()
export class CreateAgentTaskInput {
  @Field(() => String)
  @IsString()
  objectNameSingular: string;

  @Field(() => ID)
  @IsUUID()
  recordId: string;

  // Optional: omit it and the workspace's seeded research agent is resolved
  // server-side, which is also what binds it to its role. A supplied id is
  // validated before the task is created.
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  agentId?: string;

  @Field(() => String)
  @IsString()
  reason: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  // The charter's "budgeted" and "retryable" controls. Without these the only
  // way to set them was to be a language model calling the tool.
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  budget?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxAttempts?: number;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
