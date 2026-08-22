import { Field, Float, Int, ObjectType } from '@nestjs/graphql';

@ObjectType('AiTrustCountByKey')
export class AiTrustCountByKeyDTO {
  @Field(() => String)
  key: string;

  @Field(() => Int)
  count: number;
}

@ObjectType('AiSpendBucket')
export class AiSpendBucketDTO {
  // Start of the bucket, truncated by the requested period.
  @Field(() => Date)
  periodStart: Date;

  @Field(() => Int)
  runCount: number;

  // Float, not Int: GraphQL Int is a signed 32-bit value and a busy workspace
  // aggregating a month of tokens will pass 2.1 billion. An overflow here
  // would surface as a serialization error on the cost chart, which is the
  // one number a buyer checks twice.
  @Field(() => Float)
  inputTokens: number;

  @Field(() => Float)
  outputTokens: number;

  // Micro-credits are what AgentRun stores (bigint). Exposed as a string so
  // no precision is lost in transit, alongside the divided-out Float the UI
  // actually plots.
  @Field(() => String)
  creditsUsedMicro: string;

  @Field(() => Float)
  creditsUsed: number;
}

@ObjectType('AiTrustDashboard')
export class AiTrustDashboardDTO {
  // CURRENT facts grouped by the source type of their originating evidence.
  @Field(() => [AiTrustCountByKeyDTO])
  factsBySourceType: AiTrustCountByKeyDTO[];

  // CURRENT facts grouped by how recently the world was observed.
  @Field(() => [AiTrustCountByKeyDTO])
  factFreshness: AiTrustCountByKeyDTO[];

  @Field(() => Int)
  currentFactCount: number;

  @Field(() => Int)
  conflictedFactCount: number;

  // ProposalItem terminal outcomes — the human verdict on what the AI drafted.
  // Item-level, not proposal-level: a reviewer approves some items of a batch
  // and rejects others, and a proposal-level rollup would hide that.
  @Field(() => [AiTrustCountByKeyDTO])
  proposalItemOutcomes: AiTrustCountByKeyDTO[];

  @Field(() => [AiSpendBucketDTO])
  spendByPeriod: AiSpendBucketDTO[];
}
