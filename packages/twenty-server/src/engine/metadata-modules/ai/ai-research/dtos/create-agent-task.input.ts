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

  @Field(() => ID)
  @IsUUID()
  agentId: string;

  @Field(() => String)
  @IsString()
  reason: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
