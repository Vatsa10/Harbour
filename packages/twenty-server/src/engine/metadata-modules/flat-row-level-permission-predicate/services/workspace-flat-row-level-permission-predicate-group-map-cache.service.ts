// SeaRM — AGPL-3.0. Clean-room reimplementation, mirroring the structure of
// the already-AGPL sibling WorkspaceFlatRowLevelPermissionPredicateMapCacheService
// in the same package, adapted for the predicate-group variant (adds
// self-referential parent-group id resolution). No Enterprise source
// consulted.

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { ApplicationEntity } from 'src/engine/core-modules/application/application.entity';
import { createEmptyFlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/constant/create-empty-flat-entity-maps.constant';
import { fromRowLevelPermissionPredicateGroupEntityToFlatRowLevelPermissionPredicateGroup } from 'src/engine/metadata-modules/flat-row-level-permission-predicate/utils/from-row-level-permission-predicate-group-entity-to-flat-row-level-permission-predicate-group.util';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';
import { RowLevelPermissionPredicateGroupEntity } from 'src/engine/metadata-modules/row-level-permission-predicate/entities/row-level-permission-predicate-group.entity';
import { type FlatRowLevelPermissionPredicateGroupMaps } from 'src/engine/metadata-modules/row-level-permission-predicate/types/flat-row-level-permission-predicate-group-maps.type';
import { InjectWorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/inject-workspace-scoped-repository.decorator';
import { WorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/workspace-scoped-repository';
import { WorkspaceCache } from 'src/engine/workspace-cache/decorators/workspace-cache.decorator';
import { WorkspaceCacheProvider } from 'src/engine/workspace-cache/interfaces/workspace-cache-provider.service';
import { createIdToUniversalIdentifierMap } from 'src/engine/workspace-cache/utils/create-id-to-universal-identifier-map.util';
import { addFlatEntityToFlatEntityMapsThroughMutationOrThrow } from 'src/engine/workspace-manager/workspace-migration/utils/add-flat-entity-to-flat-entity-maps-through-mutation-or-throw.util';

@Injectable()
@WorkspaceCache('flatRowLevelPermissionPredicateGroupMaps')
export class WorkspaceFlatRowLevelPermissionPredicateGroupMapCacheService extends WorkspaceCacheProvider<FlatRowLevelPermissionPredicateGroupMaps> {
  constructor(
    @InjectWorkspaceScopedRepository(RowLevelPermissionPredicateGroupEntity)
    private readonly rowLevelPermissionPredicateGroupRepository: WorkspaceScopedRepository<RowLevelPermissionPredicateGroupEntity>,
    @InjectRepository(ApplicationEntity)
    private readonly applicationRepository: Repository<ApplicationEntity>,
    @InjectWorkspaceScopedRepository(RoleEntity)
    private readonly roleRepository: WorkspaceScopedRepository<RoleEntity>,
    @InjectRepository(ObjectMetadataEntity)
    private readonly objectMetadataRepository: Repository<ObjectMetadataEntity>,
  ) {
    super();
  }

  async computeForCache(
    workspaceId: string,
  ): Promise<FlatRowLevelPermissionPredicateGroupMaps> {
    const [
      rowLevelPermissionPredicateGroups,
      applications,
      roles,
      objectMetadatas,
    ] = await Promise.all([
      this.rowLevelPermissionPredicateGroupRepository.find(workspaceId, {
        withDeleted: true,
      }),
      this.applicationRepository.find({
        where: { workspaceId },
        select: ['id', 'universalIdentifier'],
        withDeleted: true,
      }),
      this.roleRepository.find(workspaceId, {
        select: ['id', 'universalIdentifier'],
        withDeleted: true,
      }),
      this.objectMetadataRepository.find({
        where: { workspaceId },
        select: ['id', 'universalIdentifier'],
        withDeleted: true,
      }),
    ]);

    const applicationIdToUniversalIdentifierMap =
      createIdToUniversalIdentifierMap(applications);
    const roleIdToUniversalIdentifierMap =
      createIdToUniversalIdentifierMap(roles);
    const objectMetadataIdToUniversalIdentifierMap =
      createIdToUniversalIdentifierMap(objectMetadatas);
    const rowLevelPermissionPredicateGroupIdToUniversalIdentifierMap =
      createIdToUniversalIdentifierMap(rowLevelPermissionPredicateGroups);

    const flatRowLevelPermissionPredicateGroupMaps =
      createEmptyFlatEntityMaps();

    for (const rowLevelPermissionPredicateGroupEntity of rowLevelPermissionPredicateGroups) {
      const flatRowLevelPermissionPredicateGroup =
        fromRowLevelPermissionPredicateGroupEntityToFlatRowLevelPermissionPredicateGroup(
          {
            entity: rowLevelPermissionPredicateGroupEntity,
            applicationIdToUniversalIdentifierMap,
            roleIdToUniversalIdentifierMap,
            objectMetadataIdToUniversalIdentifierMap,
            parentRowLevelPermissionPredicateGroupIdToUniversalIdentifierMap:
              rowLevelPermissionPredicateGroupIdToUniversalIdentifierMap,
          },
        );

      addFlatEntityToFlatEntityMapsThroughMutationOrThrow({
        flatEntity: flatRowLevelPermissionPredicateGroup,
        flatEntityMapsToMutate: flatRowLevelPermissionPredicateGroupMaps,
      });
    }

    return flatRowLevelPermissionPredicateGroupMaps;
  }
}
