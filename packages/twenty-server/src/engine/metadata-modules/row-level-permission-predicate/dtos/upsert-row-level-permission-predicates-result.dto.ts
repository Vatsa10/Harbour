// SeaRM — AGPL-3.0. Clean-room reimplementation of the row-level-permission
// predicate upsert result DTO (no Twenty Enterprise source consulted).
// Returns the full set of predicates/groups written by the upsert mutation
// so the caller can reconcile client-side state without a refetch.

import { Field, ObjectType } from '@nestjs/graphql';

import { RowLevelPermissionPredicateGroupDTO } from 'src/engine/metadata-modules/row-level-permission-predicate/dtos/row-level-permission-predicate-group.dto';
import { RowLevelPermissionPredicateDTO } from 'src/engine/metadata-modules/row-level-permission-predicate/dtos/row-level-permission-predicate.dto';

@ObjectType('UpsertRowLevelPermissionPredicatesResult')
export class UpsertRowLevelPermissionPredicatesResultDTO {
  @Field(() => [RowLevelPermissionPredicateDTO])
  predicates: RowLevelPermissionPredicateDTO[];

  @Field(() => [RowLevelPermissionPredicateGroupDTO])
  predicateGroups: RowLevelPermissionPredicateGroupDTO[];
}
