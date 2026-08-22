// SeaRM — AGPL-3.0. Clean-room reimplementation, mirroring the structure of
// the already-AGPL ViewFilterGroupService (no Enterprise source consulted).
// Diff/soft-delete semantics ("omitted groups are deleted") come from the
// AGPL tool contract in
// role/tools/upsert-row-level-permission-rules.tool.ts, which documents
// "the complete list of predicate groups to keep for this role and object.
// Existing groups omitted from the list are deleted."

import { Injectable } from '@nestjs/common';

import { isDefined } from 'searm-shared/utils';

import { type FlatApplication } from 'src/engine/core-modules/application/types/flat-application.type';
import { WorkspaceManyOrAllFlatEntityMapsCacheService } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service';
import { type AllFlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/types/all-flat-entity-maps.type';
import { type FlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/types/flat-entity-maps.type';
import { fromCreateRowLevelPermissionPredicateGroupInputToFlatRowLevelPermissionPredicateGroup } from 'src/engine/metadata-modules/flat-row-level-permission-predicate/utils/from-create-row-level-permission-predicate-group-input-to-flat-row-level-permission-predicate-group.util';
import { fromFlatRowLevelPermissionPredicateGroupToDto } from 'src/engine/metadata-modules/flat-row-level-permission-predicate/utils/from-flat-row-level-permission-predicate-group-to-dto.util';
import { fromUpdateRowLevelPermissionPredicateGroupInputToFlatRowLevelPermissionPredicateGroup } from 'src/engine/metadata-modules/flat-row-level-permission-predicate/utils/from-update-row-level-permission-predicate-group-input-to-flat-row-level-permission-predicate-group.util';
import { type RowLevelPermissionPredicateGroupInput } from 'src/engine/metadata-modules/row-level-permission-predicate/dtos/inputs/upsert-row-level-permission-predicates.input';
import { type RowLevelPermissionPredicateGroupDTO } from 'src/engine/metadata-modules/row-level-permission-predicate/dtos/row-level-permission-predicate-group.dto';
import { type FlatRowLevelPermissionPredicateGroup } from 'src/engine/metadata-modules/row-level-permission-predicate/types/flat-row-level-permission-predicate-group.type';

export type RowLevelPermissionPredicateGroupUpsertOperations = {
  flatEntityToCreate: FlatRowLevelPermissionPredicateGroup[];
  flatEntityToUpdate: FlatRowLevelPermissionPredicateGroup[];
};

@Injectable()
export class RowLevelPermissionPredicateGroupService {
  constructor(
    private readonly flatEntityMapsCacheService: WorkspaceManyOrAllFlatEntityMapsCacheService,
  ) {}

  async findByWorkspaceId(
    workspaceId: string,
  ): Promise<RowLevelPermissionPredicateGroupDTO[]> {
    const { flatRowLevelPermissionPredicateGroupMaps } =
      await this.flatEntityMapsCacheService.getOrRecomputeManyOrAllFlatEntityMaps(
        {
          workspaceId,
          flatMapsKeys: ['flatRowLevelPermissionPredicateGroupMaps'],
        },
      );

    return Object.values(
      flatRowLevelPermissionPredicateGroupMaps.byUniversalIdentifier,
    )
      .filter(
        (flatGroup): flatGroup is FlatRowLevelPermissionPredicateGroup =>
          isDefined(flatGroup) && !isDefined(flatGroup.deletedAt),
      )
      .map(fromFlatRowLevelPermissionPredicateGroupToDto);
  }

  async findByRole(
    workspaceId: string,
    roleId: string,
  ): Promise<RowLevelPermissionPredicateGroupDTO[]> {
    const allGroups = await this.findByWorkspaceId(workspaceId);

    return allGroups.filter((group) => group.roleId === roleId);
  }

  buildUpsertOperations({
    roleId,
    roleUniversalIdentifier,
    objectMetadataId,
    workspaceId,
    flatApplication,
    predicateGroupInputs,
    existingFlatRowLevelPermissionPredicateGroupMaps,
    flatObjectMetadataMaps,
  }: {
    roleId: string;
    roleUniversalIdentifier: string;
    objectMetadataId: string;
    workspaceId: string;
    flatApplication: FlatApplication;
    predicateGroupInputs: RowLevelPermissionPredicateGroupInput[];
    existingFlatRowLevelPermissionPredicateGroupMaps: FlatEntityMaps<FlatRowLevelPermissionPredicateGroup>;
  } & Pick<
    AllFlatEntityMaps,
    'flatObjectMetadataMaps'
  >): RowLevelPermissionPredicateGroupUpsertOperations {
    const existingOwnedGroups = Object.values(
      existingFlatRowLevelPermissionPredicateGroupMaps.byUniversalIdentifier,
    ).filter(
      (
        flatGroup,
      ): flatGroup is FlatRowLevelPermissionPredicateGroup =>
        isDefined(flatGroup) &&
        flatGroup.roleId === roleId &&
        flatGroup.objectMetadataId === objectMetadataId &&
        !isDefined(flatGroup.deletedAt),
    );

    const inputIds = new Set(
      predicateGroupInputs.map((input) => input.id).filter(isDefined),
    );

    const flatEntityToCreate: FlatRowLevelPermissionPredicateGroup[] = [];
    const flatEntityToUpdate: FlatRowLevelPermissionPredicateGroup[] = [];

    for (const input of predicateGroupInputs) {
      const existingGroup = isDefined(input.id)
        ? existingOwnedGroups.find((group) => group.id === input.id)
        : undefined;

      if (isDefined(existingGroup)) {
        flatEntityToUpdate.push(
          fromUpdateRowLevelPermissionPredicateGroupInputToFlatRowLevelPermissionPredicateGroup(
            {
              input,
              existingGroup,
              flatRowLevelPermissionPredicateGroupMaps:
                existingFlatRowLevelPermissionPredicateGroupMaps,
            },
          ),
        );
      } else {
        flatEntityToCreate.push(
          fromCreateRowLevelPermissionPredicateGroupInputToFlatRowLevelPermissionPredicateGroup(
            {
              input,
              roleId,
              workspaceId,
              roleUniversalIdentifier,
              flatApplication,
              flatObjectMetadataMaps,
              flatRowLevelPermissionPredicateGroupMaps:
                existingFlatRowLevelPermissionPredicateGroupMaps,
            },
          ),
        );
      }
    }

    const deletedAt = new Date().toISOString();

    for (const existingGroup of existingOwnedGroups) {
      if (!inputIds.has(existingGroup.id)) {
        flatEntityToUpdate.push({
          ...existingGroup,
          deletedAt,
        });
      }
    }

    return { flatEntityToCreate, flatEntityToUpdate };
  }
}
