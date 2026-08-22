// SeaRM — AGPL-3.0. Clean-room reimplementation, mirroring the structure of
// the already-AGPL ViewFilterGroupService / view-widget-upsert multi-key
// migration-build pattern (no Enterprise source consulted). Diff/soft-delete
// semantics ("omitted predicates are deleted; empty list clears all rules")
// come from the AGPL tool contract in
// role/tools/upsert-row-level-permission-rules.tool.ts.

import { Injectable } from '@nestjs/common';

import { isDefined } from 'searm-shared/utils';

import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import { WorkspaceManyOrAllFlatEntityMapsCacheService } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service';
import { findFlatEntityByIdInFlatEntityMapsOrThrow } from 'src/engine/metadata-modules/flat-entity/utils/find-flat-entity-by-id-in-flat-entity-maps-or-throw.util';
import { fromCreateRowLevelPermissionPredicateInputToFlatRowLevelPermissionPredicate } from 'src/engine/metadata-modules/flat-row-level-permission-predicate/utils/from-create-row-level-permission-predicate-input-to-flat-row-level-permission-predicate.util';
import { fromFlatRowLevelPermissionPredicateGroupToDto } from 'src/engine/metadata-modules/flat-row-level-permission-predicate/utils/from-flat-row-level-permission-predicate-group-to-dto.util';
import { fromFlatRowLevelPermissionPredicateToDto } from 'src/engine/metadata-modules/flat-row-level-permission-predicate/utils/from-flat-row-level-permission-predicate-to-dto.util';
import { fromUpdateRowLevelPermissionPredicateInputToFlatRowLevelPermissionPredicate } from 'src/engine/metadata-modules/flat-row-level-permission-predicate/utils/from-update-row-level-permission-predicate-input-to-flat-row-level-permission-predicate.util';
import { type UpsertRowLevelPermissionPredicatesInput } from 'src/engine/metadata-modules/row-level-permission-predicate/dtos/inputs/upsert-row-level-permission-predicates.input';
import { type RowLevelPermissionPredicateDTO } from 'src/engine/metadata-modules/row-level-permission-predicate/dtos/row-level-permission-predicate.dto';
import { type UpsertRowLevelPermissionPredicatesResultDTO } from 'src/engine/metadata-modules/row-level-permission-predicate/dtos/upsert-row-level-permission-predicates-result.dto';
import { RowLevelPermissionPredicateGroupService } from 'src/engine/metadata-modules/row-level-permission-predicate/services/row-level-permission-predicate-group.service';
import { type FlatRowLevelPermissionPredicate } from 'src/engine/metadata-modules/row-level-permission-predicate/types/flat-row-level-permission-predicate.type';
import { validateRowLevelPermissionRuleOwnershipOrThrow } from 'src/engine/metadata-modules/row-level-permission-predicate/utils/validate-row-level-permission-rule-ownership.util';
import { WorkspaceMigrationBuilderException } from 'src/engine/workspace-manager/workspace-migration/exceptions/workspace-migration-builder-exception';
import { WorkspaceMigrationValidateBuildAndRunService } from 'src/engine/workspace-manager/workspace-migration/services/workspace-migration-validate-build-and-run-service';

@Injectable()
export class RowLevelPermissionPredicateService {
  constructor(
    private readonly workspaceMigrationValidateBuildAndRunService: WorkspaceMigrationValidateBuildAndRunService,
    private readonly flatEntityMapsCacheService: WorkspaceManyOrAllFlatEntityMapsCacheService,
    private readonly applicationService: ApplicationService,
    private readonly rowLevelPermissionPredicateGroupService: RowLevelPermissionPredicateGroupService,
  ) {}

