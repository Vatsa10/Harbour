import { Field, InputType, ObjectType } from '@nestjs/graphql';

import { ArrayMaxSize, IsArray, IsString } from 'class-validator';

// An unbounded list would be pasted into as a spam-filter substitute and then
// scanned on every ingested participant.
const MAX_SUPPRESSION_ENTRIES = 5000;

@ObjectType('IngestionSuppression')
export class IngestionSuppressionDTO {
  @Field(() => [String])
  suppressedDomains: string[];

  @Field(() => [String])
  suppressedEmails: string[];
}

@InputType()
export class UpdateIngestionSuppressionInput {
  @Field(() => [String])
  @IsArray()
  @ArrayMaxSize(MAX_SUPPRESSION_ENTRIES)
  @IsString({ each: true })
  suppressedDomains: string[];

  @Field(() => [String])
  @IsArray()
  @ArrayMaxSize(MAX_SUPPRESSION_ENTRIES)
  @IsString({ each: true })
  suppressedEmails: string[];
}
