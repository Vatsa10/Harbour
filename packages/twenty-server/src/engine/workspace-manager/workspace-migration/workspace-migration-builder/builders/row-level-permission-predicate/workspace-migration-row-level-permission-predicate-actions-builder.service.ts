// SeaRM — AGPL-3.0. Clean-room reimplementation of the row-level-permission
// predicate workspace-migration actions builder (no Twenty Enterprise source
// consulted; derived from the sibling viewFilter actions builder service).

import { Injectable } from '@nestjs/common';

import { ALL_METADATA_NAME } from 'twenty-shared/metadata';

import { UniversalUpdateRowLevelPermissionPredicateAction } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/builders/row-level-permission-predicate/types/workspace-migration-row-level-permission-predicate-action.type';
import { WorkspaceEntityMigrationBuilderService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/services/workspace-entity-migration-builder.service';
import { FlatEntityUpdateValidationArgs } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/types/universal-flat-entity-update-validation-args.type';
import { UniversalFlatEntityValidationArgs } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/types/universal-flat-entity-validation-args.type';
import { UniversalFlatEntityValidationReturnType } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/types/universal-flat-entity-validation-result.type';
import { FlatRowLevelPermissionPredicateValidatorService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/validators/services/flat-row-level-permission-predicate-validator.service';

@Injectable()
export class WorkspaceMigrationRowLevelPermissionPredicateActionsBuilderService extends WorkspaceEntityMigrationBuilderService<
  typeof ALL_METADATA_NAME.rowLevelPermissionPredicate
> {
  constructor(
    private readonly flatRowLevelPermissionPredicateValidatorService: FlatRowLevelPermissionPredicateValidatorService,
  ) {
    super(ALL_METADATA_NAME.rowLevelPermissionPredicate);
  }

  protected validateFlatEntityCreation(
    args: UniversalFlatEntityValidationArgs<
      typeof ALL_METADATA_NAME.rowLevelPermissionPredicate
    >,
  ): UniversalFlatEntityValidationReturnType<
    typeof ALL_METADATA_NAME.rowLevelPermissionPredicate,
    'create'
  > {
    const validationResult =
      this.flatRowLevelPermissionPredicateValidatorService.validateFlatRowLevelPermissionPredicateCreation(
        args,
      );

    if (validationResult.errors.length > 0) {
      return {
        status: 'fail',
        ...validationResult,
      };
    }

    const { flatEntityToValidate: flatRowLevelPermissionPredicateToValidate } =
      args;

    return {
      status: 'success',
      action: {
        type: 'create',
        metadataName: 'rowLevelPermissionPredicate',
        flatEntity: flatRowLevelPermissionPredicateToValidate,
      },
    };
  }

  protected validateFlatEntityDeletion(
    args: UniversalFlatEntityValidationArgs<
      typeof ALL_METADATA_NAME.rowLevelPermissionPredicate
    >,
  ): UniversalFlatEntityValidationReturnType<
    typeof ALL_METADATA_NAME.rowLevelPermissionPredicate,
    'delete'
  > {
    const validationResult =
      this.flatRowLevelPermissionPredicateValidatorService.validateFlatRowLevelPermissionPredicateDeletion(
        args,
      );

    if (validationResult.errors.length > 0) {
      return {
        status: 'fail',
        ...validationResult,
      };
    }

    const { flatEntityToValidate: flatRowLevelPermissionPredicateToValidate } =
      args;

    return {
      status: 'success',
      action: {
        type: 'delete',
        metadataName: 'rowLevelPermissionPredicate',
        universalIdentifier:
          flatRowLevelPermissionPredicateToValidate.universalIdentifier,
      },
    };
  }

  protected validateFlatEntityUpdate(
    args: FlatEntityUpdateValidationArgs<
      typeof ALL_METADATA_NAME.rowLevelPermissionPredicate
    >,
  ): UniversalFlatEntityValidationReturnType<
    typeof ALL_METADATA_NAME.rowLevelPermissionPredicate,
    'update'
  > {
    const validationResult =
      this.flatRowLevelPermissionPredicateValidatorService.validateFlatRowLevelPermissionPredicateUpdate(
        args,
      );

    if (validationResult.errors.length > 0) {
      return {
        status: 'fail',
        ...validationResult,
      };
    }

    const { universalIdentifier, flatEntityUpdate } = args;

    const updateRowLevelPermissionPredicateAction: UniversalUpdateRowLevelPermissionPredicateAction =
      {
        type: 'update',
        metadataName: 'rowLevelPermissionPredicate',
        universalIdentifier,
        update: flatEntityUpdate,
      };

    return {
      status: 'success',
      action: updateRowLevelPermissionPredicateAction,
    };
  }
}
