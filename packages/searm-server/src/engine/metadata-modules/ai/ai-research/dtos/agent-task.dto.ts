import { Field, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';

import { AgentTaskStatus } from 'src/engine/metadata-modules/ai/ai-research/types/agent-task-status.type';

registerEnumType(AgentTaskStatus, { name: 'AgentTaskStatus' });

@ObjectType('AgentTask')
export class AgentTaskDTO {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  objectNameSingular: string;

  @Field(() => ID)
  recordId: string;

  @Field(() => ID)
  agentId: string;

  @Field(() => String)
  reason: string;

  @Field(() => Int)
  priority: number;

  @Field(() => AgentTaskStatus)
  status: AgentTaskStatus;

  @Field(() => Date)
  dueAt: Date;

  @Field(() => Int)
  attempts: number;

  @Field(() => Int)
  maxAttempts: number;

  @Field(() => String, { nullable: true })
  outcome: string | null;

  @Field(() => Date)
  createdAt: Date;
}
