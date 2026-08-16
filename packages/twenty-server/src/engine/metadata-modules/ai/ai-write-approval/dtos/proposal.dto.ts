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

// A fact and its primary evidence, flattened. sourceType and strength are
// String, not GraphQL enums: EvidenceSourceType is a seven-member string
// union owned by Phase 2 Task 1, and Phase 3 adds writers for three of them,
// so a mirror enum here is a runtime error waiting for its first ingestion
// proposal. This mirrors what the DTO already does for toolId and error.
@ObjectType('ProposalItemFact')
export class ProposalItemFactDTO {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  fieldName: string;

  @Field(() => String)
  strength: string;

  @Field(() => Boolean)
  hasConflict: boolean;

  @Field(() => String, { nullable: true })
  sourceType: string | null;

  @Field(() => String, { nullable: true })
  sourceLocator: string | null;

  @Field(() => Date, { nullable: true })
  observedAt: Date | null;
}

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

  @Field(() => String, { nullable: true })
  toolId: string | null;

  @Field(() => GraphQLJSON)
  payload: Record<string, unknown>;

  @Field(() => GraphQLJSON)
  baseline: Record<string, unknown>;

  @Field(() => ProposalItemStatus)
  status: ProposalItemStatus;

  @Field(() => String, { nullable: true })
  error: string | null;

  @Field(() => [ID])
  factIds: string[];

  // Populated by ProposalItemFieldsResolver. Declared on the type rather
  // than only on the resolver so a missing citation reads as an empty list,
  // never as an unknown-field query error in the approval inbox.
  @Field(() => [ProposalItemFactDTO])
  facts: ProposalItemFactDTO[];
}

@ObjectType('Proposal')
export class ProposalDTO {
  @Field(() => ID)
  id: string;

  @Field(() => ProposalStatus)
  status: ProposalStatus;

  @Field(() => Date)
  expiresAt: Date;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => [ProposalItemDTO])
  items: ProposalItemDTO[];
}

// Why each failed item failed. failedItemIds alone tells an approver that
// something did not apply but never what to do about it, and the reason
// otherwise only exists on a proposalItem row the inbox has already closed.
@ObjectType('ApprovalFailure')
export class ApprovalFailureDTO {
  @Field(() => ID)
  itemId: string;

  @Field(() => String)
  error: string;
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

  @Field(() => [ApprovalFailureDTO])
  failures: ApprovalFailureDTO[];

  @Field(() => Boolean)
  aborted: boolean;
}
