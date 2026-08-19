// SeaRM — AGPL-3.0. Clean-room reimplementation of the row-level-permission
// predicate group flat-entity validator (no Twenty Enterprise source
// consulted; derived from the sibling flat-view-filter-group validator
// service's circular-dependency pattern and the AGPL
// flat-row-level-permission-predicate mappers which fix the field shape of
// FlatRowLevelPermissionPredicateGroup).

import { Injectable } from '@nestjs/common';

import { msg, t } from '@lingui/core/macro';
import { ALL_METADATA_NAME } from 'twenty-shared/metadata';
import { isDefined } from 'twenty-shared/utils';

import { findFlatEntityByUniversalIdentifier } from 'src/engine/metadata-modules/flat-entity/utils/find-flat-entity-by-universal-identifier.util';
import { type MetadataUniversalFlatEntityMaps } from 'src/engine/workspace-manager/workspace-migration/universal-flat-entity/types/metadata-universal-flat-entity-maps.type';
import { validateFlatEntityCircularDependency } from 'src/engine/workspace-manager/workspace-migration/utils/validate-flat-entity-circular-dependency.util';
import {
  type FailedFlatEntityValidation,
  type FlatEntityValidationError,
} from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/builders/types/failed-flat-entity-validation.type';
import { getEmptyFlatEntityValidationError } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/builders/utils/get-flat-entity-validation-error.util';
import { type FlatEntityUpdateValidationArgs } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/types/universal-flat-entity-update-validation-args.type';
import { type UniversalFlatEntityValidationArgs } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/types/universal-flat-entity-validation-args.type';

// Local exception codes: see flat-row-level-permission-predicate-validator
// .service.ts for why these are not reused from the upstream Enterprise-
// headered exception file.
export enum WorkspaceMigrationRowLevelPermissionPredicateGroupExceptionCode {
  ROW_LEVEL_PERMISSION_PREDICATE_GROUP_ALREADY_EXISTS = 'ROW_LEVEL_PERMISSION_PREDICATE_GROUP_ALREADY_EXISTS',
  ROW_LEVEL_PERMISSION_PREDICATE_GROUP_NOT_FOUND = 'ROW_LEVEL_PERMISSION_PREDICATE_GROUP_NOT_FOUND',
  INVALID_ROW_LEVEL_PERMISSION_PREDICATE_GROUP_DATA = 'INVALID_ROW_LEVEL_PERMISSION_PREDICATE_GROUP_DATA',
  CIRCULAR_DEPENDENCY = 'CIRCULAR_DEPENDENCY',
  MAX_DEPTH_EXCEEDED = 'MAX_DEPTH_EXCEEDED',
}

// Predicate groups combine child predicates/groups with an AND/OR operator,
// mirroring the view-filter-group nesting model; capped at two levels (root
// and one child level) for the same reason: unbounded nesting makes the
// deny-by-default evaluation at query time unauditable.
const ROW_LEVEL_PERMISSION_PREDICATE_GROUP_MAX_DEPTH = 2;

@Injectable()
export class FlatRowLevelPermissionPredicateGroupValidatorService {
  constructor() {}

