// SeaRM — AGPL-3.0. Clean-room reimplementation of the row-level-permission
// predicate flat-entity validator (no Twenty Enterprise source consulted;
// derived from the sibling flat-view-filter validator service, the AGPL
// flat-row-level-permission-predicate mappers which fix the field shape of
// FlatRowLevelPermissionPredicate, and the committed RLP recon which fixes
// the deny-by-default security contract).

import { Injectable } from '@nestjs/common';

import { msg, t } from '@lingui/core/macro';
import { ALL_METADATA_NAME } from 'twenty-shared/metadata';
import { isDefined } from 'twenty-shared/utils';

import { findFlatEntityByUniversalIdentifier } from 'src/engine/metadata-modules/flat-entity/utils/find-flat-entity-by-universal-identifier.util';
import { type FailedFlatEntityValidation } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/builders/types/failed-flat-entity-validation.type';
import { getEmptyFlatEntityValidationError } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/builders/utils/get-flat-entity-validation-error.util';
import { type FlatEntityUpdateValidationArgs } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/types/universal-flat-entity-update-validation-args.type';
import { type UniversalFlatEntityValidationArgs } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/types/universal-flat-entity-validation-args.type';

// Local exception codes: the upstream RowLevelPermissionPredicateExceptionCode
// enum lives in an Enterprise-headered file we cannot open or depend on, so
// this validator defines and owns its own codes. FlatEntityValidationError
// "code" field is generic over string, so this is a compatible substitute.
export enum WorkspaceMigrationRowLevelPermissionPredicateExceptionCode {
  ROW_LEVEL_PERMISSION_PREDICATE_ALREADY_EXISTS = 'ROW_LEVEL_PERMISSION_PREDICATE_ALREADY_EXISTS',
  ROW_LEVEL_PERMISSION_PREDICATE_NOT_FOUND = 'ROW_LEVEL_PERMISSION_PREDICATE_NOT_FOUND',
  INVALID_ROW_LEVEL_PERMISSION_PREDICATE_DATA = 'INVALID_ROW_LEVEL_PERMISSION_PREDICATE_DATA',
}

@Injectable()
export class FlatRowLevelPermissionPredicateValidatorService {
  constructor() {}

