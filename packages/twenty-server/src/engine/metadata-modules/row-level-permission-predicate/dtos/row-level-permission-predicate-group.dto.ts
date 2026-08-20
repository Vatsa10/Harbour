// SeaRM — AGPL-3.0. Clean-room reimplementation of the row-level-permission
// predicate group GraphQL DTO (no Twenty Enterprise source consulted).
// Field set mirrors the AGPL FlatRowLevelPermissionPredicateGroup type in
// ../types/flat-row-level-permission-predicate-group.type.ts, following the
// sibling ViewFilterGroupDTO shape.

import { Field, ObjectType, registerEnumType } from '@nestjs/graphql';
import { RowLevelPermissionPredicateGroupLogicalOperator } from 'twenty-shared/types';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';

registerEnumType(RowLevelPermissionPredicateGroupLogicalOperator, {
  name: 'RowLevelPermissionPredicateGroupLogicalOperator',
});

@ObjectType('RowLevelPermissionPredicateGroup')
export class RowLevelPermissionPredicateGroupDTO {
  @Field(() => UUIDScalarType)
  id: string;

  @Field(() => UUIDScalarType, { nullable: false })
  objectMetadataId: string;

  @Field(() => UUIDScalarType, { nullable: false })
  roleId: string;

  @Field(() => RowLevelPermissionPredicateGroupLogicalOperator, {
    nullable: false,
  })
  logicalOperator: RowLevelPermissionPredicateGroupLogicalOperator;

  @Field(() => UUIDScalarType, { nullable: true })
  parentRowLevelPermissionPredicateGroupId?: string | null;

  @Field(() => Number, { nullable: true })
  positionInRowLevelPermissionPredicateGroup?: number | null;

  @Field(() => UUIDScalarType, { nullable: true })
  workspaceId?: string;

  @Field(() => Date, { nullable: true })
  createdAt?: Date;

  @Field(() => Date, { nullable: true })
  updatedAt?: Date;

  @Field(() => Date, { nullable: true })
  deletedAt?: Date | null;
}
