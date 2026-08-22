import { Field, GraphQLISODateTime, ID, ObjectType } from '@nestjs/graphql';
import GraphQLJSON from 'graphql-type-json';

import { type BriefSections } from 'src/engine/metadata-modules/ai/ai-research/types/record-brief.type';

@ObjectType('RecordBrief')
export class RecordBriefDTO {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  objectNameSingular: string;

  @Field(() => ID)
  recordId: string;

  @Field(() => String)
  narrative: string;

  @Field(() => GraphQLJSON)
  sections: BriefSections;

  @Field(() => [ID])
  factIds: string[];

  @Field(() => GraphQLISODateTime)
  oldestObservedAt: Date;

  @Field(() => GraphQLISODateTime)
  refreshedAt: Date;
}

// The result of asking for a brief. `brief` null with `refusalReason` set is
// the success case the whole feature is built around: nothing was worth
// saying, so nothing was said. The client renders absence, not an error.
@ObjectType('RecordBriefGenerationResult')
export class RecordBriefGenerationResultDTO {
  @Field(() => RecordBriefDTO, { nullable: true })
  brief: RecordBriefDTO | null;

  @Field(() => String, { nullable: true })
  refusalReason: string | null;
}