  validateFlatRowLevelPermissionPredicateCreation({
    flatEntityToValidate: flatRowLevelPermissionPredicateToValidate,
    optimisticFlatEntityMapsAndRelatedFlatEntityMaps: {
      flatRowLevelPermissionPredicateMaps:
        optimisticFlatRowLevelPermissionPredicateMaps,
      flatFieldMetadataMaps,
      flatRoleMaps,
      flatObjectMetadataMaps,
      flatRowLevelPermissionPredicateGroupMaps,
    },
  }: UniversalFlatEntityValidationArgs<
    typeof ALL_METADATA_NAME.rowLevelPermissionPredicate
  >): FailedFlatEntityValidation<'rowLevelPermissionPredicate', 'create'> {
    const validationResult = getEmptyFlatEntityValidationError({
      flatEntityMinimalInformation: {
        universalIdentifier:
          flatRowLevelPermissionPredicateToValidate.universalIdentifier,
      },
      metadataName: 'rowLevelPermissionPredicate',
      type: 'create',
    });

    const existingRowLevelPermissionPredicate =
      findFlatEntityByUniversalIdentifier({
        universalIdentifier:
          flatRowLevelPermissionPredicateToValidate.universalIdentifier,
        flatEntityMaps: optimisticFlatRowLevelPermissionPredicateMaps,
      });

    if (isDefined(existingRowLevelPermissionPredicate)) {
      validationResult.errors.push({
        code: WorkspaceMigrationRowLevelPermissionPredicateExceptionCode.ROW_LEVEL_PERMISSION_PREDICATE_ALREADY_EXISTS,
        message: t`Row level permission predicate with this universal identifier already exists`,
        userFriendlyMessage: msg`Row level permission predicate already exists`,
      });
    }

    const referencedRole = findFlatEntityByUniversalIdentifier({
      universalIdentifier:
        flatRowLevelPermissionPredicateToValidate.roleUniversalIdentifier,
      flatEntityMaps: flatRoleMaps,
    });

    if (!isDefined(referencedRole)) {
      validationResult.errors.push({
        code: WorkspaceMigrationRowLevelPermissionPredicateExceptionCode.INVALID_ROW_LEVEL_PERMISSION_PREDICATE_DATA,
        message: t`Role not found`,
        userFriendlyMessage: msg`Role not found`,
      });
    }

    const referencedObjectMetadata = findFlatEntityByUniversalIdentifier({
      universalIdentifier:
        flatRowLevelPermissionPredicateToValidate.objectMetadataUniversalIdentifier,
      flatEntityMaps: flatObjectMetadataMaps,
    });

    if (!isDefined(referencedObjectMetadata)) {
      validationResult.errors.push({
        code: WorkspaceMigrationRowLevelPermissionPredicateExceptionCode.INVALID_ROW_LEVEL_PERMISSION_PREDICATE_DATA,
        message: t`Object metadata not found`,
        userFriendlyMessage: msg`Object metadata not found`,
      });
    }

    const referencedFieldMetadata = findFlatEntityByUniversalIdentifier({
      universalIdentifier:
        flatRowLevelPermissionPredicateToValidate.fieldMetadataUniversalIdentifier,
      flatEntityMaps: flatFieldMetadataMaps,
    });

    if (!isDefined(referencedFieldMetadata)) {
      validationResult.errors.push({
        code: WorkspaceMigrationRowLevelPermissionPredicateExceptionCode.INVALID_ROW_LEVEL_PERMISSION_PREDICATE_DATA,
        message: t`Field metadata not found`,
        userFriendlyMessage: msg`Field metadata not found`,
      });
    }

    if (
      isDefined(
        flatRowLevelPermissionPredicateToValidate.workspaceMemberFieldMetadataUniversalIdentifier,
      )
    ) {
      const referencedWorkspaceMemberFieldMetadata =
        findFlatEntityByUniversalIdentifier({
          universalIdentifier:
            flatRowLevelPermissionPredicateToValidate.workspaceMemberFieldMetadataUniversalIdentifier,
          flatEntityMaps: flatFieldMetadataMaps,
        });

      if (!isDefined(referencedWorkspaceMemberFieldMetadata)) {
        validationResult.errors.push({
          code: WorkspaceMigrationRowLevelPermissionPredicateExceptionCode.INVALID_ROW_LEVEL_PERMISSION_PREDICATE_DATA,
          message: t`Workspace member field metadata not found`,
          userFriendlyMessage: msg`Workspace member field metadata not found`,
        });
      }
    }

    if (
      isDefined(
        flatRowLevelPermissionPredicateToValidate.rowLevelPermissionPredicateGroupUniversalIdentifier,
      )
    ) {
      const referencedGroup = findFlatEntityByUniversalIdentifier({
        universalIdentifier:
          flatRowLevelPermissionPredicateToValidate.rowLevelPermissionPredicateGroupUniversalIdentifier,
        flatEntityMaps: flatRowLevelPermissionPredicateGroupMaps,
      });

      if (!isDefined(referencedGroup)) {
        validationResult.errors.push({
          code: WorkspaceMigrationRowLevelPermissionPredicateExceptionCode.INVALID_ROW_LEVEL_PERMISSION_PREDICATE_DATA,
          message: t`Row level permission predicate group not found`,
          userFriendlyMessage: msg`Row level permission predicate group not found`,
        });
      }
    }

    // Deny-by-default contract (see rlp-recon.md): a predicate that resolves
    // to neither a standalone field comparison nor a group membership is
    // structurally meaningless and MUST fail validation rather than being
    // silently accepted as a no-op predicate that grants unrestricted access.
    if (
      !isDefined(referencedFieldMetadata) &&
      !isDefined(
        flatRowLevelPermissionPredicateToValidate.rowLevelPermissionPredicateGroupUniversalIdentifier,
      )
    ) {
      validationResult.errors.push({
        code: WorkspaceMigrationRowLevelPermissionPredicateExceptionCode.INVALID_ROW_LEVEL_PERMISSION_PREDICATE_DATA,
        message: t`Row level permission predicate must reference either a field or a predicate group`,
        userFriendlyMessage: msg`Row level permission predicate is missing a field or group reference`,
      });
    }

    return validationResult;
  }

  validateFlatRowLevelPermissionPredicateDeletion({
    flatEntityToValidate: flatRowLevelPermissionPredicateToValidate,
    optimisticFlatEntityMapsAndRelatedFlatEntityMaps: {
      flatRowLevelPermissionPredicateMaps:
        optimisticFlatRowLevelPermissionPredicateMaps,
    },
  }: UniversalFlatEntityValidationArgs<
    typeof ALL_METADATA_NAME.rowLevelPermissionPredicate
  >): FailedFlatEntityValidation<'rowLevelPermissionPredicate', 'delete'> {
    const validationResult = getEmptyFlatEntityValidationError({
      flatEntityMinimalInformation: {
        universalIdentifier:
          flatRowLevelPermissionPredicateToValidate.universalIdentifier,
      },
      metadataName: 'rowLevelPermissionPredicate',
      type: 'delete',
    });

    const existingRowLevelPermissionPredicate =
      findFlatEntityByUniversalIdentifier({
        universalIdentifier:
          flatRowLevelPermissionPredicateToValidate.universalIdentifier,
        flatEntityMaps: optimisticFlatRowLevelPermissionPredicateMaps,
      });

    if (!isDefined(existingRowLevelPermissionPredicate)) {
      validationResult.errors.push({
        code: WorkspaceMigrationRowLevelPermissionPredicateExceptionCode.ROW_LEVEL_PERMISSION_PREDICATE_NOT_FOUND,
        message: t`Row level permission predicate not found`,
        userFriendlyMessage: msg`Row level permission predicate not found`,
      });

      return validationResult;
    }

    return validationResult;
  }

