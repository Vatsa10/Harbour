// SeaRM — AGPL-3.0. Clean-room reimplementation of the row-level-permission
// predicate GraphQL DTO (no Twenty Enterprise source consulted). Field set
// mirrors the AGPL FlatRowLevelPermissionPredicate type in
// ../types/flat-row-level-permission-predicate.type.ts, following the
// sibling ViewFilterDTO shape.

import { Field, ObjectType, registerEnumType } from '@nestjs/graphql';
import GraphQLJSON from 'graphql-type-json';
import {
  RowLevelPermissionPredicateOperand,
  type RowLevelPermissionPredicateValue,
} from 'twenty-shared/types';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';

registerEnumType(RowLevelPermissionPredicateOperand, {
  name: 'RowLevelPermissionPredicateOperand',
});

@ObjectType('RowLevelPermissionPredicate')
export class RowLevelPermissionPredicateDTO {
  @Field(() => UUIDScalarType)
  id: string;

  @Field(() => UUIDScalarType, { nullable: false })
  objectMetadataId: string;

  @Field(() => UUIDScalarType, { nullable: false })
  roleId: string;

  @Field(() => UUIDScalarType, { nullable: false })
  fieldMetadataId: string;

  @Field(() => RowLevelPermissionPredicateOperand, {
    nullable: false,
    defaultValue: RowLevelPermissionPredicateOperand.CONTAINS,
  })
  operand: RowLevelPermissionPredicateOperand;

  @Field(() => GraphQLJSON, { nullable: true })
  value: RowLevelPermissionPredicateValue | null;

  @Field(() => String, { nullable: true })
  subFieldName?: string | null;

  @Field(() => UUIDScalarType, { nullable: true })
  workspaceMemberFieldMetadataId?: string | null;

  @Field(() => String, { nullable: true })
  workspaceMemberSubFieldName?: string | null;

  @Field(() => UUIDScalarType, { nullable: true })
  rowLevelPermissionPredicateGroupId?: string | null;

  @Field(() => Number, { nullable: true })
  positionInRowLevelPermissionPredicateGroup?: number | null;

  @Field(() => UUIDScalarType, { nullable: true })
  workspaceId?: string;

  @Field({ nullable: true })
  createdAt?: Date;

  @Field({ nullable: true })
  updatedAt?: Date;

  @Field(() => Date, { nullable: true })
  deletedAt?: Date | null;
}
