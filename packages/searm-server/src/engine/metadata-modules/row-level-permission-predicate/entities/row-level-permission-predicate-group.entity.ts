// SeaRM — AGPL-3.0. Clean-room reimplementation of the row-level-permission
// predicate group core entity (no SeaRM Enterprise source consulted).
// Column set, types, nullability, defaults and index names are reverse
// derived from introspecting the live `core."rowLevelPermissionPredicateGroup"`
// table (schema facts are not copyrightable expression) and from the AGPL
// FlatRowLevelPermissionPredicateGroup type / relation-constant metadata in
// src/engine/metadata-modules/flat-entity/constant/, which fix the relation
// and foreign-key shape this entity must expose.

import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';

import { RowLevelPermissionPredicateGroupLogicalOperator } from 'searm-shared/types';

import { type ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { type RoleEntity } from 'src/engine/metadata-modules/role/role.entity';
import { type RowLevelPermissionPredicateEntity } from 'src/engine/metadata-modules/row-level-permission-predicate/entities/row-level-permission-predicate.entity';
import { SyncableEntity } from 'src/engine/workspace-manager/types/syncable-entity.interface';

@Entity({ name: 'rowLevelPermissionPredicateGroup', schema: 'core' })
@Index('IDX_RLPPG_PARENT_GROUP_ID', [
  'parentRowLevelPermissionPredicateGroupId',
])
@Index('IDX_RLPPG_WORKSPACE_ID_ROLE_ID_OBJECT_METADATA_ID', [
  'workspaceId',
  'roleId',
  'objectMetadataId',
])
export class RowLevelPermissionPredicateGroupEntity extends SyncableEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: false, type: 'uuid' })
  objectMetadataId: string;

  @ManyToOne('ObjectMetadataEntity', {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'objectMetadataId' })
  objectMetadata: Relation<ObjectMetadataEntity>;

  @Column({ nullable: false, type: 'uuid' })
  roleId: string;

  @ManyToOne('RoleEntity', (role: RoleEntity) => role.rowLevelPermissionPredicateGroups, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'roleId' })
  role: Relation<RoleEntity>;

  @Column({
    nullable: false,
    type: 'enum',
    enum: Object.values(RowLevelPermissionPredicateGroupLogicalOperator),
    default: RowLevelPermissionPredicateGroupLogicalOperator.AND,
  })
  logicalOperator: RowLevelPermissionPredicateGroupLogicalOperator;

  @Column({ nullable: true, type: 'uuid' })
  parentRowLevelPermissionPredicateGroupId: string | null;

  @ManyToOne(
    () => RowLevelPermissionPredicateGroupEntity,
    (rowLevelPermissionPredicateGroup) =>
      rowLevelPermissionPredicateGroup.childRowLevelPermissionPredicateGroups,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'parentRowLevelPermissionPredicateGroupId' })
  parentRowLevelPermissionPredicateGroup: Relation<RowLevelPermissionPredicateGroupEntity> | null;

  @OneToMany(
    () => RowLevelPermissionPredicateGroupEntity,
    (rowLevelPermissionPredicateGroup) =>
      rowLevelPermissionPredicateGroup.parentRowLevelPermissionPredicateGroup,
  )
  childRowLevelPermissionPredicateGroups: Relation<
    RowLevelPermissionPredicateGroupEntity[]
  >;

  @Column({ nullable: true, type: 'double precision' })
  positionInRowLevelPermissionPredicateGroup: number | null;

  @OneToMany(
    'RowLevelPermissionPredicateEntity',
    (rowLevelPermissionPredicate: RowLevelPermissionPredicateEntity) =>
      rowLevelPermissionPredicate.rowLevelPermissionPredicateGroup,
  )
  rowLevelPermissionPredicates: Relation<RowLevelPermissionPredicateEntity[]>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt: Date | null;
}