  validateFlatRowLevelPermissionPredicateUpdate({
    universalIdentifier,
    flatEntityUpdate,
    optimisticFlatEntityMapsAndRelatedFlatEntityMaps: {
      flatRowLevelPermissionPredicateMaps:
        optimisticFlatRowLevelPermissionPredicateMaps,
      flatFieldMetadataMaps,
      flatRowLevelPermissionPredicateGroupMaps,
    },
  }: FlatEntityUpdateValidationArgs<
    typeof ALL_METADATA_NAME.rowLevelPermissionPredicate
  >): FailedFlatEntityValidation<'rowLevelPermissionPredicate', 'update'> {
    const existingRowLevelPermissionPredicate =
      findFlatEntityByUniversalIdentifier({
        universalIdentifier,
        flatEntityMaps: optimisticFlatRowLevelPermissionPredicateMaps,
      });

    const validationResult = getEmptyFlatEntityValidationError({
      flatEntityMinimalInformation: {
        universalIdentifier,
      },
      metadataName: 'rowLevelPermissionPredicate',
      type: 'update',
    });

    if (!isDefined(existingRowLevelPermissionPredicate)) {
      validationResult.errors.push({
        code: WorkspaceMigrationRowLevelPermissionPredicateExceptionCode.ROW_LEVEL_PERMISSION_PREDICATE_NOT_FOUND,
        message: t`Row level permission predicate not found`,
        userFriendlyMessage: msg`Row level permission predicate not found`,
      });

      return validationResult;
    }

    const updatedFlatRowLevelPermissionPredicate = {
      ...existingRowLevelPermissionPredicate,
      ...flatEntityUpdate,
    };

    if (
      isDefined(
        updatedFlatRowLevelPermissionPredicate.fieldMetadataUniversalIdentifier,
      )
    ) {
      const referencedFieldMetadata = findFlatEntityByUniversalIdentifier({
        universalIdentifier:
          updatedFlatRowLevelPermissionPredicate.fieldMetadataUniversalIdentifier,
        flatEntityMaps: flatFieldMetadataMaps,
      });

      if (!isDefined(referencedFieldMetadata)) {
        validationResult.errors.push({
          code: WorkspaceMigrationRowLevelPermissionPredicateExceptionCode.INVALID_ROW_LEVEL_PERMISSION_PREDICATE_DATA,
          message: t`Field metadata not found`,
          userFriendlyMessage: msg`Field metadata not found`,
        });
      }
    }

    if (
      isDefined(
        updatedFlatRowLevelPermissionPredicate.rowLevelPermissionPredicateGroupUniversalIdentifier,
      )
    ) {
      const referencedGroup = findFlatEntityByUniversalIdentifier({
        universalIdentifier:
          updatedFlatRowLevelPermissionPredicate.rowLevelPermissionPredicateGroupUniversalIdentifier,
        flatEntityMaps: flatRowLevelPermissionPredicateGroupMaps,
      });

      if (!isDefined(referencedGroup)) {
        validationResult.errors.push({
          code: WorkspaceMigrationRowLevelPermissionPredicateExceptionCode.INVALID_ROW_LEVEL_PERMISSION_PREDICATE_DATA,
          message: t`Row level permission predicate group not found`,
          userFriendlyMessage: msg`Row level permission predicate group not found`,
        });
      }
    }

    if (
      !isDefined(
        updatedFlatRowLevelPermissionPredicate.fieldMetadataUniversalIdentifier,
      ) &&
      !isDefined(
        updatedFlatRowLevelPermissionPredicate.rowLevelPermissionPredicateGroupUniversalIdentifier,
      )
    ) {
      validationResult.errors.push({
        code: WorkspaceMigrationRowLevelPermissionPredicateExceptionCode.INVALID_ROW_LEVEL_PERMISSION_PREDICATE_DATA,
        message: t`Row level permission predicate must reference either a field or a predicate group`,
        userFriendlyMessage: msg`Row level permission predicate is missing a field or group reference`,
      });
    }

    return validationResult;
  }
}