  private getCircularDependencyValidationErrors({
    rowLevelPermissionPredicateGroupUniversalIdentifier,
    parentRowLevelPermissionPredicateGroupUniversalIdentifier,
    flatRowLevelPermissionPredicateGroupMaps,
  }: {
    rowLevelPermissionPredicateGroupUniversalIdentifier: string;
    parentRowLevelPermissionPredicateGroupUniversalIdentifier: string;
    flatRowLevelPermissionPredicateGroupMaps: MetadataUniversalFlatEntityMaps<'rowLevelPermissionPredicateGroup'>;
  }): FlatEntityValidationError<WorkspaceMigrationRowLevelPermissionPredicateGroupExceptionCode>[] {
    const circularDependencyResult = validateFlatEntityCircularDependency({
      flatEntityUniversalIdentifier:
        rowLevelPermissionPredicateGroupUniversalIdentifier,
      flatEntityParentUniversalIdentifier:
        parentRowLevelPermissionPredicateGroupUniversalIdentifier,
      maxDepth: ROW_LEVEL_PERMISSION_PREDICATE_GROUP_MAX_DEPTH,
      parentUniversalIdentifierKey:
        'parentRowLevelPermissionPredicateGroupUniversalIdentifier',
      flatEntityMaps: flatRowLevelPermissionPredicateGroupMaps,
    });

    if (circularDependencyResult.status === 'success') {
      return [];
    }

    switch (circularDependencyResult.reason) {
      case 'self_reference':
        return [
          {
            code: WorkspaceMigrationRowLevelPermissionPredicateGroupExceptionCode.CIRCULAR_DEPENDENCY,
            message: t`Row level permission predicate group cannot be its own parent`,
            userFriendlyMessage: msg`Row level permission predicate group cannot be its own parent`,
          },
        ];
      case 'circular_dependency':
        return [
          {
            code: WorkspaceMigrationRowLevelPermissionPredicateGroupExceptionCode.CIRCULAR_DEPENDENCY,
            message: t`Circular dependency detected in row level permission predicate group hierarchy`,
            userFriendlyMessage: msg`Circular dependency detected in row level permission predicate group hierarchy`,
          },
        ];
      case 'max_depth_exceeded':
        return [
          {
            code: WorkspaceMigrationRowLevelPermissionPredicateGroupExceptionCode.MAX_DEPTH_EXCEEDED,
            message: t`Row level permission predicate group hierarchy exceeds maximum depth of ${ROW_LEVEL_PERMISSION_PREDICATE_GROUP_MAX_DEPTH}`,
            userFriendlyMessage: msg`Row level permission predicate group hierarchy exceeds maximum depth of ${ROW_LEVEL_PERMISSION_PREDICATE_GROUP_MAX_DEPTH}`,
          },
        ];
    }
  }

