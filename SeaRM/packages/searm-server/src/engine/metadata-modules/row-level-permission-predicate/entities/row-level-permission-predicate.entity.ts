// SeaRM — AGPL-3.0. Clean-room reimplementation of the row-level-permission
// predicate core entity (no SeaRM Enterprise source consulted). Column
// set, types, nullability, defaults and index names are reverse derived
// from introspecting the live `core."rowLevelPermissionPredicate"` table
// (schema facts are not copyrightable expression) and from the AGPL
// FlatRowLevelPermissionPredicate type / relation-constant metadata in
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
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';

import { RowLevelPermissionPredicateOperand } from 'searm-shared/types';
import { type RowLevelPermissionPredicateValue } from 'searm-shared/types';

import { type FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { type ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { type RoleEntity } from 'src/engine/metadata-modules/role/role.entity';
import { RowLevelPermissionPredicateGroupEntity } from 'src/engine/metadata-modules/row-level-permission-predicate/entities/row-level-permission-predicate-group.entity';
import { type JsonbProperty } from 'src/engine/workspace-manager/workspace-migration/universal-flat-entity/types/jsonb-property.type';
import { SyncableEntity } from 'src/engine/workspace-manager/types/syncable-entity.interface';

@Entity({ name: 'rowLevelPermissionPredicate', schema: 'core' })
@Index('IDX_RLPP_FIELD_METADATA_ID', ['fieldMetadataId'])
@Index('IDX_RLPP_GROUP_ID', ['rowLevelPermissionPredicateGroupId'])
@Index('IDX_RLPP_WORKSPACE_ID_ROLE_ID_OBJECT_METADATA_ID', [
  'workspaceId',
  'roleId',
  'objectMetadataId',
])
@Index('IDX_RLPP_WORKSPACE_MEMBER_FIELD_METADATA_ID', [
  'workspaceMemberFieldMetadataId',
])
export class RowLevelPermissionPredicateEntity extends SyncableEntity {
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

  @ManyToOne(
    'RoleEntity',
    (role: RoleEntity) => role.rowLevelPermissionPredicates,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'roleId' })
  role: Relation<RoleEntity>;

  @Column({ nullable: false, type: 'uuid' })
  fieldMetadataId: string;

  @ManyToOne('FieldMetadataEntity', {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'fieldMetadataId' })
  fieldMetadata: Relation<FieldMetadataEntity>;

  @Column({
    nullable: false,
    type: 'enum',
    enum: Object.values(RowLevelPermissionPredicateOperand),
    default: RowLevelPermissionPredicateOperand.CONTAINS,
  })
  operand: RowLevelPermissionPredicateOperand;

  @Column({ nullable: true, type: 'jsonb', default: null })
  value: JsonbProperty<RowLevelPermissionPredicateValue> | null;

  @Column({ nullable: true, type: 'text', default: null })
  subFieldName: string | null;

  @Column({ nullable: true, type: 'uuid', default: null })
  workspaceMemberFieldMetadataId: string | null;

  @ManyToOne('FieldMetadataEntity', {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'workspaceMemberFieldMetadataId' })
  workspaceMemberFieldMetadata: Relation<FieldMetadataEntity> | null;

  @Column({ nullable: true, type: 'text', default: null })
  workspaceMemberSubFieldName: string | null;

  @Column({ nullable: true, type: 'uuid', default: null })
  rowLevelPermissionPredicateGroupId: string | null;

  @ManyToOne(
    () => RowLevelPermissionPredicateGroupEntity,
    (rowLevelPermissionPredicateGroup) =>
      rowLevelPermissionPredicateGroup.rowLevelPermissionPredicates,
    { onDelete: 'CASCADE', nullable: true },
  )
  @JoinColumn({ name: 'rowLevelPermissionPredicateGroupId' })
  rowLevelPermissionPredicateGroup: Relation<RowLevelPermissionPredicateGroupEntity> | null;

  @Column({ nullable: true, type: 'double precision' })
  positionInRowLevelPermissionPredicateGroup: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt: Date | null;
}
