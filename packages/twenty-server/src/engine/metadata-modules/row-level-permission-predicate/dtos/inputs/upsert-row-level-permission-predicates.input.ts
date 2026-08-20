// SeaRM — AGPL-3.0. Clean-room reimplementation of the row-level-permission
// predicate upsert input DTOs (no Twenty Enterprise source consulted).
// Field set derived from the AGPL flat mappers in
// flat-row-level-permission-predicate/utils/from-{create,update}-*, which
// construct FlatRowLevelPermissionPredicate(Group) from exactly these
// input fields, and from the sibling CreateViewFilterInput pattern.

import { Field, HideField, InputType } from '@nestjs/graphql';

import {
  IsDefined,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import GraphQLJSON from 'graphql-type-json';
import {
  RowLevelPermissionPredicateGroupLogicalOperator,
  RowLevelPermissionPredicateOperand,
  type RowLevelPermissionPredicateValue,
} from 'twenty-shared/types';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';

@InputType()
export class RowLevelPermissionPredicateInput {
  @IsOptional()
  @IsUUID()
  @Field(() => UUIDScalarType, { nullable: true })
  id?: string;

  @IsUUID()
  @Field(() => UUIDScalarType, { nullable: false })
  fieldMetadataId: string;

  @IsEnum(RowLevelPermissionPredicateOperand)
  @Field(() => RowLevelPermissionPredicateOperand, { nullable: false })
  operand: RowLevelPermissionPredicateOperand;

  @IsOptional()
  @IsDefined()
  @Field(() => GraphQLJSON, { nullable: true })
  value?: RowLevelPermissionPredicateValue | null;

  @IsOptional()
  @IsString()
  @Field({ nullable: true })
  subFieldName?: string;

  @IsOptional()
  @IsUUID()
  @Field(() => UUIDScalarType, { nullable: true })
  workspaceMemberFieldMetadataId?: string;

  @IsOptional()
  @IsString()
  @Field({ nullable: true })
  workspaceMemberSubFieldName?: string;

  @IsOptional()
  @IsUUID()
  @Field(() => UUIDScalarType, { nullable: true })
  rowLevelPermissionPredicateGroupId?: string;

  @IsOptional()
  @IsNumber()
  @Field({ nullable: true })
  positionInRowLevelPermissionPredicateGroup?: number;

  @HideField()
  universalIdentifier?: string;

  @HideField()
  applicationId?: string;
}

@InputType()
export class RowLevelPermissionPredicateGroupInput {
  @IsOptional()
  @IsUUID()
  @Field(() => UUIDScalarType, { nullable: true })
  id?: string;

  @IsUUID()
  @Field(() => UUIDScalarType, { nullable: false })
  objectMetadataId: string;

  @IsEnum(RowLevelPermissionPredicateGroupLogicalOperator)
  @Field(() => RowLevelPermissionPredicateGroupLogicalOperator, {
    nullable: false,
  })
  logicalOperator: RowLevelPermissionPredicateGroupLogicalOperator;

  @IsOptional()
  @IsUUID()
  @Field(() => UUIDScalarType, { nullable: true })
  parentRowLevelPermissionPredicateGroupId?: string;

  @IsOptional()
  @IsNumber()
  @Field({ nullable: true })
  positionInRowLevelPermissionPredicateGroup?: number;

  @HideField()
  universalIdentifier?: string;

  @HideField()
  applicationId?: string;
}

@InputType()
export class UpsertRowLevelPermissionPredicatesInput {
  @IsUUID()
  @Field(() => UUIDScalarType, { nullable: false })
  roleId: string;

  @IsUUID()
  @Field(() => UUIDScalarType, { nullable: false })
  objectMetadataId: string;

  @IsDefined()
  @ValidateNested({ each: true })
  @Type(() => RowLevelPermissionPredicateInput)
  @Field(() => [RowLevelPermissionPredicateInput], { nullable: false })
  predicates: RowLevelPermissionPredicateInput[];

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => RowLevelPermissionPredicateGroupInput)
  @Field(() => [RowLevelPermissionPredicateGroupInput], { nullable: true })
  predicateGroups?: RowLevelPermissionPredicateGroupInput[];
}