  validateFlatRowLevelPermissionPredicateGroupCreation({
    flatEntityToValidate: flatRowLevelPermissionPredicateGroupToValidate,
    optimisticFlatEntityMapsAndRelatedFlatEntityMaps: {
      flatRowLevelPermissionPredicateGroupMaps:
        optimisticFlatRowLevelPermissionPredicateGroupMaps,
      flatRoleMaps,
      flatObjectMetadataMaps,
    },
    remainingFlatEntityMapsToValidate,
  }: UniversalFlatEntityValidationArgs<
    typeof ALL_METADATA_NAME.rowLevelPermissionPredicateGroup
  >): FailedFlatEntityValidation<
    'rowLevelPermissionPredicateGroup',
    'create'
  > {
    const validationResult = getEmptyFlatEntityValidationError({
      flatEntityMinimalInformation: {
        universalIdentifier:
          flatRowLevelPermissionPredicateGroupToValidate.universalIdentifier,
      },
      metadataName: 'rowLevelPermissionPredicateGroup',
      type: 'create',
    });

    const existingRowLevelPermissionPredicateGroup =
      findFlatEntityByUniversalIdentifier({
        universalIdentifier:
          flatRowLevelPermissionPredicateGroupToValidate.universalIdentifier,
        flatEntityMaps: optimisticFlatRowLevelPermissionPredicateGroupMaps,
      });

    if (isDefined(existingRowLevelPermissionPredicateGroup)) {
      validationResult.errors.push({
        code: WorkspaceMigrationRowLevelPermissionPredicateGroupExceptionCode.ROW_LEVEL_PERMISSION_PREDICATE_GROUP_ALREADY_EXISTS,
        message: t`Row level permission predicate group with this universal identifier already exists`,
        userFriendlyMessage: msg`Row level permission predicate group already exists`,
      });
    }

    const referencedRole = findFlatEntityByUniversalIdentifier({
      universalIdentifier:
        flatRowLevelPermissionPredicateGroupToValidate.roleUniversalIdentifier,
      flatEntityMaps: flatRoleMaps,
    });

    if (!isDefined(referencedRole)) {
      validationResult.errors.push({
        code: WorkspaceMigrationRowLevelPermissionPredicateGroupExceptionCode.INVALID_ROW_LEVEL_PERMISSION_PREDICATE_GROUP_DATA,
        message: t`Role not found`,
        userFriendlyMessage: msg`Role not found`,
      });
    }

    const referencedObjectMetadata = findFlatEntityByUniversalIdentifier({
      universalIdentifier:
        flatRowLevelPermissionPredicateGroupToValidate.objectMetadataUniversalIdentifier,
      flatEntityMaps: flatObjectMetadataMaps,
    });

    if (!isDefined(referencedObjectMetadata)) {
      validationResult.errors.push({
        code: WorkspaceMigrationRowLevelPermissionPredicateGroupExceptionCode.INVALID_ROW_LEVEL_PERMISSION_PREDICATE_GROUP_DATA,
        message: t`Object metadata not found`,
        userFriendlyMessage: msg`Object metadata not found`,
      });
    }

    if (
      isDefined(
        flatRowLevelPermissionPredicateGroupToValidate.parentRowLevelPermissionPredicateGroupUniversalIdentifier,
      )
    ) {
      const circularDependencyErrors =
        this.getCircularDependencyValidationErrors({
          rowLevelPermissionPredicateGroupUniversalIdentifier:
            flatRowLevelPermissionPredicateGroupToValidate.universalIdentifier,
          parentRowLevelPermissionPredicateGroupUniversalIdentifier:
            flatRowLevelPermissionPredicateGroupToValidate.parentRowLevelPermissionPredicateGroupUniversalIdentifier,
          flatRowLevelPermissionPredicateGroupMaps:
            optimisticFlatRowLevelPermissionPredicateGroupMaps,
        });

      if (circularDependencyErrors.length > 0) {
        validationResult.errors.push(...circularDependencyErrors);
      }

      const referencedParentInOptimistic = findFlatEntityByUniversalIdentifier(
        {
          universalIdentifier:
            flatRowLevelPermissionPredicateGroupToValidate.parentRowLevelPermissionPredicateGroupUniversalIdentifier,
          flatEntityMaps: optimisticFlatRowLevelPermissionPredicateGroupMaps,
        },
      );

      const referencedParentInRemaining = findFlatEntityByUniversalIdentifier({
        universalIdentifier:
          flatRowLevelPermissionPredicateGroupToValidate.parentRowLevelPermissionPredicateGroupUniversalIdentifier,
        flatEntityMaps: remainingFlatEntityMapsToValidate,
      });

      if (
        !isDefined(referencedParentInOptimistic) &&
        !isDefined(referencedParentInRemaining)
      ) {
        validationResult.errors.push({
          code: WorkspaceMigrationRowLevelPermissionPredicateGroupExceptionCode.ROW_LEVEL_PERMISSION_PREDICATE_GROUP_NOT_FOUND,
          message: t`Parent row level permission predicate group not found`,
          userFriendlyMessage: msg`Parent row level permission predicate group not found`,
        });
      }
    }

    return validationResult;
  }

  validateFlatRowLevelPermissionPredicateGroupDeletion({
    flatEntityToValidate: flatRowLevelPermissionPredicateGroupToValidate,
    optimisticFlatEntityMapsAndRelatedFlatEntityMaps: {
      flatRowLevelPermissionPredicateGroupMaps:
        optimisticFlatRowLevelPermissionPredicateGroupMaps,
    },
  }: UniversalFlatEntityValidationArgs<
    typeof ALL_METADATA_NAME.rowLevelPermissionPredicateGroup
  >): FailedFlatEntityValidation<
    'rowLevelPermissionPredicateGroup',
    'delete'
  > {
    const validationResult = getEmptyFlatEntityValidationError({
      flatEntityMinimalInformation: {
        universalIdentifier:
          flatRowLevelPermissionPredicateGroupToValidate.universalIdentifier,
      },
      metadataName: 'rowLevelPermissionPredicateGroup',
      type: 'delete',
    });

    const existingRowLevelPermissionPredicateGroup =
      findFlatEntityByUniversalIdentifier({
        universalIdentifier:
          flatRowLevelPermissionPredicateGroupToValidate.universalIdentifier,
        flatEntityMaps: optimisticFlatRowLevelPermissionPredicateGroupMaps,
      });

    if (!isDefined(existingRowLevelPermissionPredicateGroup)) {
      validationResult.errors.push({
        code: WorkspaceMigrationRowLevelPermissionPredicateGroupExceptionCode.ROW_LEVEL_PERMISSION_PREDICATE_GROUP_NOT_FOUND,
        message: t`Row level permission predicate group not found`,
        userFriendlyMessage: msg`Row level permission predicate group not found`,
      });
    }

    return validationResult;
  }

