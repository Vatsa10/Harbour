import { Field, Int, ObjectType } from '@nestjs/graphql';

import GraphQLJSON from 'graphql-type-json';

@ObjectType()
export class EventLogRecord {
  @Field(() => String)
  event: string;

  @Field(() => Date)
  timestamp: Date;

  @Field(() => String, { nullable: true })
  userId?: string;

  @Field(() => GraphQLJSON, { nullable: true })
  properties?: Record<string, unknown>;

  @Field(() => String, { nullable: true })
  recordId?: string;

  @Field(() => String, { nullable: true })
  objectMetadataId?: string;

  @Field(() => Boolean, { nullable: true })
  isCustom?: boolean;

  // SeaRM Principal-contract addition: derived, non-breaking. Distinguishes
  // human/API-key/AI-agent/system-originated events. Backfilled from
  // `properties.actorKind` when the emitter recorded one, else inferred from
  // `userId` presence. See event-logs-spec.md "Principal contract" section.
  @Field(() => String, { nullable: true })
  actorKind?: string;

  // SeaRM Principal-contract addition: derived, non-breaking. Set only when
  // the emitter recorded `properties.proposalId` (e.g. an AI-agent change
  // that went through proposal/approval). No ClickHouse schema change.
  @Field(() => String, { nullable: true })
  proposalReference?: string;
}

@ObjectType()
export class EventLogPageInfo {
  @Field(() => String, { nullable: true })
  endCursor?: string;

  @Field(() => Boolean)
  hasNextPage: boolean;
}

@ObjectType()
export class EventLogQueryResult {
  @Field(() => [EventLogRecord])
  records: EventLogRecord[];

  @Field(() => Int)
  totalCount: number;

  @Field(() => EventLogPageInfo)
  pageInfo: EventLogPageInfo;
}
