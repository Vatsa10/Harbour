import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-type-json';

import {
  ProposalActionType,
  ProposalItemStatus,
  ProposalStatus,
} from 'src/engine/metadata-modules/ai/ai-write-approval/types/proposal-status.type';

registerEnumType(ProposalStatus, { name: 'ProposalStatus' });
registerEnumType(ProposalItemStatus, { name: 'ProposalItemStatus' });
registerEnumType(ProposalActionType, { name: 'ProposalActionType' });

@ObjectType('ProposalItem')
export class ProposalItemDTO {
  @Field(() => ID)
  id: string;

  @Field(() => ProposalActionType)
  actionType: ProposalActionType;

  @Field(() => String, { nullable: true })
  objectNameSingular: string | null;

  @Field(() => ID, { nullable: true })
  recordId: string | null;

  @Field(() => GraphQLJSON)
  payload: Record<string, unknown>;

  @Field(() => GraphQLJSON)
  baseline: Record<string, unknown>;

  @Field(() => ProposalItemStatus)
  status: ProposalItemStatus;

  @Field(() => String, { nullable: true })
  error: string | null;
}

@ObjectType('Proposal')
export class ProposalDTO {
  @Field(() => ID)
  id: string;

  @Field(() => ProposalStatus)
  status: ProposalStatus;

  @Field(() => String, { nullable: true })
  reason: string | null;

  @Field(() => Date)
  expiresAt: Date;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => [ProposalItemDTO])
  items: ProposalItemDTO[];
}

@ObjectType('ApprovalResult')
export class ApprovalResultDTO {
  @Field(() => ID)
  proposalId: string;

  @Field(() => [ID])
  appliedItemIds: string[];

  @Field(() => [ID])
  conflictedItemIds: string[];

  @Field(() => [ID])
  failedItemIds: string[];

  @Field(() => Boolean)
  aborted: boolean;
}