  validateFlatRowLevelPermissionPredicateGroupUpdate({
    universalIdentifier,
    flatEntityUpdate,
    optimisticFlatEntityMapsAndRelatedFlatEntityMaps: {
      flatRowLevelPermissionPredicateGroupMaps:
        optimisticFlatRowLevelPermissionPredicateGroupMaps,
    },
  }: FlatEntityUpdateValidationArgs<
    typeof ALL_METADATA_NAME.rowLevelPermissionPredicateGroup
  >): FailedFlatEntityValidation<
    'rowLevelPermissionPredicateGroup',
    'update'
  > {
    const existingRowLevelPermissionPredicateGroup =
      findFlatEntityByUniversalIdentifier({
        universalIdentifier,
        flatEntityMaps: optimisticFlatRowLevelPermissionPredicateGroupMaps,
      });

    const validationResult = getEmptyFlatEntityValidationError({
      flatEntityMinimalInformation: {
        universalIdentifier,
      },
      metadataName: 'rowLevelPermissionPredicateGroup',
      type: 'update',
    });

    if (!isDefined(existingRowLevelPermissionPredicateGroup)) {
      validationResult.errors.push({
        code: WorkspaceMigrationRowLevelPermissionPredicateGroupExceptionCode.ROW_LEVEL_PERMISSION_PREDICATE_GROUP_NOT_FOUND,
        message: t`Row level permission predicate group not found`,
        userFriendlyMessage: msg`Row level permission predicate group not found`,
      });

      return validationResult;
    }

    const parentRowLevelPermissionPredicateGroupUniversalIdentifierUpdate =
      flatEntityUpdate.parentRowLevelPermissionPredicateGroupUniversalIdentifier;

    if (
      !isDefined(
        parentRowLevelPermissionPredicateGroupUniversalIdentifierUpdate,
      )
    ) {
      return validationResult;
    }

    const newParentRowLevelPermissionPredicateGroupUniversalIdentifier =
      parentRowLevelPermissionPredicateGroupUniversalIdentifierUpdate;

    const circularDependencyErrors = this.getCircularDependencyValidationErrors(
      {
        rowLevelPermissionPredicateGroupUniversalIdentifier:
          existingRowLevelPermissionPredicateGroup.universalIdentifier,
        parentRowLevelPermissionPredicateGroupUniversalIdentifier:
          newParentRowLevelPermissionPredicateGroupUniversalIdentifier,
        flatRowLevelPermissionPredicateGroupMaps:
          optimisticFlatRowLevelPermissionPredicateGroupMaps,
      },
    );

    if (circularDependencyErrors.length > 0) {
      validationResult.errors.push(...circularDependencyErrors);
    }

    const referencedParentRowLevelPermissionPredicateGroup =
      findFlatEntityByUniversalIdentifier({
        universalIdentifier:
          newParentRowLevelPermissionPredicateGroupUniversalIdentifier,
        flatEntityMaps: optimisticFlatRowLevelPermissionPredicateGroupMaps,
      });

    if (!isDefined(referencedParentRowLevelPermissionPredicateGroup)) {
      validationResult.errors.push({
        code: WorkspaceMigrationRowLevelPermissionPredicateGroupExceptionCode.ROW_LEVEL_PERMISSION_PREDICATE_GROUP_NOT_FOUND,
        message: t`Parent row level permission predicate group not found`,
        userFriendlyMessage: msg`Parent row level permission predicate group not found`,
      });
    }

    return validationResult;
  }
}