  async findByWorkspaceId(
    workspaceId: string,
  ): Promise<RowLevelPermissionPredicateDTO[]> {
    const { flatRowLevelPermissionPredicateMaps } =
      await this.flatEntityMapsCacheService.getOrRecomputeManyOrAllFlatEntityMaps(
        {
          workspaceId,
          flatMapsKeys: ['flatRowLevelPermissionPredicateMaps'],
        },
      );

    return Object.values(
      flatRowLevelPermissionPredicateMaps.byUniversalIdentifier,
    )
      .filter(
        (flatPredicate): flatPredicate is FlatRowLevelPermissionPredicate =>
          isDefined(flatPredicate) && !isDefined(flatPredicate.deletedAt),
      )
      .map(fromFlatRowLevelPermissionPredicateToDto);
  }

  async upsertRowLevelPermissionPredicates({
    workspaceId,
    input,
  }: {
    workspaceId: string;
    input: UpsertRowLevelPermissionPredicatesInput;
  }): Promise<UpsertRowLevelPermissionPredicatesResultDTO> {
    const { roleId, objectMetadataId } = input;
    const predicateInputs = input.predicates;
    const predicateGroupInputs = input.predicateGroups ?? [];

    const { workspaceCustomFlatApplication } =
      await this.applicationService.findWorkspaceSearmStandardAndCustomApplicationOrThrow(
        {
          workspaceId,
        },
      );

    const {
      flatRoleMaps,
      flatObjectMetadataMaps,
      flatFieldMetadataMaps,
      flatRowLevelPermissionPredicateMaps: existingFlatRowLevelPermissionPredicateMaps,
      flatRowLevelPermissionPredicateGroupMaps:
        existingFlatRowLevelPermissionPredicateGroupMaps,
    } = await this.flatEntityMapsCacheService.getOrRecomputeManyOrAllFlatEntityMaps(
      {
        workspaceId,
        flatMapsKeys: [
          'flatRoleMaps',
          'flatObjectMetadataMaps',
          'flatFieldMetadataMaps',
          'flatRowLevelPermissionPredicateMaps',
          'flatRowLevelPermissionPredicateGroupMaps',
        ],
      },
    );

    const flatRole = findFlatEntityByIdInFlatEntityMapsOrThrow({
      flatEntityMaps: flatRoleMaps,
      flatEntityId: roleId,
    });

    const flatObjectMetadata = findFlatEntityByIdInFlatEntityMapsOrThrow({
      flatEntityMaps: flatObjectMetadataMaps,
      flatEntityId: objectMetadataId,
    });

    // Fail closed: an upsert must never be able to persist a predicate that
    // references (or hijacks) a row it does not own — see the util's own
    // doc comment for the full rationale.
    validateRowLevelPermissionRuleOwnershipOrThrow({
      roleId,
      objectMetadataId,
      predicates: predicateInputs,
      predicateGroups: predicateGroupInputs,
      existingFlatRowLevelPermissionPredicateMaps,
      existingFlatRowLevelPermissionPredicateGroupMaps,
    });

    const { flatEntityToCreate: groupsToCreate, flatEntityToUpdate: groupsToUpdate } =
      this.rowLevelPermissionPredicateGroupService.buildUpsertOperations({
        roleId,
        roleUniversalIdentifier: flatRole.universalIdentifier,
        objectMetadataId,
        workspaceId,
        flatApplication: workspaceCustomFlatApplication,
        predicateGroupInputs,
        existingFlatRowLevelPermissionPredicateGroupMaps,
        flatObjectMetadataMaps,
      });

    const existingOwnedPredicates = Object.values(
      existingFlatRowLevelPermissionPredicateMaps.byUniversalIdentifier,
    ).filter(
      (flatPredicate): flatPredicate is FlatRowLevelPermissionPredicate =>
        isDefined(flatPredicate) &&
        flatPredicate.roleId === roleId &&
        flatPredicate.objectMetadataId === objectMetadataId &&
        !isDefined(flatPredicate.deletedAt),
    );

    const predicateInputIds = new Set(
      predicateInputs.map((predicateInput) => predicateInput.id).filter(isDefined),
    );

    const predicatesToCreate: FlatRowLevelPermissionPredicate[] = [];
    const predicatesToUpdate: FlatRowLevelPermissionPredicate[] = [];

    for (const predicateInput of predicateInputs) {
      const existingPredicate = isDefined(predicateInput.id)
        ? existingOwnedPredicates.find(
            (predicate) => predicate.id === predicateInput.id,
          )
        : undefined;

      if (isDefined(existingPredicate)) {
        predicatesToUpdate.push(
          fromUpdateRowLevelPermissionPredicateInputToFlatRowLevelPermissionPredicate(
            {
              input: predicateInput,
              existingPredicate,
              flatFieldMetadataMaps,
              flatRowLevelPermissionPredicateGroupMaps:
                existingFlatRowLevelPermissionPredicateGroupMaps,
            },
          ),
        );
      } else {
        predicatesToCreate.push(
          fromCreateRowLevelPermissionPredicateInputToFlatRowLevelPermissionPredicate(
            {
              input: predicateInput,
              roleId,
              objectMetadataId,
              workspaceId,
              roleUniversalIdentifier: flatRole.universalIdentifier,
              objectMetadataUniversalIdentifier:
                flatObjectMetadata.universalIdentifier,
              flatApplication: workspaceCustomFlatApplication,
              flatFieldMetadataMaps,
              flatRowLevelPermissionPredicateGroupMaps:
                existingFlatRowLevelPermissionPredicateGroupMaps,
            },
          ),
        );
      }
    }

    const deletedAt = new Date().toISOString();

    for (const existingPredicate of existingOwnedPredicates) {
      if (!predicateInputIds.has(existingPredicate.id)) {
        predicatesToUpdate.push({
          ...existingPredicate,
          deletedAt,
        });
      }
    }

    const buildAndRunResult =
      await this.workspaceMigrationValidateBuildAndRunService.validateBuildAndRunWorkspaceMigration(
        {
          allFlatEntityOperationByMetadataName: {
            rowLevelPermissionPredicateGroup: {
              flatEntityToCreate: groupsToCreate,
              flatEntityToDelete: [],
              flatEntityToUpdate: groupsToUpdate,
            },
            rowLevelPermissionPredicate: {
              flatEntityToCreate: predicatesToCreate,
              flatEntityToDelete: [],
              flatEntityToUpdate: predicatesToUpdate,
            },
          },
          workspaceId,
          isSystemBuild: false,
          applicationUniversalIdentifier:
            workspaceCustomFlatApplication.universalIdentifier,
        },
      );

    if (buildAndRunResult.status === 'fail') {
      throw new WorkspaceMigrationBuilderException(
        buildAndRunResult,
        'Multiple validation errors occurred while upserting row level permission predicates',
      );
    }

    const {
      flatRowLevelPermissionPredicateMaps: recomputedFlatPredicateMaps,
      flatRowLevelPermissionPredicateGroupMaps: recomputedFlatGroupMaps,
    } = await this.flatEntityMapsCacheService.getOrRecomputeManyOrAllFlatEntityMaps(
      {
        workspaceId,
        flatMapsKeys: [
          'flatRowLevelPermissionPredicateMaps',
          'flatRowLevelPermissionPredicateGroupMaps',
        ],
      },
    );

    const resultingPredicates = Object.values(
      recomputedFlatPredicateMaps.byUniversalIdentifier,
    ).filter(
      (flatPredicate): flatPredicate is FlatRowLevelPermissionPredicate =>
        isDefined(flatPredicate) &&
        flatPredicate.roleId === roleId &&
        flatPredicate.objectMetadataId === objectMetadataId &&
        !isDefined(flatPredicate.deletedAt),
    );

    const resultingGroups = Object.values(
      recomputedFlatGroupMaps.byUniversalIdentifier,
    ).filter(
      (flatGroup) =>
        isDefined(flatGroup) &&
        flatGroup.roleId === roleId &&
        flatGroup.objectMetadataId === objectMetadataId &&
        !isDefined(flatGroup.deletedAt),
    );

    return {
      predicates: resultingPredicates.map(fromFlatRowLevelPermissionPredicateToDto),
      predicateGroups: resultingGroups.map((flatGroup) =>
        fromFlatRowLevelPermissionPredicateGroupToDto(flatGroup!),
      ),
    };
  }
}
