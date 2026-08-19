// SeaRM — AGPL-3.0. Clean-room reimplementation of the row-level-permission
// predicate group workspace-migration action types (no Twenty Enterprise
// source consulted; derived from the sibling viewFilterGroup migration
// action types and the AGPL flat-row-level-permission-predicate mappers).

import { type BaseFlatCreateWorkspaceMigrationAction } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/types/base-flat-create-workspace-migration-action.type';
import { type BaseFlatDeleteWorkspaceMigrationAction } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/types/base-flat-delete-workspace-migration-action.type';
import { type BaseFlatUpdateWorkspaceMigrationAction } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/types/base-flat-update-workspace-migration-action.type';
import { type BaseUniversalCreateWorkspaceMigrationAction } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/types/base-universal-create-workspace-migration-action.type';
import { type BaseUniversalDeleteWorkspaceMigrationAction } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/types/base-universal-delete-workspace-migration-action.type';
import { type BaseUniversalUpdateWorkspaceMigrationAction } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/types/base-universal-update-workspace-migration-action.type';

export type UniversalCreateRowLevelPermissionPredicateGroupAction =
  BaseUniversalCreateWorkspaceMigrationAction<'rowLevelPermissionPredicateGroup'>;

export type FlatCreateRowLevelPermissionPredicateGroupAction =
  BaseFlatCreateWorkspaceMigrationAction<'rowLevelPermissionPredicateGroup'>;

export type FlatUpdateRowLevelPermissionPredicateGroupAction =
  BaseFlatUpdateWorkspaceMigrationAction<'rowLevelPermissionPredicateGroup'>;

export type UniversalUpdateRowLevelPermissionPredicateGroupAction =
  BaseUniversalUpdateWorkspaceMigrationAction<'rowLevelPermissionPredicateGroup'>;

export type UniversalDeleteRowLevelPermissionPredicateGroupAction =
  BaseUniversalDeleteWorkspaceMigrationAction<'rowLevelPermissionPredicateGroup'>;

export type FlatDeleteRowLevelPermissionPredicateGroupAction =
  BaseFlatDeleteWorkspaceMigrationAction<'rowLevelPermissionPredicateGroup'>;
